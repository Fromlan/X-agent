@echo off
cd /d "%~dp0\.."
title X-agent tutorial reset
echo.
echo ========================================
echo   X-agent tutorial env reset
echo   Clears ~/.pi and uninstalls Pi CLI
echo ========================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reset-tutorial-env.ps1" -Yes
echo.
pause
