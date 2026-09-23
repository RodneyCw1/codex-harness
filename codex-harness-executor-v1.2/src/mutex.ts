import { spawn } from "node:child_process";
import path from "node:path";
import { Block, ensure, hash } from "./files.ts";

// The kernel owns the lock. Closing the parent pipe (including a crash) releases it.
export async function windowsMutex(root: string) {
  const name = "Global\\CodexHarness-" + hash(root.toLowerCase()).slice(7);
  const script = `$ErrorActionPreference='Stop';$m=[Threading.Mutex]::new($false,'${name}');$held=$false;try {try {$held=$m.WaitOne(0)} catch [Threading.AbandonedMutexException] {$held=$true};if(!$held){[Console]::Out.WriteLine('LOCKED');exit 2};[Console]::Out.WriteLine('READY');[Console]::Out.Flush();[Console]::In.ReadLine() | Out-Null} finally {if($held){$m.ReleaseMutex()};$m.Dispose()}`;
  const child = spawn(
    path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR },
    },
  );
  const controller = new AbortController();
  let releasing = false;
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => {
      if (!releasing) controller.abort();
      resolve();
    }),
  );
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Block("LOCK_UNAVAILABLE", "Windows 互斥锁启动超时"));
    }, 15000);
    child.once("error", (e) => {
      clearTimeout(timeout);
      reject(new Block("LOCK_UNAVAILABLE", e.message));
    });
    child.once("close", () => {
      clearTimeout(timeout);
      reject(new Block("LOCK_UNAVAILABLE", "Windows 持锁进程未就绪"));
    });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("READY")) {
        clearTimeout(timeout);
        resolve();
      } else if (output.includes("LOCKED")) {
        clearTimeout(timeout);
        reject(new Block("LOCKED", "已有写入进程持有控制目录"));
      }
    });
  });
  return {
    signal: controller.signal,
    assert() {
      ensure(
        !controller.signal.aborted,
        "LOCK_LOST",
        "Windows 持锁进程异常退出，已停止写入",
      );
    },
    async release() {
      releasing = true;
      child.stdin.end("release\n");
      await closed;
    },
  };
}
