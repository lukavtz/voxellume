import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeAdapter,
  qualifyRuntimeAdapter,
  type RuntimeAdapter,
  type RuntimeAdapterId,
  type RuntimeOperationResult,
  type RuntimeSession,
  type RuntimeTarget,
} from "../../src/core/verification/runtime-adapter.ts";

const revisions = {
  modlens: "ba2020c226b51858d157bc943ed13f1c6b578514",
  rogal: "c153433ae8b043afee755d885808c519291103af",
  arclight: "d9387740f005fb5f3fe3c4d2cc97787588448f36",
} as const;

const session: RuntimeSession = {
  id: "session-fixture",
  ownedPids: [4101, 4102],
};

const inputs = {
  launch: {
    projectId: "project-fixture",
    projectRoot: "/isolated/project",
    mode: "hidden" as const,
  },
  worldCreate: {
    sessionId: session.id,
    name: "voxellume-qualification",
    seed: "424242",
    isolated: true as const,
  },
  settle: { sessionId: session.id, ticks: 20 },
  input: {
    sessionId: session.id,
    action: { kind: "key" as const, key: "W", action: "tap" as const },
  },
  command: { sessionId: session.id, command: "time set day" },
  assert: {
    sessionId: session.id,
    condition: "client.inWorld == true",
    timeoutMs: 1_000,
  },
  screenshot: {
    sessionId: session.id,
    path: "qualification.png",
    maxBytes: 1024,
  },
  cancel: { sessionId: session.id, ownedPids: session.ownedPids },
  cleanup: { sessionId: session.id, ownedPids: session.ownedPids },
};

function target(
  minecraftVersion: string,
  loader: RuntimeTarget["loader"] = "fabric",
): RuntimeTarget {
  return { minecraftVersion, loader };
}

function selectedAdapter(
  id: RuntimeAdapterId,
  runtimeTarget: RuntimeTarget,
): RuntimeAdapter {
  const result = createRuntimeAdapter({
    target: runtimeTarget,
    enabledAdapters: [id],
  });
  assert.equal(result.status, "available");
  if (result.status !== "available") throw new Error("unreachable");
  return result.adapter;
}

function assertUnsupported(
  result: RuntimeOperationResult<unknown>,
  adapter: RuntimeAdapterId,
  operation: string,
  code = "unsupported_operation",
): void {
  assert.deepEqual(result, {
    status: "unsupported",
    code,
    adapter,
    operation,
  });
}

test("selects only the exact pinned adapter for each qualified upstream target", async (t) => {
  const cases = [
    {
      id: "modlens" as const,
      target: target("26.3", "neoforge"),
      capabilities: {
        launch: true,
        worldCreate: false,
        settle: true,
        realTicks: false,
        input: true,
        command: false,
        assert: false,
        screenshot: true,
        cancel: true,
        cleanup: true,
      },
    },
    {
      id: "rogal" as const,
      target: target("26.2", "fabric"),
      capabilities: {
        launch: false,
        worldCreate: false,
        settle: true,
        realTicks: true,
        input: true,
        command: true,
        assert: false,
        screenshot: true,
        cancel: false,
        cleanup: true,
      },
    },
    {
      id: "arclight" as const,
      target: target("1.21.1", "fabric"),
      capabilities: {
        launch: false,
        worldCreate: true,
        settle: true,
        realTicks: false,
        input: true,
        command: true,
        assert: true,
        screenshot: true,
        cancel: true,
        cleanup: true,
      },
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.id, () => {
      const adapter = selectedAdapter(fixture.id, fixture.target);
      assert.equal(adapter.id, fixture.id);
      assert.equal(adapter.revision, revisions[fixture.id]);
      assert.deepEqual(adapter.capabilities, fixture.capabilities);
    });
  }

  const neoForgeArclight = selectedAdapter(
    "arclight",
    target("1.21.1", "neoforge"),
  );
  assert.equal(neoForgeArclight.id, "arclight");
});

test("never substitutes a nearby Minecraft version or loader", async (t) => {
  const cases = [
    { id: "modlens" as const, target: target("26.2") },
    { id: "modlens" as const, target: target("26.3.1") },
    { id: "rogal" as const, target: target("26.2", "neoforge") },
    { id: "rogal" as const, target: target("26.3", "fabric") },
    { id: "arclight" as const, target: target("1.21.2", "fabric") },
    { id: "arclight" as const, target: target("1.21.1", "forge") },
    { id: "arclight" as const, target: target("1.21.1", "quilt") },
  ];

  for (const fixture of cases) {
    await t.test(
      `${fixture.id} ${fixture.target.loader} ${fixture.target.minecraftVersion}`,
      () => {
        const result = createRuntimeAdapter({
          target: fixture.target,
          enabledAdapters: [fixture.id],
        });
        assert.deepEqual(result, {
          status: "unavailable",
          code: "runtime_adapter_unavailable",
          target: fixture.target,
        });
      },
    );
  }
});

