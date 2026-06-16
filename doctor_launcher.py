"""
Doctor Station — Haptic Pad All-in-One
Actual Arduino packet format (confirmed from serial monitor):
  JX:1975|JY:2044|JZ:2062|SW:0|IMU1:0.933,0.012,0.036,0.357|IMU2:0.126,-0.770,0.624,0.044

Set DEBUG_RAW = True to print raw packets for diagnosis.
Set DEBUG_RAW = False for clean live display (default).
"""

import socket
import serial
import serial.tools.list_ports
import threading
import time
import os
import sys
import math

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# ── Config ───────────────────────────────────────────────────────────────────
BAUD_RATE     = 115200
SLAVE_IP_FILE = 'slave_ip.txt'
DEBUG_RAW     = False          # flip to True to see raw packets
MOCK_MODE     = '--mock' in sys.argv
 
AXIS_MAP = {
    'X': ('JX', 502),
    'Y': ('JY', 503),
    'Z': ('JZ', 65432),
}
AXIS_PORTS = {axis: cfg[1] for axis, cfg in AXIS_MAP.items()}

# ── Resolve slave IP ──────────────────────────────────────────────────────────
def resolve_slave_ip() -> str:
    base_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    ip_path  = os.path.join(base_dir, SLAVE_IP_FILE)
    if os.path.exists(ip_path):
        with open(ip_path, 'r') as f:
            saved = f.read().strip()
        if saved:
            print(f"  Slave IP  : {saved}  (from {SLAVE_IP_FILE})")
            return saved
    print()
    print("  slave_ip.txt not found. Enter slave IP address:")
    while True:
        if MOCK_MODE:
            return "127.0.0.1" # Default for mock
        ip = input("  Slave IP: ").strip()
        if ip:
            with open(ip_path, 'w') as f:
                f.write(ip)
            print(f"  Saved to {ip_path}")
            return ip

# ── Serial auto-detection ─────────────────────────────────────────────────────
def find_haptic_port() -> str | None:
    for p in serial.tools.list_ports.comports():
        if '0483' in p.hwid or 'Doctor Station' in p.description:
            return p.device
    return None

# ── IMU formatter ─────────────────────────────────────────────────────────────
def fmt_imu(raw: str) -> str:
    if not raw or raw.strip() == 'ERR':
        return 'ERR'
    parts = raw.split(',')
    if len(parts) != 4:
        return f'BAD({raw[:15]})'
    try:
        w, x, y, z = map(float, parts)
        return f"w={w:+.3f} x={x:+.3f} y={y:+.3f} z={z:+.3f}"
    except ValueError:
        return f'BAD({raw[:15]})'

# ── SW decoder ────────────────────────────────────────────────────────────────
def decode_sw(val: str):
    try:
        n   = int(val)
        swm = 'ON' if (n & 0b01) else 'OFF'
        swl = 'ON' if (n & 0b10) else 'OFF'
        return swm, swl
    except ValueError:
        return '?', '?'

# ── Packet parser ─────────────────────────────────────────────────────────────
SKIP_TOKENS = ('===', 'BOOT', 'LOOP', 'ERROR', 'OK:', 'HX711', 'BNO')

def parse_packet(line: str) -> dict | None:
    line = line.strip()
    if not line or any(t in line for t in SKIP_TOKENS):
        return None
    data = {}
    try:
        for field in line.split('|'):
            if ':' not in field:
                continue
            key, _, value = field.partition(':')
            key, value = key.strip(), value.strip()

            if key in ('JX', 'JY', 'JZ'):
                data[key] = int(value)
            elif key == 'SW':
                swm, swl    = decode_sw(value)
                data['SWM'] = swm
                data['SWL'] = swl
                data['SW']  = value             
            elif key in ('IMU1', 'IMU2'):
                data[key] = value               
            elif key == 'HX':
                data[key] = None if value == 'NOT_READY' else float(value)
            else:
                data[key] = value

        if not {'JX', 'JY', 'JZ'}.issubset(data):
            return None
        return data
    except (ValueError, AttributeError):
        return None

# ── Live display ──────────────────────────────────────────────────────────────
_display_ready = False

