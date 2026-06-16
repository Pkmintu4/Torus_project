@echo off
REM TORUS Video Consultation - Mobile Setup Script
REM Simple version without subdomain requirement

color 0A
cls

echo.
echo ============================================
echo  TORUS HTTPS Tunnel Setup
echo ============================================
echo.
echo This will create one FREE HTTPS tunnel for mobile access
echo.
echo Required: Node.js and npm installed
echo.
pause

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found!
    echo Install from: https://nodejs.org/
    pause
    exit /b 1
)

echo.
echo Step 1: Starting Backend Signaling Server...
echo.
start "TORUS Server (Keep Running)" cmd /k "cd /d "%CD%\backend" && node server.js"
timeout /t 3 /nobreak

echo.
echo Step 2: Starting HTTPS Tunnel for Signaling (port 5000)...
echo Please wait for the tunnel URL to appear...
echo.
start "TORUS Tunnel" cmd /k "cd /d ""%CD%"" && npx localtunnel --port 5000"

echo.
echo ============================================
echo  Tunnels Starting...
echo ============================================
echo.
echo You will see 1 new window with an HTTPS URL
echo Copy that URL and use it in the format below:
echo.
echo DOCTOR Link:
echo https://YOUR-TUNNEL-URL/connected-device.html?room=ABC123^&role=doctor^&autostart=1
echo.
echo PATIENT Link (Mobile):
echo https://YOUR-TUNNEL-URL/connected-device.html?room=ABC123^&role=patient^&autostart=1
echo.
echo Replace YOUR-TUNNEL-URL with the actual localtunnel URL from the window
echo.
echo Press any key to close...
pause
