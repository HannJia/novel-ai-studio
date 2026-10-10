# 00 · 交接范围与事实基线

## 1. 本次交接要做什么

把现有 Vue 3 + Electron 应用的信息架构重排为效果图所示的新版界面，包括：

- 左侧全局导航改为：首页 / 设定集 / 创作 / 大纲 / 文档 / 素材 / 发布 + 设置
- 新增「设定集」合并入口（人物 / 地点 / 势力 / 物品·装备 / 世界规则 / 资料库）
- 写作页改为「正文 + 悬浮 AI 批注」形态，并加入行内续写建议
- 新增「故事地图」作为章节与叙事线的可视化视图
- 新增「灵感工作室」作为开书前的对话式设定生成入口
- 首页改为写作统计 + 继续写作 + 书架 + 待办面板

**不做什么**：不改数据库表结构；不改 AI 服务调用协议；不重写导出/导入逻辑。

## 2. 命名约定（重要）

- 「**墨笺**」是**占位产品名**，仅为效果图视觉演示使用。
  **交接时不得据此改名**。软件当前正式名称见 `README.md` 与 `package.json` 的
  `description` 字段，产品名变更需要负责人单独决策，不随本次界面重排一起改。
- 效果图人物「林远 / 苏婉 / 白长老」、书名「青云修仙录 / 星河问道」、
  章节名「丹房夜谈 / 药王谷」全部是占位文案，**不得写入任何种子数据或测试夹具**。
- 代码标识符、路由名、组件名沿用现有英文命名，不要为「墨笺」新增字面量。

## 3. 术语表

本表定义文档与代码之间的一一对应关系。实现时严格使用同一术语，不要混用。

| 术语 | 对应现有实现 | 数据归属 | 说明 |
| --- | --- | --- | --- |
| 书架 | `views/NovelList.vue`，路由 `/` | `novels` 表 | 首页的书本网格 |
| 工作台 | `views/Workspace.vue`，路由 `/workspace/:novelId` | — | 单本书的容器布局 |
| 角色库 | `views/workspace/CharacterLibrary.vue` | 角色表 | 存**角色概述**（身份、性格、外貌、背景） |
| 知识库 | `views/workspace/KnowledgeBase.vue`，以及全局 `/knowledge` | 知识表 | 存**体系设定**（世界观规则、势力、地理、力量体系） |
| 数据面板 | `views/workspace/DataPanelWorkspace.vue` | 数据面板表 | 存**会随剧情变化的数值**（等级、属性、持有物、关系状态） |
| 设定集 | **新增合并入口**（效果图第 1 张） | 无独立存储 | 仅作为上述三者的统一入口，见 `03-navigation.md` |
| 故事地图 | **新增**，效果图第 5 张 | 复用大纲 + 章节 + 剧情线数据 | 章节与叙事线的可视化 |
| 灵感工作室 | 复用 `views/workspace/InspirationArchive.vue` 思路，新增开书前对话形态 | 灵感表 | 全书级，不属于某一章 |
| 批注 | 现有 `components/chapter-editor/ChapterReviewSidebar.vue` 的扩展 | 不落库 | 锚定到正文位置的 AI 建议 |
| 设定变更建议 | 现有人工确认流程 | `story_state_proposals` 迁移 | 见 `05-missing-pages.md` 审批类界面 |

## 4. 现有代码事实基线

以下为撰写本目录时**实测**的仓库状态，实现方应据此校验，若发现不符说明基线已漂移。

**分支与提交**：`codex/release-1.0.6`，HEAD 为 `8fc2573`
（Release 1.0.6: improve long-form chapter workflows）。撰写时工作区干净。

已合入的相关改动（**不要再重复实现**）：
- 数据库补列迁移 `story_state_proposals`
- 配角字段校验
- 自定义退出弹窗（`src/components/ExitConfirmDialog.vue`）
- 云同步面板中的浏览器版提示（`src/components/CloudSyncPanel.vue`）

**现有路由**（`src/router/index.ts`）：
`/`、`/create`、`/settings`、`/knowledge`、
`/workspace/:novelId` 下的 `outline`、`volumes`（重定向到 `planning?tab=volumes`）、
`chapters`、`inspiration`、`characters`、`knowledge`、`planning`、`data`、`editor/:chapterId`，
以及 `/generate/:novelId`。

**主题**（`src/styles/variables.css`）：已有三套，通过 `data-theme` 属性切换——
`fanqie`（默认，暖白 + 橙红）、`eyecare`（护眼，淡黄）、`dark`（深色）。
外加 naive-ui 的 `darkTheme` 在 `src/App.vue` 中挂载。效果图的浅色 = `fanqie`，
深色 = `dark`。**注意效果图的浅色比现有 `fanqie` 更偏宣纸白、主色更偏印章红**，
是否调整现有变量见 `01-tokens.md` 第 6 节。

**变量体系现状**：已有主色/背景/文字/边框/阴影/圆角/间距/过渡/字体/状态色/进度条/滚动条
共 12 组自定义属性。**响应式断点已存在**（`max-width: 1200px` 侧栏收窄、`768px` 侧栏抽屉化），
但按最小窗口 1024×700 的要求，`768px` 断点在 Electron 里永远不会触发，需要重定，见 `06-interactions.md`。

**窗口尺寸**（`app-main/main.js`）：默认 1280×800，最小 **1024×700**。
`minWidth: 1024, minHeight: 700`。所有页面必须在此尺寸下可用。

**编辑区输入形态**：现有正文编辑器见 `src/views/workspace/ChapterEditor.vue`。
现有快捷键实测为：`Ctrl/Cmd+S` 保存、`Ctrl/Cmd+Enter`（AI 模式下）触发续写、`Esc` 关闭。
中文输入法组词判断已有先例可循：`src/components/InspirationChat.vue` 使用
`event.isComposing || composing.value || event.keyCode === 229` 拦截回车，
行内续写建议的 Tab 采纳必须复用同一判断。

**测试基线**：`npm test`（vitest）、`npm run test:electron`（Electron 冒烟）、
`npm run typecheck`。任何阶段完成前这三条必须全绿。

## 5. 交付裁定

后续三份文档 `04-pages.md`、`05-missing-pages.md`、`06-interactions.md` 是主体。
如果时间紧张只读三处，读这三处，加上 `03-navigation.md` 的数据职责边界一节。
