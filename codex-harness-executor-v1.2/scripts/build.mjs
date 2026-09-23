import { build } from "esbuild";
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
