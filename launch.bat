@echo off
cd /d "%~dp0"
echo [Dashboard] Building...
call npx tsc -p tsconfig.electron.json
if %errorlevel% neq 0 (
    echo [Dashboard] TypeScript build failed!
    pause
    exit /b 1
)
echo [Dashboard] Starting Workflow Dashboard...
set ELECTRON_RUN_AS_NODE=
start "" /B node_modules\electron\dist\electron.exe .
echo [Dashboard] Launched! You can close this window.
