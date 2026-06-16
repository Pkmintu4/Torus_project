@echo off
REM ============================================================================
REM BIOMETRIC SYSTEM - QUICK VERIFICATION SCRIPT
REM Run this to verify your backend is working before testing in browser
REM ============================================================================

setlocal enabledelayedexpansion

echo.
echo ============================================================================
echo   BIOMETRIC REGISTRATION SYSTEM - VERIFICATION TOOL
echo ============================================================================
echo.

REM Color codes
set RED=[41m
set GREEN=[42m
set YELLOW=[43m
set CYAN=[46m

echo [STEP 1] Checking Python Installation...
python --version >nul 2>&1
if errorlevel 1 (
    echo   ❌ ERROR: Python not found
    echo   FIX: Install Python 3.7+ from https://python.org
    echo   IMPORTANT: Check "Add Python to PATH" during installation
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('python --version') do set PYTHON_VERSION=%%i
    echo   ✅ Found: !PYTHON_VERSION!
)
echo.

echo [STEP 2] Checking Required Packages...
python -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo   ❌ Missing: Flask package
    echo   FIX: Run this command:
    echo   pip install -r requirements.txt
    pause
    exit /b 1
)
echo   ✅ Flask installed

python -c "import serial" >nul 2>&1
if errorlevel 1 (
    echo   ❌ Missing: pyserial package
    echo   FIX: Run this command:
    echo   pip install -r requirements.txt
    pause
    exit /b 1
)
echo   ✅ pyserial installed

python -c "import flask_cors" >nul 2>&1
if errorlevel 1 (
    echo   ❌ Missing: flask-cors package
    echo   FIX: Run this command:
    echo   pip install -r requirements.txt
    pause
    exit /b 1
)
echo   ✅ flask-cors installed
echo.

echo [STEP 3] Checking biometric_server.py File...
if exist "biometric_server.py" (
    echo   ✅ Found: biometric_server.py
) else (
    echo   ❌ ERROR: biometric_server.py not found
    echo   Make sure you're in the right directory
    pause
    exit /b 1
)
echo.

echo [STEP 4] Checking Frontend Files...
if exist "biometric-register.html" (
    echo   ✅ Found: biometric-register.html
) else (
    echo   ⚠️  WARNING: biometric-register.html not found
)

if exist "biometric-auth.html" (
    echo   ✅ Found: biometric-auth.html
) else (
    echo   ⚠️  WARNING: biometric-auth.html not found
)

if exist "biometric-admin.html" (
    echo   ✅ Found: biometric-admin.html
) else (
    echo   ⚠️  WARNING: biometric-admin.html not found
)
echo.

echo [STEP 5] Pre-Flight Checklist...
echo.
echo   BEFORE STARTING, VERIFY:
echo   □ Arduino IDE is CLOSED (very important!)
echo   □ Arduino connected to USB port
echo   □ Device Manager shows Arduino on COM6
echo   □ Fingerprint sensor LED is GREEN (on)
echo.
echo   If any of these are NOT done, fix them now!
echo.

set /p PROCEED="Ready to start backend server? (yes/no) "
if /i "!PROCEED!" neq "yes" (
    echo Cancelled. Exiting.
    pause
    exit /b 0
)
echo.

echo ============================================================================
echo   STARTING BIOMETRIC SERVER
echo ============================================================================
echo.
echo Server will start at: http://127.0.0.1:5000
echo.
echo NEXT STEPS AFTER SERVER STARTS:
echo   1. Note the "Serial connection established" message
echo   2. Open NEW terminal/PowerShell window
echo   3. Run: curl http://127.0.0.1:5000/health
echo   4. Open browser to: biometric-register.html
echo   5. Open Developer Tools: F12
echo   6. Go to Console tab
echo   7. Press and hold fingerprint circle for 2 seconds
echo   8. Watch console for: ✅ Backend SUCCESS
echo.
echo ============================================================================
echo.

python biometric_server.py

pause
