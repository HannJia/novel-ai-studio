// Prompt 构造器 — 用于各种 AI 调用场景

import type { Novel } from '@/types/novel'
import type { ReviewContext } from '@/services/context'
import type { ChatMessage } from '@/services/ai'
import type { ChapterEndingCheck } from '@/services/chapterEnding'
import { genres } from '@/data/genres'

// 查找分类名称
function findGenreNames(genreVal: string, subGenreVal: string): { genre: string; subGenre: string } {
  const g = genres.find(x => x.value === genreVal)
  const s = g?.children.find(x => x.value === subGenreVal)
  return { genre: g?.label || genreVal, subGenre: s?.label || subGenreVal }
}

// 格式化核心设定为文本
function formatSettings(novel: Novel): string {
  const s = novel.settings
  const parts: string[] = []

  // 主角
  if (s.protagonist.name || s.protagonist.background) {
    parts.push(`【主角设定】`)
    if (s.protagonist.name) parts.push(`姓名：${s.protagonist.name}`)
    if (s.protagonist.gender) parts.push(`性别：${s.protagonist.gender}`)
    if (s.protagonist.age) parts.push(`年龄：${s.protagonist.age}`)
    if (s.protagonist.background) parts.push(`身份背景：${s.protagonist.background}`)
    if (s.protagonist.personality.length > 0) parts.push(`性格特点：${s.protagonist.personality.join('、')}`)
    if (s.protagonist.initialPower) parts.push(`初始实力：${s.protagonist.initialPower}`)
    if (s.protagonist.cheatDescription) parts.push(`金手指/外挂：${s.protagonist.cheatDescription}`)
  }

  // 世界观
  if (s.worldBuilding.worldType || s.worldBuilding.specialRules) {
    parts.push(`\n【世界观设定】`)
    if (s.worldBuilding.worldType) parts.push(`世界类型：${s.worldBuilding.worldType}`)
    if (s.worldBuilding.worldScale) parts.push(`世界规模：${s.worldBuilding.worldScale}`)
    if (s.worldBuilding.socialStructure) parts.push(`社会结构：${s.worldBuilding.socialStructure}`)
    if (s.worldBuilding.specialRules) parts.push(`特殊规则：${s.worldBuilding.specialRules}`)
  }

  // 力量体系
  if (s.powerSystem.systemName || s.powerSystem.levelHierarchy) {
    parts.push(`\n【力量体系】`)
    if (s.powerSystem.systemName) parts.push(`体系名称：${s.powerSystem.systemName}`)
    if (s.powerSystem.levelHierarchy) parts.push(`等级划分：${s.powerSystem.levelHierarchy}`)
  }

  // 核心冲突
  if (s.coreConflict.mainConflict || s.coreConflict.mainVillain) {
    parts.push(`\n【核心冲突】`)
    if (s.coreConflict.mainConflict) parts.push(`主线矛盾：${s.coreConflict.mainConflict}`)
    if (s.coreConflict.mainVillain) parts.push(`主要反派：${s.coreConflict.mainVillain}`)
    if (s.coreConflict.coreSuspense) parts.push(`核心悬念：${s.coreConflict.coreSuspense}`)
  }

  // 感情线
  if (s.romance.romanceType) {
    parts.push(`\n【感情线】`)
    parts.push(`类型：${s.romance.romanceType}`)
    if (s.romance.developmentPace) parts.push(`发展节奏：${s.romance.developmentPace}`)
    if (s.romance.toneChanges) parts.push(`感情基调变化：${s.romance.toneChanges}`)
  }

  // 爽点
  if (s.payoff.faceSlapFrequency || s.payoff.patterns.length > 0) {
    parts.push(`\n【爽点设计】`)
    if (s.payoff.faceSlapFrequency) parts.push(`打脸频率：${s.payoff.faceSlapFrequency}`)
    if (s.payoff.levelUpPace) parts.push(`升级节奏：${s.payoff.levelUpPace}`)
    if (s.payoff.patterns.length > 0) parts.push(`爽点模式：${s.payoff.patterns.join('、')}`)
  }

  // 其他
  if (s.otherSettings) {
    parts.push(`\n【其他设定】\n${s.otherSettings}`)
  }

  return parts.join('\n')
}

