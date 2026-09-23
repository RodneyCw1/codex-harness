# 升级与恢复 v1.2

1. 停止活动运行并保留控制/工作目录。备份旧执行器和非秘密配置；不复制或打印私有 Key。
2. 用新版源码、dist、schema、脚本和说明更新项目外执行器。原 harness.cmd 路径可以不变。
3. 只有已明确接受普通文件读取和联网的可信项目，才将配置改为 1.2 并设置 sandbox.profile: trusted_local、network: true。旧配置缺少 profile 时仍为 strict。
4. 运行 doctor --live。报告分别列出运行时、目录保护、网络预期和模型往返，失败不得宣称接入就绪。新的运行时/配置指纹不能沿用旧证据；停止未审批旧轮、cancel 后修订规范再派发。
5. 未初始化项目执行 init；中断后重试会沿初始化意图复用工作区。已初始化时返回同一事实记录，不重建或覆盖工作区。源基线已变时保持阻塞，由 Codex 核对后决定接入新批次，不能删历史冒充恢复。
6. Windows 使用内核互斥量单写入，writer.lock 仅用于诊断；空/损坏旧锁不再使 JSON 解析崩溃。检测到活跃旧进程仍阻塞。Windows 隐藏持锁辅助进程异常退出会停止后续状态写入；进程崩溃后锁由系统释放。
7. transaction.json 保存未完成状态事务；下一次持锁操作核对版本和摘要再完成提交。transactions 中的独立事务记录是事件索引的依据。普通 resume 保留提交计数，只有明确续跑预算暂停使用 --new-batch。

project.generated_dirs 接受目录名，默认含 target、.codegraph、.harness-tmp；既有依赖与构建排除仍保留。不能指定路径、通配符，不能覆盖明确的任务范围/保护范围。若项目确实把源码放在这些目录中，先由 Codex 调整布局或规则，不能忽略源码获得通过。

必需产物示例：project.artifacts.test 下登记 {path: 'target/result.json', type: report, required: true, role: 'assertion-results'}。path 是检查副本相对路径；role 说明其验收用途。缺失时 REQUIRED_ARTIFACT，执行器自己的报告不能替代。旧 required_artifact_types 仍兼容，具体业务必须登记真实报告并检查测试数量。

inspect --offset N 返回每个日志最多50000字符、truncated、next_offset 和 total_chars；按 next_offset 继续读取，不能把预览当成全部证据。
