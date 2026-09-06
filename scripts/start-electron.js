// Electron 启动脚本 — 确保清除 ELECTRON_RUN_AS_NODE 环境变量
// 某些开发环境（如 Gemini IDE）会设置此变量导致 Electron 以 Node.js 模式运行
const { spawn } = require('child_process')
const electron = require('electron')

// 复制当前环境变量并删除 ELECTRON_RUN_AS_NODE
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// 启动 Electron，传入项目根目录
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: env,
})

child.on('close', (code) => process.exit(code))