// 格式化写作风格
function formatStyle(novel: Novel): string {
  const ws = novel.writingStyle
  const map: Record<string, string> = {
    'first-person': '第一人称', 'third-limited': '第三人称限知', 'third-omniscient': '第三人称全知', 'multi-pov': '多视角切换',
    'hot-blooded': '热血燃文', 'humorous': '轻松幽默', 'dark': '暗黑压抑', 'classical': '古典文雅', 'modern': '现代白话', 'healing': '温馨治愈', 'epic': '悲壮史诗', 'calm-calculated': '冷静克制',
    'detailed': '精细描写', 'balanced': '适中平衡', 'concise': '简洁明快',
    'crisp': '简洁利落', 'colloquial': '生活化口语', 'classical-chinese': '古风文言', 'humorous-retort': '幽默吐槽', 'formal': '正式严肃',
    'explosive': '热血燃爆', 'strategic': '策略智斗', 'realistic': '写实残酷', 'elegant': '飘逸流畅', 'tactical': '战术博弈',
    'fast': '快节奏', 'normal': '正常节奏', 'slow': '慢节奏', 'slow-burn': '慢热铺垫',
    'restrained': '内敛含蓄', 'intense': '直接强烈', 'nuanced': '细腻层次丰富',
  }
  return [
    `叙事视角：${map[ws.narrativePov] || ws.narrativePov}`,
    `文风基调：${map[ws.toneStyle] || ws.toneStyle}`,
    `描写密度：${map[ws.descriptionDensity] || ws.descriptionDensity}`,
    `对话风格：${map[ws.dialogueStyle] || ws.dialogueStyle}`,
    `战斗描写：${map[ws.combatStyle] || ws.combatStyle}`,
    `节奏控制：${map[ws.pacingControl] || ws.pacingControl}`,
    `情感表达：${map[ws.emotionExpression] || ws.emotionExpression}`,
  ].join('\n')
}

const CHAPTER_WORD_LIMIT_RULE = `【单章字数硬性规则】
- 每章正文目标字数必须在 2000~2500 字之间。
- 单章最低不能低于 2000 字；单章最高绝对不能超过 3000 字。
- 规划章节数时，必须按“本卷/全书预估字数 ÷ 0.20~0.25 万字/章”倒推章节数。
- 禁止写“每章约 6500~7500 字”等高密度估算；如果总字数约 233 万字，合理章节数应约为 932~1165 章，而不是 300 多章。`

