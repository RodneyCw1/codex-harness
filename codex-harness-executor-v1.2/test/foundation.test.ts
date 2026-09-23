import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeConfig } from "../src/config.ts";
import { safePath, snapshot, hash } from "../src/files.ts";
import { applyTextPatch } from "../src/patch.ts";
const root = path.resolve(".test-data/foundation");
await fs.mkdir(root, { recursive: true });
test("legacy executor normalizes; parallel/model fallback forbidden", () => {
  const base = {
    schema_version: "1.0",
    executor: {
      protocol: "openai_chat_completions",
      base_url: "https://example.org/v1",
      api_key_env: "WORK_KEY",
      model: "worker",
    },
    project: {
      source_root: path.join(root, "source"),
      work_root: path.join(root, "work"),
      control_root: path.join(root, "control"),
    },
  };
  assert.equal(normalizeConfig(base, ".").workflow.active_executor, "default");
  assert.throws(() =>
    normalizeConfig({ ...base, workflow: { concurrency: 2 } }, "."),
  );
  assert.throws(() =>
    normalizeConfig(
      {
        ...base,
        executor: { ...base.executor, base_url: "http://example.org" },
      },
      ".",
    ),
  );
});
test("reject traversal, Windows ADS, case aliases, device names and junction escape", async () => {
  for (const p of [
    "../secret",
    "C:/secret",
    "a:secret",
    "A/../b",
    "CON",
    "x.",
    "x\\y",
    "/tmp",
    "a//b",
  ])
    await assert.rejects(safePath(root, p));
  const outside = path.resolve(".test-data/outside");
  await fs.mkdir(outside, { recursive: true });
  await fs
    .symlink(outside, path.join(root, "escape-" + Date.now()), "junction")
    .then(async () => {
      const entries = await fs.readdir(root);
      const link = entries.find((x) => x.startsWith("escape-"))!;
      await assert.rejects(safePath(root, link + "/secret"));
    });
});
test("strict unified patch checks context, snapshot and scope before writing", async () => {
  const ws = path.join(root, "patch-" + Date.now());
  await fs.mkdir(ws, { recursive: true });
  await fs.writeFile(path.join(ws, "a.txt"), "old\n");
  const before = await snapshot(ws);
  const p = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n";
  await assert.rejects(applyTextPatch(ws, p, hash("stale"), ["a.txt"], []));
  await assert.rejects(applyTextPatch(ws, p, before.id, ["b.txt"], []));
  await applyTextPatch(ws, p, before.id, ["a.txt"], []);
  assert.equal(await fs.readFile(path.join(ws, "a.txt"), "utf8"), "new\n");
  await assert.rejects(
    applyTextPatch(ws, p, (await snapshot(ws)).id, ["a.txt"], []),
  );
});
