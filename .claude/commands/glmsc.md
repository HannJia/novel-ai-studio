---
description: "GLM 代码审查 - 让 GLM 审查代码并提出改进建议"
allowed-tools: ["Bash", "Read"]
---

请先调用 GLM-4.7 进行代码审查：

```bash
python "e:\Cousor_work\novel-ai-studio\scripts\glm-cli.py" -p "请审查以下代码并提出改进建议（只做分析，不要修改代码）：$ARGUMENTS"
```

执行上述命令获取 GLM 的审查结果后，请：
1. 判断问题的优先级
2. 给出具体的修改方案
3. 实施代码优化
