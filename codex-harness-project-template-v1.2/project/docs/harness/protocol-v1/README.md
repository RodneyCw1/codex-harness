# Codex 主导的 AI 开发闭环规范

**版本：1.0.0 · 日期：2026-09-17 · 语言：简体中文**

你提出需求，Codex 根据项目代码与规则制定方案、验收和测试要求，外部 AI 实施，Codex 独立验收并自动派发返工。成果达到要求后，交付待合并代码及证据。

本包交付工作流规范、可复制模板和交换协议。它不是已安装的插件，也不包含能直接调用 API、编辑项目或常驻运行的执行器。配置文件和提示词需要接入具备这些能力的本地执行器后才能自动运行。

## 从这里开始

1. 阅读 [工作流规范](WORKFLOW.md)，确定各角色职责、验收和停止规则。
2. 按 [项目接入指南](INTEGRATION.md) 填写项目画像、配置和验证命令。
3. 使用 [模板索引](templates/README.md) 建立本项目的实现、验收、测试和状态文件；将入口片段合并到已有项目指令，保留原有规则。
4. 由 Codex 冻结任务规范，再按 [交换协议](PROTOCOL.md) 派发执行。
5. 通过 [示例闭环](examples/README.md) 理解失败、返工和通过；所有示例证据均为模拟数据。

## 目录

| 内容 | 入口 |
|---|---|
| 阶段流程、状态、自动审批及完成定义 | [WORKFLOW.md](WORKFLOW.md) |
| 项目接入、API 与本地工具桥接 | [INTEGRATION.md](INTEGRATION.md) |
| 交换对象、证据绑定及恢复协议 | [PROTOCOL.md](PROTOCOL.md) |
| 关键设计决定与来源 | [DECISIONS.md](DECISIONS.md) |
| 项目文档、配置、状态模板 | [templates/README.md](templates/README.md) |
| Codex、执行 AI、验收者提示词 | [prompts/README.md](prompts/README.md) |
| JSON Schema 与校验边界 | [schemas/README.md](schemas/README.md) |
| 两轮示例及异常验收场景 | [examples/README.md](examples/README.md) |
| 本包交付检查结果 | [VALIDATION.md](VALIDATION.md) |

## 默认行为

- 同时推进一个功能，Codex 保留决策和通过权。
- 每个功能每批次最多 10 轮提交；首次提交计入。连续 3 轮无进展则暂停。
- 短暂 API 故障最多额外重试 3 次；鉴权、协议、权限问题直接阻塞。
- 通过必须有当前规范、当前代码快照下的独立验证证据。
- 自动执行、验收和返工；不自动合并或发布。
- 暂停及中断均保留状态，恢复不依赖模型记住旧聊天。

## 可以给 Codex 的启动需求

> 请按本项目接入的 Codex Harness v1 工作流处理以下需求：［需求］。先读取项目规范、代码和当前状态，生成实现、验收、测试文档及追踪关系。确认已配置的执行器能力可用后，派发外部 AI 实施，由你独立验收和返工。遵守每批次 10 轮、连续 3 轮无进展暂停的限制，通过后交付待合并成果。执行器不可用时，完成不依赖它的分析与文档并明确报告接入阻塞，不把文档生成视为代码实现完成。

## 适用边界

适用于能提供可观察行为、可执行检查及可恢复工作区的代码项目。框架、语言、测试命令均由项目配置决定。模型名称、服务商和 API 地址不绑定某一供应商。

原始框架来自 [Learn Harness Engineering 模板指南](https://github.com/walkinglabs/learn-harness-engineering/blob/main/docs/zh/resources/templates/index.md)。本包中的 API 协议、文件布局、计数规则和状态提交规则是为本需求制定的工程约定，详见 [设计记录](DECISIONS.md)。
