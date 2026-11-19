@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or later is required. Install Node.js and run setup.cmd again.
  popd
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 22) { console.error('Node.js 22 or later is required.'); process.exit(1); }"
if errorlevel 1 goto failed
call npm ci --ignore-scripts --no-fund --no-audit
if errorlevel 1 goto failed
node scripts/register.mjs --apply --update
if errorlevel 1 goto failed
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure.ps1"
if errorlevel 1 goto failed
echo Setup completed. Restart or reconnect your MCP clients.
popd
exit /b 0
:failed
echo Setup failed. Check the error above and rerun setup.cmd after fixing it.
popd
exit /b 1
