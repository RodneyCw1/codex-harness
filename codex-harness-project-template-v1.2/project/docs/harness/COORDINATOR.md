# 本项目协调约定

由当前 Codex 会话负责分析、文档、调度和独立验收。通用工作流见 [WORKFLOW.md](protocol-v1/WORKFLOW.md)，交换对象见 [PROTOCOL.md](protocol-v1/PROTOCOL.md)。具体 CLI 说明在本机执行器包 COORDINATOR.md 和 RUNTIME.md；其路径记录在本机配置与交接中。

首次接入按规范模板包 CODEX-SETUP.md 合并文件、回填画像并建立本机配置。已经接入时先核对真实 status 和基线，不能重复 init 覆盖历史。

## 仓库文档与控制输入

编写入口是当前项目工作树的 docs/harness/。初始化前在用户授权的原项目中维护；初始化后，当前批次使用执行器返回的隔离工作树，由 Codex 在没有活动运行的阶段维护规范。文档与代码一起作为待合并成果交付，避免原项目与隔离树同时维护两套正文。

v1.2 的 prepare 不会自动同步项目文档。每轮由当前 Codex 会话把三份已审查文档和必要上下文原样复制到 control_root/inputs/<task-id>/<feature-id>/v<version>/，逐文件核对 SHA-256 并记录仓库相对来源。draft 的 documents/context_paths 使用控制根相对路径，随后由 prepare 生成 specs、摘要和任务包。原始正文随项目保存；冻结输入和证据不开放给工作 AI。

同一版本重派发要求正文、上下文和受保护文件一致；变化时由 Codex 提升版本。活动运行中不修改保护文档，需要修订时按 stop/cancel 约定结束当前轮并保留计数。原始进度在控制目录持续记录，仓库摘要不用于驱动状态机。最终 ACCEPT 到 export 之间不改工作树；导出后的交接更新是单独的文档变更，不冒称新快照已经通过。

没有模型 Key 或沙箱可用时，仍可完成只读分析和仓库文档。真实执行前必须通过模型与沙箱预检。不要把模板复制成功等同于项目接入和业务验收全部完成。

## 日常闭环

读取需求和项目规范 → 分析实际代码 → 写实现/验收/测试文档 → 登记命令与范围 → 复制控制输入 → prepare → run → verify → inspect → Codex decide。

REVISE 时生成关联验收项、复现证据和复验条件的返工单，再准备下一轮。BLOCK 或达到轮数/无进展上限时保存状态并说明恢复条件；不把暂停标记通过。所有功能通过后建立 FINAL 任务、独立整体验证并 export，交付待合并差异和文档。

用户不用搬运 JSON；以上步骤和协议对象由 Codex 维护。Key 不写项目，示例证据不能用于 live 评审。实际 API 协议仅支持 OpenAI 兼容 Chat Completions 工具调用。

## 本项目命令和路径

接入后由 Codex 回填 project-profile.md 与项目外配置，注明 CLI 入口、配置位置和验证命令。没有回填前，本模板不可用于派发任务。
