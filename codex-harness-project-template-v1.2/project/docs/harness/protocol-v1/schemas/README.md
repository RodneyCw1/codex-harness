# Schema使用说明

- [contracts.schema.json](contracts.schema.json)：Draft 2020-12，涵盖task、execution_report、verification_evidence、review、rework、feature_list、run_state。
- [config.schema.json](config.schema.json)：配置结构；YAML先解析为对象，再校验。

contracts的根使用oneOf按kind区分对象，公共结构位于$defs。调用方可验证整个根schema；只验证某一种对象时使用对应的 `#/$defs/review` 等引用，保留完整本地定义。

调用模型服务的结构化输出功能时，需根据实际服务支持的JSON Schema子集生成适配版本；不能假设供应商接受该文件的全部关键词。无论远端如何限制输出，本地都要按完整合同及 [协议语义](../PROTOCOL.md) 再检查。

配置模板允许变量引用和REPLACE占位，因此结构通过不表示可运行。派发前须展开变量并拒绝空值、未替换占位、无效URL/路径/命令和不匹配的工具能力。

所有示例均为illustrative。类型校验不证明审批来源、日志真实、文件摘要正确或当前快照一致。实际验收必须来自live受信通道并通过协议规定的语义闸门。
