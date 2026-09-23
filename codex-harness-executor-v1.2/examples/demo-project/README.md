# 真实模型联调用的小项目

这是故意带一个错误的小项目，不是已经通过的交付代码。需求：使 sum(a,b) 返回两个数的和，并保持验收脚本不变。运行 `node check.mjs` 可以看到当前失败。

在独立配置中把 source_root 指向本目录副本，allowed_paths 设为 `['sum.mjs']`，protected_paths 设为 `['check.mjs']`，登记基线、功能与最终命令 `[node.exe 的绝对路径, 'check.mjs']`，再让 Codex 按 COORDINATOR.md 接入。基线失败属于本需求要修复的已知问题，应如实记录。需要本机 doctor 通过以及真实工作 AI 配置。
