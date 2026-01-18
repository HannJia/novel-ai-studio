@echo off
chcp 65001 >nul
title NovelAI Studio

echo.
echo  ========================================
echo     NovelAI Studio Starting...
echo  ========================================
echo.

cd /d "%~dp0"

where java >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Java not found
    pause
    exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found
    pause
    exit /b 1
)

if not exist "java-backend\target\novel-ai-studio-1.0.0.jar" (
    echo [ERROR] Backend JAR not found
    echo Please build: cd java-backend && mvn clean package -DskipTests
    pause
    exit /b 1
)

echo [1/2] Starting backend...
start "Backend" /min cmd /c "cd /d "%~dp0java-backend\target" && java -jar novel-ai-studio-1.0.0.jar"

echo      Waiting for backend (port 8080)...
:wait_backend
timeout /t 2 /nobreak >nul
netstat -an | findstr ":8080.*LISTENING" >nul 2>&1
if %errorlevel% neq 0 (
    goto wait_backend
)
echo      Backend ready!

echo.
echo [2/2] Starting frontend + electron...
echo      This may take a moment...
start "Frontend" cmd /c "cd /d "%~dp0" && npm run electron:dev"

echo.
echo  ========================================
echo     Started!
echo     Backend:  http://localhost:8080
echo     Frontend: http://localhost:5173
echo  ========================================
echo.
echo To stop: run stop-app.bat or close windows
echo.
pause
