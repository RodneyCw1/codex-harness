import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { normalizeConfig, Secrets } from "../../src/config.ts";
import { WindowsSandbox } from "../../src/sandbox.ts";
import { exists } from "../../src/files.ts";
test(
  "Windows native sandbox enforces actual filesystem, environment and network boundaries",
  { timeout: 60000 },
  async () => {
    const root = path.resolve(".test-data/native-" + Date.now());
    await fs.mkdir(root, { recursive: true });
    const config = normalizeConfig(
      {
        schema_version: "1.2",
        executors: {
          worker: {
            protocol: "openai_chat_completions",
            base_url: "http://127.0.0.1:9999/v1",
            api_key_env: "HARNESS_DOCTOR_SECRET",
            model: "fake",
          },
        },
        project: {
          source_root: path.join(root, "source"),
          work_root: path.join(root, "work"),
          control_root: path.join(root, "control"),
        },
        sandbox: {
          profile: "trusted_local",
          network: true,
          codex_path: process.env.HARNESS_CODEX_PATH ?? "codex",
        },
      },
      ".",
    );
    await fs.mkdir(config.project.source_root, { recursive: true });
    const vars = {
      ...process.env,
      HARNESS_DOCTOR_SECRET: "DOCTOR_SECRET_SENTINEL",
    };
    let report: any;
    try {
      report = await new WindowsSandbox(
        config,
        vars,
        new Secrets(["DOCTOR_SECRET_SENTINEL"]),
      ).probe();
    } catch (e) {
      const reportText = await fs.readFile(
        path.join(config.project.control_root, "doctor-sandbox.json"),
        "utf8",
      );
      await fs.mkdir("reports", { recursive: true });
      await fs.writeFile("reports/host-sandbox.json", reportText);
      console.error(reportText);
      throw e;
    }
    await fs.mkdir("reports", { recursive: true });
    await fs.writeFile(
      "reports/host-sandbox.json",
      JSON.stringify(report, null, 2),
    );
    assert.equal(report.ok, true);
  },
);
test(
  "Windows native sandbox command cancellation stops the child process tree",
  { timeout: 30000 },
  async () => {
    const root = path.resolve(".test-data/cancel-" + Date.now());
    const cwd = path.join(root, "work", "check");
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(path.join(root, "source"), { recursive: true });
    await fs.mkdir(path.join(root, "control"), { recursive: true });
    const config = normalizeConfig(
      {
        schema_version: "1.2",
        executors: {
          a: {
            protocol: "openai_chat_completions",
            base_url: "https://example.org/v1",
            api_key_env: "WORK_KEY",
            model: "fixture",
          },
        },
        project: {
          source_root: path.join(root, "source"),
          work_root: path.join(root, "work"),
          control_root: path.join(root, "control"),
        },
        sandbox: {
          profile: "trusted_local",
          network: true,
          codex_path: process.env.HARNESS_CODEX_PATH ?? "codex",
        },
      },
      ".",
    );
    const script =
      "require('fs').writeFileSync('heartbeat','start');setInterval(()=>require('fs').writeFileSync('heartbeat',String(Date.now())),100);";
    const parent =
      "require('child_process').spawn(process.execPath,['-e'," +
      JSON.stringify(script) +
      "],{stdio:'ignore'});setInterval(()=>{},1000);";
    const signal = new AbortController();
    const runner = new WindowsSandbox(config, process.env, new Secrets([]));
    const promise = runner.run(
      {
        id: "cancel",
        argv: [process.execPath, "-e", parent],
        cwd: ".",
        timeout_seconds: 15,
        purpose: "baseline",
      },
      cwd,
      [],
      signal.signal,
    );
    for (
      let i = 0;
      i < 100 && !(await exists(path.join(cwd, "heartbeat")));
      i++
    )
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      await exists(path.join(cwd, "heartbeat")),
      true,
      "child must actually start",
    );
    signal.abort();
    const result = await promise;
    assert.equal(result.aborted, true);
    const heartbeat = await fs.readFile(path.join(cwd, "heartbeat"), "utf8");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(
      await fs.readFile(path.join(cwd, "heartbeat"), "utf8"),
      heartbeat,
    );
  },
);
