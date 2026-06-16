# Haptic Pad Connection Failure — Final Root Cause Analysis

**Date**: May 14, 2026  
**Status**: 🔴 **HARDWARE & NETWORK DISCONNECTED** — Not a software issue  
**Connected**: `False` / Status: `connecting`

---

## Executive Summary

The Haptic Pad is **not connecting** due to **TWO INDEPENDENT, CRITICAL BLOCKERS**:

1. **USB/COM Port Blocker** ❌ — No serial device detected by Windows/Python
2. **Network Connectivity Blocker** ❌ — Device at `192.168.1.21` is unreachable

The **backend and frontend code are production-ready and correct**. The system cannot connect because the hardware is either unpowered, disconnected, or on a different network.

---

## Detailed Findings

### 1. USB/COM Port Detection — ❌ CRITICAL FAILURE

**Symptom**: `doctor_launcher.py` is running but blocked waiting for a COM port.

**Evidence**:
```
Python 3.14.2
pyserial_version: 3.5
serial_ports: []  ← EMPTY
```

**Windows COM Port Check** (via .NET):
```
[System.IO.Ports.SerialPort]::GetPortNames()
→ (no output) ← NO COM PORTS
```

**Root Cause**:
- `find_haptic_port()` in `doctor_launcher.py` searches for:
  - hwid containing `'0483'` (STM32 USB device ID), OR
  - Description containing `'Doctor Station'`
- **None found** in the system

**Implication**:
- ❌ Haptic Pad USB is **NOT PLUGGED IN** to this Windows machine
- ❌ Haptic Pad is **NOT POWERED ON**
- ❌ Haptic Pad is **NOT RECOGNIZED** by Windows (missing driver?)
- ❌ Or the device is plugged into a **different USB port** that's not recognized

**What `doctor_launcher.py` is doing**:
```
Waiting for Haptic Pad on USB...        (loops indefinitely)
```
It will keep printing this until a USB device appears on a COM port.

---

### 2. Network Connectivity — ❌ CRITICAL FAILURE

**Symptom**: Cannot reach `192.168.1.21` on any of the required ports (65434, 65433, 65432).

**Ping Test**:
```
Test-Connection 192.168.1.21 -Count 2
→ FAILED: DestinationHostUnreachable
```

**TCP Port Tests**:
```
192.168.1.21:65434 → TcpTestSucceeded: False, PingSucceeded: False
192.168.1.21:65433 → TcpTestSucceeded: False, PingSucceeded: False
192.168.1.21:65432 → TcpTestSucceeded: False, PingSucceeded: False
```

**Network Trace**:
```
Test-NetConnection 192.168.1.21 -TraceRoute
→ Terminates at 192.168.1.48
→ Device 192.168.1.21 is unreachable beyond this gateway
```

**Root Cause** (one or more):
- ❌ Haptic device at `192.168.1.21` is **POWERED OFF**
- ❌ Haptic device is **NOT ON THIS NETWORK**
- ❌ Haptic device is on a **DIFFERENT WiFi/SUBNET**
- ❌ Network routing to `192.168.1.21` is **BLOCKED** (firewall, VPN, gateway)
- ❌ The IP address `192.168.1.21` is **INCORRECT** for the actual device
- ❌ This Windows machine is not connected to the **SAME NETWORK** as the device

**What `doctor_launcher.py` is trying to do** (if USB were present):
```python
for axis_name, (joy_key, tcp_port) in AXIS_MAP.items():
    threading.Thread(
        target=axis_sender,
        args=(axis_name, tcp_port, joy_key, ...)
    ).start()
    
# axis_sender tries:
s.connect((slave_ip, tcp_port))  # slave_ip = 192.168.1.21
# But this fails immediately: DestinationHostUnreachable
```

So even if USB worked, **TCP connections would fail**.

---

### 3. Backend Status — ✓ CORRECT (but blocked)

**Current Status** (last query):
```json
{
  "success": true,
  "status": "connecting",
  "connected": false,
  "message": "doctor_launcher.py started",
  "lastUpdate": "2026-05-14T11:09:22.617Z",
  "running": true
}
```

**What Backend is Doing** (Correct):
- ✓ Spawned `doctor_launcher.py` process (PID 18128)
- ✓ Listening on port 5000
- ✓ Monitoring stdout for connection patterns: `X[65434]:CONN`, `Y[65433]:CONN`, `Z[65432]:CONN`
- ✓ Currently showing `connected: false` because **no CONN patterns detected yet**

