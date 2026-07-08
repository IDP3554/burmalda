@echo off
rem One-command backend launcher, run from the repo root: start.bat
rem (double-click, or from cmd/PowerShell). Does the same thing as running
rem manually: cd backend, activate venv if present, then
rem uvicorn main:app --host 0.0.0.0 --port 3000.
rem
rem Port 3000 matches the Scanner's default server-address field in
rem index.html, so nothing needs to be reconfigured by hand.
rem
rem NOTE: kept ASCII-only on purpose - non-ASCII text in .bat files can be
rem misread by cmd.exe depending on the system's active code page, which
rem corrupts REM lines into garbage "commands".

cd /d "%~dp0backend"

set HAD_VENV=0
if exist ".venv\Scripts\activate.bat" (
  set HAD_VENV=1
  call ".venv\Scripts\activate.bat"
)

where uvicorn >nul 2>nul
if errorlevel 1 (
  if "%HAD_VENV%"=="0" (
    echo venv not found. Create it and install dependencies ^(once^):
    echo   python -m venv backend\.venv
    echo   backend\.venv\Scripts\activate
    echo   pip install -r backend\requirements.txt
  ) else (
    echo backend\.venv found, but uvicorn is not installed in it ^(dependencies
    echo were not installed, or the venv is broken^). Run:
    echo   backend\.venv\Scripts\activate
    echo   pip install -r backend\requirements.txt
  )
  echo ^(Or without a venv, globally: cd backend ^&^& pip install -r requirements.txt^)
  exit /b 1
)

echo Backend starting on http://0.0.0.0:3000
echo Find this machine's local IP (run: ipconfig) to connect the Scanner from a
echo phone: http://YOUR-IP:3000/api/fish

uvicorn main:app --host 0.0.0.0 --port 3000
