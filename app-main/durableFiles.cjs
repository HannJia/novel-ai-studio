const fs = require('fs')
const { randomUUID } = require('crypto')

function writeFileDurably(filePath, data, encoding) {
  fs.writeFileSync(filePath, data, encoding)
  const descriptor = fs.openSync(filePath, 'r+')
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function replaceFile(tempPath, targetPath) {
  try { fs.renameSync(tempPath, targetPath); return }
  catch (error) {
    if (!fs.existsSync(targetPath)) throw error
  }
  // Windows can reject replacing an existing file. Keep the original under a
  // separate name until the new file is installed; never delete it first.
  const rollbackPath = `${targetPath}.previous-${randomUUID()}`
  fs.renameSync(targetPath, rollbackPath)
  try { fs.renameSync(tempPath, targetPath) }
  catch (error) {
    fs.renameSync(rollbackPath, targetPath)
    throw error
  }
  try { fs.rmSync(rollbackPath) } catch { /* Safe to retain an extra recovery copy. */ }
}

function writeAtomicFile(targetPath, data, backupPath = '') {
  const tempPath = `${targetPath}.tmp`
  writeFileDurably(tempPath, data)
  if (backupPath && fs.existsSync(targetPath)) {
    const backupTemp = `${backupPath}.tmp`
    writeFileDurably(backupTemp, fs.readFileSync(targetPath))
    replaceFile(backupTemp, backupPath)
  }
  replaceFile(tempPath, targetPath)
}

function preserveRecoveryFiles(dbPath) {
  const suffix = `.recovery-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`
  for (const source of [dbPath, `${dbPath}.bak`]) {
    if (fs.existsSync(source)) writeFileDurably(`${source}${suffix}`, fs.readFileSync(source))
  }
}

module.exports = { writeAtomicFile, preserveRecoveryFiles }
