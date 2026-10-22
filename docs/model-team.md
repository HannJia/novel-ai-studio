# 开发用多模型协作

已实现本地 API 调用工具；是否已配置密钥、是否经过真实调用验证，以本机状态和调用账本为准。配置模板位于 `tools/model-team.config.example.json`，不含密钥，默认禁止真实请求。此工具用于辅助开发，不属于小说软件的用户功能，也不修改软件的更新地址。GitHub 工具调研见 [多模型工具选型](model-team-tools.md)。

2026-10-17，本机 Sonnet、Opus 与 DeepSeek 的三次最小真实请求均返回 HTTP 200 和 `OK`，没有发送项目源码。成功记录在本机配置的 `lastLiveVerification` 中，可通过 `status` 查询；换电脑后仍需重新配置密钥并验证。该检查验证文本接口连通性，不代表真实开发任务已验收。

## 调用结构

Sonnet 提供主要实现方案，当前 Codex 会话负责需求拆解、选择文件、应用候选修改、独立审查、调试、测试和最终验收。复杂架构或疑难问题交给 Opus，范围明确的辅助分析交给 DeepSeek。外部模型通过本地桥接工具返回分析或候选补丁；它们不是当前聊天里的原生子代理，不会自行运行命令或修改项目。

用户最新选择：不设每日金额上限，以模型能力、问题解决质量和任务匹配为主，不强制先使用便宜模型再升级。成本作为运行记录和后续优化依据。当前聊天额度与外部 API 费用分别计算，调用外部模型不会替换当前聊天的计费方式。

## 结合用户实测截图的初始分工

| 任务 | 初始执行者 | 升级条件 |
| --- | --- | --- |
| 查找文件、读取 Git 差异、运行格式检查/测试 | 本地工具 | 需要解释复杂结果时才使用模型 |
| 整理长日志、提取报错、总结已定位的代码、范围明确的独立初查 | DeepSeek V4.1 Flash | 需要更复杂的实现或判断时，按任务分派给 Sonnet 或 Opus |
| 前端、后端业务逻辑、跨层功能、UI 调整和常见缺陷修复 | Claude Sonnet 5.5 | 作为主要实现成员；涉及跨模块设计、复杂根因或重大取舍时，直接让 Opus 参与 |
| 独立审查、调试、测试和最终验收 | 当前 Codex 会话 | 以源码和实际运行证据验收，必要时补充独立模型意见 |
| 复杂架构、多步任务判断、疑难问题的根因分析 | Claude Opus 5.5 | 根据复杂度从一开始参与，形成明确任务后交 Sonnet 实施；不固定参与每次审查 |
| 数据迁移、账户权限、持久化安全或自动更新链路的复杂修改 | Sonnet 或 Opus，按问题复杂度选择 | 使用适当的独立复核及项目既有验证要求，不依据模型自述判定成功 |

用户提供的五张实测截图显示：Sonnet 的后端为 92.8、全栈为 99.3；Opus 对应为 92.1、92.2，而 Opus 的 Agent 题为 100。由此将 Sonnet 明确设为主要实现成员，Opus 用于复杂判断；DeepSeek 优先承担范围明确的辅助工作，不独立协调团队或批准关键修改。详细读数、归一化口径和推断范围见 [视频参考记录](model-team-video-reference.md)。

这是结合官方能力定位与用户截图制定的初始策略。2026-10-17 已在本项目的篇幅与全文审核优化中实际调用 Sonnet 交付模块／测试、Opus 独立审查；集成情况见 [实施说明](chapter-length-and-review.md)。这证明配置可用于开发协作，不代表中转模型身份或通用能力排名已被独立验证。根据真实任务的正确性、一次通过率、稳定性、耗时和返工情况调整；不按固定比例分配调用量，也不凭单套评测断言某模型在所有任务上更强。

## 调度与验收

1. 简单工作先使用本地确定性工具；只在需要模型判断时发起 API 请求。
2. 每次只发送任务所需的已跟踪源码片段、差异、测试失败信息和验收条件。调用前检查敏感内容；不发送真实密钥、用户数据、数据库、稿件、PDF 或 OCR 输出。
3. 一个普通任务通常只选一个执行模型。确需分工时才增加另一模型；有文件依赖的修改按顺序完成，避免相互覆盖。
4. 不使用固定的“便宜模型失败几轮才允许调用强模型”策略。复杂任务可直接分配 Opus；没有新增证据时先改进定位方法或分工，避免重复尝试。
5. 按任务难度选择推理强度。参数必须经实际接口验证，不假设中转实现了全部原厂参数。
6. 限定上下文和输出长度，保留必要的公共提示前缀。缓存只有在中转确认支持、响应 usage 可核对且实际价格有利时才启用。
7. 不透明重试生成请求：超时可能已经产生费用。先记录这次状态，再决定是否重试。不得自动切换到另一个未知价格的模型。
8. 保存不含提示正文或密钥的调用账本：实际请求模型、服务端返回模型、usage、耗时、失败/重试与费用。费用按中转提供的单价计算，无法确认的项标记未知，不记为零。
9. 验收以运行结果、测试和代码审查为准。重大修改进行独立复核；普通小改不固定调用全体模型。DeepSeek 的反馈用于补充证据，关键结论由负责的实现/复核成员与主会话核实。运行记录用于比较实际质量和效率。

