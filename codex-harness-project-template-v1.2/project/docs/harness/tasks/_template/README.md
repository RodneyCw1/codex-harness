# 任务模板：复制后填写

复制本目录为实际任务 ID，并由 Codex 填写 [实现](implementation.md)、[验收](acceptance.md)、[测试](test-plan.md)。所有占位内容均须解决；未确定的业务含义应询问用户，实施细节优先根据项目推导。

三份文档 front matter 的 task_id/spec_version 与 draft 保持一致；可选 feature_id 若出现也必须一致。实际 task draft 使用执行器 examples/task.draft.json；v1.3 使用 prepare --docs <项目相对任务目录> 自动冻结三份文档，旧执行器才复制到控制输入。没有真实验收方法时不能派发。
