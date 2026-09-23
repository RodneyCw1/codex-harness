import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Store } from "../src/store.ts";
import { id, exists } from "../src/files.ts";
import { fixture, reviewFor } from "./helpers.ts";

async function stateStore() {
  const root = path.resolve(".test-data/state-recovery-" + id("case"));
  const store = new Store(root);
  const current = { revision: 0, active_run: null, features: {}, runs: {} };
  await store.put("db.json", current);
  return { store, current };
}

async function events(store: Store) {
  const text = await fs
    .readFile(store.file("events.jsonl"), "utf8")
    .catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("a transaction interrupted before db replacement recovers its complete state exactly once", async () => {
  const { store, current } = await stateStore();
  const next = {
    ...current,
    revision: 1,
    features: { "TASK/F1": { total_submissions: 1, status: "in_progress" } },
  };
  const originalPut = store.put.bind(store);
  let injected = false;
  store.put = async (file, value) => {
    if (file === "db.json" && !injected) {
      injected = true;
      throw new Error("injected failure before db replacement");
    }
    return originalPut(file, value);
  };
  await assert.rejects(
    store.lock(() =>
      store.commitState(current, next, "candidate_submitted", {
        submission_id: "candidate-1",
      }),
    ),
    /injected failure before db replacement/,
  );
  assert.deepEqual(await store.read("db.json"), current);
  const pending = await store.read("transaction.json");
  const recovered = new Store(store.root);
  await recovered.lock(async () => {
    await recovered.recoverTransactions();
  });
  await recovered.lock(async () => {
    await recovered.recoverTransactions();
  });
  assert.deepEqual(await recovered.read("db.json"), next);
  assert.equal(await exists(recovered.file("transaction.json")), false);
  const matching = (await events(recovered)).filter(
    (event) => event.data?.transaction_id === pending.transaction_id,
  );
  assert.equal(matching.length, 1);
  assert.equal(matching[0].data.submission_id, "candidate-1");
  assert.equal(matching[0].data.revision, 1);
  assert.deepEqual(
    (await recovered.read(`transactions/${pending.transaction_id}.json`)).next,
    next,
  );
});

for (const afterAppend of [false, true]) {
  test(`a transaction interrupted ${afterAppend ? "after" : "before"} event append recovers one event and one revision`, async () => {
    const { store, current } = await stateStore();
    const next = {
      ...current,
      revision: 1,
      active_run: "RUN-1",
      runs: { "RUN-1": { candidate: { round_number: 1 }, phase: "reviewing" } },
    };
    const originalEvent = store.event.bind(store);
    let injected = false;
    store.event = async (type, data) => {
      if (type === "candidate_submitted" && !injected) {
        injected = true;
        if (afterAppend) await originalEvent(type, data);
        throw new Error("injected event append interruption");
      }
      return originalEvent(type, data);
    };
    await assert.rejects(
      store.lock(() =>
        store.commitState(current, next, "candidate_submitted", {
          submission_id: "candidate-1",
        }),
      ),
      /injected event append interruption/,
    );
    assert.deepEqual(await store.read("db.json"), next);
    const pending = await store.read("transaction.json");
    const recovered = new Store(store.root);
    await recovered.lock(async () => {
      await recovered.recoverTransactions();
    });
    await recovered.lock(async () => {
      await recovered.recoverTransactions();
    });
    assert.deepEqual(await recovered.read("db.json"), next);
    const matching = (await events(recovered)).filter(
      (event) => event.data?.transaction_id === pending.transaction_id,
    );
    assert.equal(matching.length, 1);
    assert.equal(matching[0].type, "candidate_submitted");
    assert.equal(matching[0].data.revision, 1);
    assert.equal(await exists(recovered.file("transaction.json")), false);

    const following = { ...next, revision: 2, active_run: null };
    await recovered.lock(() =>
      recovered.commitState(next, following, "candidate_reviewed", {
        submission_id: "candidate-1",
      }),
    );
    assert.deepEqual(await recovered.read("db.json"), following);
    assert.equal(
      (await events(recovered)).filter(
        (event) => event.type === "candidate_submitted",
      ).length,
      1,
    );
    assert.equal(
      (await events(recovered)).filter(
        (event) => event.type === "candidate_reviewed",
      ).length,
      1,
    );
  });
}

test("Engine.save recovers an interrupted write without losing state or replaying its revision", async () => {
  const f = await fixture();
  try {
    const db = await f.engine.db();
    const initialRevision = db.revision;
    db.features["TASK/F1"] = {
      status: "in_progress",
      total_submissions: 1,
      batch_submissions: 1,
    };
    const originalPut = f.engine.store.put.bind(f.engine.store);
    let injected = false;
    f.engine.store.put = async (file, value) => {
      if (file === "db.json" && !injected) {
        injected = true;
        throw new Error("injected Engine.save interruption");
      }
      return originalPut(file, value);
    };
    await assert.rejects(
      f.engine.store.lock(() =>
        f.engine.save(db, "candidate_submitted", {
          submission_id: "saved-candidate",
        }),
      ),
      /injected Engine.save interruption/,
    );
    assert.equal(db.revision, initialRevision);
    f.engine.store.put = originalPut;
    await new Store(f.engine.store.root).lock(async () => {});
    const restored = await f.engine.db();
    assert.equal(restored.revision, initialRevision + 1);
    assert.deepEqual(restored.features["TASK/F1"], db.features["TASK/F1"]);
    await assert.rejects(
      f.engine.store.lock(() =>
        f.engine.save(db, "candidate_submitted", {
          submission_id: "saved-candidate",
        }),
      ),
      { code: "STATE_CONFLICT" },
    );
    assert.equal((await f.engine.db()).revision, initialRevision + 1);
    assert.equal(
      (await events(f.engine.store)).filter(
        (event) => event.type === "candidate_submitted",
      ).length,
      1,
    );
    restored.features["TASK/F1"].status = "passing";
    await f.engine.store.lock(() =>
      f.engine.save(restored, "candidate_reviewed", {
        submission_id: "saved-candidate",
      }),
    );
    assert.equal(restored.revision, initialRevision + 2);
    assert.equal(
      (await f.engine.db()).features["TASK/F1"].total_submissions,
      1,
    );
  } finally {
    await f.close();
  }
});

test(
  "a newer specification clears previous pass and resolved-defect progress without resetting submission counts",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      let prepared = await f.engine.prepare(f.draft);
      let run: any = await f.engine.start(prepared.task);
      await f.engine.verify(run.run_id);
      const failed = await reviewFor(f.engine, run.run_id, "REVISE");
      await f.engine.decide(run.run_id, failed.review, failed.rework);
      f.setCorrect();
      prepared = await f.engine.prepare(f.draft);
      run = await f.engine.start(prepared.task);
      await f.engine.verify(run.run_id);
      const good = await reviewFor(f.engine, run.run_id);
      const evidence = (await f.engine.db()).runs[run.run_id].evidence;
      await f.engine.decide(run.run_id, good.review, undefined, [
        {
          defect_id: "BUG-SUM",
          explanation: "Both original assertions now pass",
          evidence_ids: evidence.map((item: any) => item.id),
        },
      ]);
      const before = (await f.engine.db()).features["TASK/F1"];
      assert.deepEqual(before.verified_pass_ids, ["AC-SUM"]);
      assert.deepEqual(before.closed_blocker_ids, ["BUG-SUM"]);

      const newer = await f.engine.prepare({ ...f.draft, spec_version: 2 });
      const after = (await f.engine.db()).features["TASK/F1"];
      assert.equal(after.status, "not_started");
      assert.equal(after.approved_snapshot_id, null);
      assert.deepEqual(after.verified_pass_ids, []);
      assert.deepEqual(after.closed_blocker_ids, []);
      assert.equal(after.stalled_rounds, 0);
      assert.equal(after.rework_id, null);
      assert.equal(after.total_submissions, before.total_submissions);
      assert.equal(after.batch_submissions, before.batch_submissions);
      assert.equal(after.batch_id, before.batch_id);
      assert.equal(
        (await f.engine.store.read(newer.task)).previous_rework_id,
        null,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "a specification change invalidates accepted transitive dependents and final acceptance but keeps independent features",
  { timeout: 60000 },
  async () => {
    const f = await fixture();
    try {
      f.setCorrect();
      for (const [feature_id, dependencies] of [
        ["F1", []],
        ["F2", ["F1"]],
        ["F3", ["F2"]],
        ["Independent", []],
      ] as Array<[string, string[]]>) {
        const prepared = await f.engine.prepare({
          ...f.draft,
          feature_id,
          dependencies,
        });
        const run: any = await f.engine.start(prepared.task);
        await f.engine.verify(run.run_id);
        const good = await reviewFor(f.engine, run.run_id);
        await f.engine.decide(run.run_id, good.review);
      }
      const final = await f.engine.prepare({
        ...f.draft,
        feature_id: "FINAL",
        scope: "final",
      });
      const run: any = await f.engine.start(final.task);
      await f.engine.verify(run.run_id);
      const good = await reviewFor(f.engine, run.run_id);
      await f.engine.decide(run.run_id, good.review);
      const before = await f.engine.db();
      for (const feature of Object.values(before.features))
        assert.equal(feature.status, "passing");

      await f.engine.prepare({ ...f.draft, spec_version: 2 });
      const after = await f.engine.db();
      for (const featureId of ["F1", "F2", "F3", "FINAL"]) {
        const feature = after.features["TASK/" + featureId];
        assert.equal(feature.status, "not_started", featureId);
        assert.equal(feature.approved_snapshot_id, null, featureId);
        assert.deepEqual(feature.verified_pass_ids, [], featureId);
        assert.deepEqual(feature.closed_blocker_ids, [], featureId);
      }
      assert.equal(after.features["TASK/Independent"].status, "passing");
      assert.equal(
        after.features["TASK/Independent"].approved_snapshot_id,
        before.features["TASK/Independent"].approved_snapshot_id,
      );
      await assert.rejects(
        f.engine.prepare({ ...f.draft, feature_id: "FINAL", scope: "final" }),
        { code: "FINAL" },
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "inspect returns every character of a long real log through explicit continuation offsets",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      f.setCorrect();
      const prepared = await f.engine.prepare(f.draft);
      const run: any = await f.engine.start(prepared.task);
      await f.engine.verify(run.run_id);
      const evidenceRef = (await f.engine.db()).runs[run.run_id].evidence[0]
        .ref;
      const evidence = await f.engine.store.read(evidenceRef);
      const logPath = evidence.artifacts.find(
        (item: any) => item.type === "log",
      ).path;
      const content =
        "BEGIN\n" + "中文🙂 output line\n".repeat(8000) + "END-OF-REAL-LOG\n";
      // Deliberately extend an isolated fixture log; this tests reading, not evidence acceptance.
      await fs.writeFile(f.engine.store.file(logPath), content);
      let offset = 0,
        combined = "",
        pages = 0;
      for (;;) {
        const inspected = await f.engine.inspect(run.run_id, offset);
        const page = inspected.evidence
          .flatMap((item: any) => item.logs)
          .find((item: any) => item.path === logPath);
        assert.equal(page.offset, offset);
        assert.equal(page.total_chars, content.length);
        assert.equal(page.text, content.slice(offset, offset + 50000));
        combined += page.text;
        pages += 1;
        if (!page.truncated) {
          assert.equal(page.next_offset, null);
          break;
        }
        assert.equal(page.next_offset, offset + page.text.length);
        assert.ok(page.next_offset > offset);
        offset = page.next_offset;
      }
      assert.ok(pages > 1);
      assert.equal(combined, content);
      const beyond = await f.engine.inspect(run.run_id, content.length + 10);
      const emptyPage = beyond.evidence
        .flatMap((item: any) => item.logs)
        .find((item: any) => item.path === logPath);
      assert.equal(emptyPage.text, "");
      assert.equal(emptyPage.truncated, false);
      assert.equal(emptyPage.next_offset, null);
      await assert.rejects(f.engine.inspect(run.run_id, -1), {
        code: "OFFSET",
      });
      await assert.rejects(f.engine.inspect(run.run_id, 1.5), {
        code: "OFFSET",
      });
    } finally {
      await f.close();
    }
  },
);
