# 01 · 设计变量（Design Tokens）

## 0. 怎么改

现有变量体系在 `src/styles/variables.css`，通过 `[data-theme="..."]` 切换，结构是好的。
**不要新建第二套变量文件**。本节给出的值要么替换现有变量值，要么作为**新增变量**
追加进四个作用域（`:root / fanqie`、`eyecare`、`dark`）。

任何新增的原始色值都**不得写在组件 `<style>` 里**，必须先在 `variables.css` 中定义。

## 1. 颜色：浅色（宣纸）

效果图的浅色比现有 `fanqie` 更素：底色是宣纸米白，主色是印章朱红而非番茄橙红。

| Token | 值 | 用途 |
| --- | --- | --- |
| `--color-primary` | `#B03A2E` | 印章红，主按钮、激活态、强调数字 |
| `--color-primary-hover` | `#C24B3D` | |
| `--color-primary-pressed` | `#94301F` | |
| `--color-primary-light` | `rgba(176, 58, 46, 0.08)` | 浅底标签、选中行背景 |
| `--color-primary-suppl` | `#D98878` | 次级强调、图示辅助线 |
| `--color-seal` | `#9E2B25` | 印章图形专用，**不可用于正文文字**（对比度不足） |
| `--bg-color` | `#FAF8F4` | 页面底色（宣纸） |
| `--bg-color-paper` | `#FDFBF7` | 编辑区纸面 |
| `--bg-color-card` | `#FFFFFF` | 卡片 |
| `--bg-color-sidebar` | `#F5F2EC` | 侧栏 |
| `--bg-color-hover` | `rgba(0, 0, 0, 0.035)` | |
| `--bg-color-tag` | `#FBF0ED` | |
| `--text-color-primary` | `#26221E` | 墨色 |
| `--text-color-secondary` | `#6B635A` | |
| `--text-color-tertiary` | `#9A9188` | |
| `--text-color-disabled` | `#C4BDB4` | |
| `--border-color` | `#E6E1D8` | 主细线 |
| `--border-color-light` | `#F0ECE4` | 次级细线 |
| `--border-color-hover` | `#D5CEC3` | |

状态色沿用现有 `--color-success: #18A058` / `--color-warning: #F0A020` /
`--color-error: #D03050` / `--color-info: #2080F0`，不调整。

**新增语义色**（效果图中数据面板/待办用到，需要四级）：

| Token | 值 | 用途 |
| --- | --- | --- |
| `--state-done` | `#6B635A` | 已完成节点（实心） |
| `--state-planned` | `#B8B0A6` | 计划中节点（空心描边） |
| `--state-ai-suggest` | `#B03A2E` | AI 建议节点（虚线描边 + 右上角 AI 角标） |
| `--state-pending` | `#C9852B` | 「待确认」标签底色 |

## 2. 颜色：深色

效果图第 4 张是深色写作页。现有 `dark` 主题的基调是中性灰蓝（`#1A1A1E`），
效果图偏暖褐。**建议向暖褐靠**，与浅色形成同一材质感，但不强制。

| Token | 值 | 用途 |
| --- | --- | --- |
| `--bg-color` | `#1C1917` | |
| `--bg-color-secondary` | `#242020` | |
| `--bg-color-paper` | `#262120` | 编辑区 |
| `--bg-color-card` | `#242020` | |
| `--bg-color-sidebar` | `#181514` | |
| `--bg-color-hover` | `rgba(255, 255, 255, 0.055)` | |
| `--color-primary` | `#C9603F` | 深色下红需提亮，否则不可读 |
| `--color-primary-hover` | `#D97B5C` | |
| `--color-primary-pressed` | `#AE4E30` | |
| `--text-color-primary` | `#EDE7E0` | |
| `--text-color-secondary` | `#A69C93` | |
| `--text-color-tertiary` | `#756C64` | |
| `--border-color` | `#3A3431` | |
| `--border-color-light` | `#2E2927` | |

深色的 `--state-ai-suggest` 用 `#C9603F`；`--state-planned` 用 `#6E655D`。

## 3. 字号层级

效果图的正文用宋体、界面用无衬线，这个分工要保留。字号定义成变量：

