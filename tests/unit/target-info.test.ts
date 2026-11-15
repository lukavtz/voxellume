import assert from "node:assert/strict";
import test from "node:test";

import { packageRoot } from "../../src/core/root.ts";
import { TOOL_NAMES, targetInfo } from "../../src/core/tools/target-info.ts";

test("targetInfo resolves the working Fabric pin from the shipped pins file", async () => {
  const result = await targetInfo(
    { minecraft: "1.21.1", loader: "fabric" },
    { packageRoot: packageRoot() },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.pins.length >= 1, true);
  assert.equal(result.value.pins[0]?.id, "java-fabric-1.21.1");
  assert.equal(result.value.pins[0]?.template, "fabric-1.21.1");
  assert.deepEqual([...result.value.tools], [...TOOL_NAMES]);
});

test("targetInfo returns an empty list for an unknown version instead of failing", async () => {
  const result = await targetInfo(
    { minecraft: "9.9" },
    { packageRoot: packageRoot() },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.value.pins, []);
});

test("targetInfo reports every shipped pin when no filter is given", async () => {
  const result = await targetInfo({}, { packageRoot: packageRoot() });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.pins.length, 68);
});

test("targetInfo converts a missing pins file into a pins_invalid failure", async () => {
  const result = await targetInfo(
    {},
    { packageRoot: "/nonexistent-voxellume-root" },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "pins_invalid");
});

test("targetInfo converts a throw it cannot classify into internal_error", async () => {
  // A non-string packageRoot makes path.join throw a TypeError: pinsFailure
  // must still resolve an envelope instead of rejecting.
  const result = await targetInfo({}, { packageRoot: undefined as never });
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "internal_error");
  assert.equal(result.error.detail.includes("\n"), false);
  assert.equal(/[A-Za-z]:[\\/]|^\//.test(result.error.detail), false);
});
