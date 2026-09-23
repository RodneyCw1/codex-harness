import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, reviewFor } from "./helpers.ts";
test(
  "actual files: failed implementation -> rework -> success -> final snapshot -> export",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      let p = await f.engine.prepare(f.draft);
      let r: any = await f.engine.start(p.task);
      assert.equal(r.candidate.round_number, 1);
      await f.engine.verify(r.run_id);
      const first = await reviewFor(f.engine, r.run_id, "REVISE");
      await f.engine.decide(r.run_id, first.review, first.rework);
      f.setCorrect();
      p = await f.engine.prepare(f.draft);
      r = await f.engine.start(p.task);
      await f.engine.verify(r.run_id);
      const good = await reviewFor(f.engine, r.run_id);
      await f.engine.decide(r.run_id, good.review);
      await f.engine.decide(r.run_id, good.review);
      assert.equal(
        (await f.engine.db()).features["TASK/F1"].total_submissions,
        2,
      );
      p = await f.engine.prepare({
        ...f.draft,
        feature_id: "FINAL",
        scope: "final",
      });
      r = await f.engine.start(p.task);
      await f.engine.verify(r.run_id);
      const final = await reviewFor(f.engine, r.run_id);
      await f.engine.decide(r.run_id, final.review);
      const out: any = await f.engine.export(r.run_id);
      assert.match(
        await fs.readFile(path.join(out.directory, "changes.patch"), "utf8"),
        /a \+ b/,
      );
      assert.match(
        await fs.readFile(
          path.join(f.config.project.source_root, "sum.mjs"),
          "utf8",
        ),
        /a - b/,
      );
      assert.equal(out.artifact_mode, "illustrative");
    } finally {
      await f.close();
    }
  },
);
test(
  "forged pass, illustrative/live mix, tampered logs and stale candidate rejected",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      const p = await f.engine.prepare(f.draft);
      const r: any = await f.engine.start(p.task);
      await f.engine.verify(r.run_id);
      const { review } = await reviewFor(f.engine, r.run_id);
      await assert.rejects(f.engine.decide(r.run_id, review), /成功执行证据/);
      const ev = await f.engine.store.read(
        (await f.engine.db()).runs[r.run_id].evidence[0].ref,
      );
      await fs.appendFile(
        f.engine.store.file(ev.artifacts[0].path),
        "FAKE PASS",
      );
      await assert.rejects(f.engine.decide(r.run_id, review), /已变化/);
      const project = await f.engine.project();
      await fs.writeFile(path.join(project.workspace, "sum.mjs"), "changed");
      await assert.rejects(f.engine.decide(r.run_id, review), /工作区变化/);
    } finally {
      await f.close();
    }
  },
);
test("frozen standards, missing coverage and protocol mismatch rejected", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.engine.prepare({ ...f.draft, test_cases: [] }),
      /校验|Schema|must|协议|CONTRACT/,
    );
    const p = await f.engine.prepare(f.draft);
    const project = await f.engine.project();
    await fs.writeFile(
      path.join(project.workspace, "check.mjs"),
      "process.exit(0)",
    );
    await assert.rejects(f.engine.start(p.task), /受保护验收文件/);
  } finally {
    await f.close();
  }
});
