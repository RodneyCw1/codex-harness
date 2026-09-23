import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
await fs.mkdir("reports", { recursive: true });
const files = (await fs.readdir("test"))
  .filter((p) => p.endsWith(".test.ts"))
  .map((p) => "test/" + p);
const checks = [
  [
    "typecheck",
    [process.execPath, "node_modules/typescript/bin/tsc", "--noEmit"],
  ],
  [
    "unit-integration",
    [process.execPath, "--test", "--test-concurrency=1", ...files],
  ],
  ["build", [process.execPath, "scripts/build.mjs"]],
  ["cli-help", [process.execPath, "dist/harness.mjs", "--help"]],
  ["cli-version", [process.execPath, "dist/harness.mjs", "--version"]],
  [
    "host",
    [
      process.execPath,
      "--test",
      "--test-concurrency=1",
      "test/host/sandbox.test.ts",
    ],
  ],
  [
    "audit",
    [
      path.join(process.env.SystemRoot, "System32", "cmd.exe"),
      "/d",
      "/c",
      "npm audit --json --cache ../npm-cache",
    ],
  ],
];
const results = [];
for (const [name, argv] of checks) {
  console.log("CHECK " + name);
  const start = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      windowsHide: true,
      shell: false,
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (x) => (stdout += x));
    child.stderr.on("data", (x) => (stderr += x));
    child.once("error", (e) =>
      resolve({ exit_code: null, stdout, stderr: stderr + e.message }),
    );
    child.once("close", (code) => resolve({ exit_code: code, stdout, stderr }));
  });
  await fs.writeFile(
    "reports/" + name + ".txt",
    result.stdout + "\nSTDERR\n" + result.stderr,
  );
  results.push({
    name,
    argv,
    exit_code: result.exit_code,
    duration_ms: Date.now() - start,
    log: name + ".txt",
  });
  console.log(name + ": " + result.exit_code);
}
await fs.writeFile(
  "reports/results.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      results,
      all_pass: results.every((x) => x.exit_code === 0),
      real_model_integration: {
        status: "not_run",
        reason: "未提供真实服务配置和 Key",
      },
    },
    null,
    2,
  ) + "\n",
);
process.exitCode = results.some((r) => r.exit_code !== 0) ? 1 : 0;
