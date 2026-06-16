# 🚀 Biometric System - Quick Reference Card

## ⚡ FASTEST START (Copy-Paste)

### Step 1: Install Python Packages
```bash
pip install -r requirements.txt
```

### Step 2: Run Server
```bash
python biometric_server.py
```

### Step 3: Open in Browser
- Registration: `file:///C:/Users/manju/OneDrive/Desktop/Torus_implementation/biometric-register.html`
- Authentication: `file:///C:/Users/manju/OneDrive/Desktop/Torus_implementation/biometric-auth.html`
- Admin Panel: `file:///C:/Users/manju/OneDrive/Desktop/Torus_implementation/biometric-admin.html`

---

## 🧪 API TEST COMMANDS (Windows PowerShell)

### Check Backend Health
```powershell
$response = Invoke-RestMethod -Uri "http://127.0.0.1:5000/health" -Method Get
$response
```

### Test Arduino Connection
```powershell
$response = Invoke-RestMethod -Uri "http://127.0.0.1:5000/test" -Method Get
$response
```

### Register Fingerprint (ID: 1)
```powershell
$body = @{ id = 1 } | ConvertTo-Json
$response = Invoke-RestMethod -Uri "http://127.0.0.1:5000/register" -Method Post -Body $body -ContentType "application/json"
$response
```

### Verify Fingerprint
```powershell
$body = @{} | ConvertTo-Json
$response = Invoke-RestMethod -Uri "http://127.0.0.1:5000/verify" -Method Post -Body $body -ContentType "application/json"
$response
```

### Delete Fingerprint (ID: 1)
```powershell
$body = @{ id = 1 } | ConvertTo-Json
$response = Invoke-RestMethod -Uri "http://127.0.0.1:5000/delete" -Method Post -Body $body -ContentType "application/json"
$response
```

### Delete ALL Fingerprints
```powershell
$body = @{ delete_all = $true } | ConvertTo-Json
$response = Invoke-RestMethod -Uri "http://127.0.0.1:5000/delete" -Method Post -Body $body -ContentType "application/json"
$response
```

---

## ❌ COMMON ISSUES & FIXES

| Issue | Fix |
|-------|-----|
| "Serial port not connected" | Arduino IDE is running (CLOSE IT). Wrong COM port. USB cable disconnected. |
| "Arduino test failed" | Arduino not powered. Sensor LED is OFF. Arduino needs reset. Try different USB port. |
| "Fingerprint not matched" | Sensor dirty. Register fingerprint first. Different finger. Sensor not working. |
| "Backend connection failed" | Flask not running. Wrong port (not 5000). Firewall blocking. URL in HTML is wrong. |
| Python not found | Install Python 3.7+. Add Python to PATH. Restart terminal after install. |

---

## 🔧 CONFIGURATION CHANGES

### Change COM Port
File: `biometric_server.py` (line ~28)
```python
SERIAL_PORT = 'COM6'  # Change to your port
```

### Change Flask Port
File: `biometric_server.py` (last line)
```python
app.run(host='127.0.0.1', port=5000)  # Change 5000 to your port
```

### Update Frontend URLs
File: `biometric-register.html` (search for):
```javascript
"http://127.0.0.1:5000/register"  // Change port if needed
```

File: `biometric-auth.html` (search for):
```javascript
"http://127.0.0.1:5000/verify"  // Change port if needed
```

---

## 📊 SERIAL MONITOR TESTING

1. Open Arduino IDE
2. Sketch → Include Library → Manage Libraries
3. Search for "Fingerprint" and find the correct library
4. Tools → Serial Monitor (baud rate: 115200)
5. Test commands:
   ```
   R1     → Should show "Saved" (register)
   F      → Should show "Matched" or "Not matched" (verify)
   D1     → Should show "Deleted" (delete single)
   DA     → Should show "All deleted" (delete all)
   ```

---

## 📱 USER WORKFLOW

### Registration Page (biometric-register.html)
```
1. Page loads
2. User sees fingerprint circle
3. User PRESSES & HOLDS circle for 2 seconds
4. Circle fills with progress (cyan ring)
5. After 2 seconds:
   ✓ Backend sends "R1" to Arduino
   ✓ Arduino registers fingerprint
   ✓ UI shows green checkmark
   ✓ Success message displays
   ✓ Auto-redirect after 1.5 seconds
```

