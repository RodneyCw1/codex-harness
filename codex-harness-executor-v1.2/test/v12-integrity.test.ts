import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, reviewFor } from "./helpers.ts";

// These checks deliberately mutate the disposable verification copy. The
// authoritative candidate is left untouched, so checking it alone is insufficient.
async function cannotAccept(
  f: Awaited<ReturnType<typeof fixture>>,
  runId: string,
  reason: RegExp,
) {
  let failure: unknown;
  try {
    await f.engine.verify(runId);
  } catch (error) {
    failure = error;
  }
  const run = (await f.engine.db()).runs[runId];
  if (failure) {
    assert.match(String(failure), reason);
    assert.notEqual(run.status, "completed");
    assert.notEqual(run.review?.decision, "ACCEPT");
    return;
  }
  const reports: string[] = [];
  for (const ref of run.evidence) {
    const evidence = await f.engine.store.read(ref.ref);
    for (const artifact of evidence.artifacts.filter(
      (a: any) => a.type === "log" || a.type === "report",
    ))
      reports.push(
        await fs.readFile(f.engine.store.file(artifact.path), "utf8"),
      );
  }
  assert.match(
    reports.join("\n"),
    reason,
    "invalid check must record its cause",
  );
  const { review } = await reviewFor(f.engine, runId);
  await assert.rejects(
    f.engine.decide(runId, review),
    "a coordinator pass cannot override invalid execution evidence",
  );
  assert.notEqual((await f.engine.db()).features["TASK/F1"].status, "passing");
}

test("v1.2: verification cannot repair a wrong candidate in its disposable copy", async () => {
  const f = await fixture();
  try {
    const prepared = await f.engine.prepare(f.draft);
    const run: any = await f.engine.start(prepared.task);
    const original = f.engine.runner.run;
    f.engine.runner.run = async (command, cwd, protectedPaths, signal) => {
      await fs.writeFile(
        path.join(cwd, "sum.mjs"),
        "export const sum = (a,b) => a+b;\n",
      );
      return original(command, cwd, protectedPaths, signal);
    };
    await cannotAccept(f, run.run_id, /CHECK_INPUT_CHANGED/);
    const manifest = await f.engine.store.read(run.candidate.manifest_ref);
    assert.equal(manifest.id, run.candidate.snapshot_id);
    assert.match(
      await fs.readFile(
        path.join((await f.engine.project()).workspace, "sum.mjs"),
        "utf8",
      ),
      /a \* b/,
      "the frozen candidate's implementation was never repaired",
    );
  } finally {
    await f.close();
  }
});

test("v1.2: initialization cannot rewrite verification input before the real test", async () => {
  const f = await fixture();
  try {
    f.config.project.commands.push({
      id: "init",
      argv: [process.execPath, "-e", "process.exit(0)"],
      cwd: ".",
      timeout_seconds: 10,
      purpose: "init",
    });
    let mutate = false;
    let verificationTests = 0;
    const original = f.engine.runner.run;
    f.engine.runner.run = async (command, cwd, protectedPaths, signal) => {
      if (command.id === "init") {
        if (mutate)
          await fs.writeFile(
            path.join(cwd, "sum.mjs"),
            "export const sum = (a,b) => a+b;\n",
          );
        return {
          exitCode: 0,
          stdout: "initialized",
          stderr: "",
          timedOut: false,
          aborted: false,
        };
      }
      if (mutate) verificationTests++;
      return original(command, cwd, protectedPaths, signal);
    };
    const prepared = await f.engine.prepare({
      ...f.draft,
      command_ids: ["init", "test"],
    });
    const run: any = await f.engine.start(prepared.task);
    mutate = true;
    await cannotAccept(f, run.run_id, /CHECK_INPUT_CHANGED/);
    assert.equal(
      verificationTests,
      0,
      "do not execute tests after initialization altered their input",
    );
  } finally {
    await f.close();
  }
});

