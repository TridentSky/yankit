@echo off
set ELECTRON_RUN_AS_NODE=
if not exist "%~dp0node_modules" (
    echo Installing dependencies...
    cd /d "%~dp0"
    npm install
)
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
