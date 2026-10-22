# 小说审稿与正文字数控制：源码补充调研

调研日期：2026-10-17。延续 [竞品总体对比](E:/novel-ai-studio/docs/competitive-analysis-2026-10-17.md)，重点核查审稿、补写、压缩、最终完成条件，并新增青春幻想引擎。当前软件基线 `b856bbd`、版本 1.0.6。本次只研究并记录方案，没有修改业务代码、安装竞品、生成私人小说或做同模型写作实测。

后续用户已授权实施四项优化，当前工作区的行为变更见 [篇幅与全文审核说明](E:/novel-ai-studio/docs/chapter-length-and-review.md)。本文保留调研时的基线判断，不代表后续实现仍有同样限制。

**结论：青春幻想引擎的字数校准模块值得参考，但它也没有把目标区间严格落实到最终保存条件。你当前软件已有较强的最低字数、结尾和审查保护；下一步重点应是统一字数规则、增加超长稿压缩，以及对最终版本重新验收。**

## 范围与证据

“审核”在这里指正文的逻辑、人物、伏笔、文风和错字检查。软件工程审计报告、JSON 格式修复和模型提供商的内容审核，分别解决不同问题，不能互相替代。本次没有核查平台投稿审核或承诺任何平台一定通过。

第三方代码按下表提交固定。结论限于所读路径：未看到严格验收，不等于证明仓库所有入口都不存在该能力。README 的产品介绍与源码中实际执行的条件分开判断；代码注释写“必须达标”，也必须检查调用者是否真的拦截。

| 仓库 | 所读快照 |
| --- | --- |
| tgxy2026/youth-fantasy-engine | `af245505974579036f0b82b86f12956dda5af305` |
| xiamuceer-j/MuMuAINovel | `743e5abec18beb8d73426527e6579538053bc6fd` |
| t59688/arboris-novel | `dd80c69bc30a80d68b375bd504c6bc308164ff9e` |
| LunaRime/novelforge | `3339a04af00bdca41d291958dab9bbaff1f5b70f` |
| YILING0013/AI_NovelGenerator | `a61674fad4dd6c4c5fa9a2ad2f12b667109e628a` |
| zaphodsdad/GhostWriter3000 | `369143fa74cb5511f151a8728eeb9717c03cf1b9` |
| MaoXiaoYuZ/Long-Novel-GPT | `107c31e54686947a6d00404e332475a60b66e630` |
| Hurricane0698/novelwriter | 当日公开 main；以下链接使用 main，应留意后续变化 |

DeepSeek 已辅助检查本项目明确选择的源码，Opus 对证据摘要提出设计建议；均经当前会话复核。辅助意见中将不同计数口径混用、误将其他项目归入“默认 80 分”的推断未采纳。请求未包含私人稿件、数据库或密钥。

## 新增项目：青春幻想引擎

