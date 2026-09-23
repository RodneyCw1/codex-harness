# 测试文档（模拟案例）

TASK-DEMO，规范版本1，环境ENV-DEMO。所列命令仅说明假想Python项目，不适用于所有项目。本包没有运行这些命令。

|TC|AC|command_id|数据与预期|
|---|---|---|---|
|TC-001|AC-001|check_normal|两个前后空格包围的 A B → A B|
|TC-002|AC-002|check_empty|空串、三个空格 → ValidationError|

无数据库及外部服务依赖，初始化假定虚拟环境就绪。每项保存退出码和日志。最终快照重跑两项，并执行 final_regression 命令覆盖既有调用链。模拟日志均带 SIMULATED 标记，不能证明实际通过。
