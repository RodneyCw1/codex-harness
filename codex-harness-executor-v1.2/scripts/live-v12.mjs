import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { initialize } from "../src/workspace.ts";
import { Engine } from "../src/engine.ts";
import { WindowsSandbox } from "../src/sandbox.ts";
import { ModelClient } from "../src/api.ts";
import { common } from "../src/protocol.ts";
import { id } from "../src/files.ts";
const mode = process.argv[2];
const pointer = "reports/live-v1.2-location.json";
if (mode === "setup") {
  const { config } = await loadConfig(process.argv[3]);
  const root = path.resolve(".test-data/live-v12-" + Date.now());
  Object.assign(config, { schema_version: "1.2" });
  Object.assign(config.sandbox, { profile: "trusted_local", network: true });
  Object.assign(config.project, {
    source_root: path.join(root, "source"),
    work_root: path.join(root, "work"),
    control_root: path.join(root, "control"),
    allowed_paths: ["sum.mjs"],
    protected_paths: ["check.mjs"],
    commands: [
      {
        id: "test",
        argv: [process.execPath, "check.mjs"],
        cwd: ".",
        timeout_seconds: 30,
        purpose: "feature",
      },
    ],
    artifacts: {
      test: [
        {
          path: "target/result.json",
          type: "report",
          required: true,
          role: "assertion-results",
        },
      ],
    },
  });
  await fs.mkdir(config.project.source_root, { recursive: true });
  await fs.writeFile(
    path.join(config.project.source_root, "sum.mjs"),
    "export const sum = (a,b) => a*b;\n",
  );
  await fs.writeFile(
    path.join(config.project.source_root, "check.mjs"),
    `import assert from 'node:assert/strict';import fs from 'node:fs';import {sum} from './sum.mjs';const cases=[[2,3,5],[-1,1,0],[0,0,0],[1.5,2.5,4]];const results=cases.map(([a,b,expected])=>({a,b,expected,actual:sum(a,b)}));fs.mkdirSync('target',{recursive:true});fs.writeFileSync('target/result.json',JSON.stringify({tests:results.length,results}));for(const c of results)assert.equal(c.actual,c.expected);console.log('PASS: four addition scenarios');\n`,
  );
  await fs.writeFile(
    path.join(root, "config.json"),
    JSON.stringify(config, null, 2),
  );
  await fs.writeFile(
    pointer,
    JSON.stringify({ root, config: path.join(root, "config.json") }, null, 2),
  );
}
const location = JSON.parse(await fs.readFile(pointer, "utf8"));
const { config, vars, secrets } = await loadConfig(location.config);
const runner = new WindowsSandbox(config, vars, secrets);
const engine = new Engine(config, vars, secrets, runner, (e) =>
  console.error(JSON.stringify(secrets.clean(e))),
);
if (mode === "setup") {
  await initialize(config, secrets);
  const docs = {
    implementation: "inputs/implementation.md",
    acceptance: "inputs/acceptance.md",
    test_plan: "inputs/test_plan.md",
  };
  for (const [kind, file] of Object.entries(docs))
    await engine.store.put(
      file,
      `# ${kind}\n这是执行器故障注入联调项目，业务目标是正确的数值加法。AC-SUM: (2,3)=5、(-1,1)=0、(0,0)=0、(1.5,2.5)=4。运行已冻结 test 命令并保存 target/result.json。\n首次运行（没有 previous_rework_id）必须保留故意错误的乘法实现：read_file sum.mjs，run_check test，然后 submit_candidate，明确说明已知缺陷；这是为了验证 Codex 会拒绝错误候选。收到返工单后用 read_file 和 apply_patch 修复 sum.mjs，再 run_check 和 submit_candidate。不可修改 check.mjs，也不可新建其他文件。不要只输出自然语言，必须使用工具。\n`,
    );
  const draft = {
    task_id: "LIVE-V12",
    feature_id: "F1",
    spec_version: 1,
    goal: "执行真实模型故障注入闭环：首次保留错误候选供 Codex 拒绝，返工后实现数值加法",
    documents: docs,
    command_ids: ["test"],
    acceptance_criteria: [
      {
        id: "AC-SUM",
        requirement_ids: ["REQ-SUM"],
        required: true,
        behavior: "正确计算四种正数、负数、零和小数的加法",
        test_ids: ["TC-SUM"],
      },
    ],
    test_cases: [
      {
        id: "TC-SUM",
        acceptance_ids: ["AC-SUM"],
        command_id: "test",
        expected_result: "四个实际加法断言全部通过，保存4项实测结果",
        required_artifact_types: ["log", "report"],
      },
    ],
  };
  await engine.store.put("inputs/draft.json", draft);
  const doctor = {
    sandbox: await runner.probe(),
    model: await new ModelClient(
      config.executors[config.workflow.active_executor],
      vars[config.executors[config.workflow.active_executor].api_key_env] ?? "",
      secrets,
      (e) => console.error(JSON.stringify(e)),
    ).probe(),
  };
  await engine.store.put("live-doctor.json", doctor);
  console.log(JSON.stringify({ location, doctor }, null, 2));
} else if (mode === "run") {
  const draft = await engine.store.read("inputs/draft.json");
  const prepared = await engine.prepare(draft);
  console.log(JSON.stringify(await engine.start(prepared.task), null, 2));
} else if (mode === "verify") {
  const db = await engine.db();
  console.log(JSON.stringify(await engine.verify(db.active_run), null, 2));
} else if (mode === "inspect") {
  const db = await engine.db();
  console.log(JSON.stringify(await engine.inspect(db.active_run), null, 2));
} else if (mode === "revise") {
  const db = await engine.db(),
    run = db.runs[db.active_run],
    task = await engine.store.read(run.task_ref);
  const review = await engine.store.read(
    `runs/${run.run_id}/review.template.json`,
  );
  Object.assign(review, {
    decision: "REVISE",
    summary:
      "Codex 已检查独立日志：实际 2*3=6，预期加法为5，错误候选不可通过。",
    next_action: "rework",
    block_reason: null,
    rework_id: id("rework"),
    hard_gates: { scope_ok: true, standards_intact: true, handoff_ready: true },
    unresolved_blockers: ["BUG-SUM"],
  });
  review.checks = review.checks.map((c) => ({
    ...c,
    verdict: "fail",
    explanation: "独立 test 退出1，断言实际6不等于5；check.mjs 未改。",
  }));
  const rework = {
    ...common(task, "rework", review.rework_id),
    source_review_id: review.message_id,
    source_submission_id: run.candidate.submission_id,
    next_round: run.candidate.round_number + 1,
    snapshot_id: run.candidate.snapshot_id,
    issues: [
      {
        defect_id: "BUG-SUM",
        acceptance_ids: ["AC-SUM"],
        actual: "sum(2,3) 返回6，现有源码使用 a*b",
        expected: "使用数值加法，四个登记用例均满足预期",
        evidence_ids: run.evidence.map((e) => e.id),
        reproduction: "运行冻结 test 命令，读取断言和 target/result.json",
        repair_scope: ["sum.mjs"],
        retest_ids: ["TC-SUM"],
      },
    ],
  };
  await engine.store.put(`inputs/${run.run_id}-review.json`, review);
  await engine.store.put(`inputs/${run.run_id}-rework.json`, rework);
  console.log(
    JSON.stringify(await engine.decide(run.run_id, review, rework), null, 2),
  );
} else if (mode === "accept") {
  // Invoke only after the coordinating Codex has inspected the current evidence.
  const db = await engine.db(),
    run = db.runs[db.active_run],
    task = await engine.store.read(run.task_ref);
  const review = await engine.store.read(
    `runs/${run.run_id}/review.template.json`,
  );
  Object.assign(review, {
    decision: "ACCEPT",
    summary:
      "Codex 已核对实际候选使用 a+b、冻结检查脚本未改、四个真实断言全部通过且输入摘要一致。",
    next_action: task.scope === "final" ? "deliver" : "next_feature",
    block_reason: null,
    rework_id: null,
    hard_gates: { scope_ok: true, standards_intact: true, handoff_ready: true },
    unresolved_blockers: [],
  });
  review.checks = review.checks.map((c) => ({
    ...c,
    verdict: "pass",
    explanation:
      "已读取独立验证日志和4项实际结果，正数、负数、零、小数加法符合冻结标准。",
  }));
  await engine.store.put(`inputs/${run.run_id}-review.json`, review);
  console.log(JSON.stringify(await engine.decide(run.run_id, review), null, 2));
} else if (mode === "final") {
  const draft = await engine.store.read("inputs/draft.json");
  const prepared = await engine.prepare({
    ...draft,
    feature_id: "FINAL",
    scope: "final",
    dependencies: ["F1"],
  });
  console.log(JSON.stringify(await engine.start(prepared.task), null, 2));
} else if (mode === "export") {
  const db = await engine.db();
  const run = Object.values(db.runs).findLast(
    (r) => r.review?.scope === "final" && r.review.decision === "ACCEPT",
  );
  console.log(JSON.stringify(await engine.export(run.run_id), null, 2));
}
