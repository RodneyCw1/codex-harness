import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { Store } from "../src/store.ts";
import { id, snapshot } from "../src/files.ts";
import { normalizeConfig, Secrets } from "../src/config.ts";
import { initialize } from "../src/workspace.ts";
import { killTree, processRun } from "../src/process.ts";

async function controlStore() {
  const root = path.resolve(".test-data/recovery-" + id("case"));
  const store = new Store(path.join(root, "control"));
  await fs.mkdir(store.root, { recursive: true });
  return { root, store };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("recover never deletes a live legacy coordinator lock", async () => {
  const { store } = await controlStore();
  const legacy = { pid: process.pid, token: "legacy-active" };
  await store.put("writer.lock", legacy);
  await assert.rejects(store.recoverLock(), /仍在运行/);
  assert.deepEqual(await store.read("writer.lock"), legacy);
  await assert.rejects(store.recoverLock(), /仍在运行/);
});

for (const [description, content] of [
  ["empty", ""],
  ["truncated", '{"pid":'],
] as const) {
  test(`recovering a ${description} legacy writer.lock permits the next writer`, async () => {
    const { store } = await controlStore();
    await fs.writeFile(store.file("writer.lock"), content);
    await store.recoverLock();
    await store.lock(() => store.put("recovered.json", { complete: true }));
    assert.deepEqual(await store.read("recovered.json"), { complete: true });
  });
}

test("concurrent Store instances never enter the same control directory together", async () => {
  const { store } = await controlStore();
  const second = new Store(store.root);
  const entered = deferred(),
    release = deferred();
  let secondEntered = false;
  const first = store.lock(async () => {
    entered.resolve();
    await release.promise;
    await store.put("owner.json", { owner: "first" });
  });
  try {
    await entered.promise;
    await assert.rejects(
      second.lock(async () => {
        secondEntered = true;
      }),
      { code: "LOCKED" },
    );
    assert.equal(secondEntered, false);
  } finally {
    release.resolve();
    await first;
  }
  await second.lock(() => second.put("owner.json", { owner: "second" }));
  assert.deepEqual(await store.read("owner.json"), { owner: "second" });
});

test("recoverLock cannot steal a writer whose callback is still running", async () => {
  const { store } = await controlStore();
  const entered = deferred(),
    release = deferred();
  const first = store.lock(async () => {
    entered.resolve();
    await release.promise;
  });
  try {
    await entered.promise;
    await assert.rejects(new Store(store.root).recoverLock(), {
      code: "LOCKED",
    });
    await assert.rejects(
      new Store(store.root).lock(async () => {}),
      { code: "LOCKED" },
    );
  } finally {
    release.resolve();
    await first;
  }
});

test("deleting diagnostic writer.lock cannot release an active writer", async () => {
  const { store } = await controlStore();
  const entered = deferred(),
    release = deferred();
  const first = store.lock(async () => {
    entered.resolve();
    await release.promise;
  });
  try {
    await entered.promise;
    await fs.rm(store.file("writer.lock"), { force: true });
    await assert.rejects(new Store(store.root).recoverLock(), {
      code: "LOCKED",
    });
    await assert.rejects(
      new Store(store.root).lock(async () => {}),
      { code: "LOCKED" },
    );
  } finally {
    release.resolve();
    await first;
  }
});

test(
  "a killed coordinator releases the real cross-process Windows writer lock",
  {
    skip: process.platform !== "win32",
    timeout: 25000,
  },
  async () => {
    const { root, store } = await controlStore();
    const childFile = path.join(root, "lock-owner.mjs");
    const storeUrl = pathToFileURL(path.resolve("src/store.ts")).href;
    await fs.writeFile(
      childFile,
      `import {Store} from ${JSON.stringify(storeUrl)};
const store = new Store(${JSON.stringify(store.root)});
await store.lock(async () => {
  process.send({ready: true});
  await new Promise(() => { setInterval(() => {}, 1000); });
});
`,
    );
    const child = spawn(process.execPath, [childFile], {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr!.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    try {
      const ready = await Promise.race([
        once(child, "message"),
        once(child, "exit").then(([code]) => {
          throw new Error(
            `Lock owner exited before ready (${code}): ${stderr}`,
          );
        }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () =>
              reject(new Error("Lock owner readiness timed out: " + stderr)),
            10000,
          );
          timer.unref();
          child.once("message", () => clearTimeout(timer));
        }),
      ]);
      assert.deepEqual(ready[0], { ready: true });
      await assert.rejects(
        store.lock(async () => {}),
        { code: "LOCKED" },
      );
      await assert.rejects(store.recoverLock(), { code: "LOCKED" });

      // Kill only the coordinator, so this also checks abandoned helper cleanup.
      const exited = once(child, "exit");
      assert.equal(child.kill("SIGKILL"), true);
      await exited;
      const deadline = Date.now() + 8000;
      for (;;) {
        try {
          await store.recoverLock();
          await store.lock(() =>
            store.put("after-crash.json", { recovered: true }),
          );
          break;
        } catch (error) {
          if (
            (error as { code?: string }).code !== "LOCKED" ||
            Date.now() >= deadline
          )
            throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      assert.deepEqual(await store.read("after-crash.json"), {
        recovered: true,
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null && child.pid)
        await killTree(child.pid);
    }
  },
);

async function projectConfig(git: boolean) {
  const root = git
    ? path.resolve(".test-data/init-recovery-" + id("case"))
    : await fs.mkdtemp(path.join(os.tmpdir(), "harness-init-recovery-"));
  const source = path.join(root, "source");
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, "source.txt"), "baseline\n");
  const runGit = async (...argv: string[]) => {
    const result = await processRun(["git", ...argv], {
      cwd: source,
      env: process.env,
      timeoutMs: 10000,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    return result.stdout;
  };
  if (git) {
    await runGit("init");
    await runGit("add", "source.txt");
    await runGit(
      "-c",
      "user.name=Harness Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Recovery fixture",
    );
    await fs.writeFile(
      path.join(source, "source.txt"),
      "user uncommitted change\n",
    );
  }
  const config = normalizeConfig(
    {
      schema_version: "1.1",
      executors: {
        worker: {
          protocol: "openai_chat_completions",
          base_url: "https://example.invalid/v1",
          api_key_env: "TEST_UNUSED_KEY",
          model: "unused",
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
  return { config, source, runGit };
}

for (const git of [false, true]) {
  test(
    `initialize retries reuse the existing ${git ? "Git worktree" : "copy"} after project metadata write fails`,
    { timeout: 30000 },
    async () => {
      const { config, source, runGit } = await projectConfig(git);
      const originalSnapshot = await snapshot(source);
      const originalPut = Store.prototype.put;
      let injected = false;
      Store.prototype.put = async function (file, value) {
        if (
          this.root === config.project.control_root &&
          file === "project.json" &&
          !injected
        ) {
          injected = true;
          throw new Error("injected project metadata write interruption");
        }
        return originalPut.call(this, file, value);
      };
      try {
        await assert.rejects(
          initialize(config, new Secrets([])),
          /injected project metadata write interruption/,
        );
      } finally {
        Store.prototype.put = originalPut;
      }
      assert.equal(injected, true);
      const firstWorkspaces = (
        await fs.readdir(config.project.work_root)
      ).filter((name) => name.startsWith("workspace-"));
      assert.equal(firstWorkspaces.length, 1);
      const resumed = await initialize(config, new Secrets([]));
      assert.equal(
        resumed.workspace,
        path.join(config.project.work_root, firstWorkspaces[0]),
      );
      assert.equal(
        (await fs.readdir(config.project.work_root)).filter((name) =>
          name.startsWith("workspace-"),
        ).length,
        1,
      );
      assert.equal((await snapshot(source)).id, originalSnapshot.id);
      assert.equal((await snapshot(resumed.workspace)).id, originalSnapshot.id);
      if (git)
        assert.equal(
          (await runGit("worktree", "list", "--porcelain"))
            .split("\n")
            .filter((line) => line.startsWith("worktree ")).length,
          2,
        );
    },
  );
}

test("initialize on an already initialized project returns the same facts without replacing workspace changes", async () => {
  const { config } = await projectConfig(false);
  const first = await initialize(config, new Secrets([]));
  await fs.writeFile(
    path.join(first.workspace, "source.txt"),
    "executor in progress\n",
  );
  const second = await initialize(config, new Secrets([]));
  assert.equal(second.workspace, first.workspace);
  assert.equal(second.baseline_snapshot, first.baseline_snapshot);
  assert.equal(
    await fs.readFile(path.join(second.workspace, "source.txt"), "utf8"),
    "executor in progress\n",
  );
});
