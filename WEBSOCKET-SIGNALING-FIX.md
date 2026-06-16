# WebSocket Signaling Issue - RESOLVED ✅

**Date:** May 6, 2026  
**Status:** FIXED  
**Issue:** "Unable to connect signaling server (ws://127.0.0.1:5000/ws). websocket error / server is down"

---

## Root Cause Analysis

### Primary Issue
`backend/server.js` had Express static file middleware **BEFORE** API route definitions:

```javascript
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '..')));  // ❌ TOO EARLY

app.get('/', (req, res) => { ... })  // Never reached for GET /
app.post('/api/auth/send-otp', ...)  // API routes after static
```

**Impact:** When frontend called `GET http://127.0.0.1:5000/`, it received HTML instead of JSON API response, breaking connection detection and causing silent failures.

### Secondary Issues Addressed
1. Missing detailed logging in `frontend.js` connection logic
2. Camera permission requirement blocking WebSocket testing
3. No fallback test mechanism for dev environments

---

## Solution Applied

### 1. ✅ Fixed Middleware Order (`backend/server.js`)
```javascript
// BEFORE: Static files intercepted all requests
app.use(express.static(...));  // Served HTML for everything
app.get('/', ...)  // Never executed

// AFTER: API routes processed first, static files last
app.post('/api/auth/send-otp', ...)  // API endpoints work
app.post('/api/auth/reset-password', ...)
app.post('/create-room', ...)
// ... error handlers ...
app.use(express.static(...));  // Only serve static if no API match
app.use((req, res) => { ... });  // 404 handler last
```

### 2. ✅ Enhanced Logging (`frontend.js`)
Added verbose connection debugging to `connectSignaling()`:
```javascript
console.log("📡 Signal Server Candidates:", socketIoCandidates, webSocketCandidates);
console.log("🔗 Attempting Socket.IO connections...");
console.log("  → Trying:", url);
console.log("  ✓ Connected via Socket.IO:", url);
```

### 3. ✅ Test Mode Support (`frontend.js`)
Added `?test=1` query parameter to skip camera requirement:
```javascript
const isTestMode = /test=1|skipCamera=true/i.test(window.location.search);
if (isTestMode) {
    console.log("🧪 TEST MODE: Skipping camera");
    return;  // Skip getUserMedia
}
```

### 4. ✅ Created Test Page (`test-signaling.html`)
Standalone WebSocket/Socket.IO diagnostic tool:
- HTTP health check
- Native WebSocket connection test
- Socket.IO connection test
- Real-time log viewing

---

## Verification Results

### Before Fix
```
❌ GET http://127.0.0.1:5000/
  Response: <!DOCTYPE html>... (HTML served by static middleware)
  
❌ WebSocket ws://127.0.0.1:5000/ws
  Error: Connection failed
```

### After Fix
```
✅ GET http://127.0.0.1:5000/
  Response: {
    "success": true,
    "message": "Backend running - OTP Authentication Service",
    "version": "2.0.0",
    "endpoints": { ... }
  }

✅ WebSocket ws://127.0.0.1:5000/ws
  Backend logs:
  [2026-05-06T04:19:56.419Z] GET /
  [SOCKET] Client connected
  User joined room: TEST-ROOM
```

---

## Files Modified

1. **`backend/server.js`** (lines ~330-820)
   - Moved `app.use(express.static(...))` from line 337 to after error handlers
   - Ensures API routes are processed before static file serving

2. **`frontend.js`** (lines ~449-500)
   - Added detailed logging to `connectSignaling()`
   - Added time-out handling for connections
   - Enhanced `connectToSignalServer()` and `connectToNativeWebSocket()` with debug output
   - Added test mode to skip camera requirement

3. **`test-signaling.html`** (new file)
   - Standalone diagnostic tool for WebSocket testing
   - No camera permission required

---

## How to Use

### Normal Operation (with camera)
```
http://127.0.0.1:5500/connected-device.html?room=ROOMID&role=doctor
```

### Test Mode (skip camera)
```
http://127.0.0.1:5500/connected-device.html?room=ROOMID&role=doctor&test=1
```

### Diagnostic Tool
```
http://127.0.0.1:5500/test-signaling.html
```

---

## Backend Verification Checklist

- [x] Backend server running on port 5000
  ```powershell
  cd backend
  npm start
  ```

- [x] HTTP health check responds with JSON
  ```powershell
  Invoke-RestMethod http://127.0.0.1:5000/
  ```

- [x] WebSocket upgrade handler listening at /ws
  ```powershell
  netstat -ano | findstr :5000  # Shows LISTENING
  ```

- [x] Socket.IO available at /socket.io
  ```javascript
  window.io('http://127.0.0.1:5000')
  ```

---

## Key Takeaways

1. **Middleware Order Matters**: Express processes middleware in registration order. Static files should be LAST (after all API routes).

2. **Silent Failures**: When JSON is expected but HTML is returned, network requests fail silently. Add logging to catch these issues.

3. **Separate Static & API**: Best practice to serve API from one path and static files from another:
   ```javascript
   app.use('/api', apiRouter);  // API routes
   app.use(express.static('public'));  // Static files
   ```

4. **Test Coverage**: Create diagnostic tools for connection issues that don't require full environment (camera, permissions, etc.)

---

## Status

✅ **FULLY RESOLVED**
- WebSocket signaling working
- HTTP API responding correctly
- Frontend can now detect and connect to backend
- Logging shows clear connection flow

**Next Steps:**  
- Test with actual camera/mobile client
- Monitor for any remaining connection edge cases
- Consider moving static files to dedicated `public/` folder for cleaner architecture
