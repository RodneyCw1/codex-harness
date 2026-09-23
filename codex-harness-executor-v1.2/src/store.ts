import fs from "node:fs/promises";
import path from "node:path";
import { windowsMutex } from "./mutex.ts";
import {
  atomic,
  readJson,
  ensure,
  id,
  digest,
  exists,
  Block,
  relativeName,
} from "./files.ts";
export class Store {
  root: string;
  lease: Awaited<ReturnType<typeof windowsMutex>> | null = null;
  constructor(root: string) {
    this.root = root;
  }
  file(p: string) {
    relativeName(p);
    return path.join(this.root, p);
  }
  async read<T = any>(p: string) {
    return readJson<T>(this.file(p));
  }
  async put(p: string, v: unknown) {
    this.lease?.assert();
    await atomic(this.file(p), v);
  }
  async event(type: string, data: unknown) {
    this.lease?.assert();
    await fs.mkdir(this.root, { recursive: true });
    const e = {
      event_id: id("event"),
      at: new Date().toISOString(),
      type,
      data,
    };
    const h = await fs.open(this.file("events.jsonl"), "a");
    try {
      await h.writeFile(JSON.stringify(e) + "\n");
      await h.sync();
    } finally {
      await h.close();
    }
    return e.event_id;
  }
  async lock<T>(fn: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.root, { recursive: true });
    if (process.platform === "win32") {
      ensure(!this.lease, "LOCKED", "同一控制目录已有写入操作");
      const lease = await windowsMutex(await fs.realpath(this.root));
      this.lease = lease;
      let ownsMetadata = false;
      try {
        const previous = await this.read("writer.lock").catch(() => null);
        if (previous?.pid && !previous.kernel_mutex) {
          try {
            process.kill(previous.pid, 0);
            throw new Block("LOCKED", "旧版写入进程仍在运行");
          } catch (e) {
            if (
              e instanceof Block ||
              (e as NodeJS.ErrnoException).code !== "ESRCH"
            )
              throw e;
          }
        }
        await this.recoverTransactions();
        await this.put("writer.lock", {
          pid: process.pid,
          token: id("lock"),
          kernel_mutex: true,
          created_at: new Date().toISOString(),
        });
        ownsMetadata = true;
        const result = await fn();
        lease.assert();
        return result;
      } finally {
        if (ownsMetadata && !lease.signal.aborted)
          await fs.unlink(this.file("writer.lock")).catch(() => {});
        this.lease = null;
        await lease.release();
      }
    }
    const lock = this.file("writer.lock");
    let h;
    try {
      h = await fs.open(lock, "wx");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new Block(
          "LOCKED",
          "已有写入进程；结束后重试，或使用 resume 恢复失效锁",
        );
      throw e;
    }
    const token = id("lock");
    await h.writeFile(
      JSON.stringify({
        pid: process.pid,
        token,
        created_at: new Date().toISOString(),
      }),
    );
    await h.close();
    try {
      return await fn();
    } finally {
      if ((await readJson(lock).catch(() => null))?.token === token)
        await fs.unlink(lock);
    }
  }
  async recoverLock() {
    if (process.platform === "win32") {
      await this.lock(async () => {
        await this.event("recovered_lock", {
          mechanism: "windows-kernel-mutex",
        });
      });
      return;
    }
    const p = this.file("writer.lock");
    if (!(await exists(p))) return;
    const l = await readJson(p);
    try {
      process.kill(l.pid, 0);
      throw new Block("LOCKED", "写入进程仍在运行，不能恢复锁");
    } catch (e) {
      if (e instanceof Block) throw e;
      ensure(
        (e as NodeJS.ErrnoException).code === "ESRCH",
        "LOCKED",
        "无法确认原进程是否停止",
      );
    }
    await fs.unlink(p);
    await this.event("recovered_lock", { previous_pid: l.pid });
  }
  async commitState(
    current: { revision: number },
    next: any,
    type: string,
    data: unknown,
  ) {
    const actual = await this.read("db.json").catch((e) => {
      if (e.code === "ENOENT") return { revision: 0 };
      throw e;
    });
    ensure(
      actual.revision === current.revision,
      "STATE_CONFLICT",
      "状态版本冲突",
    );
    const transaction = {
      transaction_id: id("transaction"),
      previous_revision: current.revision,
      next,
      type,
      data,
      state_digest: digest(next),
    };
    await this.put("transaction.json", transaction);
    await this.recoverTransactions();
  }
  async recoverTransactions() {
    if (!(await exists(this.file("transaction.json")))) return;
    const t = await this.read("transaction.json");
    ensure(
      digest(t.next) === t.state_digest,
      "TRANSACTION_CORRUPT",
      "待恢复事务损坏",
    );
    const actual = await this.read("db.json").catch((e) => {
      if (e.code === "ENOENT") return { revision: 0 };
      throw e;
    });
    ensure(
      actual.revision === t.previous_revision ||
        (actual.revision === t.next.revision &&
          digest(actual) === t.state_digest),
      "STATE_CONFLICT",
      "事务与当前状态冲突",
    );
    // Per-transaction event is authoritative; events.jsonl is a rebuildable index.
    await this.put(`transactions/${t.transaction_id}.json`, t);
    await this.put("db.json", t.next);
    const log = await fs
      .readFile(this.file("events.jsonl"), "utf8")
      .catch(() => "");
    if (
      !log.split("\n").some((line) => {
        try {
          return JSON.parse(line).data?.transaction_id === t.transaction_id;
        } catch {
          return false;
        }
      })
    ) {
      if (log && !log.endsWith("\n"))
        await fs.appendFile(this.file("events.jsonl"), "\n");
      await this.event(t.type, {
        ...t.data,
        transaction_id: t.transaction_id,
        revision: t.next.revision,
        state_digest: t.state_digest,
      });
    }
    await fs.unlink(this.file("transaction.json"));
  }
  async update(p: string, current: { revision: number }, next: any) {
    const actual = await this.read(p);
    ensure(
      actual.revision === current.revision,
      "STATE_CONFLICT",
      "状态版本冲突",
    );
    next.revision = current.revision + 1;
    await this.put(p, next);
  }
  async immutable(p: string, v: unknown) {
    if (await exists(this.file(p))) {
      ensure(
        digest(await this.read(p)) === digest(v),
        "ID_CONFLICT",
        "对象 ID 已存在但内容不同",
      );
      return;
    }
    await this.put(p, v);
  }
}
