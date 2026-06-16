"""
Biometric Fingerprint Registration & Verification System
Arduino Integration via Serial Communication
"""

import serial
import serial.tools.list_ports
import time
import json
import re
import threading
import uuid
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Arduino Configuration
SERIAL_PORT = 'COM6'
ACTIVE_SERIAL_PORT = SERIAL_PORT
BAUD_RATE = 115200
TIMEOUT = 2
READ_DURATION = 15
WRITE_DELAY = 0.15
RETRY_COUNT = 4
MAX_PROMPT_REPEATS = 40
FINAL_MARKERS = (
    "STORED",
    "SAVED",
    "ENROLLED",
    "REGISTERED",
    "MATCHED",
    "NOT MATCHED",
    "FINGERPRINTS DID NOT MATCH",
    "DATABASE CLEARED",
    "DELETED ID",
    "ERROR",
)

# Global serial connection
ser = None
lock = threading.Lock()
session_lock = threading.Lock()
register_sessions = {}

# Fingerprint user mapping: email -> {user_id, fingerprint_ids, fingerprint_names}
fingerprint_users = {}
FINGERPRINTS_PER_USER = 5  # Each user can register up to 5 fingerprints
TOTAL_FINGERPRINTS = 120


def _get_or_create_user_fp_record(email):
    """Get or create fingerprint record for a user."""
    global fingerprint_users
    
    if email not in fingerprint_users:
        # Assign user ID based on number of existing users
        user_id = len(fingerprint_users)
        start_id = user_id * FINGERPRINTS_PER_USER
        end_id = start_id + FINGERPRINTS_PER_USER
        
        if end_id > TOTAL_FINGERPRINTS:
            return None, f"Cannot allocate fingerprint IDs: system full"
        
        fingerprint_users[email] = {
            "user_id": user_id,
            "email": email,
            "fingerprint_ids": list(range(start_id, end_id)),
            "fingerprint_names": ["Fingerprint 1", "Fingerprint 2", "Fingerprint 3", "Fingerprint 4", "Fingerprint 5"],
            "fingerprint_count": 0,
            "created_at": time.time()
        }
    
    return fingerprint_users[email], None


def _get_next_available_fp_id(email):
    """Get next available fingerprint ID for user."""
    user_record, error = _get_or_create_user_fp_record(email)
    
    if error:
        return None, error
    
    if user_record["fingerprint_count"] >= FINGERPRINTS_PER_USER:
        return None, f"User already has {FINGERPRINTS_PER_USER} fingerprints registered"
    
    # Get the next unregistered ID
    fp_id = user_record["fingerprint_ids"][user_record["fingerprint_count"]]
    
    return fp_id, None


def _normalize_lines(command):
    """Convert a command payload into newline-terminated lines."""
    if command is None:
        return []

    if isinstance(command, (list, tuple)):
        lines = [str(line).strip() for line in command if str(line).strip() != ""]
    else:
        text = str(command).replace("\r\n", "\n").replace("\r", "\n")
        lines = [line.strip() for line in text.split("\n") if line.strip() != ""]

    return [f"{line}\n" for line in lines]


def _response_text(response_lines):
    """Normalize a response payload to a single string for parsing."""
    if isinstance(response_lines, list):
        return "\n".join(str(line) for line in response_lines if str(line).strip() != "")
    return str(response_lines or "")


def _has_final_marker(response_lines):
    """Return True when the Arduino has reported a terminal result."""
    response_upper = _response_text(response_lines).upper()
    return any(marker in response_upper for marker in FINAL_MARKERS)


def _is_prompt_line(line):
    text = str(line or "").strip().upper()
    return text in ("PLACE FINGER", "REMOVE FINGER", "PLACE AGAIN TO CONFIRM")


def _is_register_success(response_lines):
    """Return True when register flow reports a positive final marker."""
    response_upper = _response_text(response_lines).upper()
    if "NOT MATCHED" in response_upper or "FAILED" in response_upper or "ERROR" in response_upper:
        return False
    return any(marker in response_upper for marker in ("STORED", "SAVED", "ENROLLED", "REGISTERED"))


