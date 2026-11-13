// Synthetic responses shared by the component/SQL and isolated desktop checks.
export const creationTitle = '合成AI创建·旧码头'
export const endings = ['黎安独自公开收据，找回木箱。', '黎安与值守人共同公布两份交接记录，找回木箱。']
export const skeletons = ['收据追查', '双册对照', '封条寻踪'].map((title, index) => ({
  title,
  premise: '黎安发现码头交接记录与木箱编号不符。',
  logline: '黎安循交接线索寻找失踪木箱，并追查记录改动的来源。',
  promise: '通过有据可查的线索解开木箱去向。',
  ending: endings[index % endings.length],
  beats: [
    { title: '清点木箱', description: '黎安发现编号与交接记录不符。', kind: 'opening' },
    { title: '找到收据', description: '黎安从值守人处取得原始收据。', kind: 'turning_point' },
    { title: '核对双册', description: '黎安比较两份记录，发现移交地点被改动。', kind: 'climax' },
    { title: '公开记录', description: '黎安依据核对结果公开记录，找回木箱。', kind: 'resolution' },
  ],
}))
export const volume = ['## 第一卷：追查交接', '主题：共同核对证据', '预估章节数：3章', '预估字数：0.9万字',
  '剧情：黎安从编号异常追查原始收据，与值守人共同找回木箱。'].join('\n')
export const outline = [
  '## 推荐书名', creationTitle, '## 小说简介', skeletons[0].premise,
  '## 主线剧情走向', skeletons[0].logline, '## 主要角色表', '黎安负责核对交接记录，值守人保留了原始收据。',
  '## 核心冲突', '原始收据与交接册的编号发生冲突。', '## 分卷建议', volume,
  '## 预估总字数分配', '全书三章，共0.9万字。', '## 全书伏笔', '旧木牌背面的编号指向另一份记录。',
  '## 结局方向', endings[1],
].join('\n')
export const planResponse = JSON.stringify({ plans: [{ horizon: 'next', title: '清点木箱',
  objective: '发现编号被涂改并保留原始收据。', summary: '黎安在码头核对木箱，与值守人约定共同查清记录。',
  beats: ['核对封条', '发现编号异常', '保留原始收据'], targetChapterStart: 1, targetChapterEnd: 1,
  relatedArcIds: [], relatedEventIds: [] }] })
