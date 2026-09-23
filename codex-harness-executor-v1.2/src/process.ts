import { spawn } from "node:child_process";
import path from "node:path";
import { LogSink, type ProcessLogOptions, type ProcessLogs } from "./logs.ts";
export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  logs?: ProcessLogs;
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
    logs?: ProcessLogOptions;
  },
): Promise<ProcessResult> {
  if (options.logs)
    return processRunLogged(
      argv,
      options as typeof options & { logs: ProcessLogOptions },
    );
  return new Promise((resolve, reject) => {
    let stdout = "",
      stderr = "",
      timedOut = false,
      aborted = false,
      overflow = false,
      killRequested = false,
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
      if (p.pid && !killRequested) {
        killRequested = true;
        void killTree(p.pid);
      }
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

async function processRunLogged(
  argv: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    signal?: AbortSignal;
    logs: ProcessLogOptions;
  },
): Promise<ProcessResult> {
  let pid: number | undefined, killing: Promise<void> | undefined;
  let timedOut = false,
    aborted = false;
  const stop = () => {
    if (pid && !killing) killing = killTree(pid);
  };
  const config = options.logs;
  const stdout = new LogSink(
    config.stdoutPath,
    config.budget,
    config.secrets ?? [],
    stop,
  );
  const stderr = new LogSink(
    config.stderrPath,
    config.budget,
    config.secrets ?? [],
    stop,
  );
  await stdout.open();
  await stderr.open();
  let exitCode: number | null = null;
  if (!config.budget.error) {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    pid = child.pid;
    let startError: Error | undefined;
    const closed = new Promise<number | null>((resolve) => {
      child.once("error", (error) => {
        startError = error;
      });
      child.once("close", resolve);
    });
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
    const consume = async (stream: typeof child.stdout, sink: LogSink) => {
      stream.setEncoding("utf8");
      try {
        for await (const chunk of stream) await sink.append(String(chunk));
        await sink.append("", true);
      } catch {
        sink.fail();
      }
    };
    try {
      const result = await Promise.all([
        closed,
        consume(child.stdout, stdout),
        consume(child.stderr, stderr),
      ]);
      exitCode = result[0];
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      await killing;
      pid = undefined;
    }
    if (startError) {
      // Preserve the actual startup failure through the same redaction pipeline.
      // No process output remains, so this cannot race with stderr writes.
      await stderr.append(
        "\nPROCESS_START_FAILED: " + startError.message + "\n",
        true,
      );
      config.budget.error ??= "PROCESS_START_FAILED";
    }
  }
  const out = await stdout.close(),
    err = await stderr.close();
  const error = config.budget.error;
  return {
    exitCode: error ? null : exitCode,
    stdout: stdout.preview(),
    stderr: stderr.preview(),
    timedOut,
    aborted,
    logs: {
      stdout: out,
      stderr: err,
      complete: !error && !timedOut && !aborted,
      ...(error ? { error } : {}),
    },
  };
}
