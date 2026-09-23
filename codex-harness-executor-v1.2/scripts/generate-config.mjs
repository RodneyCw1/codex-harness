import fs from "node:fs/promises";
const string = { type: "string", minLength: 1 };
const strings = { type: "array", items: string };
const integer = (minimum, maximum) => ({
  type: "integer",
  minimum,
  ...(maximum ? { maximum } : {}),
});
const object = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const executor = object(
  {
    protocol: { const: "openai_chat_completions" },
    base_url: string,
    api_key_env: { type: "string", pattern: "^[A-Z_][A-Z0-9_]*$" },
    model: string,
    request_timeout_seconds: integer(1),
    max_request_retries: integer(0, 3),
    max_tool_calls_per_attempt: integer(1),
    max_attempt_seconds: integer(1),
    max_context_bytes: integer(1),
  },
  ["protocol", "base_url", "api_key_env", "model"],
);
const command = object(
  {
    id: string,
    argv: { ...strings, minItems: 1 },
    cwd: { const: "." },
    timeout_seconds: integer(1, 3600),
    purpose: {
      enum: ["init", "baseline", "self_test", "feature", "final", "cleanup"],
    },
  },
  ["id", "argv", "purpose"],
);
const artifact = object(
  {
    path: string,
    type: { enum: ["log", "report", "screenshot", "manifest", "other"] },
    required: { type: "boolean" },
    role: string,
  },
  ["path", "type"],
);
const project = object(
  {
    source_root: string,
    work_root: string,
    control_root: string,
    read_paths: strings,
    allowed_paths: strings,
    protected_paths: strings,
    generated_dirs: strings,
    command_env_allowlist: strings,
    commands: { type: "array", items: command },
    artifacts: {
      type: "object",
      additionalProperties: { type: "array", items: artifact },
    },
  },
  ["source_root", "work_root", "control_root"],
);
const workflow = object({
  active_executor: string,
  concurrency: { const: 1 },
  max_rounds_per_feature: integer(1, 10),
  max_stalled_rounds: integer(1, 3),
  auto_merge: { const: false },
  auto_publish: { const: false },
});
const sandbox = object({
  profile: { enum: ["strict", "trusted_local"] },
  codex_path: string,
  mode: { const: "elevated" },
  read_roots: strings,
  network: {
    anyOf: [
      { type: "boolean" },
      object({ allow_domains: { ...strings, minItems: 1 } }, ["allow_domains"]),
    ],
  },
});
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Codex Harness 配置 v1.2",
  ...object(
    {
      $schema: string,
      schema_version: { enum: ["1.0", "1.1", "1.2"] },
      executor: { $ref: "#/$defs/executor" },
      executors: {
        type: "object",
        minProperties: 1,
        additionalProperties: { $ref: "#/$defs/executor" },
      },
      private_env_file: string,
      workflow,
      project,
      sandbox,
    },
    ["schema_version", "project"],
  ),
  anyOf: [{ required: ["executors"] }, { required: ["executor"] }],
  $defs: { executor },
};
await fs.mkdir("schemas", { recursive: true });
await fs.writeFile(
  "schemas/config.schema.json",
  JSON.stringify(schema, null, 2) + "\n",
);
