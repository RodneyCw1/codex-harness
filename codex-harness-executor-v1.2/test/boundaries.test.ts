import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, reviewFor } from "./helpers.ts";
import { id, snapshot, copySnapshot, digest } from "../src/files.ts";
import { applyTextPatch } from "../src/patch.ts";
import { Store } from "../src/store.ts";
import { Secrets, commandEnvironment, loadConfig } from "../src/config.ts";
test("round 10 may pass; round 10 failure pauses and never adds an eleventh submission", async () => {
  for (const correct of [true, false]) {
    const f = await fixture();
    try {
      let prepared = await f.engine.prepare(f.draft);
      const db = await f.engine.db();
      db.features["TASK/F1"].batch_submissions = 9;
      db.features["TASK/F1"].total_submissions = 9;
      await f.engine.save(db, "seed_history_for_rule_test", {});
      prepared = await f.engine.prepare(f.draft);
      if (correct) f.setCorrect();
      const r: any = await f.engine.start(prepared.task);
      assert.equal(r.candidate.round_number, 10);
      await f.engine.verify(r.run_id);
      const review = await reviewFor(
        f.engine,
        r.run_id,
        correct ? "ACCEPT" : "REVISE",
      );
      const outcome: any = await f.engine.decide(
        r.run_id,
        review.review,
        review.rework,
      );
      assert.equal(outcome.status, correct ? "completed" : "paused");
      if (!correct) {
        assert.equal(outcome.block_reason, "ROUND_LIMIT");
        await assert.rejects(f.engine.resume(r.run_id), /new-batch/);
        const before = (await f.engine.db()).features["TASK/F1"]
          .total_submissions;
        await f.engine.resume(r.run_id, true);
        assert.equal(
          (await f.engine.db()).features["TASK/F1"].total_submissions,
          before,
        );
      }
    } finally {
      await f.close();
    }
  }
});
test("three submissions without verified progress pause; duplicates do not count again", async () => {
  const f = await fixture();
  try {
    let last: any;
    for (let i = 1; i <= 3; i++) {
      const p = await f.engine.prepare(f.draft);
      const r: any = await f.engine.start(p.task);
      await f.engine.verify(r.run_id);
      const review = await reviewFor(f.engine, r.run_id, "REVISE");
      last = await f.engine.decide(r.run_id, review.review, review.rework);
      await f.engine.decide(r.run_id, review.review, review.rework);
      assert.equal(
        (await f.engine.db()).features["TASK/F1"].batch_submissions,
        i,
      );
    }
    assert.equal(last.block_reason, "STALLED");
  } finally {
    await f.close();
  }
});
test("patch intent recovery reconciles partial writes and never reapplies a completed patch", async () => {
  const f = await fixture();
  try {
    const project = await f.engine.project();
    f.config.project.allowed_paths.push("extra.mjs");
    await fs.writeFile(path.join(project.workspace, "extra.mjs"), "before\n");
    const p = await f.engine.prepare(f.draft);
    const before = await f.engine.freeze(project.workspace);
    const staging = f.engine.store.file("recovery-staging");
    await copySnapshot(project.workspace, staging, before);
    await fs.writeFile(
      path.join(staging, "sum.mjs"),
      "export const sum = (a,b) => a+b;\n",
    );
    const after = await f.engine.freeze(staging);
    await fs.writeFile(path.join(staging, "extra.mjs"), "after\n");
    const complete = await f.engine.freeze(staging);
    // Simulate a process dying after the first file was written, before its commit record.
    await fs.writeFile(
      path.join(project.workspace, "sum.mjs"),
      await fs.readFile(path.join(staging, "sum.mjs")),
    );
    const db = await f.engine.db();
    const run: any = {
      run_id: "recovery-test",
      pending: {
        kind: "patch",
        tool_id: "patch-id",
        signature: "same",
        before: before.id,
        after: complete.id,
      },
      operations: {},
    };
    await f.engine.reconcile(db, run, await f.engine.store.read(p.task));
    assert.equal((await snapshot(project.workspace)).id, complete.id);
    await f.engine.reconcile(db, run, await f.engine.store.read(p.task));
    assert.equal(run.operations["patch-id"].status, "done");
  } finally {
    await f.close();
  }
});
test("protected Windows case aliases and excluded generated directories cannot be patched", async () => {
  const f = await fixture();
  try {
    const project = await f.engine.project();
    const s = await snapshot(project.workspace);
    await assert.rejects(
      applyTextPatch(
        project.workspace,
        "--- a/CHECK.mjs\n+++ b/CHECK.mjs\n@@ -1 +1 @@\n-old\n+new\n",
        s.id,
        ["**"],
        ["check.mjs"],
      ),
      /允许范围/,
    );
    await assert.rejects(
      applyTextPatch(
        project.workspace,
        "--- /dev/null\n+++ b/node_modules/new.mjs\n@@ -0,0 +1 @@\n+bad\n",
        s.id,
        ["**"],
        [],
      ),
      /允许范围/,
    );
  } finally {
    await f.close();
  }
});
test("single writer lock and dead process recovery", async () => {
  const root = path.resolve(".test-data/lock-" + id("case"));
  const store = new Store(root);
  await store.lock(async () => {
    await assert.rejects(
      store.lock(async () => true),
      /已有写入/,
    );
  });
  await store.put("writer.lock", { pid: 2147483647, token: "dead" });
  await store.recoverLock();
  await store.lock(async () => {});
});
test("private env remains outside project and secrets never enter command environment", async () => {
  const f = await fixture();
  try {
    const vars = {
      ...process.env,
      WORK_API_KEY: "key-never-log",
      NODE_OPTIONS: "danger",
    };
    const env = commandEnvironment(f.config, vars, "tmp");
    assert.equal(env.WORK_API_KEY, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    const s = new Secrets(["key-never-log"]);
    assert.equal(s.clean("key-never-log"), "[REDACTED]");
    const file = path.join(f.root, "private.env");
    await fs.writeFile(file, "PRIVATE_KEY=abc-private-key\n");
    const configPath = path.join(f.root, "config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        ...f.config,
        private_env_file: file,
        executors: {
          x: { ...f.config.executors.a, api_key_env: "PRIVATE_KEY" },
        },
        workflow: { ...f.config.workflow, active_executor: "x" },
      }),
    );
    assert.equal(
      (await loadConfig(configPath)).vars.PRIVATE_KEY,
      "abc-private-key",
    );
  } finally {
    await f.close();
  }
});
