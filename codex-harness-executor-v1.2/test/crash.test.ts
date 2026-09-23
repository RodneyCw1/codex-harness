import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "./helpers.ts";
import { processRun } from "../src/process.ts";
test(
  "actual executor process exits after file write; a new coordinator reconciles intent and counts once",
  { timeout: 20000 },
  async () => {
    const f = await fixture();
    try {
      f.setCorrect();
      const prepared = await f.engine.prepare(f.draft);
      const configFile = path.join(f.root, "crash-config.json");
      await fs.writeFile(configFile, JSON.stringify(f.config));
      const child = path.join(f.root, "crash-child.mjs");
      const engineUrl = pathToFileURL(path.resolve("src/engine.ts")).href,
        configUrl = pathToFileURL(path.resolve("src/config.ts")).href;
      const source = `import fs from 'node:fs/promises';import path from 'node:path';import {Engine} from ${JSON.stringify(engineUrl)};import {Secrets} from ${JSON.stringify(configUrl)};
const config=JSON.parse(await fs.readFile(${JSON.stringify(configFile)},'utf8'));
const runner={kind:'test-fixture-only',async probe(){return {};},async run(){throw new Error('Unexpected pre-crash check')}};
const engine=new Engine(config,process.env,new Secrets([process.env.HARNESS_TEST_KEY]),runner);
const save=engine.save.bind(engine);engine.save=async(db,type,data)=>{await save(db,type,data);if(type==='patch_intent'){const run=db.runs[db.active_run];const project=await engine.project();await fs.copyFile(engine.store.file('snapshots/'+run.pending.after.slice(7)+'/tree/sum.mjs'),path.join(project.workspace,'sum.mjs'));process.exit(17);}};
await engine.start(${JSON.stringify(prepared.task)});`;
      await fs.writeFile(child, source);
      const exited = await processRun([process.execPath, child], {
        cwd: process.cwd(),
        env: f.engine.vars,
        timeoutMs: 15000,
      });
      assert.equal(exited.exitCode, 17, exited.stderr);
      const before = await f.engine.db();
      const runId = before.active_run!;
      assert.ok(before.runs[runId].pending);
      const batch = before.features["TASK/F1"].batch_id;
      const resumed: any = await f.engine.resume(runId);
      assert.equal(resumed.candidate.round_number, 1);
      const after = await f.engine.db();
      assert.equal(after.features["TASK/F1"].batch_id, batch);
      assert.equal(after.features["TASK/F1"].total_submissions, 1);
      assert.equal(after.runs[runId].pending, null);
    } finally {
      await f.close();
    }
  },
);