def _is_verify_success(response_lines):
    """Return True only for an explicit MATCHED response."""
    response_upper = _response_text(response_lines).upper()
    if "NOT MATCHED" in response_upper:
        return False
    return "MATCHED" in response_upper


def _extract_matched_id(response_lines):
    """Extract matched fingerprint ID from lines like 'Matched ID 7'."""
    if not response_lines:
        return None

    for line in response_lines:
        text = str(line or "").strip()
        match = re.search(r"MATCHED\s*(?:ID)?\s*[:#-]?\s*(\d+)", text, flags=re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


def _register_command_candidates(fp_id):
    """Return protocol variants to support different Arduino sketches."""
    return [
        ["R", str(fp_id)],  # line-based protocol: R\n<ID>\n
        f"R{fp_id}\n",      # compact protocol: R<ID>\n
    ]


def _create_register_session(email, fp_id):
    session_id = uuid.uuid4().hex
    with session_lock:
        register_sessions[session_id] = {
            "session_id": session_id,
            "email": email,
            "fingerprint_id": fp_id,
            "status": "queued",
            "message": "Waiting to start",
            "responses": [],
            "final": False,
            "error": None,
            "created_at": time.time(),
            "updated_at": time.time(),
        }
    return session_id


def _update_register_session(session_id, **updates):
    with session_lock:
        session = register_sessions.get(session_id)
        if not session:
            return
        session.update(updates)
        session["updated_at"] = time.time()


def _append_register_response(session_id, line):
    with session_lock:
        session = register_sessions.get(session_id)
        if not session:
            return
        session["responses"].append(line)
        session["message"] = line
        session["updated_at"] = time.time()


def _get_register_session(session_id):
    with session_lock:
        session = register_sessions.get(session_id)
        return dict(session) if session else None


def _detect_serial_port(preferred_port=None):
    """Detect STM32/ST-Link serial port, falling back to preferred/default."""
    ports = list(serial.tools.list_ports.comports())

    # Prefer an explicitly requested port when currently present.
    if preferred_port:
        for p in ports:
            if p.device.upper() == str(preferred_port).upper():
                return p.device

    # Prefer STM32/ST-Link ports.
    for p in ports:
        label = f"{p.description} {p.manufacturer} {p.hwid}".upper()
        if "STLINK" in label or "STM32" in label or "VIRTUAL COM PORT" in label:
            return p.device

    # Fall back to configured default if available.
    for p in ports:
        if p.device.upper() == SERIAL_PORT.upper():
            return p.device

    # Final fallback: first non-Bluetooth COM-like device.
    for p in ports:
        label = f"{p.description} {p.manufacturer} {p.hwid}".upper()
        if "BLUETOOTH" not in label:
            return p.device

    return None


def _open_serial_port(port=None):
    """Open the configured serial port with stable defaults for Windows."""
    selected_port = port or _detect_serial_port(preferred_port=ACTIVE_SERIAL_PORT) or SERIAL_PORT
    return serial.Serial(
        selected_port,
        BAUD_RATE,
        timeout=TIMEOUT,
        write_timeout=TIMEOUT,
        rtscts=False,
        dsrdtr=False,
        xonxoff=False,
    )


def _reconnect_serial(reason=""):
    """Try to recover serial communication after transient COM failures."""
    global ser, ACTIVE_SERIAL_PORT
    try:
        if ser and ser.is_open:
            try:
                ser.close()
            except Exception:
                pass

        # USB CDC ports may temporarily disappear and come back with a new COM number.
        selected_port = None
        start = time.time()
        while time.time() - start < 8.0:
            selected_port = _detect_serial_port(preferred_port=ACTIVE_SERIAL_PORT)
            if selected_port:
                break
            time.sleep(0.4)

        if not selected_port:
            selected_port = SERIAL_PORT

        time.sleep(0.8)
        ser = _open_serial_port(port=selected_port)
        ACTIVE_SERIAL_PORT = ser.port
        time.sleep(2.0)
        ser.reset_input_buffer()
        ser.reset_output_buffer()
        print(f"[SERIAL] Reconnected on {ACTIVE_SERIAL_PORT}. Reason: {reason}")
        return True
    except Exception as exc:
        print(f"[SERIAL] Reconnect failed near {ACTIVE_SERIAL_PORT}: {exc}")
        return False


def _is_recoverable_serial_error(exc):
    text = str(exc or "")
    return (
        "WriteFile failed" in text
        or "PermissionError" in text
        or "device does not recognize the command" in text
        or "ClearCommError" in text
        or "Access is denied" in text
        or "The parameter is incorrect" in text
    )

def initialize_serial():
    """Initialize and test serial connection to Arduino"""
    global ser, ACTIVE_SERIAL_PORT
    try:
        selected_port = _detect_serial_port(preferred_port=SERIAL_PORT) or SERIAL_PORT

        ser = _open_serial_port(port=selected_port)
        ACTIVE_SERIAL_PORT = ser.port
        time.sleep(2)  # Wait for Arduino to initialize
        print(f"Serial connection established on {ACTIVE_SERIAL_PORT}")
        return True
    except Exception as e:
        print(f"Failed to connect to Arduino: {e}")
        return False

def send_command(cmd, extra=None, _retry=False):
    """Send a command to Arduino line by line and collect all responses.

    Returns:
        (response_lines, error)
    """
    if not ser or not ser.is_open:
        if not _reconnect_serial("port not connected at send start"):
            return None, "Serial port not connected"
    
    with lock:
        try:
            lines = _normalize_lines(cmd)

            if extra is not None:
                lines.extend(_normalize_lines(extra))

            if not lines:
                return None, "Empty command"

            print("[SERIAL] ----------------------------------------")
            print(f"[SERIAL] Command payload: {repr(cmd)}")
            if extra is not None:
                print(f"[SERIAL] Extra payload: {repr(extra)}")

            # Clear buffer
            ser.reset_input_buffer()

            # Send command line by line with a short delay so the Arduino parser
            # sees the exact line-based protocol it expects.
            for index, line in enumerate(lines, start=1):
                if index == 1:
                    print(f"[SERIAL] Sending: {line.strip()}")
                else:
                    print(f"[SERIAL] Sending extra: {line.strip()}")
                print(f"[SERIAL] → write[{index}/{len(lines)}]: {repr(line)}")
                ser.write(line.encode('utf-8'))
                ser.flush()
                time.sleep(1.0 if index == len(lines) else WRITE_DELAY)
            
            # Read response line by line until the Arduino reports a final result
            # or the timeout is reached.
            start_time = time.time()
            response_lines = []
            buffer = ""
            last_prompt = None
            prompt_repeat_count = 0
            
            while time.time() - start_time < READ_DURATION:
                if ser.in_waiting > 0:
                    chunk = ser.read(ser.in_waiting).decode(errors='ignore')
                    buffer += chunk

                    while '\n' in buffer:
                        raw_line, buffer = buffer.split('\n', 1)
                        line = raw_line.strip()
                        if line:
                            response_lines.append(line)
                            print(f"[SERIAL] Received: {line}")

                            if _is_prompt_line(line):
                                upper_line = line.strip().upper()
                                if upper_line == last_prompt:
                                    prompt_repeat_count += 1
                                else:
                                    last_prompt = upper_line
                                    prompt_repeat_count = 1

                                if prompt_repeat_count >= MAX_PROMPT_REPEATS:
                                    timeout_line = f"ERROR: Scan prompt timeout ({upper_line})"
                                    response_lines.append(timeout_line)
                                    print(f"[SERIAL] Received: {timeout_line}")
                                    print("[SERIAL] Prompt repeat threshold reached, stopping read loop")
                                    print(f"[SERIAL] ← response lines: {response_lines}")
                                    print("[SERIAL] ----------------------------------------")
                                    return response_lines, None

                            if _has_final_marker(response_lines):
                                print("[SERIAL] Final result received, stopping read loop")
                                print(f"[SERIAL] ← response lines: {response_lines}")
                                print("[SERIAL] ----------------------------------------")
                                return response_lines, None
                else:
                    time.sleep(0.05)

            if buffer.strip():
                leftover = buffer.strip()
                response_lines.append(leftover)
                print(f"[SERIAL] Received: {leftover}")

            print(f"[SERIAL] Timeout reached after {READ_DURATION}s")
            print(f"[SERIAL] ← response lines: {response_lines}")
            print("[SERIAL] ----------------------------------------")
            return response_lines, None
            
        except Exception as e:
            if not _retry and _is_recoverable_serial_error(e):
                print(f"[SERIAL] Recoverable write/read failure detected: {e}")
                if _reconnect_serial(str(e)):
                    return send_command(cmd, extra=extra, _retry=True)

            error_msg = f"Serial communication error: {str(e)}"
            print(f"[SERIAL] {error_msg}")
            return None, error_msg


def _run_register_session(session_id, fp_id):
    """Run the registration flow in the background so the UI can poll status."""
    try:
        session = _get_register_session(session_id)
        email = session.get("email", "unknown")
        
        _update_register_session(session_id, status="running", message="Place your finger")
        print(f"[API] /register session {session_id} started for email {email} with fp_id {fp_id}")

        response_lines, error = send_command(["R", str(fp_id)])

        if error:
            _update_register_session(session_id, status="error", error=error, message=error, final=True)
            print(f"[API] /register session {session_id} error: {error}")
            return

        for line in response_lines or []:
            _append_register_response(session_id, line)

        response_text = _response_text(response_lines)
        upper_text = response_text.upper()

        if "PLACE FINGER" in upper_text:
            _update_register_session(session_id, status="running", message="Place your finger")
        if "REMOVE FINGER" in upper_text:
            _update_register_session(session_id, status="running", message="Remove your finger")
        if "PLACE SAME FINGER" in upper_text or "PLACE AGAIN" in upper_text:
            _update_register_session(session_id, status="running", message="Place again to confirm")

        if _is_register_success(response_lines):
            _update_register_session(session_id, status="success", message="Saved", final=True)
        elif "NOT MATCHED" in upper_text:
            _update_register_session(session_id, status="failed", message="Not matched", final=True)
        else:
            _update_register_session(session_id, status="failed", message="Fingerprint not detected or not saved", final=True)

        print(f"[API] /register session {session_id} finished with status {_get_register_session(session_id).get('status')}")
    except Exception as e:
        error_message = str(e)
        _update_register_session(session_id, status="error", error=error_message, message=error_message, final=True)
        print(f"[API] /register session {session_id} exception: {error_message}")

def parse_response(response):
    """Parse Arduino response to determine success/failure"""
    if not response:
        return False, "No response from Arduino"
    
    response_upper = _response_text(response).upper()

    # Check explicit negative matches before positive checks because
    # "NOT MATCHED" contains the substring "MATCHED".
    if "NOT MATCHED" in response_upper or "NOT FOUND" in response_upper:
        return False, "Fingerprint not matched"
    
    # Check for success keywords
    if "SAVED" in response_upper:
        return True, "Fingerprint saved successfully"
    
    if "MATCHED" in response_upper:
        return True, "Fingerprint matched successfully"
    
    if "DELETED" in response_upper:
        return True, "Fingerprint deleted successfully"
    
    if "ERROR" in response_upper or "FAILED" in response_upper:
        return False, f"Arduino error: {response}"
    
    # Generic success check
    return True, response


def _reset_sensor_to_idle():
    """Clear serial buffers and give the sensor time to return to idle."""
    global ser
    if not ser or not ser.is_open:
        return
    try:
        ser.reset_input_buffer()
        ser.reset_output_buffer()
        time.sleep(2)
        print("[SERIAL] Buffers reset and sensor returned to idle")
    except Exception as exc:
        print(f"[SERIAL] Buffer reset warning: {exc}")

@app.route('/health', methods=['GET'])
def health_check():
    """Check if server and Arduino are connected"""
    if ser and ser.is_open:
        return jsonify({
            "status": "healthy",
            "arduino": "connected",
            "port": ACTIVE_SERIAL_PORT,
            "baud": BAUD_RATE
        })
    return jsonify({
        "status": "unhealthy",
        "arduino": "disconnected"
    }), 503

@app.route('/register', methods=['POST'])
def register_fingerprint():
    """
    Register a new fingerprint
    POST /register
    Body: {"email": "user@example.com", "mode": "sync"}
    """
    try:
        data = request.get_json() or {}
        email = str(data.get('email', 'user@example.com')).strip().lower()
        mode = str(data.get('mode', 'sync')).lower()
        
        print(f"\n[API] /register request received: email={email}")

        # Get or create user record
        user_record, error = _get_or_create_user_fp_record(email)
        if error:
            return jsonify({
                "status": "error",
                "message": error,
                "responses": []
            }), 400

        # Get next available fingerprint ID
        fp_id, error = _get_next_available_fp_id(email)
        if error:
            return jsonify({
                "status": "error",
                "message": error,
                "responses": []
            }), 400

        print(f"[API] Allocating fingerprint ID {fp_id} to user {email}")
        print(f"[API] This is fingerprint #{user_record['fingerprint_count'] + 1} for this user")

        if mode != 'sync':
            session_id = _create_register_session(email, fp_id)
            worker = threading.Thread(target=_run_register_session, args=(session_id, fp_id), daemon=True)
            worker.start()
            return jsonify({
                "status": "started",
                "message": "Registration started",
                "session_id": session_id,
                "fingerprint_id": fp_id,
                "poll_url": f"/register/status?session_id={session_id}"
            })

        # Sync mode: direct execution. Try both command formats because
        # some uploaded sketches use line-based parsing while older ones
        # expect compact commands like "R1".
        command_candidates = _register_command_candidates(fp_id)

        last_response = None
        last_error = None

        for attempt in range(1, RETRY_COUNT + 1):
            command = command_candidates[(attempt - 1) % len(command_candidates)]
            print(f"[API] /register attempt {attempt}/{RETRY_COUNT} using command {repr(command)}")

            # Ensure stale serial bytes from an interrupted previous flow do
            # not poison this registration attempt.
            _reset_sensor_to_idle()

            response, error = send_command(command)
            last_response = response
            last_error = error

            if error:
                print(f"[API] /register serial error: {error}")
                continue

            print(f"[API] /register Arduino response: {repr(response)}")
            response_text = _response_text(response)
            response_upper = response_text.upper()

            if _is_register_success(response):
                # Update user record
                user_record["fingerprint_count"] += 1
                user_record["fingerprint_names"][user_record["fingerprint_count"] - 1] = f"Fingerprint {fp_id}"
                
                _reset_sensor_to_idle()
                return jsonify({
                    "status": "success",
                    "message": "Fingerprint registered successfully",
                    "email": email,
                    "fingerprint_id": fp_id,
                    "fingerprint_count": user_record["fingerprint_count"],
                    "max_fingerprints": FINGERPRINTS_PER_USER,
                    "remaining_slots": FINGERPRINTS_PER_USER - user_record["fingerprint_count"],
                    "user_id": user_record["user_id"],
                    "raw_response": response,
                    "responses": response
                })

            if "FINGERPRINTS DID NOT MATCH" in response_upper:
                return jsonify({
                    "status": "failed",
                    "message": "Enrollment failed: place the same finger both times",
                    "fingerprint_id": fp_id,
                    "fingerprint_count": user_record["fingerprint_count"],
                    "max_fingerprints": FINGERPRINTS_PER_USER,
                    "raw_response": response,
                    "responses": response
                }), 400

            if attempt < RETRY_COUNT:
                print(f"[API] /register retrying because response was not final: {repr(response)}")

        if last_error:
            return jsonify({
                "status": "error",
                "message": last_error,
                "responses": last_response or []
            }), 500

        return jsonify({
            "status": "failed",
            "message": "Fingerprint not detected or not saved",
            "raw_response": last_response,
            "responses": last_response
        }), 400
            
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e),
            "responses": []
        }), 500


