import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
await build({
  entryPoints: ["src/console/web/app.ts"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  outfile: "dist/ui/app.js",
  minify: true,
});
await fs.copyFile("src/console/web/index.html", "dist/ui/index.html");
await fs.copyFile("src/console/web/app.css", "dist/ui/app.css");
await fs.copyFile("../docs/CONSOLE.zh-CN.md", "CONSOLE.zh-CN.md");
if (process.platform === "win32") {
  const compiler = path.join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
  execFileSync(compiler, ["/nologo", "/target:winexe", "/optimize+", "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll", "/out:" + path.resolve("dist/harness-picker.exe"), path.resolve("scripts/NativePicker.cs")], { stdio: "inherit", windowsHide: true });
}
await fs.cp(
  "../codex-harness-project-template-v1.2/project",
  "dist/onboarding-template/project",
  { recursive: true },
);
const templateFiles = [];
async function inventory(dir, rel = "") {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Template contains a link");
    const name = rel + entry.name;
    if (entry.isDirectory())
      await inventory(path.join(dir, entry.name), name + "/");
    else
      templateFiles.push({
        path: name,
        sha256: createHash("sha256")
          .update(await fs.readFile(path.join(dir, entry.name)))
          .digest("hex"),
      });
  }
}
await inventory("dist/onboarding-template/project");
await fs.writeFile(
  "dist/onboarding-template/inventory.json",
  JSON.stringify({ files: templateFiles }, null, 2) + "\n",
);
await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/harness.mjs",
  sourcemap: true,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
