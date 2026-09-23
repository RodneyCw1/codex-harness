import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { processRun } from "../src/process.ts";
import { normalizeConfig, Secrets } from "../src/config.ts";
import { initialize } from "../src/workspace.ts";
import { id } from "../src/files.ts";
test("Git worktree includes dirty and untracked files while original checkout remains intact", async () => {
  const root = path.resolve(".test-data/git-" + id("case"));
  const source = path.join(root, "source");
  await fs.mkdir(source, { recursive: true });
  const git = async (...args: string[]) => {
    const r = await processRun(["git", ...args], {
      cwd: source,
      env: process.env,
      timeoutMs: 10000,
    });
    assert.equal(r.exitCode, 0, r.stderr);
    return r.stdout;
  };
  await git("init");
  await fs.writeFile(path.join(source, "a.txt"), "base\n");
  await git("add", "a.txt");
  await git(
    "-c",
    "user.name=Harness Test",
    "-c",
    "user.email=harness-test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Test baseline",
  );
  await fs.writeFile(path.join(source, "a.txt"), "dirty\n");
  await fs.writeFile(path.join(source, "new.txt"), "untracked\n");
  const before = await git("status", "--porcelain");
  const config = normalizeConfig(
    {
      schema_version: "1.1",
      executors: {
        worker: {
          protocol: "openai_chat_completions",
          base_url: "https://example.org/v1",
          api_key_env: "WORK_KEY",
          model: "test",
        },
      },
      project: {
        source_root: source,
        work_root: path.join(root, "work"),
        control_root: path.join(root, "control"),
      },
    },
    ".",
  );
  const result = await initialize(config, new Secrets([]));
  assert.equal(result.mode, "git-worktree");
  assert.equal(
    await fs.readFile(path.join(result.workspace, "a.txt"), "utf8"),
    "dirty\n",
  );
  assert.equal(
    await fs.readFile(path.join(result.workspace, "new.txt"), "utf8"),
    "untracked\n",
  );
  assert.equal(await git("status", "--porcelain"), before);
});