## 接入与密钥

- 中转：按用户最新选择使用 `https://api.ipc.wiki`，调用 Chat Completions 路径。Sonnet 使用 `claude-sonnet-5-5`，Opus 使用 `claude-opus-5-5`，待新站 Key 配置后验证这两个 ID 和接口路径。实际支持的推理参数以新站接口验证为准。更换中转站时在本机输入新站 Key。
- DeepSeek：官方当前调用名称为 `deepseek-flash`，对应 DeepSeek-V4.1-Flash-1017。优先使用官方接口；上线时再次确认模型映射和价格。
- 两套 Key 只在本机安全配置，不进入源码、配置模板、日志或 Git。跨电脑重新配置 Key，不通过 Git 同步。
- 在确认接口信息并完成本机 Key 配置之前，不发送付费推理请求，不声称团队已启用。

## 本机设置与使用

需要 Node.js 及 Windows PowerShell，无需安装额外 npm 包。在项目目录执行：

```powershell
# 打开密码输入框，保存时不发送网络请求
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File scripts/model-team/configure-dialog.ps1

# 查询配置；ready 表示具备调用条件，不代表真实请求已通过
node scripts/model-team/bridge.cjs status

# 最小付费请求，不携带项目源码；只测试已配置 Key 的角色
node scripts/model-team/bridge.cjs probe --role implementer
node scripts/model-team/bridge.cjs probe --role expert
node scripts/model-team/bridge.cjs probe --role scout
```

密钥用 Windows DPAPI 绑定当前 Windows 账户，加密后保存在 `.local-recovery/model-team/credentials.json`；运行配置在同目录的 `config.json`。整个目录被 Git 忽略，自动备份不会上传。换电脑后重新输入密钥。也支持进程环境变量 `MODEL_TEAM_RELAY_API_KEY` 和 `MODEL_TEAM_DEEPSEEK_API_KEY`，不要在聊天或命令行中粘贴真实值。终端隐藏输入的替代入口为 `scripts/model-team/setup.ps1`。

实际任务先将任务说明及验收条件写入本机文件，然后明确选择源码文件：

```powershell
node scripts/model-team/bridge.cjs run --role implementer --task-file .local-recovery/model-team/task.md --files src/App.vue --diff
```

示例中的源码路径应替换为实际相关文件。`--files` 只接受已被 Git 跟踪的源码和文档；`--diff` 仅加入这些选定文件相对 HEAD 的差异。不选择文件时，只发送任务说明。最多 16 个文件、120 KB 上下文、24 KB 任务文本。路径排除和密钥格式扫描用于降低误传风险，调用者仍须检查内容；不要把真实业务数据粘贴进任务文件。

模型回复写入 `.local-recovery/model-team/responses/`，由当前会话检查后再实施。工具不执行模型返回的命令或补丁。账本 `.local-recovery/model-team/usage.jsonl` 记录请求模型、响应模型、usage、耗时和成功状态，不记录提示正文和 Key。未提供价格时费用为未知；超时或失败不自动重试，可能已产生费用。请求成功仅说明该接口返回了文本，不能独立证明中转提供的底层模型身份。

关闭调用可将本机 `config.json` 的 `requestsEnabled` 改为 `false`。本地测试使用模拟响应，不消耗 API 额度：

```powershell
node --test --test-isolation=none scripts/model-team/bridge.test.cjs
# Windows 隐藏启动、保存及解密回归检查；固定假密钥，模拟传输，不联网
.\scripts\model-team\test-windows-credentials.ps1
```

从 PowerShell 7 隐藏启动 Windows PowerShell 时，继承的模块搜索路径可能导致自动加载加密命令失败。两个配置入口与 Node 解密子进程均显式加载当前 PowerShell 自带的 Security 模块，避免依赖父进程的模块搜索路径。

## 参考资料（核对日期：2026-10-17）

- [Anthropic：Sonnet 5.5 的日常任务定位、成本与推理设置](https://www.anthropic.com/claude-sonnet-5-5)
- [Anthropic：Opus 5.5 的复杂任务定位](https://www.anthropic.com/claude-opus-5-5)
- [DeepSeek：模型、调用名称与价格](https://api-docs.deepseek.com/quick_start/pricing/)
- [Codex：子代理继承主会话的模型供应商](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [用户提供的 31 款模型实测视频：五张截图读数与分工推断](model-team-video-reference.md)