// 生成总大纲的 Prompt
export function buildOutlinePrompt(novel: Novel): ChatMessage[] {
  const { genre, subGenre } = findGenreNames(novel.genre, novel.subGenre)
  const tagsText = novel.tags.length > 0 ? `\n题材标签：${novel.tags.join('、')}` : ''

  const system = `你是一位资深网文策划师，擅长构思百万字级长篇小说大纲。你对各类网文套路、读者心理和市场趋势了如指掌。`

  const user = `请根据以下信息，生成一份详细的小说总大纲。

【输出纪律】
- 只输出给用户看的小说大纲正文，不要输出任何思考过程。
- 禁止输出 <thinking>、</thinking>、analysis、reasoning、思考、推理草稿等内部过程文本。
- 如果内容较长，也必须按输出要求尽量完整覆盖所有小节。

【小说类型】
大类：${genre}
子类：${subGenre}${tagsText}

【目标字数】
${novel.targetWordCountMin}~${novel.targetWordCountMax} 万字

${CHAPTER_WORD_LIMIT_RULE}

【写作风格】
${formatStyle(novel)}

【核心设定】
${formatSettings(novel)}

【输出要求】
请生成包含以下内容的总大纲（使用 Markdown 格式）：

## 一句话概括
（核心卖点，一句话描述这本书最吸引人的看点）

## 推荐书名
提供 5 个候选书名，风格各异，贴合题材。格式：
1. 《书名》— 简短说明
2. ...

## 小说简介
（200-300 字的书籍简介，适合在平台上展示）

## 主线剧情走向
按起承转合结构，描述主线剧情的发展脉络。

## 主要角色表
用表格列出主要角色：姓名、身份、性格特点、关键经历/作用。

## 核心冲突与爽点设计
描述核心矛盾、高潮转折和爽点分布。

## 分卷建议
建议分为几卷，每卷的主题、关键事件和大致章节数。每卷章节数必须符合单章 2000~2500 字的换算关系。

## 预估总字数分配
各卷预估字数，总字数需在 ${novel.targetWordCountMin}~${novel.targetWordCountMax} 万字范围内，并明确说明“按每章 2000~2500 字估算”。

【数字规则】
所有预估数字必须自然真实，禁止使用整数或 5 的倍数。
- ✅ 正确示例：预估 103.7 万字、本卷约 23 章、本卷约 48.3 万字
- ❌ 错误示例：预估 100 万字、本卷 20 章、本卷 50 万字\``

  const density = novel.settings.structure?.foreshadowingDensity || '中等'
  let foreshadowingInstruction = ''
  if (density === '烧脑') {
    foreshadowingInstruction = `\n【伏笔设计（极致烧脑）】\n请在大纲中自然地埋入 5-8 条全书级伏笔线索：\n- 在前期以非常隐蔽的方式出现（草蛇灰线）\n- 与核心冲突/主角身世/终极反派有深层内在关联\n- 形成"恍然大悟"的阅读体验\n\n在大纲末尾用独立段落标注：\n## 全书伏笔线\n- 伏笔1：[名称] — 埋设时机 / 铺垫方式 / 预期揭示时机`
  } else if (density === '高') {
    foreshadowingInstruction = `\n【伏笔设计（较高密度）】\n请在大纲中自然地埋入 3-5 条全书级伏笔线索：\n- 与核心冲突有内在关联\n- 在中后期逐步揭示\n\n在大纲末尾用独立段落标注：\n## 全书伏笔线\n- 伏笔1：[名称] — 埋设时机 / 铺垫方式 / 预期揭示时机`
  } else if (density === '中等') {
    foreshadowingInstruction = `\n【伏笔设计（常规密度）】\n请在大纲中自然地埋入 2-3 条核心伏笔线索。\n\n在大纲末尾用独立段落标注：\n## 全书伏笔线\n- 伏笔1：[名称] — 埋设时机 / 预期揭示时机`
  } else {
    foreshadowingInstruction = `\n【伏笔设计（低密度）】\n本书为直白爽文风格，仅需设计 1-2 条明确简单的伏笔。\n\n在大纲末尾用独立段落标注：\n## 全书伏笔线\n- 伏笔1：[名称] — 埋设时机 / 预期揭示时机`
  }

  foreshadowingInstruction += `\n\n【原创性与去模板化要求】\n- 伏笔必须从本书已填写的主角设定、世界规则、力量体系、核心冲突中自然生长，不要套用“神秘老者/隐藏高人/隐藏身份/幕后大能/古老残魂”这类默认模板，除非用户明确写入。\n- 如果参考作品是修仙成长流，只借鉴节奏、成长压力和资源竞争，不要复刻《凡人修仙传》式的神秘瓶子、老者身份、隐世高人、古修遗物等标志性结构。\n- 每条伏笔都必须有互不重复的名称，并严格使用格式：- 伏笔1：名称 — 埋设时机 / 铺垫方式 / 预期揭示时机。`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user + foreshadowingInstruction },
  ]
}

