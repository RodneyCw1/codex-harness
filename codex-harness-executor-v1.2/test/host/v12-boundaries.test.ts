import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../src/config.ts";
import { WindowsSandbox } from "../../src/sandbox.ts";
import { id, safePath } from "../../src/files.ts";
import { fixture } from "../helpers.ts";
import { Engine } from '../../src/engine.ts';

async function hostFixture() {
  const root = path.resolve(".test-data/v12-host-" + id("boundary"));
  const source = path.join(root, "source");
  const work = path.join(root, "work");
  const control = path.join(root, "control");
  const privateFile = path.join(root, "private", "worker.env");
  const keyName = "HARNESS_V12_HOST_WORKER_KEY";
  const sentinel = "fake-host-key-" + id("secret");
  await Promise.all(
    [source, work, control, path.dirname(privateFile)].map((dir) =>
      fs.mkdir(dir, { recursive: true }),
    ),
  );
  await fs.writeFile(privateFile, `${keyName}=${sentinel}\n`);
  const configFile = path.join(root, "fixture.json");
  await fs.writeFile(
    configFile,
    JSON.stringify(
      {
        schema_version: "1.2",
        private_env_file: privateFile,
        executors: {
          worker: {
            protocol: "openai_chat_completions",
            base_url: "http://127.0.0.1:9999/v1",
            api_key_env: keyName,
            model: "host-fixture-only",
          },
        },
        project: {
          source_root: source,
          work_root: work,
          control_root: control,
          command_env_allowlist: [],
        },
        sandbox: {
          profile: "trusted_local",
          network: true,
          codex_path: process.env.HARNESS_CODEX_PATH ?? "codex",
        },
      },
      null,
      2,
    ),
  );
  const loaded = await loadConfig(configFile);
  assert.equal(
    loaded.vars[keyName],
    sentinel,
    "the fake private-file key was actually loaded before invoking the sandbox",
  );
  return {
    root,
    ...loaded,
    keyName,
    sentinel,
    runner: new WindowsSandbox(loaded.config, loaded.vars, loaded.secrets),
  };
}

test('v1.2 host: hundreds of protected documents do not exceed Windows command limits', {timeout:60000}, async()=>{
  const f=await hostFixture();
  const input=path.join(f.config.project.work_root,'input');
  const docs='docs/harness/standards/long-directory-to-exercise-windows-profile-limits';
  await fs.mkdir(path.join(input,docs),{recursive:true});
  for(let i=0;i<240;i++)await fs.writeFile(path.join(input,docs,`acceptance-${i}.md`),'FROZEN');
  const target=docs+'/acceptance-0.md';
  const script=`const fs=require('fs');if(fs.readFileSync('${target}','utf8')!=='FROZEN')process.exit(3);try{fs.writeFileSync('${target}','BAD');process.exit(4)}catch{}console.log('protected directory verified');`;
  const command={id:'large-project',argv:[process.execPath,'-e',script],cwd:'.',timeout_seconds:30,purpose:'baseline'};
  const engine=new Engine(f.config,f.vars,f.secrets,f.runner);
  const result=await engine.executeCheck({run_id:'large-project'}, {commands:[command],protected_paths:['docs/harness/'],spec_digest:'host-large-documents'},input,command,'baseline');
  assert.equal(result.exitCode,0,result.stderr);
  assert.match(result.stdout,/protected directory verified/);
});

test(
  "v1.2 host: private environment file is unreadable and an actually loaded API key is absent from project commands",
  { timeout: 60000 },
  async () => {
    const f = await hostFixture();
    const report: any = await f.runner.probe();
    assert.equal(report.ok, true);
    assert.equal(report.profile, "trusted_local");
    assert.equal(
      report.checks.private_read,
      true,
      "private-file denial must be exercised, not omitted",
    );
    assert.equal(report.checks.secret_env, true);
    assert.equal(
      report.checks.outside_read,
      true,
      "ordinary read access is expected in the selected profile",
    );
    assert.equal(
      report.checks.network_policy,
      true,
      "configured local TCP connectivity is exercised",
    );
    assert.equal(JSON.stringify(report).includes(f.sentinel), false);
    await fs.mkdir("reports", { recursive: true });
    await fs.writeFile(
      "reports/host-v12-private-boundary.json",
      JSON.stringify(report, null, 2),
    );
  },
);

test(
  "v1.2 host: native command cannot write through a junction to an ordinary external directory",
  { timeout: 60000 },
  async () => {
    const f = await hostFixture();
    const cwd = path.join(f.config.project.work_root, "check");
    const external = path.join(f.root, "external-canary");
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(external, { recursive: true });
    const canary = path.join(external, "canary.txt");
    await fs.writeFile(canary, "UNCHANGED");
    await fs.symlink(external, path.join(cwd, "linked"), "junction");
    await assert.rejects(
      safePath(cwd, "linked/canary.txt"),
      (error: any) => error.code === "LINK",
    );
    const script = `
    const fs = require('node:fs');
    const allowed = fs.readFileSync('linked/canary.txt','utf8') === 'UNCHANGED';
    let writeDenied = false;
    try { fs.writeFileSync('linked/canary.txt', 'BAD'); }
    catch (error) { writeDenied = ['EACCES','EPERM'].includes(error.code); }
    console.log('HARNESS_JUNCTION=' + JSON.stringify({ ordinary_read_allowed: allowed, write_denied: writeDenied }));
    process.exit(allowed && writeDenied ? 0 : 1);
  `;
    const result = await f.runner.run(
      {
        id: "junction-boundary",
        argv: [process.execPath, "-e", script],
        cwd: ".",
        timeout_seconds: 30,
        purpose: "baseline",
      },
      cwd,
      [],
    );
    const match = /HARNESS_JUNCTION=(\{[^\r\n]+\})/.exec(result.stdout);
    assert.ok(
      match,
      "the native sandbox child must actually execute the junction access attempts: " +
        result.stderr,
    );
    const checks = JSON.parse(match[1]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(checks, {
      ordinary_read_allowed: true,
      write_denied: true,
    });
    assert.equal(await fs.readFile(canary, "utf8"), "UNCHANGED");
    await fs.mkdir("reports", { recursive: true });
    await fs.writeFile(
      "reports/host-v12-junction-boundary.json",
      JSON.stringify({ profile: "trusted_local", checks, result }, null, 2),
    );
  },
);

test(
  "v1.2 host: worker read_file refuses an existing junction even when ordinary host reads are allowed",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      const prepared = await f.engine.prepare(f.draft);
      const workspace = (await f.engine.project()).workspace;
      const outside = path.join(f.root, "outside-worker");
      await fs.mkdir(outside, { recursive: true });
      await fs.writeFile(
        path.join(outside, "canary.txt"),
        "WORKER_MUST_NOT_READ",
      );
      await fs.symlink(outside, path.join(workspace, "linked"), "junction");
      await assert.rejects(
        f.engine.tool(
          await f.engine.db(),
          { operations: {} },
          await f.engine.store.read(prepared.task),
          {
            id: "junction-read",
            type: "function",
            function: {
              name: "read_file",
              arguments: JSON.stringify({ path: "linked/canary.txt" }),
            },
          },
          new AbortController().signal,
        ),
        (error: any) => error.code === "LINK",
      );
    } finally {
      await f.close();
    }
  },
);