[仓库与产品介绍](https://github.com/tgxy2026/youth-fantasy-engine/tree/af245505974579036f0b82b86f12956dda5af305) 展示的是覆盖设定、角色、大纲、正文和创作管理的桌面工作台。世界包、知情权限、地图及角色推演可以作为产品设计线索；本次没有验证这些功能在长篇真实作品中的效果，也不能从页面数量判断写作质量。

### 1. 字数控制比单纯提示词更具体

[wordRange.ts](https://github.com/tgxy2026/youth-fantasy-engine/blob/af245505974579036f0b82b86f12956dda5af305/src/lib/editor/wordRange.ts) 将目标上下各 300 字作为校准区间。短稿按差额补写，长稿尝试精简；默认最多补写 4 次、压缩 2 次，调用者可以收紧。补写增量不足 30 字会停；压缩结果为空或低于区间下界的 85% 时保留原稿。这是在保护正文完整性，但不保证每次都收敛到目标。

[textStats.ts](https://github.com/tgxy2026/youth-fantasy-engine/blob/af245505974579036f0b82b86f12956dda5af305/src/lib/editor/textStats.ts) 用汉字逐字加连续拉丁字母／数字词计数，逻辑判断默认不含标点；显示层可以另外选择含标点模式。不要把其注释中的平台口径描述直接当作所有平台通用规则。

**关键限制：校准函数最终返回正文，未达区间也可能返回。** [连写调用者 autoContinue.ts](https://github.com/tgxy2026/youth-fantasy-engine/blob/af245505974579036f0b82b86f12956dda5af305/src/lib/outline/autoContinue.ts#L640) 最后主要检查异常短稿，阈值是 `min(600, max(200, round(target * 0.2)))`，没有再次强制目标 ±300。

例如目标 3500 字，希望区间是 3200–3800 字，但该入口的最终异常短稿门槛为 600 字。前面的校准会尽力改善结果，**最终保存检查本身仍不足以保证 3200–3800 字**。这是静态代码推导，不代表本次实测曾生成 600 字成品。

### 2. 审稿兼顾本地检查和 AI，但不是自动修到合格

- [chapterCheck.ts](https://github.com/tgxy2026/youth-fantasy-engine/blob/af245505974579036f0b82b86f12956dda5af305/src/lib/outline/chapterCheck.ts)：连续性、伏笔、风格、错字和敏感词等本地检查；部分检查异常时返回空结果，需要与“查完没有问题”区分。
- [proofread.ts](https://github.com/tgxy2026/youth-fantasy-engine/blob/af245505974579036f0b82b86f12956dda5af305/src/lib/aiTasks/proofread.ts)：文字校对与逻辑校对分开，按块处理，意见含原文引用并回到正文定位、去重。个别分块失败可被跳过，因此空问题列表不能单独证明全文审核成功。
- [autoContinue.ts 的 selfRefine](https://github.com/tgxy2026/youth-fantasy-engine/blob/af245505974579036f0b82b86f12956dda5af305/src/lib/outline/autoContinue.ts#L254)：检查连续性、OOC 和伏笔，收集中等／严重问题后尝试一次改写；改写异常缩水时保留原稿。没有在这里形成“反复复审直到语义合格”的保证。
- [evidenceGate.ts](https://github.com/tgxy2026/youth-fantasy-engine/blob/af245505974579036f0b82b86f12956dda5af305/src/lib/audit/evidenceGate.ts)：明确处理缺少焦点章、没有待改正文、跨章审计正文不足等证据缺口，返回原因和下一步动作。这种设计适合借鉴到上下文准备阶段。

连写入口支持作者确认初稿，但确认之后还会自动自检修正、再次校准字数；未提供确认回调时也可以继续。因此作者看过的初稿不一定等于最终保存稿。更稳妥的设计是最后一次自动修改后，再展示最终差异并确认。

### 3. 与你当前软件的实际区别

| 维度 | 青春幻想引擎所读路径 | 当前软件 |
| --- | --- | --- |
| 计数 | 汉字＋拉丁／数字词；逻辑与展示口径分开 | 去空白后 UTF-16 长度，含标点，英文按字符计 |
| 短稿 | 差额补写，有区间校准；最后仍偏向异常短稿保护 | 不足 2000 字不能完成；已有补足与有限请求 |
| 长稿 | 有压缩校准与异常缩水保护 | 2400 主要用于提示和候选保护，完成入口没有统一绝对上限 |
| 审查后修正 | 多类问题自检后一次改写，保留异常时原稿 | 六维报告、硬问题区分、局部替换、候选复核与版本保护 |
| 值得吸收 | 字数校准服务、证据不足即停、最终版本确认 | 保留现有局部修改限制及未知结论不通过的行为 |

不建议直接照搬大量页签和多轮请求。对本项目最有价值的是完善已有写作链路，而不是按功能数量追赶。

## 其他项目如何处理审核和字数

| 项目 | 正文审核机制与实际限制 | 字数处理与实际限制 |
| --- | --- | --- |
| MuMuAINovel | 先保存章节并标记 completed，再启动后台剧情分析；报告用于评分、伏笔等分析及后续改稿。所读主路径不是“审过才完成” | 目标默认 3000，提示词含范围并按目标设置 token 预算；主生成路径未见按最终长度补写／压缩闭环；记录长度使用 `len(full_content)` |
| Arboris-Novel | 本地护栏＋六维审查＋多稿比较＋周期检查。六维解析失败／缺提示词可返回默认 80 分，应视为未完成真实评价；预览扩写也不是严格合格门槛 | 预览再扩写，目标进入提示词；所读路径未见最终区间硬验收 |
| NovelForge | 所读互评命令默认三视角加权，也有六类本地审计和最多两轮自审修订；保留版本，异常缩水拒绝。部分评审截取正文，最终内容审计被标为非关键且在导入之后执行 | 写入目标字数、记录统计，修订保护原文比例；这些不等于章末最低／最高字数保证 |
| AI_NovelGenerator 新版 | 检查绑定正文版本与内容哈希，建议引用必须精确对应原文；候选预览确认值得借鉴。JSON 格式修复单独存在，不是文学质量复审 | 章节契约可指定目标；所读默认写作流程没有显式的最终长度修复循环，实际统计为非空白字符 |
| GhostWriter3000 | 生成→自动 critique→等待作者批准，作者决定是否修订和接受为正式场景；写作模型与评论模型可分配。默认最多 5 次修订不是无人值守自动修 5 轮 | 场景 target_length 进入提示词，max_tokens 独立配置；所读服务没有严格字数区间校准 |
| Long-Novel-GPT | 大纲／剧情／正文分层编辑，审阅意见可用于再写；所读引擎中评分机制仍注明未实现 | 分块扩写让任务更可控，但块大小不等于整章最终字数，未见严格章节上下限验收 |
| NovelWriter／NovWr | 续写后检查新增术语、称呼及上下文漂移，主要作为建议性警告；某些检查异常记录后跳过，并非所有警告都强制拒绝 | 所读续写接口使用 max_tokens 控制输出容量，不能据此保证最终正文字数 |

对应源码：

- MuMu：[章节生成、保存及后台分析](https://github.com/xiamuceer-j/MuMuAINovel/blob/743e5abec18beb8d73426527e6579538053bc6fd/backend/app/api/chapters.py)、[剧情分析器](https://github.com/xiamuceer-j/MuMuAINovel/blob/743e5abec18beb8d73426527e6579538053bc6fd/backend/app/services/plot_analyzer.py)。该分析器所读入口截取正文前 8000 字符。
- Arboris：[六维评分及回退](https://github.com/t59688/arboris-novel/blob/dd80c69bc30a80d68b375bd504c6bc308164ff9e/backend/app/services/six_dimension_review_service.py)、[预览扩写流程](https://github.com/t59688/arboris-novel/blob/dd80c69bc30a80d68b375bd504c6bc308164ff9e/backend/app/services/preview_generation_service.py)。默认分不能解释为实际验证通过，也不据此断言所有发布路径自动放行。
- NovelForge：[互评角色](https://github.com/LunaRime/novelforge/blob/3339a04af00bdca41d291958dab9bbaff1f5b70f/src/services/workflows/commands/spawn-reviewers.command.ts)、[自审修订](https://github.com/LunaRime/novelforge/blob/3339a04af00bdca41d291958dab9bbaff1f5b70f/src/services/workflows/commands/self-review.command.ts)、[最终处理](https://github.com/LunaRime/novelforge/blob/3339a04af00bdca41d291958dab9bbaff1f5b70f/src/services/workflows/commands/finalize-chapter.command.ts)。不同路径有不同角色数，不将 README 的角色介绍一概套到此命令。
- AI_NovelGenerator：[正文检查契约与校验](https://github.com/YILING0013/AI_NovelGenerator/blob/a61674fad4dd6c4c5fa9a2ad2f12b667109e628a/backend/services/novel/chapter_check_service.py)、[默认写作节点](https://github.com/YILING0013/AI_NovelGenerator/blob/a61674fad4dd6c4c5fa9a2ad2f12b667109e628a/backend/services/task_flows/defaults/write_chapter_by_ai.json)。本次检查当前重写版，不沿用旧 Tkinter 版能力判断。
- GhostWriter3000：[生成、评审、确认与正史写入](https://github.com/zaphodsdad/GhostWriter3000/blob/369143fa74cb5511f151a8728eeb9717c03cf1b9/backend/app/services/generation_service.py)。
- Long-Novel-GPT：[审阅与批量改写](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py)。
- NovelWriter：[续写后检查](https://github.com/Hurricane0698/novelwriter/blob/main/app/core/continuation_postcheck.py)、[运行入口及警告处理](https://github.com/Hurricane0698/novelwriter/blob/main/app/api/novel_continuation_runtime.py)。

## 当前软件需要解决的具体问题

### 1. 目标、提示与真正验收条件分散

[计数函数](E:/novel-ai-studio/src/utils/format.ts:1) 去空白后取 `.length`。例如 `你好，AI！` 在当前计数下是 6，在青春幻想引擎默认口径下是 3。不能把两套系统的“2000 字”直接横向比较，也不宜静默改变旧作品统计。

[规划提示词](E:/novel-ai-studio/src/services/prompts.ts:105) 规定目标 2000–2500、绝对不超过 3000；正文提示又偏向 2000–2200、原则不超过 2400；[编辑器阈值](E:/novel-ai-studio/src/views/workspace/ChapterEditor.vue:604) 是最低 2000、软阈值 2000、名为 hard 的阈值 2400。实际完成入口拦截低于 2000，但没有对所有稿件执行超过 2400 就失败的判断。

这会导致提示词、状态文案和实际通过条件不完全一致。应统一为一本书／章节的一份长度配置，明确统计口径、目标、最低要求和允许最高值。

### 2. 已有多项保护，不能误判为只靠提示词

- [章节生成预算](E:/novel-ai-studio/src/services/chapterGeneration.ts:1) 与 [流式追加](E:/novel-ai-studio/src/composables/useChapterAiGeneration.ts:82) 已限制初稿／追加请求，并处理模型长度截断。初稿追加上限 3 次不是整个审稿工作流所有 API 请求的总上限。
- [完成本章](E:/novel-ai-studio/src/views/workspace/ChapterEditor.vue:1944) 包含最低字数、结尾检查、一致性审查；AI 主笔此入口最多自动修正 1 轮，作者主笔为 0。其他策略表的数值不能当作这个循环已执行的次数。
- [审查判定](E:/novel-ai-studio/src/services/contentReview.ts) 区分通过、必须修改、未知；结论不明确不能当作通过。格式／空结论最多重试后报错，不应解释为所有异常都会自动重写正文。
- [局部修正](E:/novel-ai-studio/src/services/chapterRepair.ts:27) 已有唯一原文锚点、重叠拒绝、最多 6 处及修改总量约束。候选超长保护允许 `max(2400, 原文字数+200)`，也不是统一的绝对 2400 上限。

### 3. 超长稿的审核覆盖需要显式说明

[审核上下文](E:/novel-ai-studio/src/services/context.ts:490) 默认将正文截取到前 4000 字符；通常的 2000–2500 字章节能覆盖，异常长稿可能只审开头。建议超长时分块校对并补一次全章关系检查，明确哪些段落已审、哪些失败。评分或空问题列表不能替代覆盖率。

## 建议的优化顺序与验收例子

### P0：统一长度配置，并验收最终稿

保留当前作品的计数方式作为兼容选项，清楚显示计数规则。新配置可讨论“最低 2000、目标 2200、软上限 2400、允许最高 2500”等方案，**这里是示例，不是已经实施或用户确认的新标准**。生成、续写、压缩、审查后改稿和完成入口都读取同一配置。

建议链路：事件计划与篇幅分配 → 初稿 → 清理格式并计数 → 必要的补写／压缩 → 结尾与内容审查 → 局部修正 → 重新计数和复审 → 展示最终版本／差异 → 标记完成。草稿可随时保存；正式完成需要满足当前配置和已知硬问题要求。

| 输入状态 | 应有行为 |
| --- | --- |
| 字数不足且事件未完成 | 续写当前动作并收束，不开启下一章 |
| 字数不足但事件已结束 | 扩写已有因果、对白或动作细节；避免为凑字硬生新冲突 |
| 字数超过上限 | 在候选稿中压缩重复表达，保护关键事件和结尾；失败保留原稿并标未达标 |
| 模型因 token 上限截断 | 标记未完整，有限续写后重验；不能只因字数够就完成 |
| 质量修正改变长度 | 对修正后版本重新检查上下限、结尾和相关硬问题 |
| 达到修复上限仍失败 | 停止付费循环，保留草稿及失败原因，交作者处理 |

`max_tokens` 是输出容量，不是中文正文精确字数。不能通过直接截断字符串、看到句号就收尾或达到 token 数强停来宣称文章合格。

验收用合成正文覆盖：短且未结束、短但已结束、长但完整、长且截断、模型拒绝补写、压缩异常缩水、修复后再次超长。每种都应可停止、可回滚，不能静默标记合格。

### P0：审核结果绑定证据和正文版本

保留本地规则检查、结尾审查、六维意见和局部修正，增强每条问题的原文位置、证据来源、严重级别与正文版本。矛盾等硬问题不能被其他高分平均掉；审美建议允许作者忽略，规则误报允许有记录地人工豁免。

解析失败、调用失败、证据不足、部分分块未审都应显式为未知／未完成。不得用默认 80 分、缺问题数组或总分及格代替真实审核。正文发生变化后，旧报告应失效或要求重新核对。

验收：修改正文后不能继续套用旧位置；中间分块失败不能显示全文通过；只有一章时不能声称完成跨章一致性核查；必需事实缺失时解释缺口，不靠模型猜测补齐。

### P1：按场景控制篇幅，按需独立复核

章节计划可以给每个事件或场景预分篇幅，帮助模型控制结构；最终仍由代码计数。需要独立复核时再调用另一模型，不必每章固定让五个角色全文互评。小说软件内的写作／审查模型配置与开发用 Sonnet／Opus／DeepSeek 团队是两套配置，不能混为自动接通。

界面优先增加“差多少、为什么未完成、接下来补写还是压缩、最终改了哪里”。先让作者能看懂并控制一次写作过程，再考虑世界包、知情权限和推演等扩展。
