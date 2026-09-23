import { test } from "node:test";
import assert from "node:assert/strict";
import path from 'node:path';
import { normalizeConfig } from "../src/config.ts";
const base = {
  schema_version: "1.1",
  executor: {
    protocol: "openai_chat_completions",
    base_url: "https://example.org/v1",
    api_key_env: "WORK_KEY",
    model: "worker",
  },
  project: {
    source_root: "source",
    work_root: "work",
    control_root: "control",
  },
};

test('absolute Windows interpreter paths normalize before command freezing',()=>{
  const absolute=path.resolve('interpreter/cmd.exe');
  const config=normalizeConfig({...base,project:{...base.project,commands:[{id:'batch',argv:[absolute.replaceAll('\\','/'),'/d','/c','run.cmd','-Dvalue=x'],purpose:'baseline'}]}},'.');
  assert.equal(config.project.commands[0].argv[0],absolute);
  assert.equal(config.project.commands[0].argv.at(-1),'-Dvalue=x');
});
test("trusted local requires explicit 1.2 opt in; legacy keeps strict policy", () => {
  assert.equal(normalizeConfig(base, ".").sandbox.profile, "strict");
  const config = normalizeConfig(
    {
      ...base,
      schema_version: "1.2",
      sandbox: { profile: "trusted_local", network: true },
    },
    ".",
  );
  assert.equal(config.sandbox.profile, "trusted_local");
  assert.equal(config.sandbox.network, true);
  assert.throws(() =>
    normalizeConfig(
      { ...base, sandbox: { profile: "trusted_local", network: true } },
      ".",
    ),
  );
  assert.throws(() =>
    normalizeConfig(
      { ...base, schema_version: "1.2", sandbox: { network: true } },
      ".",
    ),
  );
});
test("generated exclusions cannot name protected or allowed input files", () => {
  assert.throws(() =>
    normalizeConfig(
      {
        ...base,
        project: {
          ...base.project,
          generated_dirs: ["src"],
          allowed_paths: ["src/**"],
        },
      },
      ".",
    ),
  );
  assert.throws(() =>
    normalizeConfig(
      { ...base, project: { ...base.project, generated_dirs: ["../out"] } },
      ".",
    ),
  );
});
