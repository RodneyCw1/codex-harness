import { probeProgram } from "./probe.ts";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import type { Config, Command } from "./config.ts";
import { commandEnvironment, Secrets } from "./config.ts";
import { Block, ensure, id, atomic, exists, within, hash } from "./files.ts";
import { processRun, type ProcessResult } from "./process.ts";
import type { ProcessLogOptions } from "./logs.ts";
export interface CheckRunner {
  kind: string;
  probe(signal?: AbortSignal): Promise<unknown>;
  fingerprint?(): Promise<unknown>;
  run(
    command: Command,
    cwd: string,
    protectedPaths: string[],
    signal?: AbortSignal,
    logs?: ProcessLogOptions,
  ): Promise<ProcessResult>;
}
const toml = (v: any): string =>
  Array.isArray(v)
    ? "[" + v.map(toml).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.entries(v)
          .map(([k, x]) => JSON.stringify(k) + "=" + toml(x))
          .join(",") +
        "}"
      : JSON.stringify(v);
export class WindowsSandbox implements CheckRunner {
  kind = "codex-windows";
  config: Config;
  vars: NodeJS.ProcessEnv;
  secrets: Secrets;
  private syntax: string[] | null = null;
  private executable: string | null = null;
  private executableHash: string | null = null;
  constructor(config: Config, vars: NodeJS.ProcessEnv, secrets: Secrets) {
    this.config = config;
    this.vars = vars;
    this.secrets = secrets;
  }
  async detect() {
    ensure(process.platform === "win32", "PLATFORM", "生产沙箱仅支持 Windows");
    if (!this.executable) await this.fingerprint();
    if (this.syntax) return this.syntax;
    const r = await processRun([this.executable!, "sandbox", "--help"], {
      cwd: this.config.project.control_root,
      env: commandEnvironment(
        this.config,
        this.vars,
        path.join(this.config.project.work_root, "tmp"),
      ),
      timeoutMs: 15000,
    });
    ensure(r.exitCode === 0, "SANDBOX_UNAVAILABLE", "Codex CLI sandbox 不可用");
    const help = r.stdout + r.stderr;
    ensure(
      help.includes("--permission-profile"),
      "SANDBOX_CAPABILITY",
      "CLI 缺少显式权限 profile；请使用支持该功能的 Codex CLI",
    );
    if (/Usage:.*sandbox \[OPTIONS\] \[COMMAND\]/i.test(help))
      this.syntax = ["sandbox"];
    else if (/\bwindows\b/.test(help)) {
      const w = await processRun(
        [this.executable!, "sandbox", "windows", "--help"],
        {
          cwd: this.config.project.control_root,
          env: commandEnvironment(
            this.config,
            this.vars,
            path.join(this.config.project.work_root, "tmp"),
          ),
          timeoutMs: 10000,
        },
      );
      ensure(
        w.exitCode === 0 && w.stdout.includes("--permission-profile"),
        "SANDBOX_CAPABILITY",
        "不支持该 CLI 的 Windows sandbox 形式",
      );
      this.syntax = ["sandbox", "windows"];
    } else
      throw new Block("SANDBOX_CAPABILITY", "无法识别 CLI sandbox 命令形式");
    return this.syntax;
  }
  async fingerprint() {
    await fs.mkdir(this.config.project.control_root, { recursive: true });
    const env = commandEnvironment(
      this.config,
      this.vars,
      path.join(this.config.project.work_root, "tmp"),
    );
    const configured = this.config.sandbox.codex_path;
    const lookup = await processRun(
      [
        path.join(
          this.vars.SystemRoot ?? "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Command -Name '${configured.replace(/'/g, "''")}' -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source`,
      ],
      { cwd: this.config.project.control_root, env, timeoutMs: 15000 },
    );
    ensure(
      lookup.exitCode === 0 && lookup.stdout.trim(),
      "SANDBOX_UNAVAILABLE",
      "无法解析 Codex CLI 路径",
    );
    const executable = lookup.stdout.trim();
    const sha256 = hash(await fs.readFile(executable));
    if (this.executableHash !== sha256 || this.executable !== executable)
      this.syntax = null;
    this.executable = executable;
    this.executableHash = sha256;
    const version = await processRun([executable, "--version"], {
      cwd: this.config.project.control_root,
      env,
      timeoutMs: 15000,
    });
    ensure(
      version.exitCode === 0,
      "SANDBOX_UNAVAILABLE",
      "Codex CLI 版本检查失败",
    );
    return {
      executable,
      sha256,
      version: version.stdout.trim(),
      profile: this.config.sandbox.profile,
      network: this.config.sandbox.network,
    };
  }
  async run(
    command: Command,
    cwd: string,
    protectedPaths: string[],
    signal?: AbortSignal,
    logs?: ProcessLogOptions,
  ) {
    const syntax = await this.detect();
    const temp = path.join(cwd, ".harness-tmp");
    await fs.mkdir(temp, { recursive: true });
    const files: Record<string, string> = {
      ":root":
        this.config.sandbox.profile === "trusted_local" ? "read" : "deny",
      ":minimal": "read",
      ":tmpdir": "write",
      ":slash_tmp": "deny",
      [this.config.project.source_root]: "deny",
      [this.config.project.control_root]: "deny",
      [path.dirname(process.execPath)]: "read",
    };
    for (const root of this.config.sandbox.read_roots) {
      ensure(
        !within(root, this.config.project.control_root) &&
          !within(this.config.project.control_root, root) &&
          !within(root, this.config.project.source_root) &&
          !within(this.config.project.source_root, root) &&
          !within(root, this.config.project.work_root) &&
          !within(this.config.project.work_root, root),
        "SANDBOX_ROOT",
        "read_roots 不可覆盖控制、源或工作根目录",
      );
      files[root] = "read";
    }
    files[cwd] = "write";
    for (const p of protectedPaths) files[path.join(cwd, p)] = "read";
    files[path.join(cwd, ".git")] = "deny";
    files[path.join(cwd, ".codex")] = "deny";
    files[path.join(cwd, ".agents")] = "deny";
    if (this.config.private_env_file)
      files[this.config.private_env_file] = "deny";
    const realHome =
      this.vars.CODEX_HOME ??
      (this.vars.USERPROFILE
        ? path.join(this.vars.USERPROFILE, ".codex")
        : undefined);
    if (realHome) files[realHome] = "deny";
    const env = commandEnvironment(this.config, this.vars, temp);
    if (realHome) env.CODEX_HOME = realHome;
    this.secrets.assertSafe(JSON.stringify(env));
    const profile = {
      filesystem: files,
      network:
        this.config.sandbox.network === false
          ? { enabled: false, allow_local_binding: false }
          : this.config.sandbox.network === true
            ? { enabled: true }
            : {
                enabled: true,
                allow_local_binding: false,
                domains: Object.fromEntries([
                  ...this.config.sandbox.network.allow_domains.map((domain) => [
                    domain,
                    "allow",
                  ]),
                ]),
              },
    };
    const argv = [
      this.executable!,
      ...syntax,
      "-C",
      cwd,
      "-P",
      "harness-check",
      "-c",
      "permissions.harness-check=" + toml(profile),
      "-c",
      'windows.sandbox="elevated"',
      ...(typeof this.config.sandbox.network === "boolean"
        ? ["-c", "features.network_proxy=false"]
        : ["-c", "features.network_proxy=true"]),
      "--include-managed-config",
      "--",
      ...command.argv,
    ];
    const r = await processRun(argv, {
      cwd,
      env,
      timeoutMs: command.timeout_seconds * 1000,
      signal,
      logs,
    });
    return this.secrets.clean(r);
  }
  async probe(signal?: AbortSignal) {
    await fs.mkdir(this.config.project.control_root, { recursive: true });
    const root = path.join(
      this.config.project.work_root,
      "probes",
      id("probe"),
    );
    await fs.mkdir(root, { recursive: true });
    const secret = path.join(this.config.project.control_root, id("canary"));
    await fs.writeFile(secret, "PRIVATE_CANARY");
    await fs.writeFile(path.join(root, "protected.txt"), "ORIGINAL");
    await fs.writeFile(path.join(root, "protected-delete.txt"), "ORIGINAL");
    const outside = path.join(
      this.config.project.work_root,
      id("outside-canary"),
    );
    await fs.writeFile(outside, "OUTSIDE");
    const server = net.createServer((socket) => {
      socket.on("error", () => {});
      socket.end("NETWORK_WAS_REACHABLE");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as net.AddressInfo).port;
    const probeSource =
      "(" +
      probeProgram.toString() +
      ")(" +
      JSON.stringify({
        control: secret,
        source: this.config.project.source_root,
        outside,
        allowRead: this.config.sandbox.profile === "trusted_local",
        allowNetwork: this.config.sandbox.network === true,
        port,
        privateFile: this.config.private_env_file,
        codexHome:
          this.vars.CODEX_HOME ??
          (this.vars.USERPROFILE
            ? path.join(this.vars.USERPROFILE, ".codex")
            : null),
        secretNames: [
          "HARNESS_DOCTOR_SECRET",
          ...Object.values(this.config.executors).map((e) => e.api_key_env),
        ],
      }) +
      ")";
    try {
      const result = await this.run(
        {
          id: "doctor",
          argv: [process.execPath, "-e", probeSource],
          cwd: ".",
          timeout_seconds: 30,
          purpose: "baseline",
        },
        root,
        ["protected.txt", "protected-delete.txt"],
        signal,
      );
      const m = /HARNESS_PROBE=(\{[^\r\n]+\})/.exec(result.stdout);
      const checks = m ? JSON.parse(m[1]) : null;
      const ok =
        result.exitCode === 0 &&
        checks &&
        Object.values(checks).every((x) => x === true) &&
        (await fs.readFile(outside, "utf8")) === "OUTSIDE" &&
        (await fs
          .readFile(path.join(root, "protected.txt"), "utf8")
          .catch(() => "<missing>")) === "ORIGINAL";
      const report = {
        ok: !!ok,
        platform: process.platform,
        node: process.version,
        syntax: this.syntax,
        profile: this.config.sandbox.profile,
        network: this.config.sandbox.network,
        ordinary_reads:
          this.config.sandbox.profile === "trusted_local"
            ? "allowed"
            : "denied",
        runtime: await this.fingerprint(),
        checks,
        result,
      };
      await atomic(
        path.join(this.config.project.control_root, "doctor-sandbox.json"),
        report,
      );
      ensure(
        ok,
        "SANDBOX_UNAVAILABLE",
        checks
          ? "沙箱边界失败：" +
              Object.entries(checks)
                .filter(([, ok]) => !ok)
                .map(([name]) => name)
                .join(", ") +
              "。配置的权限边界未满足；详情：doctor-sandbox.json"
          : "沙箱启动或能力检查失败：" +
              result.stderr +
              "；详情见 doctor-sandbox.json",
      );
      return report;
    } finally {
      server.close();
      await fs.unlink(secret).catch(() => {});
    }
  }
}
