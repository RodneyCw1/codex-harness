import { build } from "esbuild";
import fs from "node:fs/promises";
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