@app.route('/user-fingerprints', methods=['GET'])
def get_user_fingerprints():
    """Get all fingerprints registered for a user"""
    try:
        email = request.args.get('email', '').strip().lower()
        
        if not email:
            return jsonify({
                "status": "error",
                "message": "Email parameter required"
            }), 400
        
        user_record, error = _get_or_create_user_fp_record(email)
        if error:
            return jsonify({
                "status": "error",
                "message": error
            }), 400
        
        return jsonify({
            "status": "success",
            "email": email,
            "user_id": user_record["user_id"],
            "fingerprint_count": user_record["fingerprint_count"],
            "fingerprints": [
                {
                    "index": i,
                    "id": user_record["fingerprint_ids"][i],
                    "name": user_record["fingerprint_names"][i],
                    "registered": i < user_record["fingerprint_count"]
                }
                for i in range(len(user_record["fingerprint_ids"]))
            ]
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route('/user-fingerprints', methods=['POST'])
def delete_user_fingerprints():
    """Delete a specific fingerprint for a user"""
    try:
        data = request.get_json() or {}
        email = str(data.get('email', '')).strip().lower()
        fp_index = data.get('fingerprint_index', -1)
        
        if not email or fp_index < 0:
            return jsonify({
                "status": "error",
                "message": "Email and fingerprint_index required"
            }), 400
        
        user_record, error = _get_or_create_user_fp_record(email)
        if error:
            return jsonify({
                "status": "error",
                "message": error
            }), 400
        
        if fp_index >= user_record["fingerprint_count"]:
            return jsonify({
                "status": "error",
                "message": f"Fingerprint index {fp_index} not registered"
            }), 400
        
        fp_id = user_record["fingerprint_ids"][fp_index]
        command = ["D", str(fp_id)]
        response, error = send_command(command)
        
        if error:
            return jsonify({
                "status": "error",
                "message": error
            }), 500
        
        user_record["fingerprint_count"] -= 1
        
        return jsonify({
            "status": "success",
            "message": f"Fingerprint {fp_id} deleted",
            "remaining_fingerprints": user_record["fingerprint_count"]
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route('/register/status', methods=['GET'])
def register_status():
    session_id = request.args.get('session_id', '').strip()
    if not session_id:
        return jsonify({
            "status": "error",
            "message": "Missing session_id"
        }), 400

    session = _get_register_session(session_id)
    if not session:
        return jsonify({
            "status": "error",
            "message": "Unknown session_id"
        }), 404

    return jsonify(session)

@app.route('/verify', methods=['POST'])
def verify_fingerprint():
    """
    Verify a fingerprint
    POST /verify
    Body: {"email": "user@example.com"}
    """
    try:
        data = request.get_json() or {}
        email = str(data.get('email', 'user@example.com')).strip().lower()
        
        print(f"\n[API] /verify request received for email: {email}")
        
        # Get user's fingerprint IDs
        user_record, error = _get_or_create_user_fp_record(email)
        if error or user_record["fingerprint_count"] == 0:
            return jsonify({
                "status": "error",
                "message": "User has no registered fingerprints",
                "raw_response": [],
                "responses": []
            }), 400

        print(f"[API] User has {user_record['fingerprint_count']} fingerprints to verify against")
        user_registered_ids = set(user_record["fingerprint_ids"][:user_record["fingerprint_count"]])
        
        # Send verify command: "F"
        command = "F\n"
        print(f"[API] /verify sending command: {repr(command)}")
        response, error = send_command(command)
        
        if error:
            return jsonify({
                "status": "error",
                "message": error,
                "raw_response": [],
                "responses": []
            }), 500
        
        success, message = parse_response(response)
        print(f"[API] /verify Arduino response: {repr(response)}")
        matched_id = _extract_matched_id(response)
        
        if _is_verify_success(response):
            # Enforce user-specific matching when firmware reports the matched ID.
            if matched_id is not None and matched_id not in user_registered_ids:
                return jsonify({
                    "status": "failed",
                    "message": "Fingerprint belongs to a different user",
                    "email": email,
                    "user_id": user_record["user_id"],
                    "matched_id": matched_id,
                    "allowed_ids": sorted(list(user_registered_ids)),
                    "raw_response": response,
                    "responses": response
                }), 401

            return jsonify({
                "status": "success",
                "message": "Fingerprint verified successfully",
                "email": email,
                "user_id": user_record["user_id"],
                "matched_id": matched_id,
                "fingerprint_count": user_record["fingerprint_count"],
                "raw_response": response,
                "responses": response
            })
        else:
            return jsonify({
                "status": "failed",
                "message": "Fingerprint not matched",
                "raw_response": response,
                "responses": response
            }), 401
            
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e),
            "raw_response": [],
            "responses": []
        }), 500

@app.route('/delete', methods=['POST'])
def delete_fingerprint():
    """
    Delete fingerprint(s)
    POST /delete
    Body: {"id": 1} or {"delete_all": True}
    """
    try:
        data = request.get_json() or {}
        
        if data.get('delete_all'):
            print(f"\n[API] /delete request received: delete_all=true")
            # Match the Arduino sketch protocol:
            # D\nA\n
            command = "D\nA\n"
            message_prefix = "All fingerprints"
        else:
            user_id = data.get('id', 1)
            print(f"\n[API] /delete request received: id={user_id}")
            # Match the Arduino sketch protocol:
            # D\n1\n<id>\n
            command = f"D\n1\n{user_id}\n"
            message_prefix = f"Fingerprint ID {user_id}"
        
        print(f"[API] /delete sending command: {repr(command)}")
        response, error = send_command(command)
        
        if error:
            return jsonify({
                "status": "error",
                "message": error
            }), 500
        
        success, message = parse_response(response)
        print(f"[API] /delete Arduino response: {repr(response)}")
        
        if success:
            return jsonify({
                "status": "success",
                "message": f"{message_prefix} deleted successfully",
                "raw_response": response,
                "responses": response
            })
        else:
            return jsonify({
                "status": "failed",
                "message": message,
                "raw_response": response,
                "responses": response
            }), 400
            
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route('/test', methods=['GET'])
def test_arduino():
    """Test Arduino connection by sending a simple command"""
    try:
        print(f"\n[API] /test request received")
        
        # Try to send a simple command
        command = "F\n"
        print(f"[API] /test sending command: {repr(command)}")
        response, error = send_command(command)
        
        if error:
            return jsonify({
                "status": "error",
                "message": f"Arduino test failed: {error}"
            }), 500
        
        print(f"[API] /test Arduino response: {repr(response)}")
        return jsonify({
            "status": "success",
            "message": "Arduino connection successful",
            "response": response,
            "responses": response
        })
        
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route('/debug-serial', methods=['POST'])
def debug_serial():
    """Manually send raw or line-based serial commands for debugging."""
    try:
        data = request.get_json() or {}
        command = data.get('command')

        if isinstance(command, list):
            print(f"[API] /debug-serial request received: {command}")
        else:
            print(f"[API] /debug-serial request received: {repr(command)}")

        if not command:
            return jsonify({
                "status": "error",
                "message": "Missing command. Use {\"command\": [\"R\", \"1\"]} or {\"command\": \"F\"}."
            }), 400

        response, error = send_command(command)

        if error:
            return jsonify({
                "status": "error",
                "message": error
            }), 500

        return jsonify({
            "status": "success",
            "sent": command,
            "response": response
        })

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({
        "status": "error",
        "message": "Endpoint not found",
        "available_endpoints": [
            "GET /health",
            "GET /test",
            "POST /register",
            "POST /verify",
            "POST /delete",
            "POST /debug-serial"
        ]
    }), 404

if __name__ == '__main__':
    print("=" * 60)
    print("Biometric Fingerprint System - Arduino Integration")
    print("=" * 60)
    
    if initialize_serial():
        print("\nSystem initialized successfully")
    else:
        print("\n⚠ Failed to initialize system (Arduino not found or access denied)")
        print("  Running in simulation mode/disconnected state.")

    print("\nStarting Flask server on http://127.0.0.1:5001")
    print("\nAPI Endpoints:")
    print("  • GET  /health         - Check system status")
    print("  • GET  /test           - Test Arduino connection")
    print("  • POST /register       - Register new fingerprint")
    print("  • POST /verify         - Verify fingerprint")
    print("  • POST /delete         - Delete fingerprint(s)")
    print("\n" + "=" * 60)
    
    app.run(host='127.0.0.1', port=5001, debug=False, threaded=True)