test("rejects simultaneous upstream adapter enablement before any transport call", () => {
  const result = createRuntimeAdapter({
    target: target("26.3"),
    enabledAdapters: ["modlens", "rogal"],
    transport: {
      call: async () => {
        throw new Error("transport must not be called");
      },
    },
  });
  assert.deepEqual(result, {
    status: "unavailable",
    code: "multiple_runtime_adapters",
    adapters: ["modlens", "rogal"],
  });
});

test("uses the Voxellume verification mod as the only fallback", () => {
  const unavailable = createRuntimeAdapter({
    target: target("1.21.10"),
    enabledAdapters: ["modlens"],
    verificationMod: { installed: false },
  });
  assert.deepEqual(unavailable, {
    status: "unavailable",
    code: "runtime_adapter_unavailable",
    target: target("1.21.10"),
  });

  const fallback = createRuntimeAdapter({
    target: target("1.21.10"),
    enabledAdapters: ["modlens"],
    verificationMod: { installed: true },
  });
  assert.equal(fallback.status, "available");
  if (fallback.status !== "available") return;
  assert.equal(fallback.adapter.id, "voxellume");
  assert.deepEqual(fallback.adapter.capabilities, {
    launch: true,
    worldCreate: true,
    settle: true,
    realTicks: true,
    input: true,
    command: true,
    assert: true,
    screenshot: true,
    cancel: true,
    cleanup: true,
  });

  const exact = createRuntimeAdapter({
    target: target("26.3"),
    enabledAdapters: ["modlens"],
    verificationMod: { installed: true },
  });
  assert.equal(exact.status, "available");
  if (exact.status === "available") {
    assert.equal(exact.adapter.id, "modlens");
  }
});

test("reports unsupported upstream operations without emitting transport requests", async () => {
  const modlens = selectedAdapter("modlens", target("26.3"));
  assertUnsupported(
    await modlens.worldCreate(inputs.worldCreate),
    "modlens",
    "worldCreate",
  );
  assertUnsupported(await modlens.assert(inputs.assert), "modlens", "assert");
  assertUnsupported(
    await modlens.command(inputs.command),
    "modlens",
    "command",
  );

  const rogal = selectedAdapter("rogal", target("26.2"));
  assertUnsupported(await rogal.launch(inputs.launch), "rogal", "launch");
  assertUnsupported(
    await rogal.worldCreate(inputs.worldCreate),
    "rogal",
    "worldCreate",
  );
  assertUnsupported(await rogal.assert(inputs.assert), "rogal", "assert");
  assertUnsupported(await rogal.cancel(inputs.cancel), "rogal", "cancel");

  const arclight = selectedAdapter("arclight", target("1.21.1"));
  assertUnsupported(await arclight.launch(inputs.launch), "arclight", "launch");
  assertUnsupported(
    await arclight.settle(inputs.settle),
    "arclight",
    "settle",
    "real_ticks_unavailable",
  );
});

test("does not expose server.command or schematic.paste through command", async () => {
  let calls = 0;
  const result = createRuntimeAdapter({
    target: target("26.2"),
    enabledAdapters: ["rogal"],
    transport: {
      call: async () => {
        calls += 1;
        throw new Error("forbidden tool reached transport");
      },
    },
  });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;

  for (const command of ["server.command", "schematic.paste"]) {
    assert.deepEqual(
      await result.adapter.command({ sessionId: session.id, command }),
      {
        status: "unsupported",
        code: "command_not_allowed",
        adapter: "rogal",
        operation: "command",
      },
    );
  }
  assert.equal(calls, 0);
});

type OperationName =
  | "launch"
  | "worldCreate"
  | "input"
  | "assert"
  | "screenshot"
  | "cancel"
  | "cleanup";

interface RecordedCall {
  readonly operation: OperationName;
  readonly input: unknown;
}

function syntheticAdapter(failure?: {
  readonly operation: OperationName;
  readonly status: "failed" | "unsupported";
}) {
  const calls: RecordedCall[] = [];
  const capabilities = {
    launch: true,
    worldCreate: true,
    settle: true,
    realTicks: true,
    input: true,
    command: true,
    assert: true,
    screenshot: true,
    cancel: true,
    cleanup: true,
  } as const;

  function result(
    operation: OperationName,
  ): RuntimeOperationResult<Record<string, never>> {
    if (failure?.operation === operation) {
      return {
        status: failure.status,
        code:
          failure.status === "unsupported"
            ? "unsupported_operation"
            : `${operation}_failed`,
        adapter: "voxellume",
        operation,
      };
    }
    return { status: "passed", value: {} };
  }

  const adapter: RuntimeAdapter = {
    id: "voxellume",
    revision: "synthetic-fixture",
    target: target("26.3"),
    capabilities,
    launch: async (input) => {
      calls.push({ operation: "launch", input });
      if (failure?.operation === "launch") {
        return {
          status: failure.status,
          code:
            failure.status === "unsupported"
              ? "unsupported_operation"
              : "launch_failed",
          adapter: "voxellume",
          operation: "launch",
          session,
        };
      }
      return { status: "passed", value: session };
    },
    worldCreate: async (input) => {
      calls.push({ operation: "worldCreate", input });
      return result("worldCreate");
    },
    settle: async () => ({ status: "passed", value: {} }),
    input: async (input) => {
      calls.push({ operation: "input", input });
      return result("input");
    },
    command: async () => ({ status: "passed", value: {} }),
    assert: async (input) => {
      calls.push({ operation: "assert", input });
      return result("assert");
    },
    screenshot: async (input) => {
      calls.push({ operation: "screenshot", input });
      return result("screenshot");
    },
    cancel: async (input) => {
      calls.push({ operation: "cancel", input });
      return result("cancel");
    },
    cleanup: async (input) => {
      calls.push({ operation: "cleanup", input });
      return result("cleanup");
    },
  };
  return { adapter, calls };
}