for (const operation of ["add", "delete"] as const)
  test(`v1.2: ${operation} within a protected directory invalidates evidence`, async () => {
    const f = await fixture();
    try {
      f.setCorrect();
      f.config.project.protected_paths.push("standards/**");
      const workspace = (await f.engine.project()).workspace;
      await fs.mkdir(path.join(workspace, "standards"), { recursive: true });
      await fs.writeFile(
        path.join(workspace, "standards", "acceptance.md"),
        "Both addition assertions must pass.\n",
      );
      const prepared = await f.engine.prepare(f.draft);
      const run: any = await f.engine.start(prepared.task);
      const original = f.engine.runner.run;
      f.engine.runner.run = async (command, cwd, protectedPaths, signal) => {
        const result = await original(command, cwd, protectedPaths, signal);
        if (operation === "add")
          await fs.writeFile(
            path.join(cwd, "standards", "replacement.md"),
            "All outputs are acceptable.\n",
          );
        else await fs.unlink(path.join(cwd, "standards", "acceptance.md"));
        return result;
      };
      await cannotAccept(
        f,
        run.run_id,
        /CHECK_INPUT_CHANGED|STANDARDS_CHANGED/,
      );
    } finally {
      await f.close();
    }
  });

test("v1.2: the executor wrapper report cannot substitute for a missing required test report", async () => {
  const f = await fixture();
  try {
    f.setCorrect();
    f.config.project.artifacts.test = [
      {
        path: "target/surefire-reports/test-results.xml",
        type: "report",
        role: "test-results",
        required: true,
      },
    ];
    const prepared = await f.engine.prepare(f.draft);
    const run: any = await f.engine.start(prepared.task);
    await cannotAccept(
      f,
      run.run_id,
      /REQUIRED_ARTIFACT|ARTIFACT_REQUIRED|必需产物/,
    );
  } finally {
    await f.close();
  }
});

test("v1.2: a real required report in generated output is collected without changing source input", async () => {
  const f = await fixture();
  try {
    f.setCorrect();
    f.config.project.artifacts.test = [
      {
        path: "target/surefire-reports/test-results.xml",
        type: "report",
        role: "test-results",
        required: true,
      },
      {
        path: "target/optional-debug.txt",
        type: "report",
        role: "debug",
        required: false,
      },
    ];
    const original = f.engine.runner.run;
    f.engine.runner.run = async (command, cwd, protectedPaths, signal) => {
      const result = await original(command, cwd, protectedPaths, signal);
      await fs.mkdir(path.join(cwd, "target", "surefire-reports"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(cwd, "target", "surefire-reports", "test-results.xml"),
        '<testsuite tests="2" failures="0"><testcase name="positive"/><testcase name="negative"/></testsuite>\n',
      );
      return result;
    };
    const prepared = await f.engine.prepare(f.draft);
    const run: any = await f.engine.start(prepared.task);
    await f.engine.verify(run.run_id);
    const actual = (await f.engine.db()).runs[run.run_id];
    const evidence = await f.engine.store.read(actual.evidence[0].ref);
    assert.ok(
      evidence.artifacts.some((a: any) =>
        a.path.endsWith("target/surefire-reports/test-results.xml"),
      ),
    );
    const { review } = await reviewFor(f.engine, run.run_id);
    await f.engine.decide(run.run_id, review);
    assert.equal((await f.engine.db()).features["TASK/F1"].status, "passing");
  } finally {
    await f.close();
  }
});

test("v1.2: Maven, CodeGraph and configured generated directories never change candidate input", async () => {
  const f = await fixture();
  try {
    f.config.project.generated_dirs = [
      "target",
      ".codegraph",
      ".harness-tmp",
      "custom-output",
    ];
    const workspace = (await f.engine.project()).workspace;
    const before = await f.engine.freeze(workspace);
    for (const generated of [
      "module/target/classes/Main.class",
      ".codegraph/index.db",
      ".harness-tmp/check.tmp",
      "module/custom-output/output.txt",
    ]) {
      await fs.mkdir(path.dirname(path.join(workspace, generated)), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(workspace, generated),
        "generated, not source\n",
      );
    }
    const after = await f.engine.freeze(workspace);
    assert.equal(after.id, before.id);
    assert.deepEqual(after.files, before.files);
    await fs.writeFile(
      path.join(workspace, "sum.mjs"),
      "export const sum = (a,b) => a+b;\n",
    );
    assert.notEqual(
      (await f.engine.freeze(workspace)).id,
      before.id,
      "actual source remains part of the candidate identity",
    );
  } finally {
    await f.close();
  }
});
