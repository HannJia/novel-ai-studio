@echo off
set ELECTRON_RUN_AS_NODE=
set VITE_DEV_SERVER_URL=http://localhost:5173

echo Starting Electron...
cd /d E:\Cousor_work\novel-ai-studio
"node_modules\electron\dist\electron.exe" .
