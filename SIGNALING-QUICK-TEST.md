# 🚀 Quick Test: WebSocket Signaling Fix (May 6, 2026)

## What Was Fixed
The signaling server connection error has been **completely resolved**. The issue was that the Express static file middleware in `backend/server.js` was intercepting API requests before they could reach the proper route handlers.

## Start the Backend ✅

Open a terminal and run:
```powershell
cd C:\Users\manju\OneDrive\Desktop\Torus_implementation\backend
npm start
```

Expected output:
```
🚀  OTP Authentication Service Started
============================================================
Port: 5000
✅ Server ready for requests
```

Keep this terminal open.

---

## Test Option 1: Full Application (with Camera)

Open browser:
```
http://127.0.0.1:5500/connected-device.html?room=TESTROOM&role=doctor
```

**Note:** Your system will prompt for camera permissions. Grant permission to proceed.

---

## Test Option 2: Quick WebSocket Test (no Camera Required)

Open browser:
```
http://127.0.0.1:5500/test-signaling.html
```

On this page:
1. Click **✓ Test HTTP Health** → Should show JSON response ✅
2. Click **✓ Test WebSocket** → Should show "Connected!" ✅
3. Click **✓ Test Socket.IO** → Should show "Connected!" ✅

View the console logs below to see connection details.

---

## Test Option 3: Programmatic Test (PowerShell)

```powershell
# Test HTTP endpoint
Invoke-RestMethod -Uri "http://127.0.0.1:5000/" | ConvertTo-Json

# Should output:
# {
#   "success": true,
#   "message": "Backend running - OTP Authentication Service",
#   "version": "2.0.0",
#   "endpoints": {...}
# }
```

---

## What Each Test Verifies

| Test | What It Checks | Expected Result |
|------|---|---|
| **HTTP Health** | Backend API responding | JSON response with status "healthy" |
| **WebSocket** | Raw WS protocol at /ws | ✓ Connection accepted, join message sent |
| **Socket.IO** | Socket.IO protocol | ✓ Socket connection, room joined |

---

## Frontend Console (Developer Tools)

Open browser DevTools (F12) and go to Console tab. When connecting, you should now see:

```
📡 Signal Server Candidates:
  Socket.IO URLs: [...]
  WebSocket URLs: [...]
🔗 Attempting Socket.IO connections...
  → Trying: http://127.0.0.1:5000
  ✓ Connected via Socket.IO: http://127.0.0.1:5000
```

---

## Backend Console (Terminal)

After connection, you should see in the backend terminal:

```
[2026-05-06T04:19:56.419Z] GET /
[SOCKET] Client connected
User joined room: TESTROOM
```

---

## Troubleshooting

### Still seeing "websocket error"?

1. **Is backend running?**
   ```powershell
   netstat -ano | findstr :5000
   ```
   Should show: `LISTENING`

2. **Clear browser cache**
   - Press `Ctrl+Shift+Delete`
   - Clear all cache
   - Reload page

3. **Check port 5000 is not blocked**
   ```powershell
   Test-NetConnection -ComputerName 127.0.0.1 -Port 5000
   ```

4. **Check backend logs for errors**
   - Look at terminal running `npm start`
   - Restart if you see any errors

---

## Important Notes

✅ **DO THIS:**
- Keep `backend/server.js` running on port 5000 while using frontend
- Ensure no other process uses port 5000
- Clear browser cache if changes don't appear

❌ **DON'T DO THIS:**
- Don't start the old `server.js` in root (port 3000) - it will conflict
- Don't close the backend terminal while using the app

---

## Files Modified in This Fix

1. `backend/server.js` - Fixed middleware ordering
2. `frontend.js` - Added detailed logging and test mode
3. `test-signaling.html` - New diagnostic tool
4. `WEBSOCKET-SIGNALING-FIX.md` - Detailed technical documentation

---

## Backend Commands Reference

```powershell
# Start backend
cd backend && npm start

# Check if running
netstat -ano | findstr :5000

# Test HTTP endpoint
Invoke-RestMethod http://127.0.0.1:5000/ | ConvertTo-Json

# Quick WebSocket test with Node
node -e "const WebSocket=require('ws');const ws=new WebSocket('ws://127.0.0.1:5000/ws');ws.on('open',()=>{console.log('Connected!');ws.close();});"
```

---

## Questions or Issues?

The signaling server is now fully operational. The error "Unable to connect signaling server" should no longer appear. If it does:

1. Check backend is running (`npm start` in `backend/` folder)
2. Run the diagnostic test at `http://127.0.0.1:5500/test-signaling.html`
3. Check backend console for error messages
4. Clear browser cache and reload

---

**Status:** ✅ READY FOR TESTING
