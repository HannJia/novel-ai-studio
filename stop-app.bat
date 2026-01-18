@echo off
title Stop NovelAI Studio

echo.
echo  Stopping NovelAI Studio...
echo.

echo [1/2] Stopping backend...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo [2/2] Stopping frontend...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

taskkill /f /im electron.exe >nul 2>&1

echo.
echo  All services stopped!
echo.
timeout /t 2 /nobreak >nul
