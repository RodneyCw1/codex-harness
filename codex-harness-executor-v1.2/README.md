# Codex Harness 本地执行器 v1.3.0

v1.3 提供自动接入、项目文档直接冻结、过程报告、JUnit/TAP 用例计数和供应商用量/空间统计。配置版本 1.3，协议仍为 1.0，目录名保持不变。见 [迁移与用法](MIGRATION-1.3.md) 和 [本版验证记录](VALIDATION-V1.3.md)。

当前 Codex 会话分析项目、冻结实现/验收/测试文档、调度工作 AI、独立验收并自动返工。执行器提供文件工具、原生沙箱、快照证据和状态恢复；无需第二个决策模型 API。

本版保留 v1.2.1 对历史运行恢复、旧 FINAL 导出及长日志的修复。旧版记录处理见 [MIGRATION-1.2.1.md](MIGRATION-1.2.1.md)。原 v1.2 项目规范模板可继续使用。

## 安装与配置

执行器解压到项目外的工具目录；规范模板包先解压到临时目录，让 Codex 按 CODEX-SETUP.md 合并进项目。已有 AGENTS.md 和 docs/harness 不直接覆盖。

需要 Windows、Node.js 24、可调用的 Codex CLI、已完成设置的 elevated 沙箱；Git 项目还需 Git。包内 dist/harness.mjs 已编译并包含运行依赖，日常使用无需 npm install 或自行编译。项目使用的 JDK/Maven 等运行时另外按项目检查。

复制 examples/harness.config.yaml 到项目外，填写 executors 下的 base_url、model 和 api_key_env。Key 只填项目外 private_env_file 或本机环境变量；不要发到聊天、写进 YAML、提示词或版本库。base_url 为供应商兼容前缀，例如 https://provider.example/v1，执行器追加 /chat/completions。

多执行者在 executors 下增加命名配置，workflow.active_executor 指定默认，run --executor 明确选择；串行执行，不自动换服务。

## Windows 执行模式

新版模板显式选择 schema_version: '1.3'、sandbox.profile: trusted_local、network: true。这是用户信任项目代码的本机模式：允许普通文件读取和联网，写入限制在检查副本及临时目录；指定原项目、控制目录、私有 Key 文件、Codex 私有目录禁止访问，验收文件只读。它不承诺全面读取隔离或断网。不会修改 Windows 防火墙。

旧配置继续使用 strict 语义，不能因升级自动放宽权限。当前测试机的 Codex CLI 不支持旧根目录拒读策略，因此旧配置会明确阻塞。不要添加全权限参数或用测试适配器绕过 doctor。

## 在 Codex 中使用

发送：请阅读此执行器的 COORDINATOR.md，使用我的配置文件接入目标项目；先 doctor --live、分析代码与规范、运行基线，再按我的需求完成文档、派发、独立验收和返工。没有业务需求时只完成接入。

命令入口为 harness.cmd；所有业务命令使用 --config <项目外配置路径>。`onboard` 整合规范合并及 doctor → init → baseline；随后 prepare --docs → run → verify → inspect → decide。REVISE 后自动重派发，全部功能通过后 FINAL → verify → decide → export。原单步接入命令继续可用。

Codex 桌面外层沙箱可能无法嵌套启动原生沙箱。必要时只为可信 harness 协调者申请宿主执行权限；项目检查仍由执行器进入原生沙箱。用户不需要逐轮搬运 JSON。

## 文件与证据

source_root、work_root、control_root 必须互不包含。规范保存在项目 docs/harness；本轮冻结副本、状态和证据保存在控制目录。执行器包不含 protocol-v1，规范模板包中的固定 1.0 协议副本随项目保存。

v1.2 核对初始化后、测试前后的受测源码摘要。检查改动输入、缺失必需报告、证据过期时均不能通过。构建目录如 target 不进入候选；不能借排除规则删去任务源码或标准。成功退出只产生 unverified，Codex 仍须核对实际断言和场景，零用例不等于业务通过。

每功能每批次最多 10 次提交、连续 3 次无进展暂停；普通恢复保留轮数。成果为待合并差异，不自动合并或发布。详细接口见 RUNTIME.md，已执行检查与限制见 VALIDATION.md，旧版迁移见 MIGRATION-1.2.md。

开发者复现：npm ci、npm run typecheck、npm test、npm run test:host、npm run build。宿主测试应由宿主启动，不能嵌套在外层受限沙箱中。真实模型联调记录与模拟测试分开保存。
