import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOL_SCHEMA_VERSION,
  fail,
  ok,
  serializeToolResult,
} from "../../src/core/results.ts";

test("ok wraps a value in the versioned success envelope", () => {
  const result = ok({ a: 1 });
  assert.deepEqual(result, {
    schemaVersion: "voxellume-tool-1.0.0",
    status: "ok",
    value: { a: 1 },
  });
  assert.equal(TOOL_SCHEMA_VERSION, "voxellume-tool-1.0.0");
});

test("fail carries only a code and a detail", () => {
  const result = fail("task_not_allowed", "--init-script");
  assert.deepEqual(result, {
    schemaVersion: "voxellume-tool-1.0.0",
    status: "error",
    error: { code: "task_not_allowed", detail: "--init-script" },
  });
  assert.equal(Object.hasOwn(result, "value"), false);
});

test("serializeToolResult emits stable JSON with the envelope key order", () => {
  assert.equal(
    serializeToolResult(ok({ files: ["a", "b"], pinId: "p" })),
    '{"schemaVersion":"voxellume-tool-1.0.0","status":"ok","value":{"files":["a","b"],"pinId":"p"}}',
  );
  assert.equal(
    serializeToolResult(fail("pin_not_found", "java-fabric-9.9")),
    '{"schemaVersion":"voxellume-tool-1.0.0","status":"error","error":{"code":"pin_not_found","detail":"java-fabric-9.9"}}',
  );
});
