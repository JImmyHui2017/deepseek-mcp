@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure.ps1"
set "DEEPSEEK_SETUP_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %DEEPSEEK_SETUP_EXIT%
