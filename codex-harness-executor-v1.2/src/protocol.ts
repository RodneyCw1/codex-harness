import Ajv from "ajv/dist/2020.js";
import schema from "./contracts.schema.json" with { type: "json" };
import fs from "node:fs/promises";
import {
  ensure,
  digest,
  hash,
  safePath,
  matches,
  relativeName,
} from "./files.ts";
const ajv = new (Ajv as any)({ strict: false, allErrors: true });
const validate = ajv.compile(schema);
// Protocol documents are validated at the boundary; semantics are checked below.
export type Doc = Record<string, any>;
export function contract(value: Doc, kind: string, mode = "live") {
  ensure(validate(value), "CONTRACT", JSON.stringify(validate.errors));
  ensure(
    value.kind === kind && value.artifact_mode === mode,
    "CONTRACT",
    "协议类型或 artifact_mode 错误",
  );
}
export function common(
  task: Doc,
  kind: string,
  messageId: string,
  mode = task.artifact_mode,
) {
  return {
    protocol_version: "1.0",
    kind,
    artifact_mode: mode,
    message_id: messageId,
    task_id: task.task_id,
    feature_id: task.feature_id,
    batch_id: task.batch_id,
    spec_version: task.spec_version,
    spec_digest: task.spec_digest,
  };
}
export function bindings(task: Doc, candidate: Doc) {
  return {
    submission_id: candidate.submission_id,
    round_number: candidate.round_number,
    snapshot_id: candidate.snapshot_id,
    scope: task.scope,
  };
}
export function matchBindings(task: Doc, candidate: Doc, v: Doc) {
  for (const [k, x] of Object.entries({
    ...common(task, v.kind, v.message_id),
    ...bindings(task, candidate),
  }))
    ensure(v[k] === x, "STALE_EVIDENCE", "对象版本或快照不匹配: " + k);
}
export function validateTask(task: Doc, mode = "live") {
  contract(task, "task", mode);
  const ac = new Map(task.acceptance_criteria.map((a: Doc) => [a.id, a]));
  const tc = new Map(task.test_cases.map((t: Doc) => [t.id, t]));
  const commands = new Set(task.commands.map((c: Doc) => c.id));
  ensure(
    ac.size === task.acceptance_criteria.length &&
      tc.size === task.test_cases.length &&
      commands.size === task.commands.length,
    "MAPPING",
    "验收项、用例或命令 ID 重复",
  );
  for (const a of task.acceptance_criteria)
    for (const t of a.test_ids)
      ensure(
        (tc.get(t) as Doc)?.acceptance_ids.includes(a.id),
        "MAPPING",
        "需求/验收/测试映射不完整",
      );
  for (const t of task.test_cases) {
    ensure(commands.has(t.command_id), "MAPPING", "测试引用未注册命令");
    for (const a of t.acceptance_ids)
      ensure(
        (ac.get(a) as Doc)?.test_ids.includes(t.id),
        "MAPPING",
        "测试反向映射不完整",
      );
  }
  for (const p of [...task.allowed_paths, ...task.protected_paths]) {
    if (p === "**") continue;
    relativeName(p.replace(/\/\*\*$|\/$/, ""));
  }
  for (const c of task.commands) {
    ensure(c.cwd === "." || !c.cwd.includes(".."), "COMMAND", "命令 cwd 越界");
    ensure(
      c.argv.every((a: any) => typeof a === "string") &&
        c.timeout_seconds > 0 &&
        c.timeout_seconds <= 3600,
      "COMMAND",
      "命令参数无效",
    );
  }
  ensure(
    task.scope !== "final" ||
      (task.feature_id === "FINAL" &&
        task.expected_round === 0 &&
        task.allowed_paths.length === 0),
    "FINAL",
    "最终验收任务必须只读，轮次为零",
  );
}
export async function artifact(root: string, p: string, type = "other") {
  const b = await fs.readFile(await safePath(root, p));
  return { path: p, sha256: hash(b), type };
}
export async function verifyArtifact(root: string, a: Doc) {
  ensure(
    hash(await fs.readFile(await safePath(root, a.path))) === a.sha256,
    "ARTIFACT_CHANGED",
    "证据或规范文件已变化: " + a.path,
  );
}
export function specDigest(task: Doc, protectedFiles: Doc[]) {
  return digest({
    task_id: task.task_id,
    feature_id: task.feature_id,
    spec_version: task.spec_version,
    scope: task.scope,
    goal: task.goal,
    context_refs: task.context_refs,
    document_refs: task.document_refs,
    allowed_paths: task.allowed_paths,
    protected_paths: task.protected_paths,
    acceptance_criteria: task.acceptance_criteria,
    test_cases: task.test_cases,
    commands: task.commands,
    protected_files: protectedFiles,
  });
}
