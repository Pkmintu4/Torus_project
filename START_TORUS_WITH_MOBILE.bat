@echo off
REM TORUS Video Consultation - Automated Startup with HTTPS Tunneling
REM This script starts the server and creates HTTPS tunnels for mobile access

echo.
echo ============================================
echo  TORUS Video Consultation Setup
echo ============================================
echo.
echo This will start:
echo   1. Node.js Signaling Server (port 5000)
echo   2. HTTPS Tunnel for Frontend (port 5500)
echo   3. HTTPS Tunnel for Signaling (port 5000)
echo.
echo Please wait...
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if npx is available for localtunnel
npx --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: npx is not available
    echo Please reinstall Node.js
    pause
    exit /b 1
)

REM Start Node server in a new window
echo Starting Node.js Signaling Server...
start "TORUS Signaling Server" cmd /k "cd /d "%CD%\backend" && node server.js"
timeout /t 2 /nobreak

REM Start Frontend Tunnel in a new window
echo Starting HTTPS Tunnel for Frontend (port 5500)...
start "TORUS Frontend Tunnel" cmd /k "npx localtunnel --port 5500 --subdomain torus-frontend"

REM Start Signaling Tunnel in a new window
echo Starting HTTPS Tunnel for Signaling (port 5000)...
start "TORUS Signaling Tunnel" cmd /k "npx localtunnel --port 5000 --subdomain torus-signal"

echo.
echo ============================================
echo  Waiting for tunnels to initialize...
echo ============================================
echo.
timeout /t 5 /nobreak

echo.
echo ============================================
echo  SETUP COMPLETE!
echo ============================================
echo.
echo Your HTTPS URLs are ready. Open these links:
echo.
echo DOCTOR (Desktop):
echo https://torus-frontend.loca.lt/connected-device.html?room=TEST123^&role=doctor^&autostart=1^&signal=https://torus-signal.loca.lt
echo.
echo PATIENT (Mobile):
echo https://torus-frontend.loca.lt/connected-device.html?room=TEST123^&role=patient^&autostart=1^&signal=https://torus-signal.loca.lt
echo.
echo NOTE: Replace TEST123 with your actual room ID
echo.
echo Press any key to close this window (keep other windows open)
pause
