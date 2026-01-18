# NovelAI Studio Prompt 模板说明

## 目录结构

```
templates/
├── index.json                # 模板索引文件
├── chapter-continue.json     # 章节续写模板
├── chapter-generate.json     # 章节生成模板
├── outline-generate.json     # 大纲生成模板
├── summary-generate.json     # 摘要生成模板
├── review-logic.json         # 逻辑审查模板
└── README.md                 # 本文件
```

## 模板格式说明

每个模板文件包含以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 模板唯一标识 |
| name | string | 模板名称 |
| version | string | 模板版本 |
| description | string | 模板描述 |
| variables | array | 变量定义列表 |
| systemPrompt | string | 系统提示词 |
| userPromptTemplate | string | 用户提示词模板 |
| options | object | AI 调用选项 |

## 变量定义

```json
{
  "name": "variableName",
  "description": "变量说明",
  "required": true,
  "default": "默认值"
}
```

## 模板语法

模板使用类似 Handlebars 的语法：

- `{{variableName}}` - 插入变量值
- `{{#if condition}}...{{/if}}` - 条件判断
- `{{#each items}}...{{/each}}` - 循环遍历

## 使用方式

1. 前端加载模板文件
2. 用户填写/系统自动填充变量值
3. 渲染生成最终的 Prompt
4. 调用 AI 接口

## 自定义模板

用户可以：
1. 修改现有模板的 Prompt 内容
2. 调整变量和默认值
3. 创建新的模板文件

修改后的模板保存在用户数据目录。
