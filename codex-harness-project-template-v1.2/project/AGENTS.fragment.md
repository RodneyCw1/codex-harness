<!-- CODEX_HARNESS_START -->
## Codex Harness 项目工作流

先读取 [工作流入口](docs/harness/README.md)、[项目画像](docs/harness/project-profile.md)、[协调约定](docs/harness/COORDINATOR.md) 和 [交接](docs/harness/session-handoff.md)。保留并遵守项目已有规范以及当前目录适用的更具体指令。

- 项目有 `.codegraph/` 时，理解和定位代码先用 CodeGraph；否则使用常规搜索，不自动创建索引。
- Codex 分析实际代码和需求，编写实现、验收和测试文档，建立 REQ → AC → TC → 证据映射；外部工作 AI 只实施，Codex 保留最终通过权。
- 文档保存在项目 docs/harness；三份文档使用一致的 task_id/spec_version 元数据，通过 prepare --docs 从项目目录直接冻结，旧执行器才使用手工控制输入。不要把模板示例、状态摘要当权威运行状态。
- 每次只推进一个功能。工作 AI 不得修改 AGENTS.md、docs/harness、可信验收标准或控制目录。文件权限由执行器及宿主落实，提示词不能代替隔离。
- 只有当前代码和规范下的独立证据可以支持通过。工作 AI 自报完成只触发验收；最终交付还须整体检查。
- 每功能每批次最多 10 次提交，连续 3 轮无进展暂停；保留状态，不擅自重置计数。范围内自动返工，阻塞时报告真实原因。
- Key 保存在项目外，项目命令不继承工作 AI Key。不得绕过失败的沙箱检查。未配置服务时可先完成分析与文档。
- 交付待合并成果，提交、推送、合并和发布按用户明确授权执行。
<!-- CODEX_HARNESS_END -->