// 生成章节正文的 Prompt
export function buildChapterPrompt(
  novel: Novel,
  outlineContent: string,
  chapterGuidance: string,
  previousSummary: string,
  lastParagraph: string,
  existingContent?: string,
  factCard?: string,
  writingPlan?: string,
): ChatMessage[] {
  const existingWordCount = existingContent ? existingContent.replace(/\s/g, '').length : 0
  const remainingWords = Math.max(0, 2000 - existingWordCount)
  const isContinuation = existingWordCount > 50

  const system = `你是一位网文写手，正在创作长篇小说《${novel.title}》。

【章节长度与收束原则】单章最低 2000 字。正文接近 2000 字时必须主动收束当前场景，通常控制在 2000~2200 字，原则上不要超过 2400 字；达到 2000 字后不得为了凑字继续开启新场景或新冲突。不得在动作、对话、决定或场景目标尚未产生结果时停笔，必须先用尽可能短的篇幅完成当前剧情节拍，再结束本章。${isContinuation ? `当前本章已写 ${existingWordCount} 字，请只续写完成本章节拍所需的内容。` : ''}

【写作风格要求】
${formatStyle(novel)}`

  let wordRequirement: string
  if (isContinuation) {
    if (remainingWords <= 0) {
      wordRequirement = `1. 本章已有 ${existingWordCount} 字，已达到建议目标。请立即自然收束当前剧情节拍，只写完成未结动作和形成章节落点所需的 1~3 段；不要开启新场景或新冲突`
    } else {
      wordRequirement = `1. 本章已有 ${existingWordCount} 字，建议再写约 **${remainingWords} 字**并自然收束。请根据当前剧情节拍决定准确停点，不得因达到字数而强行截断`
    }
  } else {
    wordRequirement = `1. 目标长度为 **2000~2200 字**。从接近 2000 字起主动收束当前场景；达到 2000 字后只补写完成当前剧情节拍所需的最短内容，不要开启新场景或新冲突`
  }

  const continuationContext = isContinuation
    ? `\n【本章已有内容（续写时请紧接此处，不要重复已有内容）】\n...${existingContent!.slice(-800)}\n`
    : ''

  const user = `${isContinuation ? '请续写本章正文。' : '请根据以下信息撰写本章正文。'}

【总大纲摘要】
${outlineContent}

【本章章节计划】
${chapterGuidance || '暂无章节计划，请严格承接分卷规划与前文。'}

${previousSummary ? `【前文摘要】\n${previousSummary}\n` : ''}
${factCard ? `【生成前事实卡】\n${factCard}\n` : ''}
${writingPlan ? `【本章写作计划】\n${writingPlan}\n` : ''}
${!isContinuation && lastParagraph ? `【上一章结尾】\n${lastParagraph}\n` : ''}${continuationContext}
【写作要求】
${wordRequirement}
2. 只输出章节正文内容，不要输出章节标题、Markdown 标题、# 第一章、## 第X章、书名、作者名或目录格式
3. 正文必须直接从第一段剧情开始
4. 场景描写生动，对话自然
5. ${isContinuation ? '紧接已有内容继续推进剧情，不要重写已有段落' : '衔接上一章结尾（如有），推进本章情节'}
6. 保持角色性格和设定一致性，注意世界观内部数值的前后一致（如修炼进度、装备属性等）
7. 涉及时间、日期、倒计时、剩余天数、资源数量、灵石收支、作物成熟进度时，必须沿用同一条时间轴逐项演算；例如“距月底还有六日”后的“次日”“后日”要扣除对应天数，禁止写出前后相差一日的数字
8. 涉及“速度更快/加快/超出预期”和“最早/最迟/峰值/可采标准”等预估窗口时，后续最迟达成日必须收紧或持平，不能比前序预估更晚；若要外扩，必须明确写出放缓原因
9. 结尾不仅要句子完整，还要完成本章核心剧情节拍：行动已经执行并产生结果、关键对话得到回应、决定已经作出或场景目标形成阶段性结论
10. 可以留悬念，但必须是“本章行动已有结果后引出新问题”的有效悬念；禁止停在“正要行动、尚未回答、即将决定、准备开始”的强行截断点
11. 最后一行必须是完整自然的句子，不能用“……”“......”或未闭合引号收尾`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export function buildChapterEndingCheckPrompt(
  chapterContent: string,
  chapterGuidance = '',
  writingPlan = '',
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: '你是严谨的小说章节结尾审查编辑。你只判断当前章节是否形成完整的单章结束，不做文风润色。必须输出严格 JSON。',
    },
    {
      role: 'user',
      content: `请检查以下章节结尾是否自然完整。

【本章章节计划】
${chapterGuidance || '无'}

【本章写作计划】
${writingPlan || '无'}

【章节正文】
${chapterContent}

【判定标准】
1. 达到目标字数或末尾有句号，都不能单独证明章节完整。
2. 动作、对话、决定、信息揭示或当前场景目标必须已经执行并产生阶段性结果。
3. 合格悬念：本章核心行动已经完成或得到结果，在结果之上引出新的威胁、问题或选择。
4. 强行截断：人物正要执行关键动作、问题尚未回答、决定尚未作出、当前冲突没有任何阶段性结果，或明显只因字数到了而停笔。
5. isComplete 只有在本章可以作为独立章节自然结束时才为 true；有效悬念也必须同时满足 isComplete=true。

【输出格式】只输出 JSON 对象，不要代码块或解释：
{
  "isComplete": false,
  "isValidCliffhanger": false,
  "openAction": "尚未完成的动作、对话、决定或场景目标；没有则为空字符串",
  "reason": "判定理由",
  "continuationInstruction": "若不完整，说明应如何用最短篇幅完成当前节拍；完整则为空字符串"
}`,
    },
  ]
}

