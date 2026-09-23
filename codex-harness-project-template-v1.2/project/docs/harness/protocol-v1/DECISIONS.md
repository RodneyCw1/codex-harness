# 设计决定与依据

状态：接受 · 版本1.0.0 · 2026-09-17

## ADR-001：Codex决策与验收，外部AI执行

用户希望Codex结合既有项目做技术决策，并使用可配置的其他模型执行。采用协调者模式：Codex输出明确任务，执行者返回候选，验证器产生事实，Codex作最终判断。验证阶段使用专门的评审上下文，以冻结规范、实际差异和工具证据为依据。

这样保留项目理解与通过权，同时支持替换执行模型。代价是必须维护任务合同和独立验证通道。执行者自评不能改变状态。

## ADR-002：文档与运行存储分工

项目文档负责共享规则、实现方案和交接；受信运行存储保存不可变规范、候选、证据、结论与权威状态。Markdown进度只作为状态摘要。

这使恢复不依赖聊天，同时避免执行者修改完成状态。仅用同一可写目录存放所有文件无法落实隔离，因此接入必须建立进程和文件权限。

## ADR-003：首版固定Chat Completions工具调用

执行模型使用OpenAI兼容Chat Completions协议，通过base_url、环境密钥名和model切换服务。首版不自动推测或转换其他协议。接口能力在启动时探测，本地工具校验始终执行。

这一选择来自用户确认，不是对所有兼容服务的能力保证。未来新增协议须显式增加适配器及接入测试。

## ADR-004：有界自动返工，可继续的暂停

默认每功能每批次10次候选提交，连续3轮无进展暂停。第10轮若通过仍接受。暂停保留工作，用户明确续跑才新建批次；中断不清零。

这满足自动推进目标，并使故障循环可以诊断。限额、进展计算、最终检查特殊轮号均为本规范新增约定，不宣称来源模板已规定这些细节。

## ADR-005：内容快照约束验收结果

验收绑定规范摘要、代码快照、命令、环境及提交，不只绑定Git HEAD。未提交修改、未跟踪文件和运行依赖可能改变结果，因此只记录commit不足以证明当前候选通过。

最终整体检查使用独立final阶段，避免把各功能不同历史快照的通过结果拼成整体通过。

## 参考资料与适用范围

- [Harness模板指南](https://github.com/walkinglabs/learn-harness-engineering/blob/main/docs/zh/resources/templates/index.md)：项目规则、状态、功能范围和交接的基础。
- [防止agent提前宣告完成](https://walkinglabs.github.io/learn-harness-engineering/zh/lectures/lecture-09-why-agents-declare-victory-too-early/)：使用执行证据和完整场景确认完成。
- [从手动驱动到自动循环](https://walkinglabs.github.io/learn-harness-engineering/zh/lectures/lecture-13-loop-engineering/)：目标、验证与停止条件的闭环思想。本包不依赖该文对某个产品命令的可用性描述。
- [OpenAI Function calling](https://developers.openai.com/api/docs/guides/function-calling)：模型工具请求与工具结果的消息关联；宿主负责实际执行。
- [Codex非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)：脚本接入及结构化输出能力；需自行安装并验证实际环境。

本包以自主编写的中文规范和模板落实用户确认的方案，未整体复制上述模板。JSON Schema、目录布局、协议字段与运行计数规则属于本包设计。
