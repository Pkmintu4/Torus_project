# 🔴 Haptic Pad Connection Failure — Final Root Cause Diagnosis

**Date**: 2026-05-14  
**Status**: Two independent, critical blockers identified  
**Dashboard Display**: "Haptic Pad Not Connected" ✓ (correct)

---

## Executive Summary

The Haptic Pad shows "Not Connected" in the dashboard because **BOTH** of these conditions must be true to set `connected: true`, and **BOTH are failing**:

1. ❌ **Hardware Blocker**: No Haptic Pad USB device is plugged into this Windows machine
2. ❌ **Network Blocker**: IP `192.168.1.21` (slave device) is unreachable on all three required ports

---

## Part 1: Backend Verification ✓

### Backend is Running Correctly

**Process**: `node backend/server.js`
- Status: ✓ Running and listening on port 5000
- Logs: ✓ Clean startup (no errors)
- Endpoints: ✓ All responding (health check works)
- Email: ✓ Gmail SMTP verified

**Haptic Process Management**: ✓ Spawning correctly

```
[HAPTIC] doctor_launcher process requested to start
[HAPTIC] ============================================================
[HAPTIC] Doctor Station – Haptic Pad CDC Bridge
[HAPTIC] ============================================================
[HAPTIC] Slave IP  : 192.168.1.21  (from slave_ip.txt)
[HAPTIC] Waiting for Haptic Pad on USB...
[HAPTIC] Waiting for Haptic Pad on USB...
[HAPTIC] Waiting for Haptic Pad on USB...  ← STUCK HERE (infinite loop)
```

### Backend Status Endpoint ✓

```
GET http://127.0.0.1:5000/haptic-status

Response:
{
    "success": true,
    "status": "connecting",
    "connected": false,          ← Correct (blockers active)
    "message": "Waiting for Haptic Pad on USB...",
    "lastUpdate": "2026-05-14T13:42:12.109Z",
    "running": true              ← Launcher IS running
}
```

---

## Part 2: Hardware Blocker ❌ (PRIMARY)

### Where It Fails

**File**: `doctor_launcher.py` line 196-206
**Function**: `find_haptic_port()` 

```python
def find_haptic_port() -> str | None:
    for p in serial.tools.list_ports.comports():
        if '0483' in p.hwid or 'Doctor Station' in p.description:
            return p.device
    return None  # ← ALWAYS RETURNS NONE

# Main loop waiting for device:
port = None
while port is None:
    port = find_haptic_port()  # ← ALWAYS None
    if port is None:
        print("  Waiting for Haptic Pad on USB...        ", end='\r')
        time.sleep(1)
```

### Observed Behavior

The launcher **never escapes the USB wait loop** because:
- Serial port enumeration finds ZERO devices matching vendor ID `0483`
- Serial port enumeration finds ZERO devices matching description `"Doctor Station"`
- Result: Infinite loop, never opens serial port, never connects to TCP ports

### What's Missing

```
❌ Physical Haptic Pad USB device NOT plugged into this Windows machine
❌ Vendor ID 0483 (STM32 bootloader) not found by Windows
❌ Serial device driver possibly missing or device not recognized by Windows
```

### Consequence

Because the launcher never opens the serial port:
1. It never spawns the three TCP sender threads
2. It never connects to `192.168.1.21:65434/65433/65432`
3. It never enters the display loop
4. It never emits the connection markers `X[65434]:CONN`, `Y[65433]:CONN`, `Z[65432]:CONN`
5. Backend never detects connection

---

## Part 3: Network Blocker ❌ (SECONDARY)

### Network Connectivity Test

**Command**:
```powershell
Test-NetConnection 192.168.1.21 -Port 65434
Test-NetConnection 192.168.1.21 -Port 65433
Test-NetConnection 192.168.1.21 -Port 65432
Test-Connection 192.168.1.21 -Count 1
```

**Results** (ALL FAILED):