export function buildChapterEndingContinuationPrompt(
  chapterContent: string,
  endingCheck: ChapterEndingCheck,
  chapterGuidance = '',
  writingPlan = '',
  factCard = '',
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: '你是网文写手，负责给被截断的章节补上自然收尾。只续写结尾，不重写已有正文，不新增重大设定。',
    },
    {
      role: 'user',
      content: `请紧接现有正文，为本章补写自然收尾。

【本章章节计划】
${chapterGuidance || '无'}

【本章写作计划】
${writingPlan || '无'}

${factCard ? `【本章事实卡】\n${factCard}\n` : ''}

【结尾检查结果】
未完成事项：${endingCheck.openAction || '当前剧情节拍尚未收束'}
原因：${endingCheck.reason || '章节结尾不完整'}
收尾要求：${endingCheck.continuationInstruction || '完成当前剧情节拍并形成阶段性结果'}

【现有正文结尾】
${chapterContent.slice(-1800)}

【续写要求】
1. 只输出需要追加在原文后的正文，约 150~400 字，不得重复原文。
2. 完成上述未完成事项，让当前动作、对话、决定或场景目标产生明确结果。
3. 可以在结果之上留下新悬念，但不能再停在“正要做、尚未答、即将开始”的位置。
4. 不开启新场景，不引入重大新人物、能力、道具或世界规则。
5. 最后一句必须完整自然，不输出章节标题、分析、说明或 Markdown。`,
    },
  ]
}

export function buildChapterWritingPlanPrompt(novel: Novel, factCard: string, chapterGuidance: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: '你是长篇小说章节规划助手。你的任务是先做写作计划，不写正文。请严格遵守事实卡，避免设定冲突。',
    },
    {
      role: 'user',
      content: `请根据以下事实卡，为《${novel.title}》当前章节生成一份简短写作计划。

【已确认的章节计划】
${chapterGuidance || '暂无章节计划'}

${factCard}

【输出要求】
只输出以下 5 项，每项 1-3 条，禁止写正文：
1. 承接点：本章开头从哪里接起
2. 必须遵守的事实：角色状态、地点、资源、等级、伏笔等
3. 本章核心事件：按顺序列出
4. 禁止新增/禁止改写：哪些设定不能临时添加或改动
5. 结尾落点：本章应停在什么悬念或转折上`,
    },
  ]
}

