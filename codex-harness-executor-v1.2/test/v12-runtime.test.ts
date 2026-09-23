import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, reviewFor } from "./helpers.ts";

test("v1.2: a changed sandbox runtime invalidates verification before Codex approval", async () => {
  const f = await fixture();
  try {
    let runtimeVersion = "fixture-cli-v1";
    f.engine.runner.fingerprint = async () => ({
      executable: "fixture-cli",
      version: runtimeVersion,
      sha256: runtimeVersion,
      profile: "trusted_local",
      network: true,
    });
    f.setCorrect();
    const prepared = await f.engine.prepare(f.draft);
    const run: any = await f.engine.start(prepared.task);
    await f.engine.verify(run.run_id);
    const { review } = await reviewFor(f.engine, run.run_id);
    runtimeVersion = "fixture-cli-v2";
    await assert.rejects(
      f.engine.decide(run.run_id, review),
      (error: any) => error.code === "POLICY_CHANGED",
    );
    const rejected = (await f.engine.db()).runs[run.run_id];
    assert.notEqual(rejected.review?.decision, "ACCEPT");
    assert.notEqual(
      (await f.engine.db()).features["TASK/F1"].status,
      "passing",
    );
    assert.equal(rejected.candidate.snapshot_id, run.candidate.snapshot_id);
    runtimeVersion = "fixture-cli-v1";
    await f.engine.decide(run.run_id, review);
    assert.equal((await f.engine.db()).features["TASK/F1"].status, "passing");
  } finally {
    await f.close();
  }
});

test("v1.2: a changed runtime also blocks verification of an already submitted candidate", async () => {
  const f = await fixture();
  try {
    let executableHash = "same-executable";
    f.engine.runner.fingerprint = async () => ({
      version: "unchanged-version-text",
      sha256: executableHash,
    });
    f.setCorrect();
    const prepared = await f.engine.prepare(f.draft);
    const run: any = await f.engine.start(prepared.task);
    executableHash = "replaced-executable";
    await assert.rejects(
      f.engine.verify(run.run_id),
      (error: any) => error.code === "POLICY_CHANGED",
    );
    assert.equal((await f.engine.db()).runs[run.run_id].evidence.length, 0);
  } finally {
    await f.close();
  }
});