def display(d: dict, slave_ip: str, conn: dict, last_data_time: dict):
    global _display_ready
    
    current_time = time.time()
    
    def get_status(axis):
        joy_key = AXIS_MAP[axis][0]
        is_data_active = (current_time - last_data_time.get(joy_key, 0)) < 1.0
        is_tcp_connected = conn.get(axis, False)
        if is_data_active and is_tcp_connected:
            return 'CONN   '
        elif is_tcp_connected:
            return 'NODATA '
        else:
            return 'waiting'

    swm    = d.get('SWM', '?')
    swl    = d.get('SWL', '?')
    i1_str = fmt_imu(d.get('IMU1', 'ERR'))
    i2_str = fmt_imu(d.get('IMU2', 'ERR'))
    hx_val = d.get('HX')
    hx_str = ('NOT READY' if hx_val is None else str(hx_val)) if 'HX' in d else 'N/A'
    cx = get_status('X')
    cy = get_status('Y')
    cz = get_status('Z')

    if '--json' in sys.argv:
        import json
        dt_x = current_time - last_data_time['JX']
        dt_y = current_time - last_data_time['JY']
        dt_z = current_time - last_data_time['JZ']
        # Connected if receiving packets
        is_conn = dt_x < 1.0 and dt_y < 1.0 and dt_z < 1.0
        out = {
            "type": "status",
            "connected": is_conn,
            "axes": {"X": cx, "Y": cy, "Z": cz},
            "packets": d
        }
        sys.stdout.write(json.dumps(out) + '\n')
        sys.stdout.flush()
        return

    rows = [
        "┌─────────────────────────────────────────────────────────────────────────┐",
        "│             Doctor Station — Haptic Pad Live Monitor                    │",
        "├──────────────┬──────────────────────────────────────────────────────────┤",
       f"│  Joystick    │  X: {d['JX']:4d}        Y: {d['JY']:4d}        Z: {d['JZ']:4d}              │",
       f"│  Switches    │  Manual (SWM): {swm:<8}  Loop (SWL): {swl:<8}             │",
       f"│  Load Cell   │  {hx_str:<55} │",
       f"│  IMU  #1     │  {i1_str:<55} │",
       f"│  IMU  #2     │  {i2_str:<55} │",
        "├──────────────┴──────────────────────────────────────────────────────────┤",
    f"│  Slave: {slave_ip:<18}  X[{AXIS_PORTS['X']}]:{cx}  Y[{AXIS_PORTS['Y']}]:{cy}  Z[{AXIS_PORTS['Z']}]:{cz}│",
        "└─────────────────────────────────────────────────────────────────────────┘",
    ]

    if _display_ready:
        sys.stdout.write(f"\033[{len(rows)}A")
    sys.stdout.write('\n'.join(rows) + '\n')
    sys.stdout.flush()
    _display_ready = True

# ── Per-axis TCP sender ────────────────────────────────────────────────────────
def axis_sender(axis_name, tcp_port, joy_key,
                latest_packet, packet_lock,
                slave_ip, conn_flags):
    while True:
        try:
            conn_flags[axis_name] = False
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(5)
                s.connect((slave_ip, tcp_port))
                s.settimeout(None)
                conn_flags[axis_name] = True
                while True:
                    with packet_lock:
                        val = latest_packet.get(joy_key, 2048)
                    s.sendall(f"{val}\n".encode('ascii'))
                    time.sleep(0.01)
        except (ConnectionRefusedError, socket.timeout,
                BrokenPipeError, ConnectionResetError, OSError):
            conn_flags[axis_name] = False
            time.sleep(1)
        except Exception:
            conn_flags[axis_name] = False
            time.sleep(2)