export function buildChapterSelfCheckPrompt(
  novel: Novel,
  factCard: string,
  writingPlan: string,
  chapterContent: string,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: '你是严谨的网文章节自检编辑。请只检查正文是否违反事实卡和写作计划，并在必要时修正正文。必须输出 JSON。',
    },
    {
      role: 'user',
      content: `请对《${novel.title}》当前章节正文做生成后自检。

${factCard}

【写作计划】
${writingPlan || '无'}

【待自检正文】
${chapterContent}

【检查重点】
1. 是否违背前文角色状态、实力、资源、位置、时间线
2. 是否突然新增未铺垫的重大人物、道具、势力、世界规则
3. 是否偏离已确认的章节计划和本次写作计划
4. 是否有章节标题、半截句、未闭合引号、结尾不完整
5. 字数应在 2000~2500 字附近，最高不能超过 3000 字

【输出格式】只输出 JSON 对象，不要代码块：
{
  "needsRevision": true,
  "severity": "none|minor|major",
  "issues": ["问题1"],
  "revisedContent": "如果 needsRevision 为 true，输出修正后的完整正文；如果没有问题，输出空字符串"
}

规则：只有出现设定冲突、明显偏离、标题残留、断句残留时才改正文；不要为了润色大幅重写。`,
    },
  ]
}

// 生成分卷规划的 Prompt
export function buildVolumePlanningPrompt(novel: Novel): ChatMessage[] {
  return [
    { role: 'system', content: '你是一位擅长长篇小说结构设计的策划师。直接输出分卷内容，不要使用代码块、文件路径或任何包装格式。' },
    { role: 'user', content: `根据以下总大纲，为小说《${novel.title}》生成详细的分卷规划。

【总大纲】
${novel.outline.substring(0, 3000)}

【目标字数】
${novel.targetWordCountMin}~${novel.targetWordCountMax} 万字

${CHAPTER_WORD_LIMIT_RULE}

【输出格式】
严格按以下格式逐卷输出（不要用代码块、不要用文件路径、不要加额外包装）：

## 第X卷《卷名》
**主题**：一句话主题描述
**剧情概要**：200-300字的剧情概要
**关键转折点**：
- 转折点1
- 转折点2
**本卷角色变化**：
- 角色1变化
- 角色2变化
**预估章节数和字数**：约XX章，约XX万字（按每章 2000~2500 字估算）
**卷级伏笔**：
- 本卷伏笔：xxx
- 跨卷铺垫：xxx

【卷级伏笔要求】
根据 ${novel.settings.structure?.foreshadowingDensity || '中等'} 的伏笔密度设定，请为每卷设计若干条卷级伏笔：
- 在本卷前半段自然埋入并在高潮或结尾回收
- 如有必要，承接上一卷线索或为下一卷做铺垫
- 列出本卷需要重点推进的全书伏笔

注意：数字避免整数或 5 的倍数。` },
  ]
}

export function buildChapterAnalysisPrompt(
  chapterContent: string,
  dataPanelText: string,
  globalPlanText: string,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: '你是小说章节结构化分析助手。你只根据正文中明确出现的信息输出 JSON，不要推测未写出的变化。',
    },
    {
      role: 'user',
      content: `请分析以下章节内容，输出一个 JSON 对象。

【本章正文相关内容】
${chapterContent}

【已记录的未回收全书规划】
${globalPlanText || '无'}

【当前数据面板】
${dataPanelText || '无'}

【输出格式】只输出 JSON 对象，不要解释，不要代码块：
{
  "events": [
    {"title":"事件标题","description":"简要描述","characters":["角色名"],"type":"主线|支线|伏笔|转折|战斗|其他","status":"planted|resolved","scope":"chapter|volume|global"}
  ],
  "characters": [
    {"name":"角色名","identity":"身份","personality":"性格","powerLevel":"实力","faction":"阵营","description":"简介"}
  ],
  "globalPlans": [
    {"id":"全书规划ID","status":"developing或resolved","hintCount":1,"note":"说明变化原因"}
  ],
  "dataChanges": [
    {"itemId":"数据对象ID","itemName":"数据对象名","fieldName":"字段名","oldValue":"旧值","newValue":"新值","reason":"正文原文依据，尽量引用关键短句"}
  ]
}

【规则】
1. events 提取 1-5 个关键事件；如果正文出现新埋伏笔，type 必须填 "伏笔"，status 填 "planted"，scope 按影响范围填写。
2. characters 只输出本章明确出场或首次出现的角色，没有则输出 []。
3. globalPlans 只更新已记录全书规划中本章有明确推进或回收证据的条目，没有则输出 []。
4. dataChanges 只有正文明确写到数值变化、时间推进、等级提升、资源增减、成长进度变化时才输出，没有则输出 []。`,
    },
  ]
}