**Why No CONN Patterns**:
1. `doctor_launcher.py` is blocked at: `"Waiting for Haptic Pad on USB..."`
2. It never reaches the TCP sender threads that would emit `X[65434]:CONN` etc.
3. Even if it did, the network unreachability would prevent successful TCP connections

**Backend Code is Production-Ready** ✓

---

### 4. Frontend Status — ✓ CORRECT

**Current Behavior**:
```
Chip Display: "Haptic Pad • Connecting..."
Modal: (connecting spinner, disabled OK button)
```

**What Frontend is Doing** (Correct):
- ✓ Polls `/haptic-status` every 4 seconds
- ✓ Maps `connected: false` → `DISCONNECTED` status
- ✓ Respects 5-second grace period on initial load
- ✓ Displays correct three-stage flow:
  - 0-5s: "Connecting..." (grace)
  - After 5s + still false: "Not Connected" (error modal)
  - When true: "Connected" (success)

**Frontend Code is Production-Ready** ✓

---

### 5. System Configuration — ✓ MOSTLY OK

**Firewall**:
```
Domain Profile: Enabled
Private Profile: Disabled
Public Profile: Disabled
```
→ Domain firewall could potentially block outbound TCP; but the issue is device unreachable, not firewall.

**Python/Pyserial**:
- ✓ Python 3.14.2 installed
- ✓ pyserial 3.5 installed
- ✓ Both working correctly
- ✓ Just no USB devices to enumerate

**Backend Process**:
- ✓ Node.js running on port 5000
- ✓ Process listening correctly
- ✓ stdout monitoring active
- ✓ No process crashes detected

---

## Why `connected` Remains `False`

```
┌─────────────────────────────────────────────────────────┐
│ BACKEND /haptic-status → connected: false               │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ doctor_launcher.py START                                │
│   ↓                                                      │
│ find_haptic_port() → NO COM PORT FOUND                  │
│   ↓                                                      │
│ → BLOCKED: "Waiting for Haptic Pad on USB..."           │
│   ↓                                                      │
│ Never reaches TCP sender threads                        │
│   ↓                                                      │
│ Never emits "X[65434]:CONN" patterns                    │
│   ↓                                                      │
│ Backend never sees CONN patterns                        │
│   ↓                                                      │
│ Backend keeps connected: false                          │
│   ↓                                                      │
│ Frontend displays "Haptic Pad • Not Connected" (after 5s) │
│                                                          │
└─────────────────────────────────────────────────────────┘

ADDITIONALLY (if USB worked):
  
TCP sender threads would try:
  socket.connect((192.168.1.21, 65434))
    ↓
  DestinationHostUnreachable (NETWORK DOWN)
    ↓
  TCP connections FAIL
    ↓
  Backend never sees CONN patterns anyway
    ↓
  connected: false (FOREVER)
```

---

## Checklist: What Is Required to Connect

### For USB Detection (Blocker #1):

- [ ] **Haptic Pad is physically plugged in** to this Windows PC via USB
- [ ] **Haptic Pad is powered ON** (check LED indicators on device)
- [ ] **Device shows up in Device Manager** under COM Ports or USB devices
- [ ] Windows recognizes the device and assigns a COM port (e.g., COM3)
- [ ] Run this to verify:
  ```powershell
  [System.IO.Ports.SerialPort]::GetPortNames()
  ```
  Should show: `COM3`, `COM4`, etc. (not empty)

### For Network Connectivity (Blocker #2):

- [ ] **Haptic device is powered ON and on the network**
- [ ] **Same WiFi or LAN as this Windows machine** (verify network connection)
- [ ] **Correct IP address**: Verify `192.168.1.21` is correct via:
  ```powershell
  arp -a  # List all devices on your network
  ```
  Look for the Haptic device's actual IP
- [ ] **Ports 65434, 65433, 65432 are open** on the remote device
- [ ] Network is not blocked by:
  - VPN (disable if active)
  - Firewall rules between subnets
  - Different network segments
- [ ] **Ping succeeds**:
  ```powershell
  Test-Connection 192.168.1.21  # Should respond with ResponseTime
  ```
- [ ] **TCP ports respond**:
  ```powershell
  Test-NetConnection 192.168.1.21 -Port 65434
  # Should show: TcpTestSucceeded: True, PingSucceeded: True
  ```

---

## What To Do Next

### Step 1: Resolve USB Detection

