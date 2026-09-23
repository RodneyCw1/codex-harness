#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig, Secrets } from "./config.ts";
import { Block, ensure, readJson, within, atomic } from "./files.ts";
import { WindowsSandbox } from "./sandbox.ts";
import { ModelClient } from "./api.ts";
import { initialize } from "./workspace.ts";
import { Engine } from "./engine.ts";
const help = `Codex Harness 1.2 — Node.js 24 / Windows
用法：harness <命令> --config <项目配置.yaml> [参数]
  init --project <目录>          创建项目事实清单与独立工作区
  doctor [--live] [--executor ID] 实测沙箱，--live 探测模型工具往返
  prepare --task <draft.json>    由 Codex 冻结规范、填充快照和协议字段
  baseline                      独立记录接入时基线验证
  run --task <控制目录任务路径> [--executor ID]
  verify --run <ID>              独立运行冻结候选的所有测试
  decide --run <ID> --review <JSON> [--rework <JSON>]
  status [--run <ID>]
  inspect --run <ID> [--offset N] 向 Codex 返回规范、差异与分页验证日志
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
      project: { type: "string" },
      task: { type: "string" },
      executor: { type: "string" },
      run: { type: "string" },
      review: { type: "string" },
      rework: { type: "string" },
      resolved: { type: "string" },
      reason: { type: "string" },
      offset: { type: "string" },
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
    console.log("1.2.0");
    return;
  }
  ensure(
    Number(process.versions.node.split(".")[0]) === 24,
    "NODE_VERSION",
    "需要 Node.js 24",
  );
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
    case "doctor": {
      await fs.mkdir(config.project.control_root, { recursive: true });
      await fs.mkdir(config.project.work_root, { recursive: true });
      const sandbox = await engine.store
        .lock(() => runner.probe())
        .catch((e) => ({
          ok: false,
          error: secrets.clean({
            code: e.code ?? "SANDBOX_UNAVAILABLE",
            message: e.message,
          }),
        }));
      const selected = values.executor ?? config.workflow.active_executor;
      ensure(config.executors[selected], "EXECUTOR", "执行者不存在");
      let live: any = { status: "not_run", reason: "未指定 --live" };
      if (values.live)
        try {
          live = {
            ok: true,
            ...(await new ModelClient(
              config.executors[selected],
              vars[config.executors[selected].api_key_env] ?? "",
              secrets,
              (e) => console.error(JSON.stringify(e)),
            ).probe()),
          };
        } catch (e) {
          live = {
            ok: false,
            error: secrets.clean({
              code: (e as Block).code ?? "MODEL_UNAVAILABLE",
              message: (e as Error).message,
            }),
          };
        }
      result = {
        ok: sandbox.ok && live.ok !== false,
        configuration: {ok:true,schema_version:config.schema_version,profile:config.sandbox.profile,network:config.sandbox.network},
        executor: selected,
        sandbox,
        model: live,
      };
      await atomic(engine.store.file("doctor.json"), result);
      break;
    }
    case "prepare":
      result = await engine.prepare(await readJson(need("task")));
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
      result = await engine.inspect(need("run"), Number(values.offset ?? 0));
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
