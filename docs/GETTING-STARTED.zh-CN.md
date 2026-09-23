# Codex Harness 从零开始：安装、配置与使用

**v1.3 推荐入口：** 使用 `onboard --config <项目外 YAML> --input <接入 JSON> --dry-run` 查看计划，确认输入后去掉 `--dry-run` 完成接入。任务文档可用 `prepare --docs` 直接冻结；`report` 查看过程，`stats` 查看供应商 token 和空间。参数、JSON 示例、JUnit/TAP 登记及迁移见 [v1.3 说明](../codex-harness-executor-v1.2/MIGRATION-1.3.md)。下面保留的手工流程与 v1.2 历史环境说明仍可用于排错；新发行 CLI 版本为 1.3.0，历史测试记录不代表本机预检结果。

[返回中文首页](../README.zh-CN.md) · [English README](../README.md)

本教程适用于 **Codex Harness v1.2.1、Windows、PowerShell 和 Codex 桌面会话**。目标是先让工作模型修复自带加法示例，完成独立验收并导出成果，再把同一流程用于自己的项目。

你负责安装环境、在本机填写 API Key、提供项目路径和需求。Codex 负责分析项目、维护三份任务文档、调用执行器、审查证据和安排返工。执行器本身没有独立聊天界面，也没有关闭会话后继续决策的后台服务。

## 目录