const qualificationScenario = {
  launch: inputs.launch,
  world: {
    name: "voxellume-qualification",
    seed: "424242",
  },
  input: inputs.input.action,
  assertion: {
    condition: "client.inWorld == true",
    timeoutMs: 1_000,
  },
  screenshot: {
    path: "qualification.png",
    maxBytes: 1024,
  },
};

test("qualification runs the required stages in order and cleans only owned PIDs", async () => {
  const { adapter, calls } = syntheticAdapter();
  const result = await qualifyRuntimeAdapter(adapter, qualificationScenario);

  assert.equal(result.status, "passed");
  assert.deepEqual(
    calls.map((call) => call.operation),
    [
      "launch",
      "worldCreate",
      "input",
      "assert",
      "screenshot",
      "cancel",
      "cleanup",
    ],
  );
  assert.deepEqual(calls[1]?.input, {
    sessionId: session.id,
    name: "voxellume-qualification",
    seed: "424242",
    isolated: true,
  });
  assert.deepEqual(calls.at(-2)?.input, {
    sessionId: session.id,
    ownedPids: [4101, 4102],
  });
  assert.deepEqual(calls.at(-1)?.input, {
    sessionId: session.id,
    ownedPids: [4101, 4102],
  });
  assert.equal(
    calls.some(
      (call) =>
        typeof call.input === "object" &&
        call.input !== null &&
        JSON.stringify(call.input).includes("*"),
    ),
    false,
  );
});

test("every qualification failure stops downstream claims and still cancels and cleans owned PIDs", async (t) => {
  const failures: readonly {
    operation: OperationName;
    expected: readonly OperationName[];
  }[] = [
    { operation: "launch", expected: ["launch", "cancel", "cleanup"] },
    {
      operation: "worldCreate",
      expected: ["launch", "worldCreate", "cancel", "cleanup"],
    },
    {
      operation: "input",
      expected: ["launch", "worldCreate", "input", "cancel", "cleanup"],
    },
    {
      operation: "assert",
      expected: [
        "launch",
        "worldCreate",
        "input",
        "assert",
        "cancel",
        "cleanup",
      ],
    },
    {
      operation: "screenshot",
      expected: [
        "launch",
        "worldCreate",
        "input",
        "assert",
        "screenshot",
        "cancel",
        "cleanup",
      ],
    },
    {
      operation: "cancel",
      expected: [
        "launch",
        "worldCreate",
        "input",
        "assert",
        "screenshot",
        "cancel",
        "cleanup",
      ],
    },
    {
      operation: "cleanup",
      expected: [
        "launch",
        "worldCreate",
        "input",
        "assert",
        "screenshot",
        "cancel",
        "cleanup",
      ],
    },
  ];

  for (const fixture of failures) {
    await t.test(fixture.operation, async () => {
      const { adapter, calls } = syntheticAdapter({
        operation: fixture.operation,
        status: "failed",
      });
      const result = await qualifyRuntimeAdapter(
        adapter,
        qualificationScenario,
      );
      assert.equal(result.status, "failed");
      assert.equal(result.code, `${fixture.operation}_failed`);
      assert.deepEqual(
        calls.map((call) => call.operation),
        fixture.expected,
      );
      const cleanup = calls.at(-1);
      assert.ok(cleanup !== undefined);
      assert.equal(cleanup.operation, "cleanup");
      const cleanupInput: unknown = cleanup.input;
      assert.ok(
        typeof cleanupInput === "object" &&
          cleanupInput !== null &&
          "ownedPids" in cleanupInput,
      );
      assert.deepEqual(cleanupInput.ownedPids, [4101, 4102]);
    });
  }
});

test("an unsupported required qualification operation is not faked as a pass", async () => {
  const { adapter, calls } = syntheticAdapter({
    operation: "worldCreate",
    status: "unsupported",
  });
  const result = await qualifyRuntimeAdapter(adapter, qualificationScenario);

  assert.equal(result.status, "unsupported");
  assert.equal(result.code, "unsupported_operation");
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["launch", "worldCreate", "cancel", "cleanup"],
  );
});