// 完成章节时生成总结和标题
export function buildChapterCompletionPrompt(chapterContent: string, chapterTitle: string, chapterIndex: number): ChatMessage[] {
  return [
    { role: 'system', content: '你是一个精准的网文章节整理助手。请根据章节正文生成章节总结，并在需要时生成章节名。只输出 JSON。' },
    { role: 'user', content: `请为以下第${chapterIndex}章生成章节整理结果。

【当前章节标题】${chapterTitle}

【章节正文】
${chapterContent}

注意：如果正文开头误含“# 第一章 xxx”“第X章 xxx”等标题行，请忽略该标题行，只根据正文剧情总结；不要把标题行当作剧情内容。

【输出格式】只输出 JSON 对象，不要解释，不要代码块：
{
  "title": "4-8个字的章节名，如果当前标题已经是正式标题则原样返回",
  "summary": "150-200字章节总结，包含核心情节、角色变化、关键事件和伏笔状态"
}` },
  ]
}

// 违禁词检测 Prompt
export function buildBannedWordsCheckPrompt(content: string): ChatMessage[] {
  return [
    { role: 'system', content: '你是一个网文平台合规审查助手。请检查以下内容是否包含需要修改的敏感词或违规内容。' },
    { role: 'user', content: `请检查以下正文中可能触犯网文平台审核规则的内容。

【正文】
${content.substring(0, 3000)}

【检查维度】
1. 暴力血腥描写是否过度
2. 是否有色情或擦边内容
3. 政治敏感表述
4. 涉及封建迷信的内容
5. 其他平台可能审核不通过的词汇

【输出格式】
如果没有问题，输出"✅ 未发现明显违规内容"。
如果有问题，按以下格式列出：
- ⚠️ [问题词/句] → [修改建议]` },
  ]
}

