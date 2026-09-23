import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ModelClient } from "../src/api.ts";
import { Secrets } from "../src/config.ts";
async function fake(fn: (body: any, res: http.ServerResponse) => void) {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const b of req) body += b;
    fn(JSON.parse(body), res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  return {
    base,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
const conf = (base: string) => ({
  protocol: "openai_chat_completions",
  base_url: base,
  api_key_env: "TEST_API_KEY",
  model: "fake",
  request_timeout_seconds: 1,
  max_request_retries: 0,
  max_tool_calls_per_attempt: 10,
  max_attempt_seconds: 10,
  max_context_bytes: 10000,
});
test("server errors stop after exactly three additional retries", async () => {
  let calls = 0;
  const server = await fake((body, response) => {
    calls++;
    response.writeHead(503);
    response.end();
  });
  try {
    const client = new ModelClient(
      { ...conf(server.base), max_request_retries: 3 },
      "fixture-key",
      new Secrets(["fixture-key"]),
    );
    await assert.rejects(
      client.request([{ role: "user", content: "retry" }]),
      /HTTP 503/,
    );
    assert.equal(calls, 4);
  } finally {
    await server.close();
  }
});
test("401 is not retried and response body never leaks", async () => {
  let calls = 0;
  const s = await fake((b, r) => {
    calls++;
    r.writeHead(401);
    r.end("secret-value");
  });
  try {
    await assert.rejects(
      new ModelClient(
        conf(s.base),
        "secret-value",
        new Secrets(["secret-value"]),
      ).request([{ role: "user", content: "hello" }]),
      /HTTP 401/,
    );
    assert.equal(calls, 1);
  } finally {
    await s.close();
  }
});
test("429 retries and roundtrip preserves tool message IDs", async () => {
  let calls = 0;
  const s = await fake((b, r) => {
    if (++calls === 1) {
      r.writeHead(429);
      r.end();
      return;
    }
    if (calls === 3) assert.equal(b.messages[2].tool_call_id, "probe");
    const nonce = /nonce ([\w-]+)/.exec(b.messages.at(-1).content)?.[1];
    r.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "probe",
                  type: "function",
                  function: {
                    name: "capability_probe",
                    arguments: JSON.stringify({ nonce }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  try {
    await new ModelClient(
      { ...conf(s.base), max_request_retries: 1 },
      "secret-value",
      new Secrets(["secret-value"]),
    ).probe();
    assert.equal(calls, 3);
  } finally {
    await s.close();
  }
});
test("context limit, fake completion and timeout are blocking", async () => {
  const s = await fake((b, r) => {
    if (b.messages[0].content === "timeout") return;
    r.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "PASS" },
          },
        ],
      }),
    );
  });
  try {
    const c = new ModelClient(
      conf(s.base),
      "secret-value",
      new Secrets(["secret-value"]),
    );
    await assert.rejects(
      c.request([{ role: "user", content: "x".repeat(20000) }]),
      /上下文/,
    );
    await assert.rejects(
      c.request([{ role: "user", content: "fake" }]),
      /工具调用/,
    );
    await assert.rejects(c.request([{ role: "user", content: "timeout" }]));
  } finally {
    await s.close();
  }
});

test("omitted assistant content supports reasoning tool roundtrip", async () => {
  let calls = 0;
  const opaqueReasoning = "fixture provider continuation";
  const s = await fake((body, response) => {
    calls++;
    if (calls === 2) {
      const previous = body.messages.find((m: any) => m.role === "assistant");
      assert.equal(previous.content, null);
      assert.equal(previous.reasoning_content, opaqueReasoning);
      assert.equal(body.messages[2].tool_call_id, "probe-1");
    }
    const nonce = /nonce ([\w-]+)/.exec(body.messages.at(-1).content)?.[1];
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              reasoning_content: opaqueReasoning,
              tool_calls: [
                {
                  id: "probe-" + calls,
                  type: "function",
                  function: {
                    name: "capability_probe",
                    arguments: JSON.stringify({ nonce }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  try {
    const result = await new ModelClient(
      conf(s.base),
      "fixture-key",
      new Secrets(["fixture-key"]),
    ).probe();
    assert.deepEqual(result, { tools: true, roundtrip: true });
    assert.equal(calls, 2);
  } finally {
    await s.close();
  }
});

test("reasoning metadata remains subject to type and secret validation", async () => {
  let value: unknown = { invalid: true };
  const s = await fake((body, response) => {
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              reasoning_content: value,
              tool_calls: [
                {
                  id: "probe",
                  type: "function",
                  function: { name: "capability_probe", arguments: "{}" },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  try {
    const client = new ModelClient(
      conf(s.base),
      "fixture-secret-token",
      new Secrets(["fixture-secret-token"]),
    );
    await assert.rejects(
      client.request([{ role: "user", content: "probe" }]),
      (e: any) => e.code === "API_PROTOCOL",
    );
    value = "fixture-secret-token";
    await assert.rejects(
      client.request([{ role: "user", content: "probe" }]),
      /密钥|秘密|敏感/,
    );
  } finally {
    await s.close();
  }
});
