import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { normalizeConfig, Secrets, commandEnvironment } from "../src/config.ts";
import { Engine } from "../src/engine.ts";
import { initialize } from "../src/workspace.ts";
import { processRun } from "../src/process.ts";
import { common } from "../src/protocol.ts";
import { id } from "../src/files.ts";
import type { CheckRunner } from "../src/sandbox.ts";
export async function fixture() {
  const root = path.resolve(".test-data/e2e-" + id("case"));
  await fs.mkdir(path.join(root, "source"), { recursive: true });
  await fs.writeFile(
    path.join(root, "source", "sum.mjs"),
    "export const sum = (a, b) => a - b;\n",
  );
  await fs.writeFile(
    path.join(root, "source", "check.mjs"),
    "import assert from 'node:assert/strict';import {sum} from './sum.mjs';assert.equal(sum(2,3),5);assert.equal(sum(-1,1),0);console.log('SCENARIO sum passed');\n",
  );
  let correct = false;
  const server = http.createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    const previous = body.messages.findLast((m: any) => m.role === "assistant")
      ?.tool_calls?.[0]?.function.name;
    const last = body.messages.at(-1);
    let name = "read_file",
      args: any = { path: "sum.mjs" };
    if (previous === "read_file") {
      const read = JSON.parse(last.content);
      name = "apply_patch";
      const next = correct
        ? "export const sum = (a, b) => a + b;"
        : "export const sum = (a, b) => a * b;";
      args = {
        snapshot_id: read.snapshot_id,
        patch:
          "--- a/sum.mjs\n+++ b/sum.mjs\n@@ -1 +1 @@\n-" +
          read.text.trim() +
          "\n+" +
          next +
          "\n",
      };
    } else if (previous === "apply_patch") {
      name = "run_check";
      args = { command_id: "test" };
    } else if (previous === "run_check") {
      name = "submit_candidate";
      args = { summary: "fixture candidate", unresolved_issues: [] };
    }
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: id("tool"),
                  type: "function",
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const config = normalizeConfig(
    {
      schema_version: "1.1",
      executors: {
        a: {
          protocol: "openai_chat_completions",
          base_url: "http://127.0.0.1:" + (server.address() as any).port,
          api_key_env: "HARNESS_TEST_KEY",
          model: "fixture",
        },
      },
      project: {
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
            timeout_seconds: 10,
            purpose: "feature",
          },
        ],
      },
    },
    ".",
  );
  const vars = {
    ...process.env,
    HARNESS_TEST_KEY: "fake-key-only-used-by-tests-87654",
  };
  const secrets = new Secrets([vars.HARNESS_TEST_KEY]);
  const runner: CheckRunner = {
    kind: "test-fixture-only",
    async probe() {
      return { test_double: true };
    },
    async run(command, cwd, protectedPaths, signal) {
      assert.deepEqual(command.argv, [process.execPath, "check.mjs"]);
      return processRun(command.argv, {
        cwd,
        env: commandEnvironment(config, vars, path.join(cwd, "tmp")),
        timeoutMs: 10000,
        signal,
      });
    },
  };
  await initialize(config, secrets);
  const engine = new Engine(config, vars, secrets, runner);
  for (const n of ["implementation", "acceptance", "test_plan"])
    await engine.store.put(
      "inputs/" + n + ".md",
      "# " + n + "\nAC-SUM: sum(2,3)=5; sum(-1,1)=0\n",
    );
  const draft = {
    task_id: "TASK",
    feature_id: "F1",
    spec_version: 1,
    goal: "Implement sum",
    documents: {
      implementation: "inputs/implementation.md",
      acceptance: "inputs/acceptance.md",
      test_plan: "inputs/test_plan.md",
    },
    command_ids: ["test"],
    acceptance_criteria: [
      {
        id: "AC-SUM",
        requirement_ids: ["REQ-SUM"],
        required: true,
        behavior: "Addition including negatives",
        test_ids: ["TC-SUM"],
      },
    ],
    test_cases: [
      {
        id: "TC-SUM",
        acceptance_ids: ["AC-SUM"],
        command_id: "test",
        expected_result: "both assertions pass",
        required_artifact_types: ["log", "report"],
      },
    ],
  };
  return {
    root,
    config,
    engine,
    draft,
    setCorrect() {
      correct = true;
    },
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
export async function reviewFor(
  engine: Engine,
  runId: string,
  decision = "ACCEPT",
) {
  const run = (await engine.db()).runs[runId];
  const review = await engine.store.read(`runs/${runId}/review.template.json`);
  review.decision = decision;
  review.checks = review.checks.map((c: any) => ({
    ...c,
    verdict: decision === "ACCEPT" ? "pass" : "fail",
    explanation:
      decision === "ACCEPT"
        ? "Read log assertions and code diff; both scenarios correct"
        : "Actual assertion failed: 2 * 3 is 6, expected 5",
  }));
  review.hard_gates = {
    scope_ok: true,
    standards_intact: true,
    handoff_ready: true,
  };
  review.unresolved_blockers = [];
  review.summary = "Fixture coordinator decision";
  review.next_action =
    decision === "ACCEPT"
      ? review.scope === "final"
        ? "deliver"
        : "next_feature"
      : "rework";
  review.block_reason = null;
  review.rework_id = decision === "ACCEPT" ? null : id("rework");
  let rework;
  if (decision === "REVISE") {
    const task = await engine.store.read(run.task_ref);
    rework = {
      ...common(task, "rework", review.rework_id),
      source_review_id: review.message_id,
      source_submission_id: run.candidate.submission_id,
      next_round: run.candidate.round_number + 1,
      snapshot_id: run.candidate.snapshot_id,
      issues: [
        {
          defect_id: "BUG-SUM",
          acceptance_ids: ["AC-SUM"],
          actual: "sum(2,3)=6",
          expected: "sum(2,3)=5",
          evidence_ids: run.evidence.map((e: any) => e.id),
          reproduction: "Run test registry entry",
          repair_scope: ["sum.mjs"],
          retest_ids: ["TC-SUM"],
        },
      ],
    };
  }
  return { review, rework };
}
