# 本项目协调约定

由当前 Codex 会话负责分析、文档、调度和独立验收。通用工作流见 [WORKFLOW.md](protocol-v1/WORKFLOW.md)，交换对象见 [PROTOCOL.md](protocol-v1/PROTOCOL.md)。具体 CLI 说明在本机执行器包 COORDINATOR.md 和 RUNTIME.md；其路径记录在本机配置与交接中。

首次接入按规范模板包 CODEX-SETUP.md 使用 `onboard` 合并文件、回填画像并建立本机配置；向导默认预检、初始化和基线。已经接入时先核对真实 status，向导重试保留既有工作区、任务与进度。

## 仓库文档与控制输入

v1.3 的编写入口是本机配置 `source_root` 原项目中的 docs/harness/，由 Codex 在没有活动运行的阶段维护三份规范。工作 AI 实施仍使用隔离工作树；自动摘要只写原项目，不修改工作副本或候选。

三份已审查文档使用 YAML front matter 记录 `task_id`、`spec_version`，如有 `feature_id` 也须与 draft 一致。调用 `prepare --task <draft> --docs <项目相对目录>`，执行器一次校验三份文档、复核来源摘要并发布冻结规范与 manifest。必要上下文仍经 `context_paths` 指向控制目录。旧 `prepare --task` 的控制目录输入方式继续支持，不需要为新方式手工复制三份正文。

同一版本重派发要求正文、上下文和受保护文件一致；变化时由 Codex 提升版本。活动运行中不修改保护文档，需要修订时按 stop/cancel 约定结束当前轮并保留计数。原始进度在控制目录持续记录，仓库摘要不用于驱动状态机。最终 ACCEPT 到 export 之间不改工作树；导出后的交接更新是单独的文档变更，不冒称新快照已经通过。

没有模型 Key 或沙箱可用时，仍可完成只读分析和仓库文档。真实执行前必须通过模型与沙箱预检。不要把模板复制成功等同于项目接入和业务验收全部完成。

## 日常闭环

读取需求和项目规范 → 分析实际代码 → 写实现/验收/测试文档并核对版本 → 登记命令、测试报告类型与范围 → prepare --docs → run → verify → inspect → Codex decide。

使用 `report` 查看每轮证据，`stats` 查看供应商用量和空间。真实执行数量来自本次 JUnit/TAP 报告；零执行、全部跳过或无效报告不能支持通过，非测试检查和旧记录的未知计数分别标注。关键阶段自动同步原项目进度与交接受管区块；冲突时保留用户内容，通过 `report --sync` 重试。

REVISE 时生成关联验收项、复现证据和复验条件的返工单，再准备下一轮。BLOCK 或达到轮数/无进展上限时保存状态并说明恢复条件；不把暂停标记通过。所有功能通过后建立 FINAL 任务、独立整体验证并 export，交付待合并差异和文档。

用户不用搬运 JSON；以上步骤和协议对象由 Codex 维护。Key 不写项目，示例证据不能用于 live 评审。实际 API 协议仅支持 OpenAI 兼容 Chat Completions 工具调用。

## 本项目命令和路径

接入后由 Codex 回填 project-profile.md 与项目外配置，注明 CLI 入口、配置位置和验证命令。没有回填前，本模板不可用于派发任务。
