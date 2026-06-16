@echo off
REM Biometric Fingerprint System - Flask Server Starter
REM Ensures Python dependencies are installed and starts the server

echo.
echo ============================================================
echo 🔬 Biometric Fingerprint System - Arduino Integration
echo ============================================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ✗ Python is not installed or not in PATH
    echo Please install Python 3.7+ from https://www.python.org/
    pause
    exit /b 1
)

echo ✓ Python detected
echo.

REM Check if virtual environment exists, create if not
if not exist venv (
    echo 📦 Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo 🔧 Activating virtual environment...
call venv\Scripts\activate.bat

REM Install dependencies
echo 📥 Installing dependencies...
pip install -r requirements.txt >nul 2>&1

if %errorlevel% neq 0 (
    echo ✗ Failed to install dependencies
    pause
    exit /b 1
)

echo ✓ Dependencies ready
echo.
echo ⚠️  IMPORTANT CHECKS:
echo  □ Arduino IDE is CLOSED (serial port conflict)
echo  □ Arduino is connected via USB to COM6
echo  □ Fingerprint sensor LED is ON
echo.
echo 🚀 Starting Flask server...
echo.

REM Run the server
python biometric_server.py

pause