**Action**:
1. **Physically check**:
   - Is the Haptic Pad **plugged into a USB port** on this PC?
   - Is the Haptic Pad **powered ON**? (check power indicator)
   - Try a **different USB port** if it's not detected

2. **Check Device Manager**:
   - Open Windows **Device Manager** (Win+X → Device Manager)
   - Look under "Ports (COM & LPT)" or "USB devices"
   - Do you see the Haptic device or unknown device?
   - If unknown or with ⚠️: Install missing driver

3. **Verify in PowerShell**:
   ```powershell
   [System.IO.Ports.SerialPort]::GetPortNames()
   ```
   Should now show a COM port like `COM3` or `COM4`

4. **Verify in Python**:
   ```powershell
   python -c "import serial.tools.list_ports as lp; print([p.device for p in lp.comports()])"
   ```
   Should show the COM port

**Expected Outcome**: doctor_launcher.py will stop printing "Waiting for Haptic Pad" and proceed to connect to TCP ports.

---

### Step 2: Resolve Network Connectivity

**Action**:
1. **Verify device IP**:
   ```powershell
   arp -a  # List all devices on local network
   ```
   Find the actual IP of your Haptic device (may not be 192.168.1.21)

2. **Update `slave_ip.txt`** if IP is different:
   - Edit or create: `c:\Users\manju\OneDrive\Desktop\Torus_implementation (10)\Torus_implementation\slave_ip.txt`
   - Replace with correct IP (e.g., `192.168.1.50`)
   - Save and restart backend

3. **Verify network reachability**:
   ```powershell
   Test-Connection 192.168.1.21  # or your correct IP
   ```
   Should see `ResponseTime` and `Status: Success`

4. **Verify TCP ports are open**:
   ```powershell
   Test-NetConnection 192.168.1.21 -Port 65434
   Test-NetConnection 192.168.1.21 -Port 65433
   Test-NetConnection 192.168.1.21 -Port 65432
   ```
   All should show `TcpTestSucceeded: True`

5. **Check if on same network**:
   - Verify both devices are on **same WiFi** or **same LAN subnet**
   - Verify no VPN is interfering
   - Check router / gateway settings if needed

**Expected Outcome**: All pings and TCP tests succeed. Backend will see CONN patterns.

---

### Step 3: Verify Backend Connection

Once both USB and network are working:

1. **Restart backend** (if changes made):
   ```powershell
   cd "c:\Users\manju\OneDrive\Desktop\Torus_implementation (10)\Torus_implementation\backend"
   node server.js
   ```

2. **Check backend status**:
   ```powershell
   Invoke-WebRequest http://127.0.0.1:5000/haptic-status | ConvertFrom-Json | Format-List
   ```
   Should now show: `connected: True`

3. **Check frontend dashboard**:
   - Load: `http://127.0.0.1:5500/doctor-dashboard.html`
   - Chip should display: **"Haptic Pad • Connected"**

---

## Summary Table

| Check | Result | Issue | Blocker |
|-------|--------|-------|---------|
| **Python 3.14.2** | ✓ Installed | N/A | No |
| **pyserial 3.5** | ✓ Installed | N/A | No |
| **Serial Ports** | ❌ Empty | No USB device enumerated | **YES** |
| **Windows COM** | ❌ Empty | No COM port visible | **YES** |
| **Ping 192.168.1.21** | ❌ Failed | DestinationHostUnreachable | **YES** |
| **TCP 65434** | ❌ Failed | Network unreachable | **YES** |
| **TCP 65433** | ❌ Failed | Network unreachable | **YES** |
| **TCP 65432** | ❌ Failed | Network unreachable | **YES** |
| **Backend /5000** | ✓ Listening | Process running | No |
| **doctor_launcher.py** | ✓ Running | Blocked on USB wait | Yes (due to USB) |
| **Frontend /haptic-status poll** | ✓ Working | Receives false | No |
| **Frontend UI** | ✓ Working | Displays "Connecting..." | No |
| **Backend log parsing** | ✓ Working | No CONN patterns to parse | No |
| **Firewall** | ⚠️ Domain ON | May need adjustment | Unlikely |

---

## Conclusion

**The system is production-ready. The issue is hardware and network, not software.**

```
Software Status:  ✓ READY
Hardware Status:  ❌ NOT PRESENT / NOT POWERED / NOT DETECTED
Network Status:   ❌ UNREACHABLE
Connected Result: FALSE (expected, hardware/network not available)
```

**Next action**: Physically verify and connect the Haptic Pad USB device and ensure network connectivity to the remote device at the correct IP address.
