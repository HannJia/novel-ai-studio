const { randomUUID } = require('crypto')

function createUpdateHandshake(send, timeoutMs = 30000) {
  let pending = null
  function finish(error) {
    if (!pending) return
    const request = pending
    pending = null
    clearTimeout(request.timer)
    if (error) request.reject(error)
    else request.resolve()
  }
  return {
    request() {
      if (pending) return Promise.reject(new Error('正在保存更新前的数据，请稍候。'))
      return new Promise((resolve, reject) => {
        const id = randomUUID()
        const timer = setTimeout(() => finish(new Error('更新前保存超时，未执行安装。请重试。')), timeoutMs)
        pending = { id, timer, resolve, reject }
        try { send(id) } catch (error) { finish(error) }
      })
    },
    respond(result) {
      if (!pending || result?.requestId !== pending.id) return
      finish(result.ok === true ? null : new Error(String(result.error || '更新前保存失败，未执行安装。').slice(0, 240)))
    },
    get busy() { return Boolean(pending) },
  }
}

module.exports = { createUpdateHandshake }