// 全维度内容审查 Prompt（角色一致性、世界观、剧情连贯性等）
export function buildContentReviewPrompt(reviewContext: ReviewContext, chapterIndex: number): ChatMessage[] {

  return [
    {
      role: 'system',
      content: `你是一位经验丰富的网文编辑和内容审查专家。你的核心任务是抓出会影响读者理解、设定连续性和剧情可信度的硬伤。请严格但不过度挑刺：把真正需要修改的问题和普通润色建议分开。`
    },
    {
      role: 'user',
      content: `请对以下第 ${chapterIndex + 1} 章内容进行全维度审查。

======== 小说核心设定 ========
${reviewContext.settings}

======== 写作风格要求 ========
${reviewContext.style}

======== 角色设定 ========
${reviewContext.characters}

======== 总大纲摘要 ========
${reviewContext.outline}

======== 本章章节计划 ========
${reviewContext.chapterGuidance}

======== 近期事件记录 ========
${reviewContext.recentEvents}

======== 前文章节总结 ========
${reviewContext.previousSummary}

======== 可引用证据来源（语义召回） ========
${reviewContext.semanticEvidence}

======== 待审查正文（第 ${chapterIndex + 1} 章） ========
${reviewContext.chapterContent}

【审查维度】请从以下 6 个维度逐一审查：

【分级原则】
- ❌ 严重问题：设定冲突、时间线冲突、角色状态/等级/资源错误、能力边界前后矛盾、关键情节点缺失、明显违背前文事实。此类必须修改。
- ⚠️ 轻微问题：措辞可能误导、信息交代略少、过渡略跳、节奏略不稳，虽不属于硬伤，但可能影响正文合格度。此类列入建议修改；是否需要重写以“总体判断”为准。
- 📝 编辑建议：纯润色、氛围补充、表达优化、后续写作提醒，不影响本章成立。此类不要标成“有问题”。

【不要误判】
- 不要把“可引用证据来源”“本章章节计划”“前文章节总结”等系统上下文自身当作正文问题；只有读者能在正文中看到的问题才列为问题。
- 新名词、地名、设施名第一次出现时，如果不影响理解，可以视为氛围铺垫，不要强行要求解释。
- 伏笔、留白、克制表达、慢热节奏，只要与风格设定一致，不要判为问题。
- 对“可优化但不影响正文合格度”的内容，放入编辑建议，不要放入严重或轻微问题。

## 1. 角色一致性
- 角色言行是否符合已有的性格设定？
- 角色能力表现是否与设定等级匹配？
- 角色称呼、外貌描写是否与前文一致？

## 2. 世界观吻合度
- 力量体系描述是否符合设定？（等级、名称、规则）
- 地名、势力名称是否前后一致？
- 是否出现了与世界观矛盾的现代词汇或概念？

## 3. 剧情连贯性
- 本章情节是否与前文事件逻辑衔接？
- 是否有前文未交代突然出现的人物或物品？
- 时间线是否合理？

## 4. 大纲契合度
- 本章内容是否符合章节大纲的要求？
- 是否偏离了总大纲的主线方向？
- 是否遗漏了本章章节计划中的关键情节点？

## 5. 设定冲突检测
- 是否存在前后矛盾的设定描述？
- 角色关系是否出现冲突？
- 数值/等级/时间是否自相矛盾？
- 对相对时间和倒计时必须逐步演算：如“距月底还有N日”“次日”“后日”“离月底还有M日”，需要校验 N - 已过天数 - 目标偏移 = M；差一日也属于严重问题。
- 对趋势型预估必须检查方向：若正文写明“速度更快/加快/超出预期”，则后续“最迟达成日/峰值上限/可采标准上限”不能比前序预估更晚；否则属于严重问题。

## 6. 叙事质量
- 叙事视角是否保持一致？
- 节奏是否与设定的写作风格匹配？
- 是否有明显的剧情灌水或逻辑漏洞？

【输出格式】
请严格按以下结构输出：

# 第 ${chapterIndex + 1} 章全维度审查报告

## 结论
- 总体判断：✅可通过 / ⚠️建议修改 / ❌必须修改
- 必改数量：X
- 建议修改数量：X
- 编辑建议数量：X
注意：总体判断是唯一的通过判定依据。若建议修改项不影响本章整体合格度，总体判断仍可写“✅可通过”；只有当这些建议修改确实需要修正后才能交付时，总体判断才写“⚠️建议修改”。

## 必改问题（只列严重问题）
如果没有，写“无”。
每条格式：
1. [维度] 问题标题
   - 原文证据：引用正文中能看到的短句
   - 问题原因：说明与哪条设定/前文事实冲突
   - 修改建议：给出具体改法

## 建议修改（轻微问题）
如果没有，写“无”。
只列不属于硬伤、但可能影响正文稳定度的问题；若这些问题不影响整体通过，总体判断仍应为“✅可通过”。

## 编辑建议（不影响通过）
如果没有，写“无”。
只放润色、节奏、氛围、后续注意事项，不要当作问题。

## 六维度简评
1. 角色一致性：✅通过 / ⚠️轻微 / ❌严重，一句话说明
2. 世界观吻合度：✅通过 / ⚠️轻微 / ❌严重，一句话说明
3. 剧情连贯性：✅通过 / ⚠️轻微 / ❌严重，一句话说明
4. 大纲契合度：✅通过 / ⚠️轻微 / ❌严重，一句话说明
5. 设定冲突检测：✅通过 / ⚠️轻微 / ❌严重，一句话说明
6. 叙事质量：✅通过 / ⚠️轻微 / ❌严重，一句话说明`
    }
  ]
}
