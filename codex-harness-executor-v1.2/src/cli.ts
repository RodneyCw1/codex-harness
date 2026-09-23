#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig, Secrets } from "./config.ts";
import { parse } from "yaml";
import { Block, ensure, readJson, within } from "./files.ts";
import { WindowsSandbox } from "./sandbox.ts";
import { doctor } from "./doctor.ts";
import { onboard, promptOnboard, type OnboardInput } from "./onboarding.ts";
import { buildReport, refreshReports } from "./reporting.ts";
import { storageStats, usageStats } from "./telemetry.ts";
import { initialize } from "./workspace.ts";
import { Engine } from "./engine.ts";
const help = `Codex Harness 1.3.0 — Node.js 24 / Windows
用法：harness <命令> --config <项目配置.yaml> [参数]
  init --project <目录>          创建项目事实清单与独立工作区
  doctor [--live] [--executor ID] 实测沙箱，--live 探测模型工具往返
  onboard [--input <JSON>] [--dry-run]  交互或参数接入；默认预检、初始化及基线
    --project <目录> --template <模板包> --work-root <目录> --control-root <目录>
    --executor <名称> --base-url <URL> --model <ID> --api-key-env <变量名>
    [--private-env-file <项目外私有文件>] [--codex-path <codex.exe>]
  prepare --task <draft.json> [--docs <项目相对目录>]  冻结三份文档
  report [--run <ID>] [--refresh] [--sync]  查询、重建报告或同步摘要
  stats [--run <ID>]             供应商用量和项目当前空间统计
  baseline                      独立记录接入时基线验证
  run --task <控制目录任务路径> [--executor ID]
  verify --run <ID>              独立运行冻结候选的所有测试
  decide --run <ID> --review <JSON> [--rework <JSON>]
  status [--run <ID>]
  inspect --run <ID> [--offset N] 向 Codex 返回规范、差异与分页验证日志
  inspect --run <ID> --log <引用> [--byte-offset N] 读取完整日志（每页最多64KiB）
  stop --run <ID>
  cancel --run <ID> --reason <说明>  取消已停止的当前轮，保留代码、计数和证据
  resume --run <ID> [--new-batch]
  export --run <ID>              仅最终验收通过后导出待合并成果
stdout 为 JSON；stderr 为中文摘要与 JSON 阶段事件。
密钥只从环境变量或项目外 private_env_file 读取。`;
let secrets = new Secrets([]);
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: "string" },
      input: { type: "string" },
      template: { type: "string" },
      "work-root": { type: "string" },
      "control-root": { type: "string" },
      "base-url": { type: "string" },
      model: { type: "string" },
      "api-key-env": { type: "string" },
      "private-env-file": { type: "string" },
      "codex-path": { type: "string" },
      "dry-run": { type: "boolean" },
      docs: { type: "string" },
      refresh: { type: "boolean" },
      sync: { type: "boolean" },
      project: { type: "string" },
      task: { type: "string" },
      executor: { type: "string" },
      run: { type: "string" },
      review: { type: "string" },
      rework: { type: "string" },
      resolved: { type: "string" },
      reason: { type: "string" },
      offset: { type: "string" },
      log: { type: "string" },
      "byte-offset": { type: "string" },
      live: { type: "boolean" },
      "new-batch": { type: "boolean" },
      help: { type: "boolean" },
      version: { type: "boolean" },
    },
  });
  if (values.help || (positionals.length === 0 && !values.version)) {
    console.log(help);
    return;
  }
  if (values.version) {
    console.log("1.3.0");
    return;
  }
  ensure(
    Number(process.versions.node.split(".")[0]) === 24,
    "NODE_VERSION",
    "需要 Node.js 24",
  );
  if (positionals[0] === "onboard") {
    let input: OnboardInput = values.input ? await readJson(values.input) : {};
    if (!input.config && values.config)
      input.config = await fs
        .readFile(values.config, "utf8")
        .then(parse)
        .catch((e) => {
          if (e.code === "ENOENT") return {};
          throw e;
        });
    input.config ??= {};
    input.config.project ??= {};
    if (values.project)
      input.config.project.source_root = path.resolve(values.project);
    if (values.template) input.template_root = path.resolve(values.template);
    if (values["work-root"])
      input.config.project.work_root = path.resolve(values["work-root"]);
    if (values["control-root"])
      input.config.project.control_root = path.resolve(values["control-root"]);
    if (values["private-env-file"])
      input.config.private_env_file = path.resolve(values["private-env-file"]);
    if (values["codex-path"])
      input.config.sandbox = {
        profile: "trusted_local",
        network: true,
        ...input.config.sandbox,
        codex_path: path.resolve(values["codex-path"]),
      };
    const name =
      values.executor ??
      input.config.workflow?.active_executor ??
      Object.keys(input.config.executors ?? {})[0] ??
      "primary";
    if (values.model || values["base-url"] || values["api-key-env"]) {
      input.config.executors ??= {};
      input.config.executors[name] ??= { protocol: "openai_chat_completions" };
      const e = input.config.executors[name];
      if (values.model) e.model = values.model;
      if (values["base-url"]) e.base_url = values["base-url"];
      if (values["api-key-env"]) e.api_key_env = values["api-key-env"];
    }
    if (values.executor)
      input.config.workflow = {
        ...input.config.workflow,
        active_executor: name,
      };
    let file = values.config;
    if (
      process.stdin.isTTY &&
      (!file ||
        !input.config.project.source_root ||
        !Object.keys(input.config.executors ?? {}).length)
    ) {
      const prompted = await promptOnboard(file, input);
      file = prompted.file;
      input = prompted.input;
    }
    ensure(file, "CONFIG", "请指定 --config");
    const result = await onboard(file, input, values["dry-run"]);
    console.log(
      JSON.stringify({ ok: result.ok, command: "onboard", result }, null, 2),
    );
    if (!result.ok && !result.dry_run) process.exitCode = 2;
    return;
  }
  ensure(values.config, "CONFIG", "请指定 --config");
  const loaded = await loadConfig(values.config);
  secrets = loaded.secrets;
  const { config, vars } = loaded;
  if (values.project) config.project.source_root = path.resolve(values.project);
  for (const a of [config.project.work_root, config.project.control_root])
    ensure(
      !within(config.project.source_root, a) &&
        !within(a, config.project.source_root),
      "CONFIG",
      "项目目录不可与控制/工作目录重叠",
    );
  const runner = new WindowsSandbox(config, vars, secrets);
  const engine = new Engine(config, vars, secrets, runner, (e) =>
    console.error(JSON.stringify(secrets.clean(e))),
  );
  const command = positionals[0];
  let result: unknown;
  const need = (name: "run" | "task" | "review") => {
    ensure(values[name], "ARGUMENT", "缺少 --" + name);
    return values[name]!;
  };
  console.error("Harness：" + command + " 开始");
  switch (command) {
    case "init":
      result = await initialize(config, secrets);
      break;
    case "report":
      if (values.run)
        ensure((await engine.db()).runs[values.run], "RUN", "运行不存在");
      result =
        values.refresh || values.sync
          ? await engine.store.lock(() => refreshReports(engine, values.sync))
          : await buildReport(engine, values.run);
      break;
    case "stats":
      if (values.run)
        ensure((await engine.db()).runs[values.run], "RUN", "运行不存在");
      result = {
        usage: await usageStats(engine.store.root, values.run),
        storage: await storageStats(
          config.project.work_root,
          engine.store.root,
        ),
      };
      break;
    case "doctor": {
      result = await doctor(engine, values.live, values.executor);
      break;
    }
    case "prepare":
      result = await engine.prepare(await readJson(need("task")), values.docs);
      break;
    case "run": {
      let task = need("task");
      if (path.isAbsolute(task)) {
        ensure(
          within(config.project.control_root, task),
          "TASK",
          "任务必须位于控制目录",
        );
        task = path
          .relative(config.project.control_root, task)
          .replaceAll("\\", "/");
      }
      result = await engine.start(task, values.executor);
      break;
    }
    case "verify":
      result = await engine.verify(need("run"));
      break;
    case "decide":
      result = await engine.decide(
        need("run"),
        await readJson(need("review")),
        values.rework ? await readJson(values.rework) : undefined,
        values.resolved ? await readJson(values.resolved) : [],
      );
      break;
    case "status":
      result = await engine.status(values.run);
      break;
    case "baseline":
      result = await engine.baseline();
      break;
    case "inspect":
      ensure(
        !values["byte-offset"] || values.log,
        "ARGUMENT",
        "--byte-offset 需要 --log",
      );
      ensure(
        !values.log || values.offset === undefined,
        "ARGUMENT",
        "--log 使用 --byte-offset，不能与 --offset 混用",
      );
      result = values.log
        ? await engine.inspectLog(
            need("run"),
            values.log,
            Number(values["byte-offset"] ?? 0),
          )
        : await engine.inspect(need("run"), Number(values.offset ?? 0));
      break;
    case "stop":
      result = await engine.stop(need("run"));
      break;
    case "cancel":
      ensure(values.reason, "CANCEL_REASON", "请指定 --reason");
      result = await engine.cancel(need("run"), values.reason);
      break;
    case "resume":
      result = await engine.resume(need("run"), values["new-batch"]);
      break;
    case "export":
      result = await engine.export(need("run"));
      break;
    default:
      throw new Block("COMMAND", "未知命令；使用 --help");
  }
  const ok = (result as any)?.ok !== false;
  console.error("Harness：" + command + (ok ? " 完成" : " 完成，存在阻塞"));
  console.log(JSON.stringify(secrets.clean({ ok, command, result }), null, 2));
  if (!ok) process.exitCode = 2;
}
main().catch((e) => {
  const error = secrets.clean({
    ok: false,
    error: {
      code: e instanceof Block ? e.code : "UNEXPECTED",
      message: e.message,
    },
  });
  console.error("Harness：已阻塞，状态与历史记录保留。" + error.error.message);
  console.log(JSON.stringify(error, null, 2));
  process.exitCode = 2;
});
