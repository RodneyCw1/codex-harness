# 本项目 Harness 入口

状态：模板刚接入，待 Codex 根据实际项目回填。规范内容随项目保存，本机配置、Key、权威运行状态和原始证据放在项目外。

阅读顺序：[项目画像](project-profile.md) → [协调约定](COORDINATOR.md) → [任务目录](tasks/README.md) → [进度](progress.md) 与 [交接](session-handoff.md)。完整规范在 [protocol-v1](protocol-v1/README.md)，来源记录见 [protocol-source.json](protocol-source.json)。

## 谁负责什么

Codex 理解需求、分析代码、制定实现/验收/测试标准并独立验收。工作 AI 按任务实施和返工。本地执行器调用工作 AI API、提供受控工具、保存真实快照和证据。当前 Codex 会话就是协调者，不需要另配决策模型 API。

## 文档与运行分开保存

- 根 AGENTS.md：合并后的开工入口，保留原项目规则。
- docs/harness：本项目采用的规范、画像、任务文档与脱敏交接；Codex 维护并纳入保护范围。
- 项目外配置：使用 [v1.2 配置示例](config/harness.config.example.yaml)，实际路径由本机配置决定。
- 项目外 work_root：运行器创建的隔离工作树。
- 项目外 control_root：冻结规范、权威状态、原始检查记录和交付证据。

模板没有业务通过结果。原协议目录中的 examples、feature_list、run-state 和 VALIDATION 是原版模板或历史示例，不代表本项目状态。v1.2 的本机配置以上面的 v1.2 示例为准，协议原件里的旧配置仅用于理解兼容格式。

## 新需求

在 tasks 下复制 [_template](tasks/_template/README.md)，填写需求、实现依据、验收行为和真实测试方法。没有具体需求时不要把模板派发给工作 AI。每次只执行一个功能，所有功能完成后还须最终快照验证。

新会话从根 AGENTS.md 开始，核对本机配置和真实 status；换电脑只重新绑定本机环境，不覆盖项目规范或凭空重建旧运行历史。
