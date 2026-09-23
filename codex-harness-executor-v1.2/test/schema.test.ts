import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parse } from "yaml";
import Ajv from "ajv/dist/2020.js";
test("published v1.1 config example matches its schema and legacy config remains valid", async () => {
  const schema = JSON.parse(
    await fs.readFile("schemas/config.schema.json", "utf8"),
  );
  const validate = new (Ajv as any)({ strict: false }).compile(schema);
  const config = parse(
    await fs.readFile("examples/harness.config.yaml", "utf8"),
  );
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
  const legacy = {
    schema_version: "1.0",
    executor: config.executors.primary,
    project: config.project,
  };
  assert.equal(validate(legacy), true, JSON.stringify(validate.errors));
});
