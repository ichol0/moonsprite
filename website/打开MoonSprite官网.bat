@echo off
setlocal

cd /d "%~dp0"

title MoonSprite Website
set "MOONSPRITE_WEBSITE_URL=http://127.0.0.1:4174"

call :configure_website
if not defined WEBSITE_WORKING_DIRECTORY (
  echo [MoonSprite] website/package.json was not found.
  echo Put this file in the project root or the website folder.
  echo.
  pause
  exit /b 1
)

call :is_listening
if not errorlevel 1 goto :open_website

call :find_package_runner
if not defined PNPM_COMMAND if not defined COREPACK_COMMAND (
  echo [MoonSprite] pnpm or Corepack was not found.
  echo Install Node.js and pnpm, then try again.
  echo.
  pause
  exit /b 1
)

echo [MoonSprite] Starting the website. Please wait...
if defined PNPM_COMMAND (
  start "MoonSprite Website" /min /d "%WEBSITE_WORKING_DIRECTORY%" "%PNPM_COMMAND%" %WEBSITE_SCRIPT% --host 127.0.0.1 --port 4174 --strictPort
) else (
  start "MoonSprite Website" /min /d "%WEBSITE_WORKING_DIRECTORY%" "%COREPACK_COMMAND%" pnpm %WEBSITE_SCRIPT% --host 127.0.0.1 --port 4174 --strictPort
)

for /l %%I in (1,1,30) do (
  call :is_listening
  if not errorlevel 1 goto :open_website
  >nul ping 127.0.0.1 -n 2
)

echo.
echo [MoonSprite] Website startup timed out: %MOONSPRITE_WEBSITE_URL%
echo Check the minimized MoonSprite Website window for details.
echo.
pause
exit /b 2

:open_website
start "" "%MOONSPRITE_WEBSITE_URL%"
exit /b 0

:configure_website
set "WEBSITE_WORKING_DIRECTORY="
set "WEBSITE_SCRIPT="

if exist "%~dp0website\package.json" (
  set "WEBSITE_WORKING_DIRECTORY=%~dp0"
  set "WEBSITE_SCRIPT=website:dev"
  exit /b 0
)

if exist "%~dp0package.json" (
  set "WEBSITE_WORKING_DIRECTORY=%~dp0"
  set "WEBSITE_SCRIPT=dev"
)
exit /b 0

:find_package_runner
set "PNPM_COMMAND="
set "COREPACK_COMMAND="

for /f "delims=" %%P in ('where pnpm.cmd 2^>nul') do if not defined PNPM_COMMAND set "PNPM_COMMAND=%%P"
if not defined PNPM_COMMAND if exist "%APPDATA%\npm\pnpm.cmd" set "PNPM_COMMAND=%APPDATA%\npm\pnpm.cmd"
if not defined PNPM_COMMAND if exist "%LOCALAPPDATA%\pnpm\pnpm.cmd" set "PNPM_COMMAND=%LOCALAPPDATA%\pnpm\pnpm.cmd"
if not defined PNPM_COMMAND if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" set "PNPM_COMMAND=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"

if not defined PNPM_COMMAND if exist "%ProgramFiles%\nodejs\corepack.cmd" set "COREPACK_COMMAND=%ProgramFiles%\nodejs\corepack.cmd"
exit /b 0

:is_listening
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4174 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
exit /b %ERRORLEVEL%
