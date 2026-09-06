// Synthetic UI fixture only. Bind to loopback; never forward or log credentials.
const http = require('http')
const settings = {
  genre: 'urban', subGenre: 'business', tags: ['经商', '群像'], targetWordCountMin: 80, targetWordCountMax: 100,
  settings: { protagonist: { name: '陈安', background: '九十年代的普通工人，不重生、不使用系统' },
    worldBuilding: { worldType: '现代', socialStructure: '九十年代地方工厂', specialRules: '现实背景，无超自然能力' },
    coreConflict: { mainConflict: '创业诚信与短期利益的冲突' }, otherSettings: '本地界面回归测试资料；具体历史政策待核实。' },
}
const outline = `## 一句话概括
普通工人陈安与同伴从修理铺起步。
## 推荐书名
1. 《回归测试：旧厂新路》
## 小说简介
一个九十年代的普通工人，在第一笔订单中面对诚信与利益。
## 主线剧情走向
起步、合作、危机、重建。
## 主要角色表
| 姓名 | 身份 | 性格特点 | 关键经历 |
| --- | --- | --- | --- |
| 陈安 | 工人 | 务实 | 创业 |
## 核心冲突与爽点设计
诚信经营与短期利益的矛盾。
## 分卷建议
### 第一卷：下海（1992-1996）
**主题：** 从零到一、原始积累与道德灰色
- 辞职风波，夫妻矛盾初现
**预估章节数：** 约97章
**预估字数：** 约21.3万字
## 预估总字数分配
全书80到100万字，按每章2000到2500字估算。
## 全书伏笔线
- 第一笔订单的承诺，影响后续合作。
`
const advice = {
  contextSummary: '本地模拟接口，非真实模型回复',
  suggestions: Array.from({ length: 4 }, (_, i) => ({
    title: `方向${i + 1}：调查订单`, kind: 'investigation',
    approach: '让陈安核对订单时间，与合伙人商量下一步。'.repeat(10),
    storyEffect: '推进调查，保持现实背景。', nextBeat: '先确认交货期限。', risk: '历史政策需要核实。',
    evidence: [{ sourceLabel: '本章正文', sourceType: 'chapter', excerpt: '陈安走进厂房。' }],
  })),
}
const longReply = `## 长回复开头定位回归\n这是本机合成的长回复，不是正式创作内容。\n\n` +
  Array.from({ length: 18 }, (_, index) => `### 建议 ${index + 1}\n` +
    '先确认人物目标，再安排一场有选择代价的冲突。保留时代语境，检查行动动机、资金来源与结果。'.repeat(4)).join('\n\n')
http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
  if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'local-fixture' }] })); return }
  let body = ''
  request.on('data', chunk => { body += chunk; if (body.length > 500000) request.destroy() })
  request.on('end', () => {
    try {
      const payload = JSON.parse(body)
      const promptText = [...(payload.messages || []), ...(Array.isArray(payload.input) ? payload.input : [])].filter(item => item.role === 'user').at(-1)?.content || ''
      const searchRequested = payload.tools?.some(item => item.name === 'web_search' || item.type === 'web_search')
        || payload.plugins?.some(item => item.id === 'web') || payload.web_search_options
      if (searchRequested) {
        response.setHeader('Content-Type', 'application/json')
        if (promptText.includes('联网失败回归')) {
          response.writeHead(400); response.end(JSON.stringify({ error: 'Synthetic unsupported search' })); return
        }
        const source = { url: 'https://example.org/history-fixture?utm_source=fixture', title: '本地回归来源（示例链接，不是史料）' }
        const answer = promptText.includes('滚动阅读回归') ? longReply
          : `这是本地模拟的联网回复，不代表真实搜索。([example.org](${source.url}))\n\n当前模拟模型：${payload.model}。`
        const finishSearch = () => {
        if (request.url === '/v1/responses') response.end(JSON.stringify({
          status: 'completed', output: [{ type: 'web_search_call', status: 'completed' }, {
            type: 'message', content: [{ type: 'output_text', text: answer, annotations: [{ type: 'url_citation', ...source }] }],
          }],
        }))
        else if (request.url === '/v1/messages') response.end(JSON.stringify({
          stop_reason: 'end_turn', content: [
            { type: 'web_search_tool_result', content: [{ type: 'web_search_result', ...source }] },
            { type: 'text', text: answer, citations: [{ type: 'web_search_result_location', ...source, cited_text: '模拟证据摘录' }] },
          ],
        }))
        else response.end(JSON.stringify({ choices: [{ message: {
          content: answer, annotations: [{ type: 'url_citation', url_citation: source }],
        } }] }))
        }
        if (promptText.includes('后台继续回归')) setTimeout(finishSearch, 5000)
        else finishSearch()
        return
      }
      const system = payload.messages?.[0]?.content || ''
      const text = payload.messages?.map(item => item.content).join('\n') || ''
      let content = JSON.stringify(advice)
      if (system.includes('小说人物关系分析助手')) content = JSON.stringify([
        { sourceName: '陈安', targetName: '周平', relation: '合伙人' },
      ])
      else if (system.includes('作者的新书策划搭档')) content = promptText.includes('滚动阅读回归') ? longReply
        : `可以围绕第一笔订单的诚信选择展开。陈安不重生，也不使用系统。你更想写修理铺还是小型工厂？\n\n当前模拟模型：${payload.model}。`
      else if (system.includes('本轮未启用联网搜索')) content = `这是普通对话的本地模拟回复，本轮没有调用搜索工具。\n\n当前模拟模型：${payload.model}。`
      else if (system.includes('将作者对话整理')) content = JSON.stringify(settings)
      else if (system.includes('小说连续性编辑和创作顾问')) content = JSON.stringify(advice)
      else if (system.includes('从总大纲提取跨章节叙事弧线')) content = JSON.stringify({
        arcs: [{ title: '创业主线', description: '守住诚信', type: 'main', importance: 1,
          characterNames: ['陈安'], nodes: [
            { title: '第一笔订单', description: '承诺如期交货', targetChapter: 1 },
            { title: '信任考验', description: '在压力下兑现承诺', targetChapter: 10 },
          ] }],
      })
      else if (text.includes('## 推荐书名')) content = outline
      if (payload.stream) {
        response.setHeader('Content-Type', 'text/event-stream')
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`)
      } else {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ choices: [{ message: { content } }] }))
      }
    } catch { response.writeHead(400); response.end('Invalid fixture request') }
  })
}).listen(5185, '127.0.0.1', () => console.log('Local synthetic API on port 5185'))
