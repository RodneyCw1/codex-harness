# 示例与验收场景

本目录用于理解合同和检验规则，**没有调用模型API，也没有运行示例中的pytest命令**。所有JSON均标记 `artifact_mode: illustrative`，日志明确包含SIMULATED。真实运行器必须拒绝这些数据作为正式验收证据。

## 两轮闭环示例

假设项目有名称规范化函数，需求为删除前后空格、保留中间空格，拒绝空串和全空格输入。该案例仅用Python风格命令说明，不限定工作流的项目语言。

| 步骤 | 文件 | 模拟结果 |
|---|---|---|
| Codex制定规范 | [实现](normalization/spec/implementation.md)、[验收](normalization/spec/acceptance.md)、[测试](normalization/spec/test-plan.md) | 两个需求对应两个AC和两个TC |
| 第一轮派发 | [任务包](normalization/task.json) | 只修改指定实现与自测文件 |
| 第一轮提交 | [执行报告](normalization/round-01/execution-report.json) | 等待独立验收 |
| 第一轮验证 | [TC-001](normalization/round-01/evidence-TC-001.json)、[TC-002](normalization/round-01/evidence-TC-002.json) | 正常名称通过，空输入失败 |
| Codex返工 | [评审](normalization/round-01/review.json)、[返工单](normalization/round-01/rework.json) | REVISE，修复空输入并重跑两项 |
| 第二轮派发 | [任务包](normalization/round-02/task.json) | 携带上一候选和返工引用 |
| 第二轮验证 | [TC-001](normalization/round-02/evidence-TC-001.json)、[TC-002](normalization/round-02/evidence-TC-002.json) | 两个必需项通过 |
| 功能通过 | [评审](normalization/round-02/review.json)、[功能状态](normalization/feature-list-after-round-2.json) | ACCEPT，但尚未完成整体交付 |
| 最终验证 | [最终只读任务包](normalization/final/task.json)、[评审](normalization/final/review.json) | 当前最终快照重跑全需求和既有调用链回归 |
| 交付 | [最终状态](normalization/final/state.json) | completed，成果待合并 |

每轮证据指向同一轮代码快照和规范摘要；日志摘要可计算核对。示例快照文件是标识和场景描述，不是真实代码清单；禁止通过改artifact_mode把它变成live。

## 负面场景

见 [验收场景清单](acceptance-scenarios.md)。包内交付检查包含静态校验和规则模型推演，实际结果见 [VALIDATION.md](../VALIDATION.md)。真实执行器落地后还必须执行场景表中的实际接入验证。
