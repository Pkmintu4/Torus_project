@echo off
setlocal
cd /d "%~dp0"

echo [LAUNCHER] Starting ECE doctor launcher...
if not exist "slave_ip.txt" (
  echo 192.168.1.21> slave_ip.txt
)

python doctor_launcher.py
exit /b %errorlevel%