```
ComputerName    : 192.168.1.21
RemotePort      : 65434
SourceAddress   : 192.168.1.48 (this machine on Wi-Fi)
PingSucceeded   : False
TcpTestSucceeded: False
Status          : DestinationHostUnreachable ❌

ComputerName    : 192.168.1.21
RemotePort      : 65433
PingSucceeded   : False
TcpTestSucceeded: False
Status          : DestinationHostUnreachable ❌

ComputerName    : 192.168.1.21
RemotePort      : 65432
PingSucceeded   : False
TcpTestSucceeded: False
Status          : DestinationHostUnreachable ❌
```

### Network Configuration

- **This Machine**: `192.168.1.48` (connected to Wi-Fi)
- **Target Device**: `192.168.1.21` (from `slave_ip.txt`)
- **Network Interface**: Wi-Fi (visible to this machine)
- **All three TCP ports**: Unreachable

### Why Network Fails

The device at `192.168.1.21` is:
- ❌ **Powered OFF**, or
- ❌ **On different network** (office Wi-Fi required but not active), or
- ❌ **Behind firewall/gateway** blocking this machine's subnet, or
- ❌ **IP address is wrong** for the actual hardware

---

## Part 4: Why connected:true Never Happens

### Backend Detection Logic

**File**: `backend/server.js` line 103-110

```javascript
// Backend monitors doctor_launcher.py stdout line-by-line
hapticProcess.stdout.on('data', (chunk) => {
    const lines = String(chunk).split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
        const cleanLine = String(line).replace(/[\x00-\x1F\x7F]/g, '').trim();
        
        // MUST HAVE ALL THREE MARKERS IN ONE LINE TO DETECT CONNECTED
        const hasX = /X\[65434\]:\s*CONN/i.test(cleanLine);
        const hasY = /Y\[65433\]:\s*CONN/i.test(cleanLine);
        const hasZ = /Z\[65432\]:\s*CONN/i.test(cleanLine);
        
        const all = Boolean(hasX && hasY && hasZ);
        hapticStatus.connected = all;  // ← ONLY true if ALL three present
    }
});
```

### Where These Markers Should Come From

**File**: `doctor_launcher.py` line 139-147

```python
def display(d: dict, slave_ip: str, conn: dict):
    cx = 'CONN   ' if conn.get('X') else 'waiting'
    cy = 'CONN   ' if conn.get('Y') else 'waiting'
    cz = 'CONN   ' if conn.get('Z') else 'waiting'
    
    # This line SHOULD be output to stdout:
    # │  Slave: 192.168.1.21  X[65434]:CONN   Y[65433]:CONN   Z[65432]:CONN│
```

But this code is **NEVER REACHED** because:
1. `find_haptic_port()` blocks forever (no USB device)
2. The TCP sender threads are never spawned (blocked at USB detection)
3. The display loop never executes (blocked at USB detection)
4. No connection status markers are ever emitted

### Current Backend State

```json
{
    "connected": false,
    "status": "connecting",
    "message": "Waiting for Haptic Pad on USB...",
    "running": true,
    "lastUpdate": "2026-05-14T13:42:12.109Z"
}
```

This is **correct** — the launcher IS running, but it's stuck waiting for the USB device. Once it finds the device:
1. Opens serial port ✓
2. Spawns TCP sender threads ✓
3. Threads try to connect to `192.168.1.21:65434/65433/65432`
   - **Would fail here** (network unreachable) ❌
4. Only if ALL connections succeed would the display loop emit the markers

---

## Part 5: Changes Already Applied

### Fix #1: Unbuffered Python Output ✓

**Problem**: Python stdout was line-buffered when piped, so launcher output wasn't reaching backend in real-time.

**Solution**: Added `-u` flag to Python spawn in `backend/server.js`:

```javascript
// BEFORE:
hapticProcess = spawn(pythonBin, [scriptPath], { cwd: path.dirname(scriptPath) });

// AFTER:
hapticProcess = spawn(pythonBin, ['-u', scriptPath], { cwd: path.dirname(scriptPath) });
```

