@echo off
chcp 65001 >nul
title 创建桌面快捷方式

echo.
echo  正在创建桌面快捷方式...
echo.

:: 获取当前目录
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

:: 获取桌面路径
for /f "tokens=2*" %%a in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders" /v Desktop 2^>nul') do set "DESKTOP=%%b"

:: 创建 VBS 脚本来生成快捷方式
echo Set WshShell = CreateObject("WScript.Shell") > "%temp%\create_shortcut.vbs"
echo Set shortcut = WshShell.CreateShortcut("%DESKTOP%\NovelAI Studio.lnk") >> "%temp%\create_shortcut.vbs"
echo shortcut.TargetPath = "%SCRIPT_DIR%\NovelAI-Studio.vbs" >> "%temp%\create_shortcut.vbs"
echo shortcut.WorkingDirectory = "%SCRIPT_DIR%" >> "%temp%\create_shortcut.vbs"
echo shortcut.Description = "AI辅助小说创作工具" >> "%temp%\create_shortcut.vbs"
echo shortcut.IconLocation = "%SCRIPT_DIR%\resources\icons\icon.ico, 0" >> "%temp%\create_shortcut.vbs"
echo shortcut.Save >> "%temp%\create_shortcut.vbs"

:: 执行 VBS 脚本
cscript //nologo "%temp%\create_shortcut.vbs"
del "%temp%\create_shortcut.vbs"

:: 同时创建停止服务的快捷方式
echo Set WshShell = CreateObject("WScript.Shell") > "%temp%\create_shortcut2.vbs"
echo Set shortcut = WshShell.CreateShortcut("%DESKTOP%\停止 NovelAI.lnk") >> "%temp%\create_shortcut2.vbs"
echo shortcut.TargetPath = "%SCRIPT_DIR%\stop-app.bat" >> "%temp%\create_shortcut2.vbs"
echo shortcut.WorkingDirectory = "%SCRIPT_DIR%" >> "%temp%\create_shortcut2.vbs"
echo shortcut.Description = "停止NovelAI服务" >> "%temp%\create_shortcut2.vbs"
echo shortcut.Save >> "%temp%\create_shortcut2.vbs"

cscript //nologo "%temp%\create_shortcut2.vbs"
del "%temp%\create_shortcut2.vbs"

echo.
echo  ✓ 快捷方式已创建到桌面：
echo    - NovelAI Studio（启动应用）
echo    - 停止 NovelAI（停止服务）
echo.
pause