### Login Page (biometric-auth.html)
```
1. Page loads (shows doctor profile)
2. User sees fingerprint circle
3. User clicks "Start Fingerprint Scan"
4. Circle pulses blue
5. Backend sends "F" to Arduino
6. Arduino searches database:
   ✓ Match found → Green circle → Dashboard
   ✗ No match → Red error → Try Again button
```

### Admin Panel (biometric-admin.html)
```
Features:
✓ Check backend health
✓ Test Arduino connection
✓ Register fingerprints (any ID)
✓ Verify fingerprints
✓ Delete specific fingerprints
✓ Delete all fingerprints
✓ Real-time operation log
```

---

## 🔐 SECURITY CHECKLIST

- [ ] Arduino commands not exposed to frontend
- [ ] Serial responses sanitized
- [ ] User ID validation on backend
- [ ] Fingerprint data not stored locally
- [ ] CORS enabled only for trusted origins
- [ ] Arduino IDE closed during operation
- [ ] Serial port not shared with other apps
- [ ] Unique ID per user implemented
- [ ] Authentication logs stored
- [ ] Error messages don't expose internals

---

## 📝 FILE REFERENCE

| File | Purpose |
|------|---------|
| `biometric_server.py` | Flask backend with Arduino communication |
| `biometric-register.html` | Registration UI with fingerprint scanner |
| `biometric-auth.html` | Login UI with fingerprint verification |
| `biometric-admin.html` | Admin panel for managing fingerprints |
| `requirements.txt` | Python dependencies (Flask, pyserial, CORS) |
| `START_BIOMETRIC_SERVER.bat` | Windows batch file to run server easily |
| `BIOMETRIC-SETUP-GUIDE.md` | Comprehensive setup and troubleshooting guide |
| `BIOMETRIC-QUICK-REFERENCE.md` | This file (quick commands and fixes) |

---

## 🆘 QUICK DIAGNOSIS

### Is Python running?
```bash
python --version
```

### Is Flask running?
Visit: `http://127.0.0.1:5000/health`
Should return JSON with status

### Is Arduino connected?
Check Device Manager → Ports (COM & LPT) for Arduino entry

### Can Arduino receive commands?
Test in Arduino IDE Serial Monitor at 115200 baud

### Can frontend reach backend?
Open browser console (F12) → Network tab → Check for failed requests

---

## 🎯 NEXT STEPS

1. **Test Everything:**
   - Backend health check
   - Arduino connection test
   - Manual fingerprint registration
   - Manual fingerprint verification

2. **Integrate Database:**
   - Store registered fingerprint IDs
   - Link to user accounts
   - Track authentication logs

3. **Add User Management:**
   - Map Aadhaar to fingerprint ID
   - Support multiple users
   - User profile management

4. **Production Ready:**
   - SSL/HTTPS setup
   - Error logging
   - Rate limiting
   - User authentication

---

## 💡 TIPS & TRICKS

1. **Virtual Environment:** Use `venv` to isolate dependencies
   ```bash
   python -m venv venv
   venv\Scripts\activate.bat
   ```

2. **Debug Mode:** Add logging for troubleshooting
   ```python
   import logging
   logging.basicConfig(level=logging.DEBUG)
   ```

3. **Multiple COM Ports:** Check Device Manager to find correct port
   ```
   Settings → Devices → Connected devices
   ```

4. **Sensor Issues:** Clean sensor with dry cloth if fingerprint not recognized

5. **USB Issues:** Try different USB port or cable if connection drops

---

## 📞 GETTING HELP

1. Check **Troubleshooting** section above first
2. Run `/health` endpoint to verify backend
3. Run `/test` endpoint to verify Arduino
4. Check browser console (F12) for errors
5. Check Flask terminal output for logs
6. Test commands directly in Serial Monitor

---

**Last Updated:** April 2026  
**System:** Torus Biometric Authentication  
**Version:** 1.0.0
