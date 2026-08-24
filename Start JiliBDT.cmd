@echo off
setlocal EnableExtensions

title JiliBDT Updates Automation
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

echo.
echo ============================================================
echo   JiliBDT Updates Automation
echo ============================================================
echo.

where node.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Install Node.js 24 LTS, then double-click this file again.
  goto :failed
)

for /f "usebackq delims=" %%V in (`node -p "process.versions.node.split('.')[0]"`) do set "NODE_MAJOR=%%V"
if not "%NODE_MAJOR%"=="24" (
  echo ERROR: Node.js 24 LTS is required. Found Node.js:
  node --version
  goto :failed
)

where pnpm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm was not found.
  echo Run: npm install --global pnpm@11
  echo Then double-click this file again.
  goto :failed
)

if /i "%JILIBDT_LAUNCHER_TEST%"=="1" (
  echo Launcher prerequisite checks passed.
  exit /b 0
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo FIRST-TIME SETUP: A new .env file was created.
  echo Fill in the Google Sheet and administrator settings, save it,
  echo then double-click Start JiliBDT.cmd again.
  echo.
  start "JiliBDT Configuration" notepad.exe "%PROJECT_DIR%.env"
  goto :failed
)

findstr /c:"replace-with-spreadsheet-id" ".env" >nul 2>nul
if not errorlevel 1 (
  echo ERROR: GOOGLE_SPREADSHEET_ID still has its placeholder value in .env.
  start "JiliBDT Configuration" notepad.exe "%PROJECT_DIR%.env"
  goto :failed
)

findstr /c:"replace-with-worksheet-title" ".env" >nul 2>nul
if not errorlevel 1 (
  echo ERROR: GOOGLE_WORKSHEET_TITLE still has its placeholder value in .env.
  start "JiliBDT Configuration" notepad.exe "%PROJECT_DIR%.env"
  goto :failed
)

findstr /c:"replace-with-a-long-random-local-token" ".env" >nul 2>nul
if not errorlevel 1 (
  echo ERROR: ADMIN_API_TOKEN still has its placeholder value in .env.
  start "JiliBDT Configuration" notepad.exe "%PROJECT_DIR%.env"
  goto :failed
)

if not exist "node_modules\.pnpm" (
  echo Installing project dependencies...
  call pnpm install --frozen-lockfile
  if errorlevel 1 goto :failed
)

echo Checking the screenshot browser...
call pnpm playwright:install
if errorlevel 1 goto :failed

echo Starting the backend and administrator interface...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4100/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "JiliBDT Backend" /D "%PROJECT_DIR%" cmd.exe /k "pnpm dev:server"
) else (
  echo Backend is already running.
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "JiliBDT Admin" /D "%PROJECT_DIR%" cmd.exe /k "pnpm dev:admin"
) else (
  echo Administrator interface is already running.
)

echo Waiting for JiliBDT to become ready...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(60); do { $api=$false; $ui=$false; try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4100/health' -TimeoutSec 2 | Out-Null; $api=$true } catch {}; try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000' -TimeoutSec 2 | Out-Null; $ui=$true } catch {}; if ($api -and $ui) { exit 0 }; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo ERROR: JiliBDT did not become ready within 60 seconds.
  echo Check the Backend and Admin windows for the exact error.
  goto :failed
)

echo Ready. Opening http://127.0.0.1:3000
start "" "http://127.0.0.1:3000"
exit /b 0

:failed
echo.
echo JiliBDT was not started. Review the message above.
echo Press any key to close this window.
pause >nul
exit /b 1
