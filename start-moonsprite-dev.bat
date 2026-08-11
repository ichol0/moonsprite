@echo off
setlocal

cd /d "%~dp0"
title MoonSprite Development

echo [MoonSprite] Starting the Tauri development app...
echo [MoonSprite] Keep this window open while using MoonSprite.
echo.

set "MOONSPRITE_APP_PID="
for /f "delims=" %%P in ('powershell -NoProfile -Command "(Get-Process -Name moonsprite -ErrorAction SilentlyContinue).Id"') do if not defined MOONSPRITE_APP_PID set "MOONSPRITE_APP_PID=%%P"
if defined MOONSPRITE_APP_PID (
  echo [MoonSprite] The development app is already running.
  echo Close the existing app before starting it again.
  exit /b 0
)

set "MOONSPRITE_PORT_PID="
for /f "delims=" %%P in ('powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue).OwningProcess"') do if not defined MOONSPRITE_PORT_PID set "MOONSPRITE_PORT_PID=%%P"
if defined MOONSPRITE_PORT_PID (
  echo [MoonSprite] Port 5173 is already in use by process %MOONSPRITE_PORT_PID%.
  echo Close that process or free port 5173, then try again.
  pause
  exit /b 2
)

set "PNPM_COMMAND="
for /f "delims=" %%P in ('where pnpm 2^>nul') do if not defined PNPM_COMMAND set "PNPM_COMMAND=%%P"

if not defined PNPM_COMMAND if exist "%APPDATA%\npm\pnpm.cmd" set "PNPM_COMMAND=%APPDATA%\npm\pnpm.cmd"
if not defined PNPM_COMMAND if exist "%LOCALAPPDATA%\pnpm\pnpm.cmd" set "PNPM_COMMAND=%LOCALAPPDATA%\pnpm\pnpm.cmd"
if not defined PNPM_COMMAND if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" set "PNPM_COMMAND=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"

if defined PNPM_COMMAND goto :start_with_pnpm

if exist "%ProgramFiles%\nodejs\corepack.cmd" (
  set "COREPACK_HOME=%LOCALAPPDATA%\MoonSprite\corepack"
  echo [MoonSprite] pnpm was not found directly. Using Corepack.
  call "%ProgramFiles%\nodejs\corepack.cmd" pnpm dev
  set "MOONSPRITE_EXIT_CODE=%ERRORLEVEL%"
  goto :finish
)

echo [MoonSprite] pnpm and Corepack were not found.
echo Install Node.js with Corepack or install pnpm, then try again.
pause
exit /b 1

:start_with_pnpm
for %%P in ("%PNPM_COMMAND%") do set "PNPM_DIRECTORY=%%~dpP"
set "PATH=%PNPM_DIRECTORY%;%PATH%"
echo [MoonSprite] Using pnpm: %PNPM_COMMAND%
call "%PNPM_COMMAND%" dev
set "MOONSPRITE_EXIT_CODE=%ERRORLEVEL%"

:finish
if not "%MOONSPRITE_EXIT_CODE%"=="0" (
  echo.
  echo [MoonSprite] Startup failed with exit code %MOONSPRITE_EXIT_CODE%.
  pause
)

exit /b %MOONSPRITE_EXIT_CODE%
