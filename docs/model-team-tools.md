# GitHub 多模型开发工具选型

调研日期：2026-10-17。用户优先级为能力和开发结果，不设每日金额上限。尚未安装或连接任何候选工具。

## 候选比较

| 工具 | 核实的能力 | 与当前需求的关系 |
| --- | --- | --- |
| [PAL MCP Server](https://github.com/BeehiveInnovations/pal-mcp-server) | 面向 Codex 等 MCP 客户端的多模型规划、讨论、排障和代码复核；支持自定义 OpenAI 兼容接口；`clink` 可调用另行安装的 AI CLI | 希望继续由当前 Codex 协调时的候选。普通 API 工具调用不等于外部模型拥有独立编辑与执行环境。完整开发能力需要主客户端执行修改，或额外配置 CLI 桥接 |
| [OpenCode](https://github.com/anomalyco/opencode) | 原生主代理/子代理、按代理指定 `provider/model-id`、自定义供应商、OpenAI Chat Completions 与 Responses 两类接入、文件修改和命令权限；有 Windows 版本 | 更符合多个供应商模型分别承担执行任务的需求。它是独立开发工具，需要配置其代理并在该工具或其接口中运行，不会直接改变当前 Codex 内置团队 |
| [Claude Code Router](https://github.com/musistudio/claude-code-router) | 多种开发客户端接入、供应商与模型路由、接口探测、凭据管理、日志与回退策略 | 适合需要统一网关的场景。单独部署路由层不能替代主代理、子代理与开发执行流程 |

上述“适合”是基于文档与源码的选型判断，尚未使用用户的中转站进行端到端测试。

## 维护与兼容性核实

GitHub API 调研时的状态：三个仓库均未归档。`pal-mcp-server` 最近推送为 2025-12-15；`opencode` 为 2026-10-17；`claude-code-router` 为 2026-10-10。最近推送时间只作为维护参考，不能单独证明稳定性或安全性。

PAL 当前自定义供应商的源码使用一组 `CUSTOM_API_URL` / `CUSTOM_API_KEY`，模型目录由 `CUSTOM_MODELS_CONFIG_PATH` 指定。用户的中转与 DeepSeek 官方是两个地址和两套 Key；可考虑运行两个相互隔离的 PAL 实例，或通过统一网关连接，而不能仅把两个地址填写到同一环境变量中。此为基于代码的接入方案，待实测。

PAL 默认目录中的 `opus` / `sonnet` 别名仍包含较旧的 Claude 版本。必须显式绑定用户中转的实际 5.5 模型 ID，并核对推理、温度、上下文和输出参数；不能凭别名宣称已用上指定模型。

OpenCode 文档支持每个代理使用独立的 `provider/model-id`。自定义 Chat Completions 接口使用 `@ai-sdk/openai-compatible`；Responses 接口使用 `@ai-sdk/openai`。用户中转宣称兼容 OpenAI，仍需确认具体路径、模型 ID、流式输出和工具调用表现。

另查到原 `oh-my-opencode` 仓库现重定向至 `code-yeongyu/oh-my-openagent`，当前 README 标注 OmO 5.0 与 Pi。旧的 OpenCode 插件教程不能视为当前版本的安装依据，本次不将其作为第一步依赖。

## 基于能力的分工起点

- Codex：理解需求、任务分派、工作区集成与最终验收。
- Opus 5.5：复杂设计、跨模块判断、疑难根因和重要修改的独立复核；可从任务开始直接参与。
- Sonnet 5.5：功能开发、UI 实现、常见缺陷修复和按设计落地。
- DeepSeek V4.1 Flash：独立代码初查、日志分析、文档和范围明确的辅助工作。是否扩大职责由实际任务验证决定。

本次实现保留当前 Codex 对话作为入口，先使用项目内无需额外依赖的 Node.js API 桥接，操作见 [开发用多模型协作](model-team.md)。它将外部回复交给 Codex 审查、应用和验证，不具备独立代理的工具循环。PAL 和 OpenCode 作为后续需要 MCP 或独立执行代理时的候选；本次未安装。先完成最小接入及真实任务验收，再决定是否需要更完整的编排工具。

## 直接依据

- [PAL：自定义模型和 API](https://github.com/BeehiveInnovations/pal-mcp-server/blob/main/docs/custom_models.md)
- [PAL：自定义供应商源码](https://github.com/BeehiveInnovations/pal-mcp-server/blob/main/providers/custom.py)
- [PAL：Codex 和 Windows 设置](https://github.com/BeehiveInnovations/pal-mcp-server/blob/main/docs/getting-started.md)
- [OpenCode：代理、模型与权限](https://opencode.ai/docs/agents/)
- [OpenCode：供应商与自定义接口](https://opencode.ai/docs/providers/)
- [Claude Code Router：项目说明](https://github.com/musistudio/claude-code-router)
- [OmO：当前项目说明](https://github.com/code-yeongyu/oh-my-openagent)
