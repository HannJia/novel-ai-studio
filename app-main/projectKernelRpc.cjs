const { validateProjectBackup } = require('./kernel-validation/projectBackupValidation.js')
const { createProjectKernel } = require('./projectKernel.cjs')

function validateBackup(value) {
  if (!value || value.format !== 'ai-novel-writer-backup' || value.version !== 3) throw new Error('只接受完整的 V3 项目数据。')
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 256 * 1024 * 1024) throw new Error('项目数据超过 256 MB 上限。')
  validateProjectBackup(value)
}

function createProjectKernelHandler({ root, authorize }) {
  let kernel
  const getKernel = async () => {
    if (!kernel) kernel = createProjectKernel({ root, validateBackup }).catch(error => { kernel = null; throw error })
    return kernel
  }
  return async (event, request) => {
    try {
      authorize(event)
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('项目请求格式无效。')
      const keys = {
        readSnapshot: ['method', 'revision'], checkpoint: ['method', 'baseRevision', 'novelId'],
        restoreNovel: ['method', 'baseRevision', 'revision', 'novelId', 'scope'],
        read: ['method'], commit: ['method', 'baseRevision', 'backup', 'sync'], history: ['method'],
        historyRuns: ['method', 'projectId', 'baseRevision', 'cursor'],
        historyCapacity: ['method'], cleanupHistory: ['method', 'token', 'baseRevision'],
        historyRetention: ['method'], previewHistoryRetention: ['method', 'policy', 'pinnedRevisions'],
        confirmHistoryRetention: ['method', 'token', 'baseRevision'],
        restore: ['method', 'baseRevision', 'revision'], location: ['method', 'projectId'], rebuildIndex: ['method', 'projectId'], indexStatus: ['method', 'projectId'],
      }
      if (!Object.prototype.hasOwnProperty.call(keys, request.method)
        || Object.keys(request).some(key => !keys[request.method].includes(key))) throw new Error('不支持的项目操作。')
      if (['commit', 'restore', 'checkpoint', 'restoreNovel', 'historyRuns', 'cleanupHistory', 'confirmHistoryRetention'].includes(request.method)
        && request.baseRevision !== null && (typeof request.baseRevision !== 'string' || request.baseRevision.length > 200)) throw new Error('项目版本无效。')
      if (['restore', 'restoreNovel', 'readSnapshot'].includes(request.method) && (typeof request.revision !== 'string' || request.revision.length > 200)) throw new Error('恢复版本无效。')
      if (['location', 'rebuildIndex', 'indexStatus', 'historyRuns'].includes(request.method)
        && (typeof request.projectId !== 'string' || !request.projectId || request.projectId.length > 200)) throw new Error('作品编号无效。')
      if (request.method === 'historyRuns' && (!Number.isSafeInteger(request.cursor) || request.cursor < 0)) throw new Error('账本页码无效。')
      if (request.method === 'cleanupHistory' && (typeof request.token !== 'string' || !/^[a-f0-9-]{36}$/.test(request.token))) throw new Error('请重新预览容量。')
      if (request.method === 'confirmHistoryRetention' && (typeof request.token !== 'string' || !/^[a-f0-9-]{36}$/.test(request.token))) throw new Error('请重新预览历史保留策略。')
      if (request.method === 'previewHistoryRetention' && (!request.policy || typeof request.policy !== 'object' || Array.isArray(request.policy) || !Array.isArray(request.pinnedRevisions))) throw new Error('历史保留策略格式无效。')
      if (request.method === 'commit') validateBackup(request.backup)
      const service = await getKernel()
      let value
      switch (request.method) {
        case 'readSnapshot': value = await service.readSnapshot(request); break
        case 'checkpoint': value = await service.checkpoint(request); break
        case 'restoreNovel': value = await service.restoreNovel(request); break
        case 'read': value = await service.read(); break
        case 'commit': value = await service.commit(request); break
        case 'history': value = await service.history(); break
        case 'historyRuns': value = await service.historyRuns(request); break
        case 'historyRetention': value = await service.historyRetention(); break
        case 'previewHistoryRetention': value = await service.previewHistoryRetention(request); break
        case 'confirmHistoryRetention': value = await service.confirmHistoryRetention(request); break
        case 'historyCapacity': value = await service.historyCapacity(); break
        case 'cleanupHistory': value = await service.cleanupHistory(request); break
        case 'restore': value = await service.restore(request); break
        case 'location': value = await service.getProjectLocation(request.projectId); break
        case 'rebuildIndex': value = await service.rebuildIndex(request.projectId); break
        case 'indexStatus': value = await service.indexStatus(request.projectId); break
      }
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error: { code: typeof error.code === 'string' ? error.code : 'PROJECT_INVALID', message: error.message || '项目操作失败。' } }
    }
  }
}

module.exports = { createProjectKernelHandler, validateBackup }
