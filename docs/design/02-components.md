# 02 · 组件规范与交互状态

## 0. 技术前提

项目已使用 naive-ui（`src/App.vue` 挂载了 `NConfigProvider` / `NMessageProvider` /
`NDialogProvider`，含 `themeOverrides`）。

**规范**：
- 通用控件（按钮、输入框、下拉、日期、消息、对话框）**优先用 naive-ui**，
  通过 `themeOverrides` 对齐本目录的变量，不要手写。
- 只有效果图中 naive-ui 没有对应形态的（悬浮批注卡、故事地图节点、
  设定板卡片、印章图形）才手写组件。
- 现有代码里有一处混用先例：`ChapterReviewSidebar.vue` 内部同时用了原生元素和
  `n-button`。新组件不要复制这种混用，一个组件内保持一种来源。

## 1. 状态矩阵（所有交互元素必须实现全六态）

效果图是静态的，看不出状态。实现方必须补齐以下状态，缺一不算完成。

| 状态 | 视觉要求 | 触发 |
| --- | --- | --- |
| 默认 | 按第 2 节规格 | — |
| 悬停 | 背景 +3.5% 明度差或边框加深一档 | `:hover` |
| 按下 | 背景再加深一档，**不做位移动画** | `:active` |
| 禁用 | 文字色降为 `--text-color-disabled`，背景保持，**不降透明度**（透明度会让禁用态在深色下糊掉） | `disabled` |
| 焦点 | `outline: 2px solid var(--color-primary)` + `outline-offset: 2px` | `:focus-visible` |
| 加载 | 控件内左侧 `ai-spinner` 旋转，文字替换为进行中文案，控件宽度不变 | `loading` |

**焦点必须用 `:focus-visible` 而不是 `:focus`**，否则鼠标点击也会出现焦点环。
现有代码库尚无统一焦点环规范，本次一并建立，见 `07-accessibility.md`。

## 2. 逐组件规格

### 2.1 按钮

四种变体，对应效果图中的用法：

| 变体 | 背景 | 文字 | 边框 | 用在哪 |
| --- | --- | --- | --- | --- |
| 主按钮 | `--color-primary` | 白 | 无 | 「确认」「继续写作」「以此开书」 |
| 次按钮 | 透明 | `--text-color-primary` | `--border-color` | 「忽略」「编辑」 |
| 幽灵按钮 | 透明 | `--text-color-secondary` | 无 | 卡片内的「丢弃」「添加」 |
| 危险按钮 | `--color-error` | 白 | 无 | 删除确认（仅在弹窗内使用） |

尺寸三档：`large` 36px 高（首页主 CTA）、`medium` 32px（默认）、`small` 26px（表格行内）。
圆角一律 `--radius-sm`。**主按钮内边距要比 naive-ui 默认值更宽**，
效果图的比例约为 `水平 20px / 垂直 8px`。

### 2.2 输入框 / 文本域

- 高度 32px（单行），圆角 `--radius-sm`，边框 `--border-color`
- 聚焦时边框色变 `--color-primary`，**不要用 naive-ui 默认的蓝色外发光**
- 错误态：边框 `--color-error`，下方 12px 红字错误提示，提示文字**必须**具体到可操作
  （「书名不能为空」而不是「输入无效」）

### 2.3 标签（Tag / Badge）

效果图里出现五种标签，语义不同，不要合并成一个组件：

| 形态 | 样式 | 语义 |
| --- | --- | --- |
| 类别标签 | 浅底 `--bg-color-tag`，文字 `--color-primary`，`--radius-sm` | 人物 / 地点 / 势力 / 物品·装备 / 世界规则 / 资料库 |
| 待确认 | 底色 `--state-pending`，白字 | 设定变更建议的审批态 |
| 数值加成 | 浅灰底，前缀 `+`，等宽字体 | 「+20 赤炎刀」「+10% 心法」 |
| AI 徽标 | `--state-ai-suggest` 描边 + 右上角小圆点 | 故事地图节点、AI 建议条目 |
| 主配角标记 | 实心红底白字小方块，2 字内 | 「主角」 |

### 2.4 列表项

- 高度 36px（侧栏导航）/ 32px（其他列表）
- 选中态：背景 `--color-primary-light` + **左侧 2px 竖条 `--color-primary`**
  （现有侧栏用纯背景色，需按效果图加上竖条）
- 悬停态：背景 `--bg-color-hover`
- 带数字计数时，计数右对齐，`--font-size-xs`，色 `--text-color-tertiary`

### 2.5 卡片

- 背景 `--bg-color-card`，边框 `--border-hairline`，圆角 `--radius-md`
- 阴影：**效果图的卡片几乎无阴影**，靠细线区分层次。
  使用时默认 `box-shadow: none`，仅悬浮卡片（首页「继续写作」、
  设定板卡片）用 `--shadow-card`
- 内边距：`--space-md`（紧凑）或 `--space-lg`（卡片墙）

### 2.6 悬浮批注卡（新增，效果图第 2、4 张）

这是效果图里最具辨识度的组件，规格要写死：

- 宽 260px，背景 `--bg-color-card`，左/右圆角 `--radius-md`
- **左侧 3px 竖条**颜色按批注类型区分：
  `--color-error`（设定冲突）、`--color-warning`（节奏建议）、
  `--color-info`（事实性问题）、`--state-ai-suggest`（续写建议）
- 内部结构：红色小圆点 + 类型标题（12px，次色）→ 正文（13px，主色）→
  操作行「采纳 / 忽略」（幽灵按钮）
- 与正文之间画一条**曲线连接线**（1px，`--border-color-hover`），
  从批注卡左缘连到正文中锚定的文字位置。曲线用 SVG 绘制，
  不用 CSS 伪元素（曲线路径需要按锚点位置实时计算）
- 同屏最多显示 **3 张**，超出时在右缘显示「还有 N 条」入口

### 2.7 弹出面板 / 命令面板（效果图第 4 张）

- 宽 420px，背景 `--bg-color-modal`，`--radius-lg`，`--shadow-lg`
- 居中偏上定位（垂直方向距视口顶部约 25%）
- 分组标题（「写作」「审查」「跳转」）：`--font-size-xs`，`--text-color-tertiary`，
  上下 `--space-sm` 内边距
- 选项行 32px 高，悬停/键盘选中态用 `--color-primary-light`，
  左侧 2px 竖条同选中色（与列表项规范一致）
- 右侧快捷键提示用 `kbd` 样式：`--font-size-xs`，1px 边框，`--radius-sm`，
  内边距 `2px 6px`
- **必须在 1024px 宽窗口下正常工作**，见 `06-interactions.md`

## 3. 动效

- 面板/弹窗进出：`--transition-fast`（150ms）淡入 + 位移 4px
- 侧栏折叠：`--transition-normal`（250ms）
- AI 流式生成中：光标闪烁（现有 `ai-spinner` 复用），**不要用打字机逐字动画**
  （长时间写作下会产生视觉疲劳，且与流式返回的实际节奏冲突）
- 所有动效必须响应 `prefers-reduced-motion`，见 `07-accessibility.md`

## 4. 不要做的事

- 不要给所有卡片加阴影来「增加层次感」，效果图的层次来自细线和留白。
- 不要引入新的 UI 库。已有 naive-ui + 手写 CSS 足够。
- 不要为深色模式写第二套组件。所有颜色走变量。
