import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, reviewFor } from "./helpers.ts";
import { id } from "../src/files.ts";
import { contract } from "../src/protocol.ts";
import { Engine } from "../src/engine.ts";
test("optional failed criterion is disclosed but does not override passing mandatory criteria", async () => {
  const f = await fixture();
  try {
    f.setCorrect();
    const draft = {
      ...f.draft,
      acceptance_criteria: [
        ...f.draft.acceptance_criteria,
        {
          ...f.draft.acceptance_criteria[0],
          id: "AC-OPTIONAL",
          required: false,
        },
      ],
      test_cases: [
        { ...f.draft.test_cases[0], acceptance_ids: ["AC-SUM", "AC-OPTIONAL"] },
      ],
    };
    const p = await f.engine.prepare(draft);
    const r: any = await f.engine.start(p.task);
    await f.engine.verify(r.run_id);
    const { review } = await reviewFor(f.engine, r.run_id);
    review.checks.find((x: any) => x.acceptance_id === "AC-OPTIONAL").verdict =
      "fail";
    review.summary =
      "Mandatory sum scenarios pass; optional criterion remains unmet.";
    await f.engine.decide(r.run_id, review);
    await assert.rejects(
      f.engine.decide(r.run_id, {
        ...review,
        summary: "different decision body",
      }),
      /不同评审/,
    );
  } finally {
    await f.close();
  }
});
test("candidate changes during verification pause the run before approval", async () => {
  const f = await fixture();
  try {
    f.setCorrect();
    const p = await f.engine.prepare(f.draft);
    const r: any = await f.engine.start(p.task);
    const original = f.engine.runner.run;
    const project = await f.engine.project();
    f.engine.runner.run = async (...args) => {
      const result = await original(...args);
      await fs.writeFile(
        path.join(project.workspace, "sum.mjs"),
        "changed during verification",
      );
      return result;
    };
    await assert.rejects(f.engine.verify(r.run_id), /验证期间候选变化/);
    assert.equal((await f.engine.db()).runs[r.run_id].status, "paused");
  } finally {
    await f.close();
  }
});
test("stale state revisions and edits to a frozen spec are rejected", async () => {
  const f = await fixture();
  try {
    const p = await f.engine.prepare(f.draft);
    const first = await f.engine.db(),
      stale = await f.engine.db();
    await f.engine.save(first, "rule_fixture", {});
    await assert.rejects(
      f.engine.save(stale, "stale_fixture", {}),
      /状态版本冲突/,
    );
    await f.engine.store.put("inputs/acceptance.md", "changed acceptance");
    await assert.rejects(f.engine.prepare(f.draft), /增加版本/);
    const newTask = await f.engine.prepare({ ...f.draft, spec_version: 2 });
    assert.notEqual(newTask.spec_digest, p.spec_digest);
    await assert.rejects(f.engine.start(p.task), /当前已准备/);
  } finally {
    await f.close();
  }
});
test("cancelling a stale candidate releases the coordinator without erasing submission counts", async () => {
  const f = await fixture();
  try {
    const p = await f.engine.prepare(f.draft);
    const r: any = await f.engine.start(p.task);
    await f.engine.cancel(r.run_id, "需求更新，重新制定规范");
    const db = await f.engine.db();
    assert.equal(db.active_run, null);
    assert.equal(db.runs[r.run_id].status, "cancelled");
    assert.equal(db.features["TASK/F1"].total_submissions, 1);
    await f.engine.prepare({
      ...f.draft,
      spec_version: 2,
      goal: "updated requirement",
    });
  } finally {
    await f.close();
  }
});
test("one omitted mandatory test is rejected even when the remaining test passes", async () => {
  const f = await fixture();
  try {
    f.setCorrect();
    const draft = {
      ...f.draft,
      acceptance_criteria: [
        {
          ...f.draft.acceptance_criteria[0],
          test_ids: ["TC-SUM", "TC-SECOND"],
        },
      ],
      test_cases: [
        ...f.draft.test_cases,
        { ...f.draft.test_cases[0], id: "TC-SECOND" },
      ],
    };
    const p = await f.engine.prepare(draft);
    const r: any = await f.engine.start(p.task);
    await f.engine.verify(r.run_id);
    const { review } = await reviewFor(f.engine, r.run_id);
    const run = (await f.engine.db()).runs[r.run_id];
    run.evidence = run.evidence.slice(0, 1);
    review.checks[0].evidence_ids = run.evidence.map((e: any) => e.id);
    await assert.rejects(
      f.engine.checkEvidence(await f.engine.store.read(p.task), run, review),
      /TC-SECOND/,
    );
  } finally {
    await f.close();
  }
});
test("interruption resumes from persisted state without resetting batch counters", async () => {
  const f = await fixture();
  try {
    const p = await f.engine.prepare(f.draft);
    const originalProbe = f.engine.runner.probe;
    f.engine.runner.probe = async () => {
      throw new Error("fixture interrupted before request");
    };
    await assert.rejects(f.engine.start(p.task), /interrupted/);
    const db = await f.engine.db();
    const runId = db.active_run!;
    const batch = db.features["TASK/F1"].batch_id;
    f.engine.runner.probe = originalProbe;
    const restarted = new Engine(
      f.config,
      f.engine.vars,
      f.engine.secrets,
      f.engine.runner,
    );
    const r: any = await restarted.resume(runId);
    assert.equal(r.candidate.round_number, 1);
    assert.equal((await restarted.db()).features["TASK/F1"].batch_id, batch);
  } finally {
    await f.close();
  }
});
test("model tool limits pause before submission and keep selected executor", async () => {
  const f = await fixture();
  try {
    f.config.executors.b = {
      ...f.config.executors.a,
      model: "selected-worker",
      max_tool_calls_per_attempt: 1,
    };
    const p = await f.engine.prepare(f.draft);
    await assert.rejects(f.engine.start(p.task, "b"), /TOOL_LIMIT/);
    const db = await f.engine.db();
    const r = db.runs[db.active_run!];
    assert.equal(r.executor, "b");
    assert.equal(r.status, "paused");
    assert.equal(db.features["TASK/F1"].batch_submissions, 0);
  } finally {
    await f.close();
  }
});
test("unknown tools and malformed arguments cannot mutate state", async () => {
  const f = await fixture();
  try {
    const p = await f.engine.prepare(f.draft);
    const task = await f.engine.store.read(p.task);
    const db = await f.engine.db();
    for (const call of [
      {
        id: "bad",
        type: "function",
        function: { name: "decide", arguments: "{}" },
      },
      {
        id: "bad2",
        type: "function",
        function: { name: "apply_patch", arguments: '{"command":"bad"}' },
      },
    ])
      await assert.rejects(
        f.engine.tool(
          db,
          { operations: {} },
          task,
          call as any,
          new AbortController().signal,
        ),
        /未知工具|Schema/,
      );
    assert.equal((await f.engine.db()).active_run, null);
  } finally {
    await f.close();
  }
});
test("final regression requires new work; feature pass is insufficient for export", async () => {
  const f = await fixture();
  try {
    f.setCorrect();
    let p = await f.engine.prepare(f.draft);
    let r: any = await f.engine.start(p.task);
    await f.engine.verify(r.run_id);
    const review = await reviewFor(f.engine, r.run_id);
    await f.engine.decide(r.run_id, review.review);
    await assert.rejects(f.engine.export(r.run_id), /最终快照/);
    const project = await f.engine.project();
    await fs.writeFile(
      path.join(project.workspace, "sum.mjs"),
      "export const sum = () => 0;\n",
    );
    p = await f.engine.prepare({
      ...f.draft,
      feature_id: "FINAL",
      scope: "final",
    });
    r = await f.engine.start(p.task);
    await f.engine.verify(r.run_id);
    const final = await reviewFor(f.engine, r.run_id);
    await assert.rejects(
      f.engine.decide(r.run_id, final.review),
      /成功执行证据/,
    );
  } finally {
    await f.close();
  }
});
test("missing artifact and omitted acceptance item cannot pass; illustrative evidence is rejected by live boundary", async () => {
  const f = await fixture();
  try {
    f.setCorrect();
    const p = await f.engine.prepare({
      ...f.draft,
      test_cases: [
        {
          ...f.draft.test_cases[0],
          required_artifact_types: ["log", "screenshot"],
        },
      ],
    });
    const r: any = await f.engine.start(p.task);
    await f.engine.verify(r.run_id);
    const { review } = await reviewFor(f.engine, r.run_id);
    await assert.rejects(f.engine.decide(r.run_id, review), /必需产物/);
    assert.throws(() => contract(review, "review", "live"), /artifact_mode/);
    review.checks = [];
    await assert.rejects(f.engine.decide(r.run_id, review), /minItems/);
  } finally {
    await f.close();
  }
});
test("configuration drift invalidates evidence", async () => {
  const f = await fixture();
  try {
    f.setCorrect();
    const p = await f.engine.prepare(f.draft);
    const r: any = await f.engine.start(p.task);
    await f.engine.verify(r.run_id);
    const { review } = await reviewFor(f.engine, r.run_id);
    f.config.project.command_env_allowlist = ["LANG"];
    await assert.rejects(f.engine.decide(r.run_id, review), /配置或命令环境/);
  } finally {
    await f.close();
  }
});
