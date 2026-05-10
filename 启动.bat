@echo off
title CampusBili Launcher

echo ====================================
echo   CampusBili Proxy Server
echo   Starting...
echo ====================================
echo.

cd /d "%~dp0"

if not exist node_modules (
  echo [INFO] node_modules not found, running pnpm install...
  call pnpm install
  if errorlevel 1 (
    echo [ERROR] Install failed, please check pnpm
    pause
    exit /b 1
  )
  echo.
)

echo [INFO] Starting server at http://localhost:3003
echo [TIP] Press Ctrl+C to stop
echo.

node server.js

pause