- [0. 操作前先读](#before-you-start)
- [1. 准备运行环境](#environment)
- [2. 下载并摆放文件](#files)
- [3. 配置工作模型](#configuration)
- [4. 运行第一个示例](#first-run)
- [5. 看懂结果并找到成果](#results)
- [6. 接入自己的项目](#your-project)
- [7. 日常使用与恢复](#daily-use)
- [8. 常见问题排查](#troubleshooting)
- [9. 完成检查表与参考资料](#checklist)

<a id="before-you-start"></a>

## 0. 操作前先读

### 三种内容分别放在哪里

| 本教程中的内容 | 你应该在哪里使用 |
|---|---|
| 标为 `powershell` 的命令 | Windows PowerShell 或终端中的 PowerShell 窗口 |
| 标为 `yaml`、`dotenv` 的配置 | 本机文本编辑器，如记事本或 VS Code |
| 标为 `text` 的“发给 Codex”提示词 | 目标项目的 Codex 聊天输入框 |

代码框右上角可复制内容；不要把 Markdown 的三个反引号也粘贴进去。PowerShell 中带引号的可执行文件路径前面需要 `&`，后文已经写好。

路径默认使用 `C:` 盘。若需要改到其他盘，请一致替换命令、配置和提示词中的路径。以下目录名称是示例，不要求你已有同名文件夹。

**本教程采用可信本机模式**：`trusted_local` 与 `network: true` 允许普通文件读取和联网，适用于你信任的项目代码。指定敏感路径和验收文件仍有访问限制；它不等于全面读取隔离或断网。

### 先准备好这些信息

| 信息 | 示例或说明 |
|---|---|
| Codex 使用入口 | 能打开本地项目并运行命令的 Codex 会话 |
| 工作模型 API 地址 | 类似 `https://your-provider.example/v1`，实际值由供应商提供 |
| 工作模型名称 | 供应商 API 的模型 ID，不能直接照搬网页里的展示名称 |
| 工作模型 API Key | 只保存在本机项目外的私有文件中 |

供应商必须支持 **OpenAI Chat Completions 格式、非流式响应、函数工具调用与工具结果回传**。只有聊天网页、只支持其他接口格式或不能连续处理工具消息的服务，不满足本执行器要求。`doctor --live` 会实际探测工具往返，正式任务也会使用 API，可能产生供应商用量。Codex 会话的登录与工作模型 API 配置是两件事。

<a id="environment"></a>

## 1. 准备运行环境

### 1.1 打开 PowerShell

在 Windows 开始菜单搜索 **PowerShell** 并打开。后文写“在 PowerShell 执行”时，都在这个窗口输入；一般操作使用普通窗口即可。安装软件或 Codex elevated 沙箱设置如果出现管理员确认，按实际安装提示处理。

### 1.2 安装 Node.js 24

1. 打开 [Node.js 官方下载页](https://nodejs.org/en/download)。
2. 选择 **24.x** 版本、Windows，以及与你电脑一致的架构，下载安装程序。
3. 完成安装后关闭旧 PowerShell，重新打开；已经运行的 Codex 桌面应用也可能需要重新打开以获得新的 PATH。
4. 执行：

```powershell
node --version
(Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
```

**成功标志**：第一行显示 `v24.x.x`，第二行显示 `node.exe` 的绝对路径。后文配置默认使用 `C:/Program Files/nodejs/node.exe`；若输出不同，使用实际路径。

本执行器检查的是 Node.js 大版本 24，不要把“更高版本”当作等价替代。业务项目自己的 Node.js 或 Java 版本可以不同，应让 Codex 分别绑定实际工具。

**常见问题**：提示找不到 `node`，先重新打开终端；仍失败时检查安装和 PATH。显示其他大版本时，定位 Node.js 24 的 `node.exe`，使用教程第 8 节的绝对路径启动方式。

### 1.3 安装 Git

从 [Git for Windows 官方安装页](https://git-scm.com/install/windows)下载安装程序，选择允许从命令行使用 Git 的 PATH 选项。安装后重新打开 PowerShell，执行：

```powershell
git --version
```

**成功标志**：显示 Git 版本号。即使示例目录没有初始化 Git，最后导出补丁也需要 Git，所以本教程先安装它。无需为了运行示例先创建 GitHub 仓库或执行 `git init`。

### 1.4 确认原生 Codex CLI

先检查本机是否已经有 CLI：

```powershell
Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object Source
```

有输出时，记下 `Source` 路径。如果没有输出，打开 [Codex CLI 官方安装说明](https://learn.chatgpt.com/docs/codex/cli)，在安装区域选择 **Windows**，按当前页面提供的步骤安装，再重新打开 PowerShell。如果你通过其他安装方式取得 CLI，也要找到实际的原生 `codex.exe`；仅有 `codex.ps1` 或 `codex.cmd` 启动包装器时，应定位其底层可执行文件并绑定到 Harness 配置。

找到可执行文件后运行：

```powershell
$CodexExe = (Get-Command codex.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
& $CodexExe --version
& $CodexExe sandbox --help
```

**成功标志**：输出版本和沙箱帮助，其中包含 `--permission-profile`。不同 CLI 可能采用 `sandbox` 或 `sandbox windows` 形式，执行器会识别支持的形式；若帮助列出了 `windows` 子命令，再执行 `& $CodexExe sandbox windows --help` 核对该能力。

发行包历史记录使用 Codex CLI `0.155.0-alpha.16`，这只是已记录的环境，不是对所有版本的兼容承诺。能力检查及稍后的 `doctor --live` 才是当前机器的依据。

**常见问题**：能在某个终端执行 `codex`，但 Harness 找不到它，通常需要在 YAML 的 `sandbox.codex_path` 中填写实际 `codex.exe` 绝对路径。不要照抄其他电脑用户名或会随应用升级变化的安装目录。

### 1.5 完成 elevated 沙箱设置

按 [Windows 沙箱官方说明](https://learn.chatgpt.com/docs/windows/windows-sandbox)完成原生 `elevated` 后端设置。需要检查用户配置时，在本机编辑器打开实际 Codex 配置文件；默认位置为 `%USERPROFILE%\.codex\config.toml`，使用自定义 `CODEX_HOME` 时按实际位置处理。

与此相关的配置片段是：

```toml
[windows]
sandbox = "elevated"
```

若已有 `[windows]` 段，只在该段修改对应设置，不要再追加重复段或覆盖整个配置文件。编辑配置不等于沙箱设置已经完成；还要完成 Codex 提示的初始化流程，并在后面的预检中验证。

Codex 官方说明中的 `unelevated` 是通用备用方式，**Harness v1.2 要求 elevated，不接受这种降级**。官方 elevated 初始化可能涉及本地用户、权限及防火墙等系统设置；Harness 自身不修改防火墙。如果机器策略禁止初始化，需要解决环境限制。

**成功标志**：本节完成工具安装和沙箱设置准备，后续 `doctor --live` 的沙箱结果通过才算 Harness 环境验证成功。

<a id="files"></a>

## 2. 下载并摆放文件

### 2.1 下载仓库 ZIP

在 GitHub 仓库首页点击 **Code → Download ZIP**，右键 ZIP 选择全部解压。打开解压结果，找到同时包含两个组件目录的那一层，将其作为 `C:\Tools\codex-harness` 保存。若外面还有一层类似 `仓库名-main` 的文件夹，不要多套一层。

最终应能找到：

```text
C:\Tools\codex-harness\
├── README.md
├── README.zh-CN.md
├── docs\GETTING-STARTED.zh-CN.md
├── codex-harness-executor-v1.2\
│   ├── harness.cmd
│   ├── dist\harness.mjs
│   └── examples\demo-project\
└── codex-harness-project-template-v1.2\
    ├── CODEX-SETUP.md
    └── project\
```

执行器目录保留 `v1.2` 名称以兼容已有路径，内部程序版本为 **1.2.1**；项目模板与配置仍是 1.2，协议仍是 1.0。

这个目录是**工具仓库**。稍后的 `C:\Projects\harness-demo` 才是本次被修改的**目标项目**，不要混淆两者。

### 2.2 检查执行器入口

在 PowerShell 执行：

```powershell
$Harness = 'C:\Tools\codex-harness\codex-harness-executor-v1.2\harness.cmd'
Test-Path -LiteralPath $Harness
& $Harness --version
& $Harness --help
```

**成功标志**：依次看到 `True`、`1.2.1` 和命令帮助。无需运行 `npm install`、`npm run build` 或双击 `.mjs` 文件。双击 `.cmd` 可能窗口一闪而过，使用 PowerShell 才方便查看输出。

### 2.3 创建示例目录并复制项目

本教程将文件分开放置：

| 路径 | 用途 |
|---|---|
| `C:\Tools\codex-harness` | 工具与模板原包 |
| `C:\Projects\harness-demo` | 加法示例，作为 `source_root` |
| `C:\Harness\config\demo.yaml` | 本次示例的非秘密配置 |
| `C:\Harness\private\work-ai.env` | 本机工作模型 Key |
| `C:\Harness\work\demo` | `work_root`，由执行器建立工作副本 |
| `C:\Harness\control\demo` | `control_root`，保存状态、证据及成果 |

在 PowerShell 执行下面整段。它会创建父目录，且在目标示例目录已存在时停止，避免覆盖旧运行：

```powershell
$DemoSource = 'C:\Tools\codex-harness\codex-harness-executor-v1.2\examples\demo-project'
$DemoTarget = 'C:\Projects\harness-demo'
if (-not (Test-Path -LiteralPath $DemoSource)) {
    throw '没有找到示例原件，请核对解压路径。'
}
if (Test-Path -LiteralPath $DemoTarget) {
    throw '示例目录已存在。请保留现场，从现有进度继续；不要重复复制。'
}
New-Item -ItemType Directory -Force -Path 'C:\Projects', 'C:\Harness\config', 'C:\Harness\private', 'C:\Harness\work', 'C:\Harness\control' | Out-Null
Copy-Item -LiteralPath $DemoSource -Destination $DemoTarget -Recurse
Get-ChildItem -LiteralPath $DemoTarget
```

**成功标志**：目标目录中有 `sum.mjs`、`check.mjs` 和 `README.md`。不要直接在工具包的 `examples` 目录内跑修改流程。

### 2.4 看一次预期的初始失败

在 PowerShell 执行：

```powershell
Set-Location -LiteralPath 'C:\Projects\harness-demo'
node .\check.mjs
$LASTEXITCODE
```

**预期结果是断言失败，退出码非零。** 初始 `sum.mjs` 使用减法，第一项断言要求 `sum(2, 3)` 等于 `5`，实际为 `-1`。这说明待修问题存在。测试遇到第一项失败就会停止，并不表示两项都已经执行。

不要手动修复，也不要改 `check.mjs`。下一步让工作模型修复实现，再由 Codex 独立验收。这里的手动观察不能替代稍后由执行器记录的正式基线。

<a id="configuration"></a>

## 3. 配置工作模型

### 3.1 在本机填写私有 Key 文件

在 PowerShell 执行以下命令，只打开编辑器：

```powershell
notepad.exe 'C:\Harness\private\work-ai.env'
```

若提示创建文件，选择创建。在编辑器写入下面一行，将占位文字替换为你的真实 Key：

```dotenv
WORK_AI_PRIMARY_KEY=把这里替换成真实APIKey
```

保存为 **UTF-8、不带 BOM** 的纯文本文件；文件类型选择“所有文件”，确保名称是 `work-ai.env`，没有额外的 `.txt`。现代记事本的“UTF-8”通常就是不带 BOM 的选项，不要选择“UTF-8 with BOM”。也可以在 VS Code 中明确选择无 BOM 的 UTF-8。

文件格式是 `NAME=value`，变量名前不能有空格，也不要写 `export`、`$env:` 或行尾说明。请在编辑器中检查内容，**不要把 Key 发给 Codex、写进 YAML 或提交到任何仓库**。后面只给 Codex 文件路径，由执行器读取凭据。

**成功标志**：资源管理器显示正确文件名，本机编辑器中已替换占位符。可用 `Test-Path -LiteralPath 'C:\Harness\private\work-ai.env'` 检查存在性，不需要在终端打印内容。

### 3.2 创建完整的单模型配置

在 PowerShell 打开：

```powershell
notepad.exe 'C:\Harness\config\demo.yaml'
```

将下列完整内容粘贴到编辑器。它只适用于本教程的加法示例。保存前修改 `base_url`、`model`、`codex_path`，并核对三处命令里的 `node.exe` 路径。YAML 使用空格缩进，不用 Tab；Windows 路径用单引号包住，示例使用正斜杠。

```yaml
schema_version: '1.2'
private_env_file: 'C:/Harness/private/work-ai.env'

executors:
  primary:
    protocol: openai_chat_completions
    base_url: 'https://your-provider.example/v1'
    api_key_env: WORK_AI_PRIMARY_KEY
    model: 'REPLACE_WITH_YOUR_MODEL_ID'
    request_timeout_seconds: 120
    max_request_retries: 3
    max_tool_calls_per_attempt: 100
    max_attempt_seconds: 1800
    max_context_bytes: 1000000

workflow:
  active_executor: primary
  concurrency: 1
  max_rounds_per_feature: 10
  max_stalled_rounds: 3
  auto_merge: false
  auto_publish: false

project:
  source_root: 'C:/Projects/harness-demo'
  work_root: 'C:/Harness/work/demo'
  control_root: 'C:/Harness/control/demo'
  read_paths: ['**']
  allowed_paths: ['sum.mjs']
  protected_paths: ['AGENTS.md', 'docs/harness/', 'check.mjs']
  command_env_allowlist: []
  commands:
    - id: baseline_check
      argv: ['C:/Program Files/nodejs/node.exe', 'check.mjs']
      cwd: '.'
      timeout_seconds: 30
      purpose: baseline
    - id: feature_check
      argv: ['C:/Program Files/nodejs/node.exe', 'check.mjs']
      cwd: '.'
      timeout_seconds: 30
      purpose: feature
    - id: final_check
      argv: ['C:/Program Files/nodejs/node.exe', 'check.mjs']
      cwd: '.'
      timeout_seconds: 30
      purpose: final
  artifacts: {}

sandbox:
  profile: trusted_local
  codex_path: 'REPLACE_WITH_ABSOLUTE_PATH_TO_CODEX_EXE'
  mode: elevated
  read_roots: []
  network: true
```

保存为 `demo.yaml`，不要保存成 `demo.yaml.txt`。这份配置没有额外测试报告文件要求，因为包内 `check.mjs` 只包含两个断言和成功日志；Codex 必须检查真实断言与执行记录，不能把自动运行摘要称作独立业务测试报告。更复杂项目应按实际检查产物配置 `artifacts` 的 `required` 和 `role`。

### 3.3 对照修改项

| 字段 | 如何填写 | 常见错误 |
|---|---|---|
| `base_url` | 供应商兼容 API 前缀，例如 `https://实际域名/v1` | 填成聊天网页；重复写 `/chat/completions`；地址带 Key 或查询参数 |
| `model` | 供应商支持工具调用的准确模型 ID | 沿用占位符，或填入仅用于网页显示的名称 |
| `api_key_env` | 保持 `WORK_AI_PRIMARY_KEY`，与私有文件左侧名称完全一致 | 把真实 Key 写在这里 |
| `private_env_file` | 私有文件的绝对路径 | 文件名多了 `.txt`，或放进目标项目 |
| `sandbox.codex_path` | 第 1 节找到的实际原生 `codex.exe` 路径 | 写成快捷方式或另一台机器的安装路径 |
| 三条 `argv` 的首项 | Node.js 24 的实际 `node.exe` 路径 | 三处只改了一处，或指向业务项目的其他 Node.js 版本 |
| 三个项目目录 | 与第 2 节保持一致 | 路径互相包含，或多个项目共用同一工作/控制目录 |

可重新执行以下命令查看程序路径，输出不包含你的 Key：

```powershell
(Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
(Get-Command codex.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
Test-Path -LiteralPath 'C:\Harness\config\demo.yaml'
Test-Path -LiteralPath 'C:\Harness\private\work-ai.env'
```

**成功标志**：两个文件存在，API、模型、可执行文件占位符均已替换，目录与实际位置一致。配置写完不表示连接已成功，下一节会由 Codex 运行真实预检。

<a id="first-run"></a>

## 4. 运行第一个示例

### 4.1 在 Codex 桌面应用中打开目标项目

打开 Codex 的项目入口，选择本地目录 `C:\Projects\harness-demo`，在该项目下开始会话。使用直接指向该目录的本地任务即可，Harness 会自行管理它需要的工作副本。

核对会话的当前项目是 **harness-demo**，而不是工具仓库或配置目录。若使用 Codex CLI 会话，也可以先切换到目标目录，再启动 `codex`；下面的提示词同样适用。

### 4.2 复制这段提示词给 Codex

若你改过默认路径，先替换这段提示词中的路径。不要在提示词里追加 Key。

```text
请使用 Codex Harness v1.2.1 完成下面的示例项目接入与修复。

目标项目：C:\Projects\harness-demo
规范模板包：C:\Tools\codex-harness\codex-harness-project-template-v1.2
执行器包：C:\Tools\codex-harness\codex-harness-executor-v1.2
本机配置：C:\Harness\config\demo.yaml
私有凭据：已在本机配置完成，由执行器读取。不要读取或打印私有文件内容。

先阅读模板包 CODEX-SETUP.md、执行器 COORDINATOR.md 和 VALIDATION.md。
请保留已有文件与改动，按接入说明合并项目规范，分析实际代码，
核对 Node.js 24、原生 codex.exe 路径和配置中的固定检查命令。
这份配置明确选择 trusted_local + network:true，用于本示例代码。

业务需求：让 sum(a, b) 返回两个数的和。
工作模型只允许修改 sum.mjs；check.mjs、AGENTS.md 和 docs/harness/
作为受保护输入，不能让工作模型修改验收断言来获得通过。

执行 doctor --live。通过后首次 init，登记并运行 baseline_check。
初始实现是 a - b，check.mjs 的两个断言是 (2,3)=5 和 (-1,1)=0。
基线的预期断言失败属于本次要修复的问题，请如实记录；
环境失败、依赖失败不能当作预期业务失败继续掩盖。

请生成实现、验收、测试文档并冻结任务，使用 primary 工作模型，
按 prepare → run → verify → inspect → decide 推进。
功能验证使用 feature_check；失败时生成返工单并继续范围内修复。
通过后用 FINAL 任务执行 final_check，独立复验并审查两个实际断言，
只有最终 ACCEPT 后才 export。不要直接代替工作模型修改 sum.mjs，
也不要通过降低权限边界或跳过 doctor 绕过环境问题。

请给出实际检查结果、最终 run_id、导出目录和 changes.patch 路径。
到导出为止，不把候选自动合并回原项目，也不提交、推送或发布。
```

**预期过程**：Codex 合并规范并分析项目；执行器预检；记录已知失败基线；工作模型修复；Codex 独立验收；最终复验和导出。工作模型可能一次修好，也可能需要返工，本教程不要求故意制造额外失败轮次。

### 4.3 遇到环境提示怎么处理

如果缺少模型名、配置路径等非秘密信息，提供缺少的值即可。Key 仍在本机文件中修改，不粘贴进会话。

如果 Codex 桌面外层沙箱阻止执行器启动原生沙箱，协调者可能需要对**具体的 Harness 命令**申请宿主运行权限。该进程随后仍会把项目检查放进原生沙箱。不要以关闭项目沙箱、添加全权限参数或改用测试适配器作为解决办法。

若出现 `BLOCK`、`ROUND_LIMIT` 或 `STALLED`，查看 Codex 报告的原因，再按第 8 节排查。暂停不等于已经完成。

**本节成功标志**：有明确的最终 ACCEPT 与导出路径，并且评审能对应到实际执行的两个断言。仅收到“已经修好”的文字，或看到一轮 run 完成，还不算结束。

<a id="results"></a>

## 5. 看懂结果并找到成果

### 5.1 先看这三个结论

| 结论 | 可以证明什么 | 不能直接证明什么 |
|---|---|---|
| 模板已接入 | 规范已合并，项目画像与配置已准备 | 沙箱、API 或测试已通过 |
| `doctor --live` 通过 | 当前配置的沙箱探针与模型工具往返通过 | 当前业务需求已经修复 |
| 最终 ACCEPT 并导出 | Codex 已审查本次最终候选和相应验证证据，导出已生成 | 原项目已经合并、GitHub 已更新或应用已部署 |

### 5.2 手动查看预检与状态

以下操作是需要排查时的辅助方法。正常流程由 Codex 调用即可；不要在它正在执行任务时重复发起预检或另开一轮执行。

在 PowerShell 设置本窗口变量，重新开窗口后要重新设置：

```powershell
$Harness = 'C:\Tools\codex-harness\codex-harness-executor-v1.2\harness.cmd'
$Config = 'C:\Harness\config\demo.yaml'
```

需要重新验证环境、且没有任务正在运行时：

```powershell
& $Harness doctor --config $Config --live
$LASTEXITCODE
```

**成功标志**：JSON 中顶层 `ok` 为 `true`，`result.sandbox.ok` 与 `result.model.ok` 均为 `true`，进程退出码为 `0`。`doctor` 不带 `--live` 时，模型部分可能是 `status: not_run`，那不代表 API 已通过。报告保存在示例控制目录的 `doctor.json`。

初始化以后可以查看状态：

```powershell
& $Harness status --config $Config
```

状态中可查看 `active_run`、各轮 `run_id`、`phase`、`status` 和 `block_reason`。把实际输出交给 Codex 解释即可，不需要手改状态文件。

### 5.3 识别基线与验收结果

- **示例基线**：应记录真实断言失败。首项失败是 `-1` 与 `5` 不相等，这是已知待修问题。
- **修复后检查**：应执行两个断言，正常结束并输出 `两个求和场景均已通过`。Codex 还需检查实现差异及受保护文件，不能只搜索日志里的“通过”二字。
- **verify 完成**：表示独立验证执行过，证据仍需 Codex 评审；运行成功不自动转换为业务通过。
- **FINAL 通过**：全部功能通过后，最终候选又完成对应回归和评审。仅该最终 ACCEPT 运行可导出。

源码改变、必需产物缺失、证据过期或运行环境漂移，都可能导致验收阻塞。应让 Codex 处理具体原因并重新验证，不能手改 JSON 把状态变成通过。

### 5.4 打开导出目录

Codex 应返回类似下面的位置，`run-实际ID` 必须使用它实际返回的值：

```text
C:\Harness\control\demo\exports\run-实际ID\
├── changes.patch
├── before\
├── after\
├── delivery.json
├── RECOVERY.md
└── history\
```

还有与交付对应的规范和验证证据文件，以实际目录为准。

| 文件或目录 | 用途 |
|---|---|
| `changes.patch` | 从接入基线到最终候选的修改差异 |
| `before/` | 导出差异对应的原始快照 |
| `after/` | 最终候选文件，可查看修复后的 `sum.mjs` |
| `delivery.json` | 本次交付的机器可读信息 |
| `RECOVERY.md` | 待合并说明和恢复位置 |
| `history/` 及证据文件 | 各轮任务、评审与验证记录 |

原项目中的 `sum.mjs` 此时仍可能是初始减法实现，因为成果还没有合并。这是正常的。先查看 `after/sum.mjs` 和补丁，再决定是否应用。导出基线可能包含接入时已有的未提交改动，不能不比较就覆盖当前项目。

若要继续合并，在确认要应用这份导出后，可以另行给 Codex 发：

```text
请检查刚才的最终导出与原项目当前文件之间的差异。
核对基线，保留原项目现有改动；如有冲突先说明。
将已验收的修复应用到原项目，并重新运行对应测试。
本次不提交、不推送、不发布。
```

这是一项后续操作，不是 export 已经执行的行为。

<a id="your-project"></a>

## 6. 接入自己的项目

示例跑通后，再进入真实项目。不要直接把 `demo.yaml` 的项目路径换掉后沿用示例状态：真实项目需要自己的配置、工作目录和控制目录。

### 6.1 确认目标与现有文件

先确定实际项目根目录。如果是 Git 仓库，在 PowerShell 执行：

```powershell
git -C 'C:\Projects\my-app' rev-parse --show-toplevel
git -C 'C:\Projects\my-app' status --short
```

将 `C:\Projects\my-app` 替换为实际项目。Git 项目应选择仓库根目录，并且至少已有一个提交；未提交改动由 Codex 识别和保留，不要为了接入而清理掉。没有 Git 的普通项目目录也可建立副本；前面的 Git 查询对它报错属于预期。

### 6.2 使用一套独立路径

下面是命名示例，配置和运行目录由接入过程创建：

| 项目项 | 示例路径 |
|---|---|
| 目标源码 | `C:\Projects\my-app` |
| 非秘密配置 | `C:\Harness\config\my-app.yaml` |
| 工作目录 | `C:\Harness\work\my-app` |
| 控制目录 | `C:\Harness\control\my-app` |
| 私有凭据 | 已在本机填写的 `C:\Harness\private\work-ai.env` |

同一供应商凭据可以继续使用，但三个项目目录、允许修改范围、验收文件和命令必须按真实项目重新确定。不要把示例的 `sum.mjs`、`check.mjs` 或 Node.js 检查命令带到其他项目。

### 6.3 在真实项目会话里发送接入提示词

打开真实项目的 Codex 本地会话，将所有项目路径和模型占位符替换后发送：

```text
请按 Codex Harness v1.2.1 接入我的项目，本次只接入，不执行业务改动。

目标项目：C:\Projects\my-app
规范模板包：C:\Tools\codex-harness\codex-harness-project-template-v1.2
执行器包：C:\Tools\codex-harness\codex-harness-executor-v1.2
新的本机配置：C:\Harness\config\my-app.yaml
独立工作目录：C:\Harness\work\my-app
独立控制目录：C:\Harness\control\my-app
私有凭据文件：C:\Harness\private\work-ai.env
Key 环境变量名：WORK_AI_PRIMARY_KEY
API 前缀：<替换为实际 base_url>
模型 ID：<替换为实际 model>

请阅读模板 CODEX-SETUP.md、执行器 COORDINATOR.md 和 VALIDATION.md。
该项目是我信任的本机代码，配置显式使用 trusted_local + network:true。
保留已有 AGENTS.md、docs/harness/、任务历史与未提交改动，比较后合并，
不要整包覆盖，不修改固定 protocol-v1 原件，不自动 git init 或提交。

根据实际代码、依赖、CI 和测试完善项目画像，区分事实与待确认事项。
参考模板配置创建新的项目外 YAML，核对原生 codex.exe 与 Node.js 24；
业务命令按项目实际工具登记，不要套用示例的 Node.js 检查命令。
初始化依赖时登记 purpose=init 的真实命令，将需要写入的缓存放检查副本。
保护项目规范、独立验收脚本及其可信依赖，按真实测试配置必需产物。
不要读取或打印私有凭据文件内容，由执行器使用该文件。

配置可用后执行 doctor --live。首次接入通过后 init 并运行基线；
如果已有运行状态先 status。缺环境时报告具体缺项，规范分析可先继续。
已有失败、零测试或缺少外部服务必须如实记录，不能宣称业务验收通过。

最后报告规范入口、本机配置路径、实际检查结果及下一步。
本次不生成虚构业务需求，不自动合并、提交、推送或发布。
```

**成功标志**：有合并后的规范、基于真实代码的项目画像、独立配置，以及明确的预检和基线结论。若环境还没通过，应列出缺项，不能因为模板已复制就称“全部可用”。

### 6.4 接入后再提出具体需求

下一条消息可以这样组织：

```text
请使用本项目刚才建立的 Harness 配置完成以下需求。
目标：<用户可观察到的结果>
当前行为：<现在具体发生什么>
期望行为：<希望变成什么>
范围限制：<允许或不允许修改的模块>
验收场景：<至少一个正常场景，以及适用的边界或失败场景>

请按协调者约定完善并冻结实现、验收和测试文档，派发工作模型，
独立验收；需要时继续范围内返工，最终回归通过后导出成果。
```

你提供业务目标，Codex 负责维护文档和协议对象。如果需求本身存在关键歧义，再补充那部分业务决定即可。

<a id="daily-use"></a>

## 7. 日常使用与恢复

### 7.1 以后打开项目先做什么

打开同一个目标项目的 Codex 会话，告诉它项目外配置的路径。已有状态时先 `status`，不要每次重复初始化，也不要重新复制示例或覆盖项目规范。

```text
请继续这个项目的 Harness 工作。
本机配置：C:\Harness\config\my-app.yaml
请先读取项目交接文档和执行器协调者说明，检查 status，
核对已有工作目录、控制目录和最近证据，再继续未完成任务。
不要重新初始化或清理历史，不要读取或打印私有 Key 文件。
```

替换实际配置路径后发送。**成功标志**：Codex 能说明上次停在哪一轮、当前候选与下一步，而不是凭聊天记忆声称任务已通过。

### 7.2 手动查看某一轮

在 PowerShell 中设置实际配置和运行 ID 后执行：

```powershell
$Harness = 'C:\Tools\codex-harness\codex-harness-executor-v1.2\harness.cmd'
$Config = 'C:\Harness\config\demo.yaml'
$RunId = 'REPLACE_WITH_ACTUAL_RUN_ID'
& $Harness status --config $Config --run $RunId
& $Harness inspect --config $Config --run $RunId
```

`$RunId` 来自实际 `status` 或 Codex 的报告，不要自行编造。`inspect` 提供差异与证据预览，原有 `--offset` 字符分页保留。v1.2.1 的 stdout/stderr 完整日志与有限预览分开保存；出现 `PREVIEW_TRUNCATED` 时，从返回的产物中取得实际日志引用：

```powershell
$LogRef = 'REPLACE_WITH_REGISTERED_LOG_REFERENCE'
& $Harness inspect --config $Config --run $RunId --log $LogRef --byte-offset 0
```

按 `next_byte_offset` 继续读取，每页最多 64 KiB。预览末尾没有错误，并不等于完整日志没有错误。一次检查及其初始化默认合计保存 256 MiB，可通过可选的 `project.max_check_log_bytes` 正整数调整；超限或写入失败会保留部分日志并阻止通过，调整后必须重跑检查。

### 7.3 停止与恢复

需要暂停正在运行的任务时，告诉 Codex“请停止当前 Harness 运行，保留状态和证据”。如需在 PowerShell 手动请求停止，先按上一节设置变量和真实运行 ID，再执行：

```powershell
& $Harness stop --config $Config --run $RunId
& $Harness status --config $Config --run $RunId
```

`stop` 是停止请求，需等待运行器处理并用状态确认，不要在请求刚发出时就删除目录或启动另一轮。

普通中断后，先让 Codex 核对状态、残留进程和候选版本，再根据协调者约定使用：

```powershell
& $Harness resume --config $Config --run $RunId
```

`resume` 仅恢复当前功能的最新有效运行；任务引用、批次或规范不匹配时返回 `RUN_STALE`，已取消及已完成运行返回 `RUN_TERMINAL`。当前 BLOCK 处理一次后重新 prepare，旧轮次不会再次改变功能状态。

`resume` 恢复可继续的运行状态，不是启动常驻自动决策服务；后续派发与评审仍由 Codex 会话推进。普通恢复保留轮数；每功能每批次最多 10 轮，连续 3 轮无进展暂停。只有你明确决定继续因预算暂停的工作时，才由 Codex 使用 `--new-batch`，不能通过重置批次隐去失败。

### 7.4 运行中想改需求

发给当前 Codex 会话：

```text
需求有变化：<说明变化>。
请先停止当前运行并等待暂停，核对是否需要 cancel 当前未审批轮。
保留代码、证据和轮数，更新相应规范版本后重新冻结与派发。
请说明哪些旧结论需要重新验证。
```

不要边运行边直接修改配置、验收标准或切换供应商，否则新配置与旧证据可能不匹配。已接受的历史结果也不能通过取消操作改写。

### 7.5 换工作模型

先在本机准备新的模型凭据，再让 Codex 配置不同名称的 executor，按需要选择 `workflow.active_executor` 或 `run --executor 名称`。每轮只选择一个，不会并行工作或自动故障切换。供应商或配置变化时应重新预检并核对冻结状态，不能把旧模型的运行证据套到新轮次。

### 7.6 换电脑或升级工具

保留项目规范，在新电脑重新安装环境、绑定实际可执行文件路径、配置本机 Key，并重新运行 `doctor --live` 和项目基线。工具仓库可重新下载，Key 不随仓库传输。

若要恢复旧运行，需要完整匹配的工作目录、控制记录和候选，并由 Codex 核对。只有项目源码或聊天记录时，应按新的接入/任务处理，不宣称恢复旧运行。升级 Node.js、CLI 或执行器后，旧证据可能失效；让 Codex 依据实际状态重新验证。详见[新电脑说明](../codex-harness-project-template-v1.2/NEW-COMPUTER.md)和[v1.2.1 迁移说明](../codex-harness-executor-v1.2/MIGRATION-1.2.1.md)。

<a id="troubleshooting"></a>

## 8. 常见问题排查

先确定卡在哪一步。需要向 Codex 提供排错信息时，提供错误码、已脱敏错误消息、配置路径和失败阶段即可；不要提供私有 Key 文件内容。

| 现象或错误 | 优先检查 | 处理办法 |
|---|---|---|
| `node` / `git` 不是可识别命令 | 安装是否完成，终端是否继承新 PATH | 重开终端和桌面应用，再用 `Get-Command` 核对路径 |
| `NODE_VERSION` | 执行 Harness 的 Node.js 是否为 24.x | 指定 Node.js 24 的绝对路径，见下方示例 |
| 双击 `harness.cmd` 后窗口消失 | 是否通过 PowerShell 调用 | 在终端用 `& '完整路径\harness.cmd' --help` 查看输出 |
| `npm run build` / `npm test` 提示缺少脚本 | 是否处于执行器目录，版本是否为 1.2.1 | 日常直接运行 `harness.cmd`；开发时进入 `codex-harness-executor-v1.2`，先 `npm ci` |
| 配置文件找不到 | 文件路径、扩展名及 `--config` 参数 | 用 `Test-Path` 检查；去掉误加的 `.txt` |
| YAML 解析错误 / `CONFIG` | 缩进、引号、字段值和三个目录关系 | 用空格缩进，检查同级字段对齐；逐项对照第 3 节 |
| 源、工作、控制目录必须互不包含 | 是否把 work/control 放进项目，或彼此嵌套 | 改为独立目录；已有运行先让 Codex 处理迁移，不直接篡改绑定 |
| `ENV_FILE` | 私有文件格式及编码 | 在本机编辑器改为无 BOM UTF-8、每行 `NAME=value`，不使用 shell 赋值语法 |
| `AUTH_MISSING` / `AUTH_FAILED` / HTTP 401、403 | 本机 Key、变量名、供应商权限 | 在本机修正私有文件；核对模型访问权限，随后重新预检 |
| HTTP 404 / `API_PROTOCOL` | `base_url`、模型 ID、接口与工具消息格式 | 使用兼容前缀而非聊天页面或完整端点；确认该模型确实支持所需工具调用 |
| 429、5xx、请求超时 | 服务可用性、限流和当前用量 | 等服务恢复或处理额度限制；执行器临时错误最多额外重试 3 次，不会自动改用备用模型 |
| `SANDBOX_UNAVAILABLE` | 原生 CLI 路径、elevated 初始化、宿主限制 | 检查实际 `codex.exe` 与沙箱设置，保留真实预检错误 |
| `SANDBOX_CAPABILITY` | CLI 帮助是否有 `--permission-profile` | 使用支持该能力的版本后重新验证；只看到版本号不够 |
| 外层沙箱嵌套启动失败或超时 | 是否由受限桌面工具再次启动原生沙箱 | 由可信协调者对具体 Harness 命令申请宿主执行，项目检查继续使用原生沙箱 |
| `GIT_ROOT` / `GIT_HEAD` | 是否选了仓库根，是否已有提交 | 使用根目录；空 Git 仓库先由项目所有者建立所需初始提交，再接入 |
| `BASELINE_COMMAND` / 测试命令找不到 | 是否登记真实 baseline 命令和实际解释器 | 让 Codex 按项目工具补齐配置，不套用别的项目命令 |
| 加法示例初始基线失败 | 是否是首项 `-1` 与 `5` 不相等 | 记录为已知待修问题，继续既定修复流程；环境失败不属于此情况 |
| 构建成功但测试数为 0 | 检查是否真的执行了测试 | 补齐实际验证方法，不标记业务通过 |
| 初始化依赖失败 | 新检查副本是否缺依赖，缓存写入位置是否正确 | 登记固定 `purpose: init` 命令；所需可写缓存放检查副本，不放宽任意写入权限 |
| `CHECK_INPUT_CHANGED` / 必需产物缺失 | 检查是否修改了源码或验收输入，是否产生真实报告 | 修正检查流程或候选后重跑，不删断言或隐藏报告要求 |
| `ROUND_LIMIT` / `STALLED` | 最近失败项和连续无进展原因 | 先让 Codex 汇总证据，再决定修订需求或明确续跑 |
| `RUN_STALE` / `RUN_TERMINAL` | 是否恢复了旧轮次或终止运行 | 用 status 核对当前运行；已完成返工从 prepare 开始，不重开旧运行 |
| `FINAL_STALE` | 功能、规范、依赖或最终审批是否变化，是否为旧版 FINAL | 提高 FINAL 规范版本，重新准备、运行、验证和评审；不复用旧 delivery.json |
| `LOG_LIMIT_EXCEEDED` / `LOG_WRITE_FAILED` | 日志合计限额、磁盘空间与写入权限 | 保留并查看已保存部分，修复后重跑；不完整日志不能通过 |
| `PROCESS_START_FAILED` | 已登记命令的可执行文件和路径是否存在 | 根据脱敏的真实启动错误修正命令配置，重新准备并检查 |
| export 被拒绝 | 是否只有功能 ACCEPT，尚无最终 ACCEPT | 完成 FINAL 的独立检查与评审；使用最终运行 ID |
| export 成功但原项目没变 | 是否只看了 `source_root` | 查看导出目录的 `after/`；合并回原项目是后续操作 |

### 用 Node.js 24 的绝对路径启动

如果 PATH 中的 `node` 不是 24，但已经安装了 24，可绕过 `harness.cmd` 对 PATH 的依赖，使用等价的已编译入口。替换 `$Node24` 为本机实际位置：

```powershell
$Node24 = 'C:\Program Files\nodejs\node.exe'
$HarnessModule = 'C:\Tools\codex-harness\codex-harness-executor-v1.2\dist\harness.mjs'
& $Node24 --version
& $Node24 $HarnessModule --help
```

确认版本是 24.x 后，业务命令同样可以写成：

```powershell
& $Node24 $HarnessModule status --config 'C:\Harness\config\demo.yaml'
```

此处 `status` 仍要求项目已经初始化。让 Codex 同时将配置里的项目检查解释器绑定到正确版本，不能只改执行器启动命令。

### 提交一条有用的排错信息

```text
我在使用 Codex Harness v1.2.1。
失败阶段：<安装 / doctor / baseline / run / verify / export>
配置路径：<项目外配置的绝对路径>
Node.js 版本：<node --version 输出>
Codex CLI 版本：<实际 CLI --version 输出>
错误码和脱敏错误信息：<实际内容>
最近改动：<换路径、换模型、升级工具，或没有>
请先核对状态与实际日志，不删除已有工作目录和控制记录。
```

<a id="checklist"></a>

## 9. 完成检查表与参考资料

跑通示例后，你应该能逐项确认：

- [ ] 使用 Windows、Node.js 24，并能调用 Git 和原生 Codex CLI。
- [ ] 两个原包在目标项目之外，三个运行目录互不包含。
- [ ] Key 只保存在本机项目外，配置和提示词没有真实密钥。
- [ ] `doctor --live` 的沙箱与模型结果都通过。
- [ ] 示例基线记录了真实的预期断言失败。
- [ ] 工作模型只修改允许的实现文件，验收脚本保持受保护。
- [ ] Codex 审查了功能验证与 FINAL 验证中的两个实际断言。
- [ ] 找到最终导出目录、`changes.patch` 和 `after/`，知道成果尚未自动合并。

上述项目是你本机的完成标准，**不是本教程宣称已经替你跑过的结果**。随包历史记录中的真实模型联调使用另一套四用例项目；本教程使用的 `examples/demo-project` 是两个断言，不混用测试数量或结论。

### 项目内参考

- [项目接入步骤](../codex-harness-project-template-v1.2/CODEX-SETUP.md)：让 Codex 合并模板、分析项目和配置环境。
- [协调者执行约定](../codex-harness-executor-v1.2/COORDINATOR.md)：任务、返工、最终验收和恢复的正式约定。
- [运行接口说明](../codex-harness-executor-v1.2/RUNTIME.md)：完整命令及状态、权限边界。
- [配置示例](../codex-harness-executor-v1.2/examples/harness.config.yaml)：多个执行者等扩展示例。
- [历史验证记录](../codex-harness-executor-v1.2/VALIDATION.md)：既有检查与限制。

### 外部工具官方说明

- [Node.js 下载](https://nodejs.org/en/download)
- [Git for Windows 安装](https://git-scm.com/install/windows)
- [Codex CLI 安装与登录](https://learn.chatgpt.com/docs/codex/cli)
- [Codex 配置文件](https://learn.chatgpt.com/docs/config-file/config-basic)
- [Windows 原生沙箱设置](https://learn.chatgpt.com/docs/windows/windows-sandbox)

外部工具页面可能更新；以实际安装页面、CLI 帮助和本机预检为准。项目 v1.2 的 Windows、Node.js 24、elevated 及显式权限 profile 要求，以本包实现为准。