**Verification**: Output now appears in real-time
```
[HAPTIC] doctor_launcher process requested to start
[HAPTIC] ============================================================
[HAPTIC] Doctor Station – Haptic Pad CDC Bridge
[HAPTIC] ============================================================
[HAPTIC] Slave IP  : 192.168.1.21  (from slave_ip.txt)
[HAPTIC] Waiting for Haptic Pad on USB...  ← NOW VISIBLE
```

---

## Part 6: What Needs to Happen

### To Fix Hardware Blocker (#1)

1. **Physical Action**: Plug the Haptic Pad USB into this Windows machine
2. **Driver Check**: Verify in Device Manager that device appears:
   - Look for STM32 device or "Doctor Station" 
   - If marked with ⚠, install CH340 or STM32 drivers
3. **Verification**: 
   ```powershell
   [System.IO.Ports.SerialPort]::GetPortNames()  # Should show COM port
   ```
4. **Restart Backend**: The launcher will immediately detect the USB port and progress

### To Fix Network Blocker (#2)

1. **Verify Slave Device**: 
   - Confirm the device at `192.168.1.21` is powered ON
   - Confirm it's on the **same office WiFi** as this machine (192.168.1.x subnet)
   - Run TCP port listeners on the three required ports

2. **Verify Network Path**:
   ```powershell
   Test-NetConnection 192.168.1.21 -TraceRoute  # Identify where route fails
   Test-Connection 192.168.1.21 -Count 1        # Ping test
   ```

3. **If IP is Wrong**: Update `slave_ip.txt`:
   ```
   192.168.1.XX  # Update to correct slave device IP
   ```

4. **If Firewall Blocks**: Allow outbound TCP to `192.168.1.21:65434`, `65433`, `65432`

---

## Part 7: Complete Signal Flow (Current State)

```
Frontend (dashboard)
    ↓
    Polls http://localhost:5000/haptic-status every 2 seconds
    ↓
Backend (Node.js port 5000)
    ↓ [✓ Listening, responsive]
    Spawns doctor_launcher.py with -u flag (unbuffered)
    ↓ [✓ Process running, PID active]
    Monitors stdout for connection markers
    ↓ [❌ BLOCKED: Never receives markers]
    hapticStatus.connected = false (STUCK)
    
Doctor_launcher.py Process
    ↓ [✓ Started successfully]
    Reads slave_ip.txt → 192.168.1.21
    ↓ [✓ File found and loaded]
    Searches for Haptic Pad USB device
    ↓ [❌ BLOCKED: Serial port not found, infinite loop]
    "Waiting for Haptic Pad on USB..."
    ↓ [Never escapes this loop]
    [Code never reaches TCP sender threads]
    [Code never emits connection markers]
    [Backend never sees confirmation]
    
Dashboard
    ↓
    Receives: { connected: false, status: "connecting" }
    ↓
    Displays: "Haptic Pad Not Connected" ✓ (CORRECT)
```

---

## Summary of Findings

| Layer | Component | Status | Issue |
|-------|-----------|--------|-------|
| **Frontend** | doctor-dashboard.html | ✓ | Displays status correctly |
| **Backend** | backend/server.js port 5000 | ✓ | Running, endpoints respond |
| **Backend** | Haptic status endpoint | ✓ | Reporting accurate state |
| **Launcher** | doctor_launcher.py process | ✓ | Spawned, running |
| **Launcher** | Serial USB detection | ❌ | **No USB device found** |
| **Launcher** | TCP connection attempt | ❌ | **Never reached (blocked by USB)** |
| **Network** | 192.168.1.21 reachability | ❌ | **Device unreachable on all 3 ports** |
| **Output** | Connection markers | ❌ | **Never emitted (blocked by USB)** |

---

## Conclusion

**`connected: true` will never happen** until BOTH conditions are met:

1. ✅ Haptic Pad USB is physically connected and recognized by Windows
2. ✅ Slave device at 192.168.1.21 is powered on, on the same network, and listening on ports 65434/65433/65432

Currently, **BOTH are failing**, so the dashboard status "Haptic Pad Not Connected" is **accurate and expected**.

---

*Generated by runtime diagnosis on Windows Machine (192.168.1.48)*
*Backend: Node.js v24.13.0*
*Python: 3.x (unbuffered)*