| Token | 浅色/深色通用值 | 用途 |
| --- | --- | --- |
| `--font-size-display` | `28px / 行高 1.3` | 首页「晚上好，今天写了 N 字」 |
| `--font-size-h1` | `22px / 1.4` | 页面主标题、人物名 |
| `--font-size-h2` | `17px / 1.5` | 区块标题（基础属性、装备物品） |
| `--font-size-body` | `14px / 1.7` | 界面正文、表单 |
| `--font-size-sm` | `13px / 1.6` | 表格、列表项 |
| `--font-size-xs` | `12px / 1.5` | 标签、角标、时间戳 |
| `--font-size-caption` | `11px / 1.4` | 图注、印章字 |
| `--font-size-manuscript` | `18px / 2.0` | **长篇正文专用**，见第 5 节 |

正文行高 2.0 是硬要求。中文长文在 1.5–1.6 行高下读起来压迫感强，效果图的疏朗感来自大写行距。

## 4. 间距、圆角、细线

间距沿用现有 `--space-xs: 4px / sm: 8px / md: 16px / lg: 24px / xl: 32px / 2xl: 48px`，不新增。

圆角：效果图比现有值**更小**，界面更硬朗。建议收敛为三档：

| Token | 现值 | 建议值 | 用途 |
| --- | --- | --- | --- |
| `--radius-sm` | 6px | `4px` | 标签、按钮、输入框 |
| `--radius-md` | 10px | `8px` | 卡片、面板 |
| `--radius-lg` | 14px | `12px` | 弹窗 |
| `--radius-xl` | 20px | `16px` | 大容器 |

**细线（新增）**：效果图多处用不到 1px 的极细分隔线，需新增两个变量：

- `--border-hairline: 1px solid var(--border-color-light)` — 卡片内部分隔
- `--border-width-strong: 2px` — 选中态左侧竖条（设定集左侧列表用）

D 需要注意：`1px` 在 125% / 150% 缩放屏上会出现半像素显示。Electron 内可以用
`transform: scaleY(0.5)` 或直接接受 1px。**由实现方实测后二选一并在代码注释里注明**。

## 5. 字体

### 5.1 界面字体

现有 `--font-family` 是 `'Microsoft YaHei', 'PingFang SC', ...`，
Windows 下会落到微软雅黑，可以保留。

### 5.2 正文宋体（关键问题）

**现有正文如果使用 `SimSun`（Windows 自带宋体），长文阅读效果差**：字形过窄、
标点挤压、无 Hinting 优化，在 18px 连续阅读下明显劣于印刷级宋体。

**建议随软件内置思源宋体**（Source Han Serif / Noto Serif CJK SC）：

- 许可证为 **SIL Open Font License 1.1**，允许打包分发、允许商用、允许嵌入应用，
  只要求保留版权声明（随字体附带 `LICENSE` 文件即可）。
- **不要**内置 Windows 自带字体（SimSun / 宋体），无再分发授权。
- 体积：思源宋体简体子集（GB2312 + 常用标点）约 3–5 MB WOFF2；
  全量 CJK 约 20 MB+。**建议只打包简体子集**，用 `subset` 工具裁剪，
  保留「常用字 + 标点 + 生僻字兜底回退到系统字体」策略。
- 字重只打包 Regular（400）与 Medium（500）两档，正文用 400，章节标题用 500。
- 变量命名：新增 `--font-family-manuscript: 'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', 'SimSun', serif`。
  回退链里保留 `SimSun` 只是兜底，正常路径不应命中。

打包位置放进 `resources/`，用 `@font-face` + `font-display: swap` 引入。

### 5.3 等宽字体

现有 `--font-family-mono` 保留，数据面板 JSON 视图在用。

## 6. 是否修改现有 `fanqie` 主题

两条路，**交接时需要负责人拍板**（已记入 `09-open-questions.md`）：

- **A（推荐）**：直接替换 `fanqie` 主题的值为第 1 节，主题改名不改
  （`data-theme` 值保持 `fanqie`，避免用户已存设置失效）。
  好处：用户设置零迁移；坏处：老用户看到配色变化，需要在 CHANGELOG 说明。
- **B**：新增 `xuan` 主题，`fanqie` 保留。好处：不动老用户；坏处：维护四套主题，
  且旧主题与新版界面的圆角/字号规范不匹配，会出现「旧皮新骨」的违和。

实现方**默认按 A 执行**，除非 `09-open-questions.md` 中该项已被划掉改为 B。

## 7. 禁止事项

- 不要把颜色写死在 `.vue` 的 `<style scoped>` 里，深色模式会直接失效。
- 不要为新页面单独引入一套 CSS 变量前缀（如 `--settings-*`），全部走全局变量。
- 不要用 `!important` 覆盖主题。现有 `variables.css` 第 202 行已有一处 `!important`
  （`.char-grid`），是历史遗留，新代码不要增加。
