import { spawn } from "node:child_process";
import path from "node:path";
export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}
export async function killTree(pid: number) {
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const p = spawn(
        path.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "taskkill.exe",
        ),
        ["/PID", String(pid), "/T", "/F"],
        {
          windowsHide: true,
          stdio: "ignore",
          env: { SystemRoot: process.env.SystemRoot },
        },
      );
      p.once("error", () => resolve());
      p.once("close", () => resolve());
    });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
}
export function processRun(
  argv: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    signal?: AbortSignal;
    maxOutput?: number;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let stdout = "",
      stderr = "",
      timedOut = false,
      aborted = false,
      overflow = false,
      settled = false;
    const max = options.maxOutput ?? 4 * 1024 * 1024;
    const p = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const stop = () => {
      if (p.pid) void killTree(p.pid);
    };
    const abort = () => {
      aborted = true;
      stop();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    p.stdout.setEncoding("utf8");
    p.stderr.setEncoding("utf8");
    p.stdout.on("data", (x: string) => {
      stdout += x;
      if (stdout.length > max) {
        overflow = true;
        stdout = stdout.slice(0, max);
        stop();
      }
    });
    p.stderr.on("data", (x: string) => {
      stderr += x;
      if (stderr.length > max) {
        overflow = true;
        stderr = stderr.slice(0, max);
        stop();
      }
    });
    const done = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    p.once("error", (e) => {
      if (!settled) {
        settled = true;
        done();
        reject(e);
      }
    });
    p.once("close", (code) => {
      if (!settled) {
        settled = true;
        done();
        resolve({
          exitCode: overflow ? null : code,
          stdout,
          stderr: stderr + (overflow ? "\nOUTPUT_LIMIT" : ""),
          timedOut,
          aborted,
        });
      }
    });
  });
}
