@echo off
REM Quick verification script for Haptic Pad setup
REM This script checks if the backend is running and verifies haptic-status

echo ============================================================
echo Haptic Pad Setup Verification
echo ============================================================
echo.

echo Checking if backend is running on port 5000...
netstat -ano | findstr :5000 > nul
if %errorlevel% equ 0 (
    echo [OK] Backend listening on port 5000
) else (
    echo [FAIL] Backend not running on port 5000
    echo.
    echo To start backend in real-device mode, run:
    echo   cd backend
    echo   node server.js
    exit /b 1
)

echo.
echo Checking haptic-status endpoint...
for /f %%i in ('powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5000/haptic-status' -UseBasicParsing -TimeoutSec 3 2>&1; if ($r.StatusCode -eq 200) { Write-Host 'OK' } } catch { Write-Host 'FAIL' }"') do set status=%%i

if "%status%"=="OK" (
    echo [OK] Haptic-status endpoint responding
) else (
    echo [FAIL] Haptic-status endpoint not responding
    exit /b 1
)

echo.
echo Querying connection status...
for /f "tokens=*" %%a in ('powershell -Command "(Invoke-WebRequest -Uri 'http://127.0.0.1:5000/haptic-status' -UseBasicParsing).Content | ConvertFrom-Json | Select-Object -ExpandProperty connected"') do set connected=%%a

if "%connected%"=="True" (
    echo [OK] Haptic device status: CONNECTED
    echo.
    echo ============================================================
    echo SUCCESS: Haptic Pad integration is working!
    echo ============================================================
    echo Frontend polling should show: "Haptic Pad Connected"
) else (
    echo [INFO] Haptic device status: NOT CONNECTED
    echo.
    echo This means the real hardware is not reachable yet.
    echo Check:
    echo   1. USB COM port detection
    echo   2. Device IP 192.168.1.21
    echo   3. TCP ports 65434, 65433, 65432
)

echo.
pause
