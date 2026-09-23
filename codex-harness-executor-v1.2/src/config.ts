import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { ensure, within, digest, safePath, relativeName } from "./files.ts";
import type { Verification } from "./verification.ts";
export interface Command {
  id: string;
  argv: string[];
  cwd: string;
  timeout_seconds: number;
  purpose: string;
}
export interface Executor {
  protocol: string;
  base_url: string;
  api_key_env: string;
  model: string;
  request_timeout_seconds: number;
  max_request_retries: number;
  max_tool_calls_per_attempt: number;
  max_attempt_seconds: number;
  max_context_bytes: number;
}
export interface Config {
  schema_version: string;
  executors: Record<string, Executor>;
  workflow: {
    active_executor: string;
    concurrency: 1;
    max_rounds_per_feature: number;
    max_stalled_rounds: number;
    auto_merge: false;
    auto_publish: false;
  };
  project: {
    source_root: string;
    work_root: string;
    control_root: string;
    read_paths: string[];
    allowed_paths: string[];
    protected_paths: string[];
    generated_dirs: string[];
    max_check_log_bytes?: number;
    command_env_allowlist: string[];
    commands: Command[];
    verification?: Record<string, Verification>;
    artifacts: Record<
      string,
      { path: string; type: string; required?: boolean; role?: string }[]
    >;
  };
  sandbox: {
    profile: "strict" | "trusted_local";
    codex_path: string;
    read_roots: string[];
    network: boolean | { allow_domains: string[] };
    mode: string;
  };
  private_env_file?: string;
}
export function normalizeConfig(
  raw: any,
  base: string,
  vars: NodeJS.ProcessEnv = process.env,
): Config {
  ensure(
    raw && ["1.0", "1.1", "1.2", "1.3"].includes(raw.schema_version),
    "CONFIG",
    "schema_version 必须为 1.0、1.1、1.2 或 1.3",
  );
  const expand = (s: unknown): string => {
    ensure(typeof s === "string", "CONFIG", "缺少配置字符串");
    return s.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, k) => {
      ensure(vars[k], "ENV_MISSING", "缺少环境变量 " + k);
      return vars[k]!;
    });
  };
  const roots = raw.project ?? {};
  const p: any = { ...roots };
  for (const k of ["source_root", "work_root", "control_root"])
    p[k] = path.resolve(base, expand(roots[k]));
  const rs = [p.source_root, p.work_root, p.control_root];
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++)
      ensure(
        !within(rs[i], rs[j]) && !within(rs[j], rs[i]),
        "CONFIG",
        "源、工作、控制目录必须互不包含",
      );
  const executors: Record<string, Executor> = {};
  const input =
    raw.executors ?? (raw.executor ? { default: raw.executor } : {});
  for (const [name, v] of Object.entries(input) as [string, any][]) {
    ensure(/^[a-zA-Z0-9_-]+$/.test(name), "CONFIG", "执行者名称无效");
    ensure(
      v.protocol === "openai_chat_completions",
      "PROTOCOL",
      "仅支持 Chat Completions",
    );
    ensure(!("api_key" in v), "SECRET", "配置中只能保存 api_key_env");
    const url = new URL(expand(v.base_url));
    ensure(
      !url.username && !url.password && !url.search && !url.hash,
      "CONFIG",
      "API 地址不可包含凭据或查询参数",
    );
    ensure(
      url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)),
      "CONFIG",
      "远程 API 必须使用 HTTPS",
    );
    ensure(
      /^[A-Z_][A-Z0-9_]*$/.test(v.api_key_env),
      "CONFIG",
      "api_key_env 无效",
    );
    executors[name] = {
      protocol: v.protocol,
      base_url: url.href.replace(/\/$/, ""),
      model: expand(v.model),
      api_key_env: v.api_key_env,
      request_timeout_seconds: v.request_timeout_seconds ?? 120,
      max_request_retries: v.max_request_retries ?? 3,
      max_tool_calls_per_attempt: v.max_tool_calls_per_attempt ?? 100,
      max_attempt_seconds: v.max_attempt_seconds ?? 1800,
      max_context_bytes: v.max_context_bytes ?? 1000000,
    };
    for (const k of [
      "request_timeout_seconds",
      "max_tool_calls_per_attempt",
      "max_attempt_seconds",
      "max_context_bytes",
    ] as const)
      ensure(
        Number.isInteger(executors[name][k]) && executors[name][k] > 0,
        "CONFIG",
        "限制必须为正整数",
      );
    ensure(
      Number.isInteger(executors[name].max_request_retries) &&
        executors[name].max_request_retries >= 0 &&
        executors[name].max_request_retries <= 3,
      "CONFIG",
      "API 额外重试最多三次",
    );
  }
  const w = {
    active_executor: raw.executor ? "default" : Object.keys(executors)[0],
    concurrency: 1,
    max_rounds_per_feature: 10,
    max_stalled_rounds: 3,
    auto_merge: false,
    auto_publish: false,
    ...raw.workflow,
  };
  ensure(
    w.concurrency === 1 && !w.auto_merge && !w.auto_publish,
    "CONFIG",
    "v1.1 只支持串行、待合并交付",
  );
  ensure(executors[w.active_executor], "CONFIG", "active_executor 不存在");
  ensure(
    Number.isInteger(w.max_rounds_per_feature) &&
      w.max_rounds_per_feature >= 1 &&
      w.max_rounds_per_feature <= 10 &&
      Number.isInteger(w.max_stalled_rounds) &&
      w.max_stalled_rounds >= 1 &&
      w.max_stalled_rounds <= 3,
    "CONFIG",
    "轮次上限不得超过 10/3",
  );
  p.read_paths ??= ["**"];
  p.allowed_paths ??= [];
  p.protected_paths ??= ["AGENTS.md"];
  p.command_env_allowlist ??= [];
  p.commands ??= [];
  p.artifacts ??= {};
  ensure(
    p.max_check_log_bytes === undefined ||
      (Number.isSafeInteger(p.max_check_log_bytes) &&
        p.max_check_log_bytes > 0),
    "LOG_CONFIG",
    "max_check_log_bytes 必须为正安全整数",
  );
  ensure(
    p.generated_dirs === undefined ||
      (Array.isArray(p.generated_dirs) &&
        p.generated_dirs.every((x: unknown) => typeof x === "string")),
    "GENERATED_DIR",
    "generated_dirs 必须为目录名数组",
  );
  p.generated_dirs = [
    ...new Set([
      "target",
      ".codegraph",
      ".harness-tmp",
      ...(p.generated_dirs ?? []),
    ]),
  ];
  for (const name of p.generated_dirs) {
    relativeName(name);
    ensure(
      !name.includes("/") && !name.includes("*"),
      "GENERATED_DIR",
      "生成目录必须为单个目录名",
    );
    ensure(
      ![...p.allowed_paths, ...p.protected_paths].some((rule: string) =>
        rule
          .split("/")
          .some((part) => part.toLowerCase() === name.toLowerCase()),
      ),
      "GENERATED_INPUT",
      "生成目录不能覆盖任务范围或受保护输入: " + name,
    );
  }
  for (const rules of [p.read_paths, p.allowed_paths, p.protected_paths]) {
    ensure(Array.isArray(rules), "CONFIG", "路径范围必须为数组");
    for (const rule of rules)
      if (rule !== "**") relativeName(rule.replace(/\/\*\*$|\/$/, ""));
  }
  for (const [commandId, items] of Object.entries(p.artifacts) as [
    string,
    { path: string; type: string; required?: boolean; role?: string }[],
  ][]) {
    ensure(
      p.commands.some((c: Command) => c.id === commandId),
      "ARTIFACT_CONFIG",
      "产物引用了未注册命令",
    );
    for (const item of items) {
      relativeName(item.path);
      ensure(
        item.required === undefined || typeof item.required === "boolean",
        "ARTIFACT_CONFIG",
        "required 必须为布尔值",
      );
      ensure(
        item.role === undefined ||
          (typeof item.role === "string" && item.role.length > 0),
        "ARTIFACT_CONFIG",
        "role 必须为非空字符串",
      );
      ensure(
        ["log", "screenshot", "report", "manifest", "other"].includes(
          item.type,
        ),
        "ARTIFACT_CONFIG",
        "未知产物类型",
      );
    }
  }
  const keys = Object.values(executors).map((e) => e.api_key_env.toLowerCase());
  for (const n of p.command_env_allowlist)
    ensure(
      !/key|token|secret|password|credential|node_options|pythonpath|preload|proxy|codex_home/i.test(
        n,
      ) && !keys.includes(n.toLowerCase()),
      "SECRET_ENV",
      "命令环境不允许 " + n,
    );
  for (const c of p.commands) {
    ensure(
      /^[a-zA-Z0-9_-]+$/.test(c.id) &&
        Array.isArray(c.argv) &&
        c.argv.length > 0 &&
        c.argv.every(
          (a: unknown) => typeof a === "string" && !a.includes("\0"),
        ),
      "COMMAND",
      "命令必须有 ID 和 argv",
    );
    c.cwd ??= ".";
    // The Windows sandbox recognizes cmd.exe by its native executable path.
    // Forward slashes can select the wrong command-line quoting path.
    if (path.isAbsolute(c.argv[0])) c.argv[0] = path.normalize(c.argv[0]);
    ensure(
      c.cwd === ".",
      "COMMAND_CWD",
      "检查命令 cwd 必须为项目根 .；子项目请使用工具参数",
    );
    c.timeout_seconds ??= 600;
    ensure(
      Number.isInteger(c.timeout_seconds) &&
        c.timeout_seconds > 0 &&
        c.timeout_seconds <= 3600,
      "COMMAND",
      "命令超时必须在 1..3600 秒",
    );
  }
  ensure(
    new Set(p.commands.map((c: Command) => c.id)).size === p.commands.length,
    "COMMAND",
    "命令 ID 重复",
  );
  ensure(
    p.verification === undefined ||
      (p.verification &&
        typeof p.verification === "object" &&
        !Array.isArray(p.verification)),
    "VERIFICATION_CONFIG",
    "verification 必须为命令映射",
  );
  for (const [cid, rule] of Object.entries(p.verification ?? {}) as [
    string,
    any,
  ][]) {
    ensure(
      p.commands.some((c: Command) => c.id === cid && c.purpose !== "init"),
      "VERIFICATION_CONFIG",
      "verification 引用了未知或初始化命令",
    );
    ensure(
      rule && ["test", "check"].includes(rule.kind),
      "VERIFICATION_CONFIG",
      "必须声明 test 或 check",
    );
    if (rule.kind === "test") {
      ensure(
        ["junit", "tap"].includes(rule.format),
        "VERIFICATION_CONFIG",
        "只支持 junit 和 tap",
      );
      ensure(
        (rule.source === "stdout" &&
          rule.format === "tap" &&
          rule.files === undefined) ||
          (rule.source === undefined &&
            Array.isArray(rule.files) &&
            rule.files.length > 0),
        "VERIFICATION_CONFIG",
        "选择 TAP stdout 或报告文件",
      );
      for (const pattern of rule.files ?? []) {
        ensure(
          typeof pattern === "string" &&
            pattern.length < 240 &&
            !/[\\\\:\x00-\x1f]/.test(pattern),
          "VERIFICATION_CONFIG",
          "报告模式必须是项目相对路径",
        );
        for (const part of pattern.split("/"))
          ensure(
            part && part !== "." && part !== "..",
            "VERIFICATION_CONFIG",
            "报告模式越界",
          );
      }
    } else
      ensure(
        rule.source === undefined &&
          rule.files === undefined &&
          rule.format === undefined,
        "VERIFICATION_CONFIG",
        "非测试检查不能声明测试报告",
      );
  }
  if (raw.schema_version === "1.3")
    for (const c of p.commands)
      ensure(
        c.purpose === "init" || p.verification?.[c.id],
        "VERIFICATION_CONFIG",
        "1.3 必须声明检查类型: " + c.id,
      );
  const s = {
    profile: "strict",
    codex_path: "codex",
    read_roots: [],
    network: false,
    mode: "elevated",
    ...raw.sandbox,
  };
  ensure(s.mode === "elevated", "SANDBOX", "要求 elevated 沙箱；不自动降级");
  ensure(
    ["strict", "trusted_local"].includes(s.profile),
    "SANDBOX",
    "未知沙箱模式",
  );
  ensure(
    s.profile !== "trusted_local" ||
      ["1.2", "1.3"].includes(raw.schema_version),
    "SANDBOX",
    "trusted_local 必须显式使用 1.2 或 1.3 配置",
  );
  ensure(
    s.network !== true || s.profile === "trusted_local",
    "NETWORK",
    "直接联网需要显式 trusted_local 模式",
  );
  if (s.network !== false && s.network !== true) {
    ensure(
      s.network &&
        Array.isArray(s.network.allow_domains) &&
        s.network.allow_domains.length > 0,
      "NETWORK",
      "网络策略必须为 false 或非空 allow_domains",
    );
    for (const domain of s.network.allow_domains)
      ensure(
        typeof domain === "string" &&
          /^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(
            domain,
          ),
        "NETWORK",
        "仅允许明确 DNS 域名；不开放本机、IP 或全局通配符",
      );
  }
  s.read_roots = s.read_roots.map((x: string) => path.resolve(base, expand(x)));
  const result: Config = {
    schema_version: ["1.2", "1.3"].includes(raw.schema_version)
      ? raw.schema_version
      : "1.1",
    executors,
    workflow: w,
    project: p,
    sandbox: s,
  };
  if (raw.private_env_file)
    result.private_env_file = path.resolve(base, expand(raw.private_env_file));
  return result;
}
export class Secrets {
  values: string[];
  constructor(values: string[]) {
    this.values = values.filter(Boolean);
  }
  clean<T>(v: T): T {
    const s = JSON.stringify(v);
    if (s === undefined) return v;
    let out = s;
    for (const secret of this.values) {
      out = out.split(JSON.stringify(secret).slice(1, -1)).join("[REDACTED]");
    }
    return JSON.parse(out);
  }
  assertSafe(s: string) {
    for (const v of this.values)
      ensure(!s.includes(v), "SECRET_LEAK", "内容包含执行者密钥，操作已阻止");
  }
}
export async function loadConfig(file: string) {
  const raw = parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  return loadConfigValue(raw, file);
}
export async function loadConfigValue(raw: any, file: string) {
  const vars = { ...process.env };
  const base = path.dirname(path.resolve(file));
  if (raw.private_env_file) {
    const p = path.resolve(base, raw.private_env_file);
    const source = path.resolve(
      base,
      String(raw.project?.source_root ?? "").replace(
        /\$\{([^}]+)\}/g,
        (_: string, k: string) => vars[k] ?? "",
      ),
    );
    ensure(!within(source, p), "SECRET_FILE", "私有环境文件必须在项目外");
    await safePath(path.dirname(p), path.basename(p));
    for (const line of (await fs.readFile(p, "utf8")).split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
      ensure(m, "ENV_FILE", "环境文件每行必须为 NAME=value");
      vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  const config = normalizeConfig(raw, base, vars);
  const secrets = new Secrets(
    Object.values(config.executors).map((e) => vars[e.api_key_env] ?? ""),
  );
  secrets.assertSafe(JSON.stringify(config));
  return { config, secrets, vars, configDigest: digest(config) };
}
export function commandEnvironment(
  config: Config,
  vars: NodeJS.ProcessEnv,
  temp: string,
) {
  const env: NodeJS.ProcessEnv = {};
  for (const k of [
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "PATH",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "APPDATA",
    ...config.project.command_env_allowlist,
  ]) {
    const actual = Object.keys(vars).find(
      (x) => x.toLowerCase() === k.toLowerCase(),
    );
    if (actual) env[k] = vars[actual];
  }
  env.TEMP = temp;
  env.TMP = temp;
  env.TMPDIR = temp;
  env.CI = "1";
  for (const e of Object.values(config.executors))
    for (const k of Object.keys(env))
      if (k.toLowerCase() === e.api_key_env.toLowerCase()) delete env[k];
  return env;
}