# ── Mock Data Generator ───────────────────────────────────────────────────────
def mock_serial_generator():
    t = 0
    while True:
        jx = int(2048 + 500 * math.sin(t))
        jy = int(2048 + 500 * math.cos(t))
        jz = int(2048 + 500 * math.sin(t * 0.5))
        yield f"JX:{jx}|JY:{jy}|JZ:{jz}|SW:0|IMU1:0.933,0.012,0.036,0.357|IMU2:0.126,-0.770,0.624,0.044\n".encode('utf-8')
        t += 0.1
        time.sleep(0.1)

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    os.system('cls' if os.name == 'nt' else 'clear')
    print("=" * 60)
    print("   Doctor Station — Haptic Pad CDC Bridge")
    if DEBUG_RAW:
        print("   *** DEBUG MODE — showing raw packets ***")
    if MOCK_MODE:
        print("   *** MOCK MODE — generating fake packets ***")
    print("=" * 60)

    slave_ip = resolve_slave_ip()
    print()

    ser = None
    mock_gen = None
    if MOCK_MODE:
        mock_gen = mock_serial_generator()
        port = "MOCK_PORT"
        print(f"  Haptic Pad : {port}                    ")
    else:
        port = None
        while ser is None:
            port = find_haptic_port()
            if port is None:
                if '--json' in sys.argv:
                    import json
                    sys.stdout.write(json.dumps({"type": "status", "connected": False, "axes": {"X": "disconnected", "Y": "disconnected", "Z": "disconnected"}, "packets": None}) + '\n')
                    sys.stdout.flush()
                print("  Waiting for Haptic Pad on USB...        ", end='\r')
                time.sleep(1)
                continue
            
            try:
                ser = serial.Serial(port, BAUD_RATE, timeout=0.1)
                ser.dtr = True
                ser.rts = True
                time.sleep(0.1)
                ser.reset_input_buffer()
                print(f"  Haptic Pad : {port}                    ")
            except Exception as e:
                if '--json' in sys.argv:
                    import json
                    sys.stdout.write(json.dumps({
                        "type": "status", 
                        "connected": False, 
                        "axes": {"X": "disconnected", "Y": "disconnected", "Z": "disconnected"}, 
                        "packets": None,
                        "error": str(e)
                    }) + '\n')
                    sys.stdout.flush()
                print(f"  [!] Could not open {port}: {e}. Retrying in 1s...", end='\r')
                time.sleep(1)

    latest_packet = {'JX': 2048, 'JY': 2048, 'JZ': 2048}
    last_data_time = {'JX': 0, 'JY': 0, 'JZ': 0}
    packet_lock   = threading.Lock()
    conn_flags    = {'X': False, 'Y': False, 'Z': False}

    for axis_name, (joy_key, tcp_port) in AXIS_MAP.items():
        threading.Thread(
            target=axis_sender,
            args=(axis_name, tcp_port, joy_key,
                  latest_packet, packet_lock,
                  slave_ip, conn_flags),
            daemon=True
        ).start()

    # ── Debug mode: print raw packets ──────────────────────────
    if DEBUG_RAW:
        print("\n  Raw packets (Ctrl-C to quit):\n")
        print("  " + "-" * 72)
        while True:
            try:
                raw = b""
                if MOCK_MODE:
                    raw = next(mock_gen).decode('utf-8', errors='ignore').strip()
                elif ser:
                    raw = ser.readline().decode('utf-8', errors='ignore').strip()
                
                if raw:
                    print(f"  RAW  : [{raw}]")
                    parsed = parse_packet(raw)
                    if parsed:
                        print(f"  KEYS : {list(parsed.keys())}")
                        print(f"  SWM={parsed.get('SWM','?')}  SWL={parsed.get('SWL','?')}  "
                              f"IMU1={parsed.get('IMU1','?')[:20]}  IMU2={parsed.get('IMU2','?')[:20]}")
                    else:
                        print(f"  SKIP : (boot/status line)")
                    print("  " + "-" * 72)
                elif not MOCK_MODE:
                    time.sleep(0.005)
            except KeyboardInterrupt:
                print("\n  Stopped.")
                break

    # ── Normal live display mode ────────────────────────────────
    else:
        print()
        print("  Connecting to slave & streaming...  (Ctrl-C to quit)\n")
        print()

        while True:
            try:
                raw = b""
                if MOCK_MODE:
                    raw = next(mock_gen).decode('utf-8', errors='ignore').strip()
                elif ser:
                    raw = ser.readline().decode('utf-8', errors='ignore').strip()
                    
                if not raw:
                    current_time = time.time()
                    display(latest_packet, slave_ip, conn_flags, last_data_time)
                    if not MOCK_MODE: time.sleep(0.005)
                    continue
                parsed = parse_packet(raw)
                if parsed is None:
                    continue
                
                current_time = time.time()
                with packet_lock:
                    if 'JX' in parsed: 
                        latest_packet['JX'] = parsed['JX']
                        last_data_time['JX'] = current_time
                    if 'JY' in parsed: 
                        latest_packet['JY'] = parsed['JY']
                        last_data_time['JY'] = current_time
                    if 'JZ' in parsed: 
                        latest_packet['JZ'] = parsed['JZ']
                        last_data_time['JZ'] = current_time
                display(parsed, slave_ip, conn_flags, last_data_time)
            except KeyboardInterrupt:
                print("\n\n  Stopped.")
                break
            except Exception as e:
                print(f"\n  [!] Error: {e}")
                if not MOCK_MODE:
                    try:
                        ser.close()
                    except Exception:
                        pass
                    # Recover automatically when USB serial drops or driver returns transient errors.
                    recovered = False
                    while not recovered:
                        try:
                            next_port = find_haptic_port()
                            if not next_port:
                                if '--json' in sys.argv:
                                    import json
                                    sys.stdout.write(json.dumps({"type": "status", "connected": False, "axes": {"X": "disconnected", "Y": "disconnected", "Z": "disconnected"}, "packets": None}) + '\n')
                                    sys.stdout.flush()
                                print("  Waiting for Haptic Pad USB reconnect...", end='\r')
                                time.sleep(1)
                                continue
                            ser = serial.Serial(next_port, BAUD_RATE, timeout=0.1)
                            ser.dtr = False
                            time.sleep(0.05)
                            ser.dtr = True
                            ser.rts = True
                            port = next_port
                            print(f"\n  [!] Reconnected Haptic Pad on {port}")
                            recovered = True
                        except Exception as inner_e:
                            if '--json' in sys.argv:
                                import json
                                sys.stdout.write(json.dumps({
                                    "type": "status", 
                                    "connected": False, 
                                    "axes": {"X": "disconnected", "Y": "disconnected", "Z": "disconnected"}, 
                                    "packets": None,
                                    "error": str(inner_e)
                                }) + '\n')
                                sys.stdout.flush()
                            time.sleep(1)
                    continue

    if ser: ser.close()
    print("\n  Exiting.")

if __name__ == "__main__":
    main()

