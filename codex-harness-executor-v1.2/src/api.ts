import type { Executor } from "./config.ts";
import { Secrets } from "./config.ts";
import { Block, ensure } from "./files.ts";
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  // Some compatible providers require this opaque field on tool continuations.
  reasoning_content?: string | null;
}
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" };
export const workerTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取项目文本文件，返回当前快照；路径为正斜线相对路径。",
      parameters: object({ path: string }),
    },
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description: "在允许读取的文本文件内搜索字面字符串，最多 50 个结果。",
      parameters: object({ query: string }),
    },
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description:
        "原子意图记录后应用严格 unified diff。必须提供最新 snapshot_id。只支持 --- a/path, +++ b/path 和 @@ 行号；新增/删除使用 /dev/null。",
      parameters: object({ snapshot_id: string, patch: string }),
    },
  },
  {
    type: "function",
    function: {
      name: "run_check",
      description: "在临时副本中执行已注册命令；不能提供任意 shell。",
      parameters: object({ command_id: string }),
    },
  },
  {
    type: "function",
    function: {
      name: "submit_candidate",
      description:
        "提交当前代码给 Codex 独立验收。执行器产生实际快照和轮数；此操作不代表验收通过。",
      parameters: object({
        summary: string,
        unresolved_issues: { type: "array", items: string },
      }),
    },
  },
];
export class ModelClient {
  executor: Executor;
  key: string;
  secrets: Secrets;
  event: (v: unknown) => void;
  constructor(
    executor: Executor,
    key: string,
    secrets: Secrets,
    event: (v: unknown) => void = () => {},
  ) {
    this.executor = executor;
    this.key = key;
    this.secrets = secrets;
    this.event = event;
    ensure(key, "AUTH_MISSING", "未设置 " + executor.api_key_env);
  }
  async request(
    messages: Message[],
    tools: ToolDefinition[] = workerTools,
    signal?: AbortSignal,
  ): Promise<Message> {
    const body = JSON.stringify({
      model: this.executor.model,
      messages,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: false,
      stream: false,
    });
    ensure(
      Buffer.byteLength(body) <= this.executor.max_context_bytes,
      "CONTEXT_LIMIT",
      "上下文超过配置上限；需 Codex 缩小任务上下文",
    );
    this.secrets.assertSafe(body);
    for (let attempt = 0; ; attempt++) {
      let retryAfter = 0;
      try {
        const deadline = AbortSignal.timeout(
          this.executor.request_timeout_seconds * 1000,
        );
        const response = await fetch(
          this.executor.base_url.replace(/\/$/, "") + "/chat/completions",
          {
            method: "POST",
            redirect: "error",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + this.key,
            },
            body,
            signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
          },
        );
        if (response.status === 429 || response.status >= 500) {
          retryAfter = Math.min(
            30,
            Math.max(0, Number(response.headers.get("retry-after")) || 0),
          );
          await response.body?.cancel();
          throw new Block("API_RETRY", "临时 API 错误 HTTP " + response.status);
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Block(
            response.status === 401 || response.status === 403
              ? "AUTH_FAILED"
              : "API_PROTOCOL",
            "API 请求失败 HTTP " + response.status + "；未记录响应体以防泄密",
          );
        }
        const reader = response.body?.getReader();
        ensure(reader, "API_PROTOCOL", "API 响应为空");
        let data = "";
        const decoder = new TextDecoder();
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          data += decoder.decode(part.value, { stream: true });
          if (data.length > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new Block("API_PROTOCOL", "API 响应过大");
          }
        }
        data += decoder.decode();
        let raw: any;
        try {
          raw = JSON.parse(data);
        } catch {
          throw new Block("API_PROTOCOL", "API 未返回有效 JSON");
        }
        const choice = raw.choices?.[0];
        ensure(
          choice && choice.finish_reason !== "length",
          "CONTEXT_LIMIT",
          "模型未完成响应，可能达到上下文或输出上限",
        );
        const m = choice.message;
        ensure(
          m?.role === "assistant" &&
            (m.content === undefined ||
              m.content === null ||
              typeof m.content === "string") &&
            Array.isArray(m.tool_calls) &&
            m.tool_calls.length > 0,
          "TOOLS_REQUIRED",
          "模型没有返回工具调用；文字完成声明不能提交候选",
        );
        const ids = new Set();
        for (const call of m.tool_calls) {
          ensure(
            call?.type === "function" &&
              typeof call.id === "string" &&
              !ids.has(call.id) &&
              typeof call.function?.name === "string" &&
              typeof call.function?.arguments === "string",
            "API_PROTOCOL",
            "无效工具调用格式",
          );
          ids.add(call.id);
        }
        const msg: Message = {
          role: "assistant",
          content: m.content ?? null,
          tool_calls: m.tool_calls,
        };
        if (m.reasoning_content !== undefined) {
          ensure(
            m.reasoning_content === null ||
              typeof m.reasoning_content === "string",
            "API_PROTOCOL",
            "无效 reasoning_content 类型",
          );
          msg.reasoning_content = m.reasoning_content;
        }
        this.secrets.assertSafe(JSON.stringify(msg));
        return msg;
      } catch (e) {
        if (signal?.aborted) throw new Block("STOPPED", "运行已停止");
        const retry =
          e instanceof Block
            ? e.code === "API_RETRY"
            : e instanceof TypeError || (e as Error).name === "TimeoutError";
        if (!retry || attempt >= this.executor.max_request_retries) throw e;
        const ms = (retryAfter || 2 ** attempt) * 1000;
        this.event({ phase: "api_retry", retry: attempt + 1, delay_ms: ms });
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(t);
            reject(new Block("STOPPED", "已停止"));
          };
          const t = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
          }, ms);
          signal?.addEventListener("abort", abort, { once: true });
        });
      }
    }
  }
  async probe(signal?: AbortSignal) {
    const tools: ToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "capability_probe",
          description: "Return the given nonce exactly.",
          parameters: object({ nonce: string }),
        },
      },
    ];
    const nonce = crypto.randomUUID();
    const messages: Message[] = [
      { role: "user", content: "Call capability_probe with nonce " + nonce },
    ];
    const first = await this.request(messages, tools, signal);
    ensure(
      first.tool_calls?.length === 1 &&
        first.tool_calls[0].function.name === "capability_probe" &&
        JSON.parse(first.tool_calls[0].function.arguments).nonce === nonce,
      "TOOLS_UNSUPPORTED",
      "模型工具能力探测失败",
    );
    messages.push(
      first,
      {
        role: "tool",
        tool_call_id: first.tool_calls[0].id,
        content: JSON.stringify({ nonce, ok: true }),
      },
      {
        role: "user",
        content:
          "Now call capability_probe with nonce " +
          nonce +
          " again to confirm you received the tool response.",
      },
    );
    const second = await this.request(messages, tools, signal);
    ensure(
      second.tool_calls?.[0]?.function.name === "capability_probe" &&
        JSON.parse(second.tool_calls[0].function.arguments).nonce === nonce,
      "TOOLS_UNSUPPORTED",
      "工具往返探测失败",
    );
    return { tools: true, roundtrip: true };
  }
}
