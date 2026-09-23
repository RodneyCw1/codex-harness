# 模板使用索引

复制到目标项目后填写实际信息。所有方括号和 `REPLACE_...` 均是待填内容；不能把空模板作为已冻结规范派发。下方示例 JSON 可以解析，但必须先替换项目内容；空数组表示尚未建立任务。

| 模板 | 写入者 | 用途 |
|---|---|---|
| [AGENTS.fragment.md](AGENTS.fragment.md) | Codex | 合并入口和最小规则，保留原项目指令 |
| [project-profile.md](project-profile.md) | Codex | 项目事实、规范依据、基线、命令与隔离方案 |
| [implementation.md](implementation.md) | Codex | 需求与实现方案、范围、接口和功能顺序 |
| [acceptance.md](acceptance.md) | Codex | 验收条件、硬门槛、需求追踪 |
| [test-plan.md](test-plan.md) | Codex | 用例、命令、数据、证据和最终检查 |
| [feature_list.json](feature_list.json) | 执行器按 Codex 决定更新 | 功能状态及验收引用 |
| [run-state.json](run-state.json) | 执行器 | 批次、阶段、计数和恢复状态 |
| [progress.md](progress.md) | 执行器生成，Codex核实 | 状态的可读摘要 |
| [session-handoff.md](session-handoff.md) | Codex | 下一会话可用的交接 |
| [clean-state-checklist.md](clean-state-checklist.md) | Codex | 暂停或交付前检查 |
| [evaluator-rubric.md](evaluator-rubric.md) | Codex | 硬门槛与六维质量评审 |
| [harness.config.yaml](harness.config.yaml) | 用户配置，Codex检查 | 外部 AI、项目路径、工具及循环限制 |
| [environment.example](environment.example) | 用户在受信环境设置 | 环境变量名示例，无真实密钥 |

权威状态和规范应保存在执行者不能写入的受信区域。复制这些模板本身不会建立访问控制。调用执行器前须按 [接入指南](../INTEGRATION.md) 配置。
