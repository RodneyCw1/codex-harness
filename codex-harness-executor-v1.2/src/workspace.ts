import fs from "node:fs/promises";
import path from "node:path";
import { type Config, Secrets, commandEnvironment } from "./config.ts";
import { Store } from "./store.ts";
import {
  ensure,
  exists,
  snapshot,
  copySnapshot,
  atomic,
  id,
  safePath,
  within,
  hash,
  digest,
} from "./files.ts";
import { processRun } from "./process.ts";
export async function initialize(config: Config, secrets: Secrets) {
  const p = config.project;
  await safePath(path.dirname(p.source_root), path.basename(p.source_root));
  for (const root of [p.work_root, p.control_root])
    await safePath(path.dirname(root), path.basename(root));
  const store = new Store(p.control_root);
  return store.lock(async () => {
    if (await exists(store.file("project.json"))) {
      const project = await store.read("project.json");
      ensure(
        path.resolve(project.source_root).toLowerCase() ===
          p.source_root.toLowerCase(),
        "SOURCE_CONFIG_CHANGED",
        "配置与已初始化项目不同",
      );
      return project;
    }
    await fs.mkdir(p.work_root, { recursive: true });
    const base = await snapshot(p.source_root, p.generated_dirs);
    const oldIntent = (await exists(store.file("initialization.json")))
      ? await store.read("initialization.json")
      : null;
    const rootsDigest = digest({
      source: p.source_root,
      work: p.work_root,
      control: p.control_root,
      generated: p.generated_dirs,
    });
    ensure(
      !oldIntent ||
        (oldIntent.baseline === base.id &&
          oldIntent.roots_digest === rootsDigest),
      "INIT_BASELINE_CHANGED",
      "初始化中断后源文件或目录配置变化；保留原工作区，需协调者核对",
    );
    const workspace =
      oldIntent?.workspace ?? path.join(p.work_root, "workspace-" + id("ws"));
    const intent = oldIntent ?? {
      operation_id: id("init"),
      workspace,
      baseline: base.id,
      roots_digest: rootsDigest,
      stage: "intent",
    };
    await store.put("initialization.json", intent);
    let gitCommit: string | null = null;
    let mode = "copy";
    const gitEnv = {
      ...commandEnvironment(config, process.env, p.work_root),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    };
    const git = await processRun(
      ["git", "-C", p.source_root, "rev-parse", "--show-toplevel"],
      {
        cwd: p.source_root,
        env: gitEnv,
        timeoutMs: 10000,
      },
    ).catch(() => null);
    if (git?.exitCode === 0) {
      ensure(
        path.resolve(git.stdout.trim()).toLowerCase() ===
          p.source_root.toLowerCase(),
        "GIT_ROOT",
        "请指定 Git 仓库根目录",
      );
      const r = await processRun(
        ["git", "-C", p.source_root, "rev-parse", "HEAD"],
        { cwd: p.source_root, env: gitEnv, timeoutMs: 10000 },
      );
      ensure(r.exitCode === 0, "GIT_HEAD", "Git 项目必须至少有一个提交");
      gitCommit = r.stdout.trim();
      ensure(
        !intent.git_commit || intent.git_commit === gitCommit,
        "INIT_BASELINE_CHANGED",
        "初始化后 Git HEAD 已变化",
      );
      intent.git_commit = gitCommit;
      await store.put("initialization.json", intent);
      if (await exists(path.join(workspace, ".git"))) {
        const existing = await processRun(
          ["git", "-C", workspace, "rev-parse", "HEAD"],
          { cwd: workspace, env: gitEnv, timeoutMs: 10000 },
        );
        ensure(
          existing.exitCode === 0 && existing.stdout.trim() === gitCommit,
          "INIT_WORKSPACE_CHANGED",
          "已创建 worktree 与初始化意图不一致",
        );
      } else {
        const add = await processRun(
          [
            "git",
            "-c",
            "core.hooksPath=NUL",
            "-C",
            p.source_root,
            "worktree",
            "add",
            "--detach",
            "--no-checkout",
            workspace,
            gitCommit,
          ],
          { cwd: p.source_root, env: gitEnv, timeoutMs: 20000 },
        );
        ensure(
          add.exitCode === 0,
          "GIT_WORKTREE",
          "无法创建独立 worktree: " + secrets.clean(add.stderr),
        );
      }
      mode = "git-worktree";
    }
    await copySnapshot(p.source_root, workspace, base);
    intent.stage = "copied";
    await store.put("initialization.json", intent);
    if (mode === "git-worktree") {
      const index = await processRun(
        ["git", "-C", workspace, "read-tree", "HEAD"],
        { cwd: workspace, env: gitEnv, timeoutMs: 10000 },
      );
      ensure(index.exitCode === 0, "GIT_INDEX", "无法初始化独立 worktree 索引");
    }
    ensure(
      (await snapshot(workspace, p.generated_dirs)).id === base.id,
      "BASELINE",
      "工作区基线复制不一致",
    );
    await copySnapshot(p.source_root, store.file("baseline"), base);
    await store.put("baseline-manifest.json", base);
    const files = base.files.map((f) => f.path);
    const codegraph = await exists(path.join(p.source_root, ".codegraph"));
    const ancestorInstructions = [];
    for (let dir = path.dirname(p.source_root); ; dir = path.dirname(dir)) {
      const file = path.join(dir, "AGENTS.md");
      if (await exists(file)) {
        const content = await fs.readFile(file, "utf8");
        secrets.assertSafe(content);
        ancestorInstructions.unshift({
          path: file,
          sha256: hash(content),
          content,
        });
      }
      if (path.dirname(dir) === dir) break;
    }
    const facts = {
      artifact_mode: "live",
      source_root: p.source_root,
      workspace,
      mode,
      git_commit: gitCommit,
      baseline_snapshot: base.id,
      files,
      excluded: base.exclusions,
      instructions: files.filter((x) => /(^|\/)(AGENTS|CLAUDE)\.md$/i.test(x)),
      dependencies: files.filter((x) =>
        /(^|\/)(package\.json|.*lock.*|pyproject\.toml|requirements.*\.txt|Cargo\.toml|go\.mod|pom\.xml|.*\.csproj)$/i.test(
          x,
        ),
      ),
      ci: files.filter(
        (x) =>
          x.startsWith(".github/workflows/") ||
          /gitlab-ci|azure-pipelines|Jenkinsfile/.test(x),
      ),
      codegraph_present: codegraph,
      ancestor_instructions: ancestorInstructions,
      analysis_status:
        "Codex 必须结合有效指令、实现和实际基线检查完成分析；此文件仅包含目录事实",
    };
    await store.put("inventory.json", facts);
    const project = {
      ...facts,
      created_at: new Date().toISOString(),
      active_run: null,
    };
    await store.put("features.json", {});
    await fs.mkdir(store.file("inputs"), { recursive: true });
    await atomic(
      store.file("inputs/project-profile.md"),
      "# 项目画像（由 Codex 回填）\n\n基于 ../inventory.json，分析架构、项目约束、初始化命令及验证基线。\n\n" +
        (codegraph
          ? "发现 .codegraph/；理解和定位代码前先用 CodeGraph。\n"
          : "未发现 .codegraph/，使用常规代码搜索；不自动建索引。\n"),
    );
    await atomic(
      store.file("CODEX.md"),
      "# 协调者入口\n\n请按照发行包 COORDINATOR.md 在当前 Codex 会话执行分析、prepare、run、verify、decide 和返工循环。\n项目原目录不得交给工作 AI 直接写入。\n",
    );
    await store.event("initialized", { workspace, baseline: base.id, mode });
    await store.put("project.json", project);
    intent.stage = "completed";
    await store.put("initialization.json", intent);
    return project;
  });
}
