import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
export class Block extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "Block";
    this.code = code;
  }
}
export function ensure(
  value: unknown,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new Block(code, message);
}
export const hash = (v: string | Buffer) =>
  "sha256:" + crypto.createHash("sha256").update(v).digest("hex");
export const id = (prefix: string) => prefix + "-" + crypto.randomUUID();
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((v as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export const digest = (v: unknown) => hash(canonical(v) + "\n");
export function normalizeDiffHeaders(diff: string) {
  return diff
    .split("\n")
    .map((line) =>
      /^(diff --git |--- |\+\+\+ |Binary files )/.test(line)
        ? line
            .replaceAll("a/before/", "a/")
            .replaceAll("a/after/", "a/")
            .replaceAll("b/before/", "b/")
            .replaceAll("b/after/", "b/")
        : line,
    )
    .join("\n");
}
export function within(root: string, p: string) {
  const r = path.relative(path.resolve(root), path.resolve(p));
  return (
    r === "" ||
    (!r.startsWith(".." + path.sep) && r !== ".." && !path.isAbsolute(r))
  );
}
export function relativeName(p: string) {
  ensure(
    typeof p === "string" &&
      p.length > 0 &&
      p.length < 240 &&
      !p.includes("\\") &&
      !p.includes(":") &&
      !p.startsWith("/") &&
      !/[\x00-\x1f]/.test(p),
    "PATH",
    "路径必须是项目内规范相对路径",
  );
  for (const s of p.split("/"))
    ensure(
      s &&
        s !== "." &&
        s !== ".." &&
        !/~[0-9]/.test(s) &&
        !/[<>"|?*]/.test(s) &&
        !/[. ]$/.test(s) &&
        !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s),
      "PATH",
      "路径含有非法 Windows 名称",
    );
  return p;
}
export async function safePath(root: string, p: string): Promise<string> {
  relativeName(p);
  const full = path.resolve(root, p);
  ensure(within(root, full), "PATH", "路径越界");
  let cur = path.parse(path.resolve(root)).root;
  for (const part of path.relative(cur, full).split(path.sep)) {
    cur = path.join(cur, part);
    try {
      const s = await fs.lstat(cur);
      ensure(!s.isSymbolicLink(), "LINK", "不允许符号链接或 junction");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") break;
      throw e;
    }
  }
  return full;
}
export function matches(p: string, patterns: string[]) {
  p = p.toLowerCase();
  return patterns.some((raw) => {
    const x = raw.toLowerCase();
    return (
      x === "**" ||
      (x.endsWith("/**")
        ? p.startsWith(x.slice(0, -2))
        : x.endsWith("/")
          ? p.startsWith(x)
          : p === x)
    );
  });
}
export function secretPath(p: string) {
  return p
    .split("/")
    .some(
      (s) =>
        (/^\.env(?:\.|$)/i.test(s) &&
          !/(?:example|sample|template)$/i.test(s)) ||
        /^(\.ssh|\.aws|\.azure|\.gnupg|\.npmrc|\.pypirc|credentials(?:\.json)?|auth\.json|id_rsa|id_ed25519)$/i.test(
          s,
        ) ||
        /\.(pem|key|p12|pfx)$/i.test(s),
    );
}
const excluded = new Set([
  ".git",
  ".codex",
  ".agents",
  "node_modules",
  ".venv",
  "venv",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  "target",
  ".codegraph",
  ".harness-tmp",
]);
export function excludedPath(p: string, generatedDirs: string[] = []) {
  return (
    secretPath(p) ||
    p
      .split("/")
      .some(
        (x) =>
          excluded.has(x.toLowerCase()) ||
          generatedDirs.some((d) => d.toLowerCase() === x.toLowerCase()),
      )
  );
}
export interface Entry {
  path: string;
  sha256: string;
  size: number;
  executable: boolean;
}
export interface Snapshot {
  id: string;
  files: Entry[];
  exclusions: { path: string; reason: string }[];
}
export async function snapshot(
  root: string,
  generatedDirs: string[] = [],
): Promise<Snapshot> {
  const files: Entry[] = [];
  const exclusions: Snapshot["exclusions"] = [];
  const names = new Set<string>();
  async function walk(dir: string, prefix: string) {
    for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name, "en"),
    )) {
      const p = prefix + e.name;
      relativeName(p);
      ensure(!names.has(p.toLowerCase()), "CASE_COLLISION", "大小写冲突: " + p);
      names.add(p.toLowerCase());
      if (excludedPath(p, generatedDirs)) {
        exclusions.push({
          path: p,
          reason: secretPath(p) ? "credential" : "generated-or-metadata",
        });
        continue;
      }
      const full = await safePath(root, p);
      const stat = await fs.lstat(full);
      if (stat.isDirectory()) {
        await walk(full, p + "/");
        continue;
      }
      ensure(stat.isFile(), "FILE_TYPE", "不支持的文件类型: " + p);
      ensure(stat.size <= 20 * 1024 * 1024, "FILE_SIZE", "文件过大: " + p);
      const b = await fs.readFile(full);
      files.push({
        path: p,
        sha256: hash(b),
        size: b.length,
        executable: process.platform !== "win32" && !!(stat.mode & 0o111),
      });
    }
  }
  await walk(root, "");
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  exclusions.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { id: digest(files), files, exclusions };
}
export async function copySnapshot(source: string, dest: string, s: Snapshot) {
  await fs.mkdir(dest, { recursive: true });
  for (const e of s.files) {
    const b = await fs.readFile(await safePath(source, e.path));
    ensure(
      hash(b) === e.sha256,
      "SOURCE_CHANGED",
      "复制期间源文件变化: " + e.path,
    );
    const target = await safePath(dest, e.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, b);
    if (e.executable) await fs.chmod(target, 0o755);
  }
}
export async function readJson<T = any>(p: string): Promise<T> {
  return JSON.parse((await fs.readFile(p, "utf8")).replace(/^\uFEFF/, ""));
}
export async function atomic(p: string, data: unknown) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + "." + crypto.randomUUID() + ".tmp";
  const f = await fs.open(tmp, "wx");
  try {
    await f.writeFile(
      typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n",
    );
    await f.sync();
  } finally {
    await f.close();
  }
  await fs.rename(tmp, p);
}
export async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
export function changed(a: Snapshot, b: Snapshot) {
  const x = new Map(a.files.map((f) => [f.path, f.sha256])),
    y = new Map(b.files.map((f) => [f.path, f.sha256]));
  return [...new Set([...x.keys(), ...y.keys()])]
    .filter((p) => x.get(p) !== y.get(p))
    .sort();
}
export async function textFile(root: string, p: string) {
  ensure(!secretPath(p), "SECRET_PATH", "禁止读取凭据");
  const b = await fs.readFile(await safePath(root, p));
  ensure(
    b.length <= 1024 * 1024 && !b.includes(0),
    "TEXT_ONLY",
    "仅支持不大于 1MB 的文本",
  );
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b);
}
