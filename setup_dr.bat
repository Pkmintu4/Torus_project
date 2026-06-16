@echo off
setlocal
cd /d "%~dp0"

echo [SETUP] Doctor Station environment setup
echo [SETUP] Working dir: %CD%

python -m pip install --upgrade pip >nul 2>&1
python -m pip install pyserial
if errorlevel 1 (
  echo [ERROR] Failed to install pyserial. Ensure Python is installed and on PATH.
  exit /b 1
)

echo [OK] pyserial installed.
echo [OK] setup complete.
exit /b 0
