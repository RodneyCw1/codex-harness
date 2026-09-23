import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { id, snapshot, normalizeDiffHeaders } from "../src/files.ts";
test("export normalizes only Git headers, never actual source text", () => {
  const patch =
    'diff --git a/before/a.txt b/after/a.txt\n--- a/before/a.txt\n+++ b/after/a.txt\n@@ -1 +1 @@\n-const x="a/before/value";\n+const x="b/after/value";\n';
  const result = normalizeDiffHeaders(patch);
  assert.match(result, /diff --git a\/a.txt b\/a.txt/);
  assert.match(result, /-const x="a\/before\/value"/);
  assert.match(result, /\+const x="b\/after\/value"/);
});
import { applyTextPatch } from "../src/patch.ts";
test("unified diff adds and deletes files, preserves CRLF and handles distinct EOF markers", async () => {
  const root = path.resolve(".test-data/patch-" + id("case"));
  await fs.mkdir(root, { recursive: true });
  const apply = async (p: string) =>
    applyTextPatch(root, p, (await snapshot(root)).id, ["**"], []);
  await apply("--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+hello\n");
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "hello\n");
  await apply("--- a/a.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-hello\n");
  await assert.rejects(fs.access(path.join(root, "a.txt")));
  await fs.writeFile(path.join(root, "crlf.txt"), "one\r\ntwo\r\n");
  await apply(
    "--- a/crlf.txt\n+++ b/crlf.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n",
  );
  assert.equal(
    await fs.readFile(path.join(root, "crlf.txt"), "utf8"),
    "one\r\nthree\r\n",
  );
  await fs.writeFile(path.join(root, "eof.txt"), "old");
  await apply(
    "--- a/eof.txt\n+++ b/eof.txt\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n",
  );
  assert.equal(await fs.readFile(path.join(root, "eof.txt"), "utf8"), "new\n");
  await apply(
    "--- a/eof.txt\n+++ b/eof.txt\n@@ -1 +1 @@\n-new\n+last\n\\ No newline at end of file\n",
  );
  assert.equal(await fs.readFile(path.join(root, "eof.txt"), "utf8"), "last");
});
