import fs from "node:fs/promises";
import path from "node:path";
import {
  ensure,
  safePath,
  snapshot,
  matches,
  textFile,
  exists,
  secretPath,
  atomic,
  excludedPath,
} from "./files.ts";
export async function applyTextPatch(
  root: string,
  patch: string,
  expected: string,
  allowed: string[],
  protectedPaths: string[],
  generatedDirs: string[] = [],
) {
  ensure(
    (await snapshot(root, generatedDirs)).id === expected,
    "STALE_SNAPSHOT",
    "补丁前置快照已变化",
  );
  ensure(
    patch.length <= 1024 * 1024 && !patch.includes("\0"),
    "PATCH_SIZE",
    "补丁无效或过大",
  );
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  let i = 0;
  const edits: { p: string; old: string | null; next: string | null }[] = [];
  while (i < lines.length) {
    const oldHeader = /^--- (a\/(.+)|\/dev\/null)$/.exec(lines[i++]);
    const newHeader = /^\+\+\+ (b\/(.+)|\/dev\/null)$/.exec(lines[i++]);
    ensure(
      oldHeader && newHeader,
      "PATCH_FORMAT",
      "只支持无时间戳的 unified diff",
    );
    const oldPath = oldHeader[2],
      newPath = newHeader[2];
    ensure(oldPath || newPath, "PATCH_FORMAT", "无效文件头");
    ensure(
      !oldPath || !newPath || oldPath === newPath,
      "PATCH_RENAME",
      "请用删除和新增表达改名",
    );
    const p = newPath ?? oldPath;
    ensure(
      !edits.some((x) => x.p.toLowerCase() === p.toLowerCase()),
      "PATCH_DUPLICATE",
      "补丁文件重复",
    );
    await safePath(root, p);
    ensure(
      !matches(p, protectedPaths),
      "PROTECTED_PATH",
      "受保护文件不在允许范围: " + p,
    );
    ensure(
      !excludedPath(p, generatedDirs) &&
        !p.split("/").some((s) => [".git", ".codex", ".agents"].includes(s)) &&
        matches(p, allowed) &&
        !matches(p, protectedPaths),
      "SCOPE",
      "文件不在允许范围: " + p,
    );
    const file = await safePath(root, p);
    const old = oldPath ? await textFile(root, p) : null;
    ensure(oldPath || !(await exists(file)), "PATCH_EXISTS", "新文件已存在");
    const crlf = old?.includes("\r\n") ?? false;
    ensure(
      !crlf || !(old ?? "").replaceAll("\r\n", "").includes("\n"),
      "PATCH_EOL",
      "不自动改写混合换行格式",
    );
    const rawSource = (old ?? "").replace(/\r\n/g, "\n").split("\n");
    if (rawSource.at(-1) === "") rawSource.pop();
    const source = rawSource.map((text, index) => ({
      text,
      newline: index < rawSource.length - 1 || !!old?.endsWith("\n"),
    }));
    const result: { text: string; newline: boolean }[] = [];
    let pos = 0,
      hunks = 0;
    while (i < lines.length && lines[i].startsWith("@@")) {
      const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(
        lines[i++],
      );
      ensure(h, "PATCH_HUNK", "hunk 头无效");
      const oldStart = Number(h[1]),
        oldCount = Number(h[2] ?? 1),
        newStart = Number(h[3]),
        newCount = Number(h[4] ?? 1);
      const start = oldCount === 0 ? oldStart : oldStart - 1;
      ensure(
        start >= pos && start <= source.length,
        "PATCH_OFFSET",
        "hunk 位置无效",
      );
      result.push(...source.slice(pos, start));
      pos = start;
      ensure(
        (newCount === 0 ? newStart : newStart - 1) === result.length,
        "PATCH_OFFSET",
        "新文件行号无效",
      );
      let oc = 0,
        nc = 0;
      let previousSign: string | null = null;
      while (
        i < lines.length &&
        (oc < oldCount ||
          nc < newCount ||
          lines[i] === "\\ No newline at end of file")
      ) {
        const line = lines[i++];
        if (line === "\\ No newline at end of file") {
          ensure(previousSign !== null, "PATCH_EOL", "孤立的文件结尾标记");
          if (previousSign !== "-") result[result.length - 1].newline = false;
          previousSign = null;
          continue;
        }
        const sign = line[0],
          value = line.slice(1);
        ensure([" ", "-", "+"].includes(sign), "PATCH_LINE", "补丁行缺少前缀");
        if (sign !== "+") {
          ensure(
            source[pos]?.text === value,
            "PATCH_CONTEXT",
            "补丁上下文不匹配: " + p,
          );
          ensure(
            source[pos].newline ===
              (lines[i] !== "\\ No newline at end of file"),
            "PATCH_EOL",
            "原文件换行标记不匹配",
          );
          pos++;
          oc++;
        }
        if (sign !== "-") {
          result.push({ text: value, newline: true });
          nc++;
        }
        previousSign = sign;
      }
      ensure(
        oc === oldCount && nc === newCount,
        "PATCH_COUNT",
        "hunk 行数不匹配",
      );
      hunks++;
    }
    ensure(hunks > 0, "PATCH_EMPTY", "文件没有 hunk");
    result.push(...source.slice(pos));
    ensure(
      result.every(
        (line, index) => line.newline || index === result.length - 1,
      ),
      "PATCH_EOL",
      "文件中间不能包含 EOF 标记",
    );
    const next = newPath
      ? result
          .map(
            (line) => line.text + (line.newline ? (crlf ? "\r\n" : "\n") : ""),
          )
          .join("")
      : null;
    ensure(
      newPath || result.length === 0,
      "PATCH_DELETE",
      "删除补丁必须删除所有行",
    );
    edits.push({ p, old, next });
  }
  ensure(edits.length > 0, "PATCH_EMPTY", "补丁为空");
  // The caller journals the whole pre/post tree. All hunks are validated before the first write.
  for (const e of edits) {
    const f = await safePath(root, e.p);
    if (e.next === null) await fs.unlink(f);
    else await atomic(f, e.next);
  }
  return edits.map((x) => x.p);
}
