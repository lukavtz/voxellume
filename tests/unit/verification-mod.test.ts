import assert from "node:assert/strict";
import test from "node:test";

import type {
  RuntimeCallOptions,
  RuntimeOperationName,
  RuntimeAdapter,
  RuntimeTarget,
  RuntimeTransport,
} from "../../src/core/verification/runtime-adapter.ts";
import {
  createVerificationModAdapter,
  generateVerificationMod,
  type GeneratedVerificationMod,
  type VerificationModGenerationInput,
  type VerificationModGenerationResult,
} from "../../src/core/verification/verification-mod.ts";

const instanceId = "123e4567-e89b-42d3-a456-426614174000";
const token = "test-only-loopback-token";
const fabricTarget: RuntimeTarget = {
  minecraftVersion: "1.21.1",
  loader: "fabric",
};
const releases = [
  "1.21",
  "1.21.1",
  "1.21.2",
  "1.21.3",
  "1.21.4",
  "1.21.5",
  "1.21.6",
  "1.21.7",
  "1.21.8",
  "1.21.9",
  "1.21.10",
  "1.21.11",
  "26.1",
  "26.1.1",
  "26.1.2",
  "26.2",
  "26.3",
] as const;
const loaders = ["fabric", "neoforge", "forge", "quilt"] as const;
const bridgeClassPath =
  "src/test/java/dev/voxellume/verification/VoxellumeVerificationBridge.java";
const entrypointPath =
  "src/test/java/dev/voxellume/verification/fabric/VoxellumeFabricVerificationMod.java";
const metadataPath = "src/test/resources/fabric.mod.json";

function scenario() {
  return {
    id: "ruby_blade_first_person",
    seed: "424242",
    camera: { x: 8.5, y: 72, z: -12.5, yaw: 90, pitch: 15 },
    ticks: 40,
    inputs: [
      { kind: "key" as const, key: "W", action: "tap" as const },
      { kind: "mouse" as const, action: "click" as const, x: 640, y: 360 },
    ],
    assertions: [
      { id: "in_world", condition: "client.inWorld == true" },
      {
        id: "held_item",
        condition: "player.mainHand == ruby_tools:ruby_blade",
      },
    ],
    screenshots: [
      { id: "hand", path: "ruby-blade-hand.png" },
      { id: "placed", path: "ruby-block-placed.png" },
    ],
    production: {
      modId: "ruby_tools",
      modVersion: "1.0.0",
      productionJarSha256: "a".repeat(64),
      environment: "production" as const,
      minecraftVersion: "1.21.1",
      protocolVersion: 767,
      remapped: true as const,
      dependencies: [
        { id: "minecraft", version: "1.21.1" },
        { id: "fabricloader", version: "0.20.1" },
        { id: "fabric-api", version: "0.116.17+1.21.1" },
      ],
      states: {
        ruby_blade_durability: "damage=1;remaining=99",
        ruby_blade_persistent_state: "damage=1;remaining=99",
        ruby_blade_multiplayer_state: "damage=1;remaining=99",
      },
      multiplayer: {
        actor: "alice",
        observer: "bravo",
        serverSessionId: "server-2",
        synchronized: true as const,
      },
      modpack: {
        id: "voxellume_production_test",
        version: "1.0.0",
        declaredMods: [
          "ruby_tools@1.0.0",
          "fabric-api@0.116.17+1.21.1",
          "cloth-config@15.0.140",
        ],
        compatible: true as const,
      },
    },
  };
}

function generationInput(
  target: RuntimeTarget = fabricTarget,
): VerificationModGenerationInput {
  return { target, instanceId, token, scenario: scenario() };
}

function productionInput(production: unknown): VerificationModGenerationInput {
  return {
    ...generationInput(),
    scenario: { ...scenario(), production },
  } as VerificationModGenerationInput;
}

function expectGenerated(
  result: VerificationModGenerationResult,
): GeneratedVerificationMod {
  assert.equal(result.status, "generated");
  if (result.status !== "generated") throw new Error("generation failed");
  return result;
}

function source(plan: GeneratedVerificationMod, outputPath: string): string {
  const file = plan.files.find(
    (candidate) => candidate.outputPath === outputPath,
  );
  assert.ok(file, `missing generated file ${outputPath}`);
  return new TextDecoder().decode(file.contents);
}

test("generates only the deterministic Fabric 1.21.1 baseline with test-only files", () => {
  const input = generationInput();
  const first = expectGenerated(generateVerificationMod(input));
  const second = expectGenerated(generateVerificationMod(input));

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.files.map((file) => file.outputPath),
    [
      bridgeClassPath,
      entrypointPath,
      metadataPath,
      "src/test/resources/voxellume-bridge.json",
      "src/test/resources/voxellume-scenario.json",
    ].sort(),
  );
  assert.equal(
    first.files.every((file) => file.outputPath.startsWith("src/test/")),
    true,
  );
  assert.equal(
    first.files.some((file) => file.outputPath.startsWith("src/main/")),
    false,
  );

  const bridge = source(first, bridgeClassPath);
  assert.match(bridge, /123e4567-e89b-42d3-a456-426614174000/);
  assert.match(bridge, /EXPECTED_MINECRAFT_VERSION = "1\.21\.1"/);
  const entrypoint = source(first, entrypointPath);
  const metadata = source(first, metadataPath);
  assert.match(entrypoint, /implements ModInitializer/);
  assert.match(entrypoint, /VoxellumeFabricVerificationMod/);
  assert.match(metadata, /"entrypoints"/);
  assert.match(metadata, /"minecraft"\s*:\s*"1\.21\.1"/);
});

test("serializes the fixed seed, camera, real ticks, inputs, assertions, and screenshots exactly", () => {
  const plan = expectGenerated(generateVerificationMod(generationInput()));
  const document = JSON.parse(
    source(plan, "src/test/resources/voxellume-scenario.json"),
  );

  assert.deepEqual(document, {
    schemaVersion: "voxellume-verification-scenario-1.0.0",
    instanceId,
    target: { edition: "java", ...fabricTarget },
    ...scenario(),
  });
  assert.equal("generatedAt" in document, false);
  assert.equal("randomId" in document, false);
});

test("publishes a real loopback port and observes the runtime release without command execution", () => {
  const plan = expectGenerated(generateVerificationMod(generationInput()));
  const bridgeJson = JSON.parse(
    source(plan, "src/test/resources/voxellume-bridge.json"),
  );
  assert.deepEqual(bridgeJson, {
    schemaVersion: "voxellume-verification-bridge-1.0.0",
    protocol: "json-lines",
    host: "127.0.0.1",
    port: 0,
    token,
    maxLineBytes: 16_384,
    maxLines: 256,
    allowedOperations: [
      "worldCreate",
      "settle",
      "input",
      "assert",
      "screenshot",
      "cancel",
      "cleanup",
    ],
  });

  const java = source(plan, bridgeClassPath);
  for (const required of [
    "import java.net.InetAddress;",
    "import java.util.UUID;",
    "import net.minecraft.SharedConstants;",
    "InetAddress.getLoopbackAddress()",
    "MessageDigest.isEqual",
    "StandardCharsets.UTF_8",
    "UUID.fromString",
    "SharedConstants.getCurrentVersion().getName()",
    "EXPECTED_MINECRAFT_VERSION",
    "getLocalPort()",
    "MAX_LINE_BYTES",
    "MAX_LINES",
    "readBoundedLine",
  ]) {
    assert.ok(java.includes(required), `missing ${required}`);
  }
  assert.match(java, /"port"/, "bound port must be published to the host");
  assert.equal(java.includes(token), false, "token must come from test config");
  for (const forbidden of [
    "Runtime.getRuntime",
    "ProcessBuilder",
    "voxellume.command",
    "execute_commands",
    "server.command",
    "schematic.paste",
  ]) {
    assert.equal(java.includes(forbidden), false, forbidden);
  }
});

test("returns unsupported for the other 67 target cells and never substitutes Quilt, Forge, or a nearby release", () => {
  const unqualifiedTargets: RuntimeTarget[] = releases.flatMap(
    (minecraftVersion) =>
      loaders
        .filter(
          (loader) => !(minecraftVersion === "1.21.1" && loader === "fabric"),
        )
        .map((loader) => ({ minecraftVersion, loader })),
  );
  assert.equal(unqualifiedTargets.length, 67);
  assert.ok(
    unqualifiedTargets.some(
      (target) =>
        target.loader === "quilt" && target.minecraftVersion === "1.21.1",
    ),
    "Quilt without qualified QSL must be covered",
  );
  assert.ok(
    unqualifiedTargets.some(
      (target) =>
        target.loader === "forge" && target.minecraftVersion === "1.21.2",
    ),
    "Forge 1.21.2 must be covered",
  );
  const targets = [
    ...unqualifiedTargets,
    ...["1.21.0", "1.21.12", "26.0", "26.3.1", "latest"].map(
      (minecraftVersion) => ({ minecraftVersion, loader: "fabric" }),
    ),
    { minecraftVersion: "1.21.1", loader: "Fabric" },
    { minecraftVersion: "1.21.1", loader: "unknown" },
  ] as RuntimeTarget[];

  for (const target of targets) {
    let transportCalls = 0;
    assert.deepEqual(generateVerificationMod(generationInput(target)), {
      status: "unsupported",
      code: "unsupported_target",
      target,
    });
    assert.deepEqual(
      createVerificationModAdapter({
        target,
        instanceId,
        transport: {
          call: async () => {
            transportCalls += 1;
          },
        },
      }),
      { status: "unsupported", code: "unsupported_target", target },
    );
    assert.equal(transportCalls, 0);
  }
});

test("rejects inconsistent or unobservable production expectations", () => {
  const production = scenario().production;
  const invalid: readonly {
    field: string;
    production: unknown;
  }[] = [
    {
      field: "scenario.production.productionJarSha256",
      production: { ...production, productionJarSha256: "not-a-sha256" },
    },
    {
      field: "scenario.production.environment",
      production: { ...production, environment: "development" },
    },
    {
      field: "scenario.production.minecraftVersion",
      production: { ...production, minecraftVersion: "1.21.2" },
    },
    {
      field: "scenario.production.protocolVersion",
      production: { ...production, protocolVersion: 0 },
    },
    {
      field: "scenario.production.remapped",
      production: { ...production, remapped: false },
    },
    {
      field: "scenario.production.dependencies",
      production: { ...production, dependencies: [] },
    },
    {
      field: "scenario.production.states.ruby_blade_multiplayer_state",
      production: {
        ...production,
        states: {
          ...production.states,
          ruby_blade_multiplayer_state: "",
        },
      },
    },
    {
      field: "scenario.production.multiplayer",
      production: {
        ...production,
        multiplayer: { ...production.multiplayer, observer: "alice" },
      },
    },
    {
      field: "scenario.production.multiplayer.synchronized",
      production: {
        ...production,
        multiplayer: { ...production.multiplayer, synchronized: false },
      },
    },
    {
      field: "scenario.production.modpack.declaredMods",
      production: {
        ...production,
        modpack: { ...production.modpack, declaredMods: [] },
      },
    },
    {
      field: "scenario.production.modpack.compatible",
      production: {
        ...production,
        modpack: { ...production.modpack, compatible: false },
      },
    },
  ];

  for (const fixture of invalid) {
    assert.deepEqual(
      generateVerificationMod(productionInput(fixture.production)),
      {
        status: "failed",
        code: "unsafe_scenario",
        field: fixture.field,
      },
    );
  }
});

test("rejects Java, JSON, path, and command injection instead of interpolating snippets", () => {
  const payload = 'ok";\nRuntime.getRuntime().exec("touch /tmp/pwned");//';
  const mutations: readonly {
    field: string;
    input: VerificationModGenerationInput;
  }[] = [
    {
      field: "scenario.id",
      input: {
        ...generationInput(),
        scenario: { ...scenario(), id: payload },
      },
    },
    {
      field: "scenario.seed",
      input: {
        ...generationInput(),
        scenario: { ...scenario(), seed: payload },
      },
    },
    {
      field: "scenario.assertions[0].condition",
      input: {
        ...generationInput(),
        scenario: {
          ...scenario(),
          assertions: [
            { id: "in_world", condition: payload },
            scenario().assertions[1]!,
          ],
        },
      },
    },
    {
      field: "scenario.inputs[1]",
      input: {
        ...generationInput(),
        scenario: {
          ...scenario(),
          inputs: [scenario().inputs[0]!, { kind: "text", text: payload }],
        },
      },
    },
    {
      field: "scenario.screenshots[0].path",
      input: {
        ...generationInput(),
        scenario: {
          ...scenario(),
          screenshots: [
            { id: "hand", path: payload },
            scenario().screenshots[1]!,
          ],
        },
      },
    },
  ];

  for (const mutation of mutations) {
    const result = generateVerificationMod(mutation.input);
    assert.equal(result.status, "failed", mutation.field);
    if (result.status === "failed") {
      assert.equal(result.code, "unsafe_scenario", mutation.field);
      assert.equal(result.field, mutation.field, mutation.field);
    }
  }

  assert.deepEqual(
    generateVerificationMod({ ...generationInput(), instanceId: payload }),
    { status: "failed", code: "invalid_instance_id" },
  );
});

interface RecordedCall {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly options?: RuntimeCallOptions;
}

function adapterHarness(
  observe: (condition: string) => unknown = () => ({ inWorld: true }),
) {
  const calls: RecordedCall[] = [];
  const terminationCalls: number[][] = [];
  const identity = {
    instanceId,
    minecraftVersion: fabricTarget.minecraftVersion,
  };
  const transport: RuntimeTransport = {
    async call(tool, args, options) {
      calls.push({ tool, args, ...(options === undefined ? {} : { options }) });
      if (tool === "voxellume.launch") {
        return {
          ...identity,
          sessionId: "session-fixture",
          ownedPids: [4101, 4102],
          bridgeHost: "127.0.0.1",
          bridgePort: 37_491,
        };
      }
      if (tool === "voxellume.world.create") {
        return {
          ...identity,
          worldName: "voxellume-qualification",
          seed: "424242",
          isolated: true,
          startedAtTick: 0,
        };
      }
      if (tool === "voxellume.ticks.wait") {
        return {
          ...identity,
          startTick: 100,
          endTick: 140,
          synchronized: true,
        };
      }
      if (tool === "voxellume.input") {
        return { ...identity, appliedAction: args.action, atTick: 141 };
      }
      if (tool === "voxellume.assert") {
        return {
          ...identity,
          condition: args.condition,
          passed: true,
          observed: observe(String(args.condition)),
          atTick: 142,
        };
      }
      if (tool === "voxellume.screenshot") {
        return {
          ...identity,
          path: "qualification.png",
          byteLength: 4,
          sha256: "a".repeat(64),
          capturedAtTick: 143,
          width: 1280,
          height: 720,
        };
      }
      if (tool === "voxellume.cancel") {
        return { ...identity, cancelled: true, cancelledAtTick: 144 };
      }
      if (tool === "voxellume.cleanup") {
        return { ...identity, acknowledged: true };
      }
      throw new Error(`unexpected tool ${tool}`);
    },
  };
  const result = createVerificationModAdapter({
    target: fabricTarget,
    instanceId,
    scenario: scenario(),
    transport,
    launcher: {
      async terminateOwnedPids(ownedPids: readonly number[]) {
        terminationCalls.push([...ownedPids]);
        return { terminatedOwnedPids: [...ownedPids], remainingOwnedPids: [] };
      },
    },
  });
  assert.equal(result.status, "available");
  if (result.status !== "available") throw new Error("adapter unavailable");
  return { adapter: result.adapter, calls, terminationCalls };
}

test("adapter rejects a mismatched trusted UUID or actual runtime release", async () => {
  for (const mismatch of [
    { instanceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { minecraftVersion: "1.21.2" },
  ]) {
    let calls = 0;
    const result = createVerificationModAdapter({
      target: fabricTarget,
      instanceId,
      transport: {
        async call() {
          calls += 1;
          return {
            instanceId,
            minecraftVersion: fabricTarget.minecraftVersion,
            ...mismatch,
            sessionId: "wrong-session",
            ownedPids: [4101],
            bridgeHost: "127.0.0.1",
            bridgePort: 37_491,
          };
        },
      },
    });
    assert.equal(result.status, "available");
    if (result.status !== "available") continue;
    assert.deepEqual(
      await result.adapter.launch({
        projectId: "project-fixture",
        projectRoot: "/isolated/project",
        mode: "hidden",
      }),
      {
        status: "failed",
        code: "identity_mismatch",
        adapter: "voxellume",
        operation: "launch",
      },
    );
    assert.equal(calls, 1);
  }
});

test("adapter requires the actual published loopback bridge port", async () => {
  for (const endpoint of [
    { bridgeHost: "127.0.0.1" },
    { bridgeHost: "127.0.0.1", bridgePort: 0 },
    { bridgeHost: "0.0.0.0", bridgePort: 37_491 },
  ]) {
    const result = createVerificationModAdapter({
      target: fabricTarget,
      instanceId,
      transport: {
        async call() {
          return {
            instanceId,
            minecraftVersion: fabricTarget.minecraftVersion,
            sessionId: "session-fixture",
            ownedPids: [4101],
            ...endpoint,
          };
        },
      },
    });
    assert.equal(result.status, "available");
    if (result.status !== "available") continue;
    assert.deepEqual(
      await result.adapter.launch({
        projectId: "project-fixture",
        projectRoot: "/isolated/project",
        mode: "hidden",
      }),
      {
        status: "unavailable",
        code: "bridge_endpoint_unavailable",
        adapter: "voxellume",
        operation: "launch",
      },
    );
  }
});

test("adapter executes the complete lifecycle using observed runtime evidence", async () => {
  const { adapter, calls, terminationCalls } = adapterHarness();
  const identity = { instanceId, minecraftVersion: "1.21.1" };
  assert.equal(adapter.id, "voxellume");
  assert.equal(adapter.revision, "voxellume-verification-mod");
  assert.deepEqual(adapter.capabilities, {
    launch: true,
    worldCreate: true,
    settle: true,
    realTicks: true,
    input: true,
    command: false,
    assert: true,
    screenshot: true,
    cancel: true,
    cleanup: true,
  });

  assert.deepEqual(
    await adapter.launch({
      projectId: "project-fixture",
      projectRoot: "/isolated/project",
      mode: "hidden",
      javaHome: "/opt/jdk-21",
    }),
    {
      status: "passed",
      value: { id: "session-fixture", ownedPids: [4101, 4102] },
    },
  );
  const sessionId = "session-fixture";
  assert.deepEqual(
    await adapter.worldCreate({
      sessionId,
      name: "voxellume-qualification",
      seed: "424242",
      isolated: true,
    }),
    {
      status: "passed",
      value: {
        ...identity,
        worldName: "voxellume-qualification",
        seed: "424242",
        isolated: true,
        startedAtTick: 0,
      },
    },
  );
  assert.deepEqual(
    await adapter.settle({ sessionId, ticks: 40, synchronize: true }),
    {
      status: "passed",
      value: { ...identity, startTick: 100, endTick: 140, synchronized: true },
    },
  );
  assert.deepEqual(
    await adapter.input({
      sessionId,
      action: { kind: "key", key: "W", action: "tap" },
    }),
    {
      status: "passed",
      value: {
        ...identity,
        appliedAction: { kind: "key", key: "W", action: "tap" },
        atTick: 141,
      },
    },
  );
  assert.deepEqual(
    await adapter.assert({
      sessionId,
      condition: "client.inWorld == true",
      timeoutMs: 1_000,
    }),
    {
      status: "passed",
      value: {
        ...identity,
        condition: "client.inWorld == true",
        passed: true,
        observed: { inWorld: true },
        atTick: 142,
      },
    },
  );
  assert.deepEqual(
    await adapter.screenshot({
      sessionId,
      path: "qualification.png",
      maxBytes: 1_024,
    }),
    {
      status: "passed",
      value: {
        ...identity,
        path: "qualification.png",
        byteLength: 4,
        sha256: "a".repeat(64),
        capturedAtTick: 143,
        width: 1280,
        height: 720,
      },
    },
  );
  assert.deepEqual(
    await adapter.cancel({ sessionId, ownedPids: [4101, 4102] }),
    {
      status: "passed",
      value: { ...identity, cancelled: true, cancelledAtTick: 144 },
    },
  );
  assert.deepEqual(
    await adapter.cleanup({ sessionId, ownedPids: [4101, 4102] }),
    {
      status: "passed",
      value: {
        ...identity,
        terminatedOwnedPids: [4101, 4102],
        remainingOwnedPids: [],
      },
    },
  );

  assert.deepEqual(terminationCalls, [[4101, 4102]]);
  assert.deepEqual(
    calls.map(({ tool, args }) => ({ tool, args })),
    [
      {
        tool: "voxellume.launch",
        args: {
          projectId: "project-fixture",
          projectRoot: "/isolated/project",
          mode: "hidden",
          javaHome: "/opt/jdk-21",
        },
      },
      {
        tool: "voxellume.world.create",
        args: {
          sessionId,
          name: "voxellume-qualification",
          seed: "424242",
          isolated: true,
        },
      },
      {
        tool: "voxellume.ticks.wait",
        args: { sessionId, ticks: 40, synchronize: true },
      },
      {
        tool: "voxellume.input",
        args: {
          sessionId,
          action: { kind: "key", key: "W", action: "tap" },
        },
      },
      {
        tool: "voxellume.assert",
        args: {
          sessionId,
          condition: "client.inWorld == true",
          timeoutMs: 1_000,
        },
      },
      {
        tool: "voxellume.screenshot",
        args: { sessionId, path: "qualification.png", maxBytes: 1_024 },
      },
      {
        tool: "voxellume.cancel",
        args: { sessionId, ownedPids: [4101, 4102] },
      },
      {
        tool: "voxellume.cleanup",
        args: { sessionId, ownedPids: [4101, 4102] },
      },
    ],
  );
  assert.equal(
    calls.some((call) => JSON.stringify(call.args).includes("*")),
    false,
    "PID cleanup must never use a wildcard",
  );
});

test("adapter accepts production assertions with structured real observations", async () => {
  const observations = [
    [
      "production.identity",
      {
        environment: "production",
        productionJarSha256: "a".repeat(64),
        modId: "ruby_tools",
        modVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        protocolVersion: 767,
        remapped: true,
        remap: {
          sourceNamespace: "mojang",
          runtimeNamespace: "intermediary",
          mappedClass: "net/minecraft/class_1799",
        },
        dependencies: [
          { id: "minecraft", version: "1.21.1" },
          { id: "fabricloader", version: "0.20.1" },
          { id: "fabric-api", version: "0.116.17+1.21.1" },
        ],
      },
    ],
    [
      "production.server_behavior:ruby_blade_durability",
      {
        id: "ruby_blade_durability",
        state: "damage=1;remaining=99",
        oracle: {
          kind: "item_durability",
          item: "ruby_tools:ruby_blade",
          damage: 1,
          remaining: 99,
        },
      },
    ],
    [
      "production.persistence.before:ruby_blade_persistent_state",
      {
        id: "ruby_blade_persistent_state",
        state: "damage=1;remaining=99",
        savedState: "damage=1;remaining=99",
      },
    ],
    [
      "production.persistence.after:ruby_blade_persistent_state",
      {
        id: "ruby_blade_persistent_state",
        state: "damage=1;remaining=99",
        savedState: "damage=1;remaining=99",
        restoredState: "damage=1;remaining=99",
        sessionId: "server-2",
      },
    ],
    [
      "production.multiplayer:ruby_blade_multiplayer_state",
      {
        id: "ruby_blade_multiplayer_state",
        state: "damage=1;remaining=99",
        actor: "alice",
        observer: "bravo",
        participant: "alice",
        sessionId: "session-fixture",
        serverSessionId: "server-2",
        sharedState: "damage=1;remaining=99",
        serverTick: 144,
        synchronized: true,
      },
    ],
    [
      "production.modpack:voxellume_production_test",
      {
        id: "voxellume_production_test",
        version: "1.0.0",
        declaredMods: [
          "ruby_tools@1.0.0",
          "fabric-api@0.116.17+1.21.1",
          "cloth-config@15.0.140",
        ],
        compatible: true,
        loadedMods: [
          {
            id: "ruby_tools",
            version: "1.0.0",
            origin: "production_jar",
            sha256: "a".repeat(64),
          },
          {
            id: "fabric-api",
            version: "0.116.17+1.21.1",
            origin: "modpack_cache",
            sha256: "b".repeat(64),
          },
          {
            id: "cloth-config",
            version: "15.0.140",
            origin: "modpack_cache",
            sha256: "c".repeat(64),
          },
        ],
      },
    ],
  ] as const;
  const { adapter, calls } = adapterHarness((condition) => {
    const entry = observations.find(([candidate]) => candidate === condition);
    assert.ok(entry, `unexpected condition ${condition}`);
    return entry[1];
  });
  await adapter.launch({
    projectId: "project-fixture",
    projectRoot: "/isolated/project",
    mode: "hidden",
  });

  for (const [condition, observed] of observations) {
    const result = await adapter.assert({
      sessionId: "session-fixture",
      condition,
    });
    assert.equal(result.status, "passed", condition);
    if (result.status === "passed") {
      assert.deepEqual(result.value, {
        instanceId,
        minecraftVersion: "1.21.1",
        condition,
        passed: true,
        observed,
        atTick: 142,
      });
    }
  }

  const assertionCalls = calls.filter(
    (call) => call.tool === "voxellume.assert",
  );
  assert.deepEqual(
    assertionCalls.map((call) => call.args.condition),
    observations.map(([condition]) => condition),
  );
  const callCount = calls.length;
  assert.deepEqual(
    await adapter.assert({
      sessionId: "session-fixture",
      condition: "production.unsupported",
    }),
    {
      status: "unsupported",
      code: "assertion_unavailable",
      adapter: "voxellume",
      operation: "assert",
    },
  );
  assert.equal(calls.length, callCount);
});

test("production observations that disagree with scenario expectations cannot pass", async () => {
  const production = scenario().production;
  const identityObservation = {
    environment: production.environment,
    productionJarSha256: production.productionJarSha256,
    modId: production.modId,
    modVersion: production.modVersion,
    minecraftVersion: production.minecraftVersion,
    protocolVersion: production.protocolVersion,
    remapped: production.remapped,
    remap: {
      sourceNamespace: "mojang",
      runtimeNamespace: "intermediary",
      mappedClass: "net/minecraft/class_1799",
    },
    dependencies: production.dependencies,
  };
  const multiplayerObservation = {
    id: "ruby_blade_multiplayer_state",
    state: production.states.ruby_blade_multiplayer_state,
    ...production.multiplayer,
    participant: "alice",
    sessionId: "session-fixture",
  };
  const cases: readonly { condition: string; observed: unknown }[] = [
    {
      condition: "production.identity",
      observed: {
        ...identityObservation,
        productionJarSha256: "0".repeat(64),
      },
    },
    {
      condition: "production.identity",
      observed: { ...identityObservation, protocolVersion: 766 },
    },
    {
      condition: "production.identity",
      observed: {
        ...identityObservation,
        remap: {
          sourceNamespace: "mojang",
          runtimeNamespace: "mojang",
          mappedClass: "net.minecraft.world.item.ItemStack",
        },
      },
    },
    {
      condition: "production.server_behavior:ruby_blade_durability",
      observed: {
        id: "ruby_blade_durability",
        state: "damage=2;remaining=98",
      },
    },
    {
      condition: "production.persistence.after:ruby_blade_persistent_state",
      observed: {
        id: "ruby_blade_persistent_state",
        state: "damage=2;remaining=98",
      },
    },
    {
      condition: "production.multiplayer:ruby_blade_multiplayer_state",
      observed: { ...multiplayerObservation, synchronized: false },
    },
    {
      condition: "production.modpack:voxellume_production_test",
      observed: { ...production.modpack, compatible: false },
    },
    {
      condition: "production.modpack:voxellume_production_test",
      observed: {
        ...production.modpack,
        declaredMods: ["ruby_tools@1.0.0"],
      },
    },
  ];

  for (const fixture of cases) {
    const { adapter } = adapterHarness(() => fixture.observed);
    await adapter.launch({
      projectId: "project-fixture",
      projectRoot: "/isolated/project",
      mode: "hidden",
    });
    assert.deepEqual(
      await adapter.assert({
        sessionId: "session-fixture",
        condition: fixture.condition,
      }),
      {
        status: "failed",
        code: "assertion_mismatch",
        adapter: "voxellume",
        operation: "assert",
      },
      fixture.condition,
    );
  }
});

test("cleanup requires launcher termination evidence and removes the session only after a real kill", async () => {
  for (const withLauncher of [false, true]) {
    let terminationCalls = 0;
    let worldCalls = 0;
    const identity = { instanceId, minecraftVersion: "1.21.1" };
    const created = createVerificationModAdapter({
      target: fabricTarget,
      instanceId,
      transport: {
        async call(tool) {
          if (tool === "voxellume.launch") {
            return {
              ...identity,
              sessionId: "session-fixture",
              ownedPids: [4101, 4102],
              bridgeHost: "127.0.0.1",
              bridgePort: 37_491,
            };
          }
          if (tool === "voxellume.cleanup") {
            return {
              ...identity,
              terminatedOwnedPids: [4101, 4102],
              remainingOwnedPids: [],
            };
          }
          if (tool === "voxellume.ticks.wait") {
            return { ...identity, startTick: 100, endTick: 140 };
          }
          if (tool === "voxellume.world.create") {
            worldCalls += 1;
            return {
              ...identity,
              worldName: "unexpected",
              seed: "424242",
              isolated: true,
              startedAtTick: 0,
            };
          }
          throw new Error(`unexpected tool ${tool}`);
        },
      },
      ...(withLauncher
        ? {
            launcher: {
              async terminateOwnedPids(ownedPids: readonly number[]) {
                terminationCalls += 1;
                return {
                  terminatedOwnedPids: [...ownedPids],
                  remainingOwnedPids: [],
                };
              },
            },
          }
        : {}),
    });
    assert.equal(created.status, "available");
    if (created.status !== "available") continue;
    await created.adapter.launch({
      projectId: "project-fixture",
      projectRoot: "/isolated/project",
      mode: "hidden",
    });

    const cleaned = await created.adapter.cleanup({
      sessionId: "session-fixture",
      ownedPids: [4101, 4102],
    });
    if (!withLauncher) {
      assert.deepEqual(cleaned, {
        status: "unavailable",
        code: "observation_unavailable",
        adapter: "voxellume",
        operation: "cleanup",
      });
      assert.equal(terminationCalls, 0);
      assert.equal(
        (
          await created.adapter.settle({
            sessionId: "session-fixture",
            ticks: 40,
          })
        ).status,
        "passed",
        "echoed PIDs must not remove the live session",
      );
    } else {
      assert.deepEqual(cleaned, {
        status: "passed",
        value: {
          ...identity,
          terminatedOwnedPids: [4101, 4102],
          remainingOwnedPids: [],
        },
      });
      assert.equal(terminationCalls, 1);
      assert.deepEqual(
        await created.adapter.worldCreate({
          sessionId: "session-fixture",
          name: "unexpected",
          seed: "424242",
          isolated: true,
        }),
        {
          status: "failed",
          code: "unknown_session",
          adapter: "voxellume",
          operation: "worldCreate",
        },
      );
      assert.equal(worldCalls, 0);
    }
  }
});

test("world creation and 11900 ticks use the computed 600000ms budget without a fixed 30-second cap", async () => {
  const timings: { tool: string; timeoutMs: number | undefined }[] = [];
  const identity = { instanceId, minecraftVersion: "1.21.1" };
  const created = createVerificationModAdapter({
    target: fabricTarget,
    instanceId,
    transport: {
      async call(tool, args, options) {
        if (tool !== "voxellume.launch") {
          timings.push({ tool, timeoutMs: options?.timeoutMs });
        }
        if (tool === "voxellume.launch") {
          return {
            ...identity,
            sessionId: "session-fixture",
            ownedPids: [4101],
            bridgeHost: "127.0.0.1",
            bridgePort: 37_491,
          };
        }
        if (tool === "voxellume.world.create") {
          return {
            ...identity,
            worldName: args.name,
            seed: args.seed,
            isolated: true,
            startedAtTick: 100,
          };
        }
        if (tool === "voxellume.ticks.wait") {
          return {
            ...identity,
            startTick: 100,
            endTick: 100 + (args.ticks as number),
            synchronized: true,
          };
        }
        throw new Error(`unexpected tool ${tool}`);
      },
    },
  });
  assert.equal(created.status, "available");
  if (created.status !== "available") return;
  await created.adapter.launch({
    projectId: "project-fixture",
    projectRoot: "/isolated/project",
    mode: "hidden",
  });
  const deadlineMs = Date.now() + 600_000;
  assert.equal(
    (
      await created.adapter.worldCreate({
        sessionId: "session-fixture",
        name: "long-running-world",
        seed: "424242",
        isolated: true,
        deadlineMs,
      })
    ).status,
    "passed",
  );
  assert.equal(
    (
      await created.adapter.settle({
        sessionId: "session-fixture",
        ticks: 11_900,
        synchronize: true,
        deadlineMs,
      })
    ).status,
    "passed",
  );
  assert.deepEqual(
    await created.adapter.settle({
      sessionId: "session-fixture",
      ticks: 12_000,
      deadlineMs,
    }),
    {
      status: "failed",
      code: "unsatisfiable_deadline",
      adapter: "voxellume",
      operation: "settle",
    },
    "12000 ticks require 605000ms and exceed the 600000ms total budget",
  );
  assert.deepEqual(
    await created.adapter.settle({
      sessionId: "session-fixture",
      ticks: 100,
      deadlineMs: Date.now() + 5_000,
    }),
    {
      status: "failed",
      code: "unsatisfiable_deadline",
      adapter: "voxellume",
      operation: "settle",
    },
    "ticks * 50 + 5000ms must fit the remaining deadline",
  );
  assert.deepEqual(
    timings.map((timing) => timing.tool),
    ["voxellume.world.create", "voxellume.ticks.wait"],
    "unsatisfiable settle calls must not reach transport",
  );
  for (const timing of timings) {
    assert.ok(timing.timeoutMs !== undefined);
    assert.ok(timing.timeoutMs > 30_000, `${timing.tool} capped the deadline`);
    assert.ok(timing.timeoutMs <= 600_000);
  }
  assert.ok(
    timings[1]!.timeoutMs! > 595_000,
    "11900 ticks must use the computed 600000ms budget",
  );
  assert.ok(
    timings[1]!.timeoutMs! <= timings[0]!.timeoutMs!,
    "each bridge call must receive the remaining deadline",
  );
});

test("input holds use the tick-derived budget while non-hold input is unchanged", async () => {
  const timings: { action: string; timeoutMs: number | undefined }[] = [];
  const identity = { instanceId, minecraftVersion: "1.21.1" };
  const created = createVerificationModAdapter({
    target: fabricTarget,
    instanceId,
    transport: {
      async call(tool, args, options) {
        if (tool === "voxellume.launch") {
          return {
            ...identity,
            sessionId: "session-fixture",
            ownedPids: [4101],
            bridgeHost: "127.0.0.1",
            bridgePort: 37_491,
          };
        }
        assert.equal(tool, "voxellume.input");
        const action = args.action as { action: string };
        timings.push({ action: action.action, timeoutMs: options?.timeoutMs });
        return { ...identity, appliedAction: args.action, atTick: 141 };
      },
    },
  });
  assert.equal(created.status, "available");
  if (created.status !== "available") return;
  await created.adapter.launch({
    projectId: "project-fixture",
    projectRoot: "/isolated/project",
    mode: "hidden",
  });

  assert.equal(
    (
      await created.adapter.input({
        sessionId: "session-fixture",
        action: { kind: "key", key: "W", action: "tap" },
        deadlineMs: Date.now() + 5_000,
      })
    ).status,
    "passed",
    "non-hold input must not use the tick-derived minimum",
  );
  const deadlineMs = Date.now() + 600_000;
  assert.equal(
    (
      await created.adapter.input({
        sessionId: "session-fixture",
        action: {
          kind: "key",
          key: "W",
          action: "hold",
          holdTicks: 11_900,
        },
        deadlineMs,
      })
    ).status,
    "passed",
  );
  assert.deepEqual(
    await created.adapter.input({
      sessionId: "session-fixture",
      action: {
        kind: "key",
        key: "W",
        action: "hold",
        holdTicks: 12_000,
      },
      deadlineMs,
    }),
    {
      status: "failed",
      code: "unsatisfiable_deadline",
      adapter: "voxellume",
      operation: "input",
    },
  );
  assert.deepEqual(
    await created.adapter.input({
      sessionId: "session-fixture",
      action: {
        kind: "key",
        key: "W",
        action: "hold",
        holdTicks: 100,
      },
      deadlineMs: Date.now() + 5_000,
    }),
    {
      status: "failed",
      code: "unsatisfiable_deadline",
      adapter: "voxellume",
      operation: "input",
    },
  );

  assert.deepEqual(
    timings.map((timing) => timing.action),
    ["tap", "hold"],
    "unsatisfiable holds must not reach transport",
  );
  assert.ok(timings[0]!.timeoutMs! > 0);
  assert.ok(timings[0]!.timeoutMs! <= 5_000);
  assert.ok(timings[1]!.timeoutMs! > 595_000);
  assert.ok(timings[1]!.timeoutMs! <= 600_000);
});

test("uppercase .PNG paths are accepted by generation and screenshot evidence", async () => {
  const input = {
    ...generationInput(),
    scenario: {
      ...scenario(),
      screenshots: [{ id: "hand", path: "ruby-blade-hand.PNG" }],
    },
  };
  const generated = expectGenerated(generateVerificationMod(input));
  const document = JSON.parse(
    source(generated, "src/test/resources/voxellume-scenario.json"),
  );
  assert.equal(document.screenshots[0].path, "ruby-blade-hand.PNG");

  const identity = { instanceId, minecraftVersion: "1.21.1" };
  const created = createVerificationModAdapter({
    target: fabricTarget,
    instanceId,
    transport: {
      async call(tool, args) {
        if (tool === "voxellume.launch") {
          return {
            ...identity,
            sessionId: "session-fixture",
            ownedPids: [4101],
            bridgeHost: "127.0.0.1",
            bridgePort: 37_491,
          };
        }
        assert.equal(tool, "voxellume.screenshot");
        return {
          ...identity,
          path: args.path,
          byteLength: 4,
          sha256: "a".repeat(64),
          capturedAtTick: 143,
          width: 1280,
          height: 720,
        };
      },
    },
  });
  assert.equal(created.status, "available");
  if (created.status !== "available") return;
  await created.adapter.launch({
    projectId: "project-fixture",
    projectRoot: "/isolated/project",
    mode: "hidden",
  });
  const screenshot = await created.adapter.screenshot({
    sessionId: "session-fixture",
    path: "qualification.PNG",
    maxBytes: 1_024,
  });
  assert.equal(screenshot.status, "passed");
  if (screenshot.status === "passed") {
    assert.equal(screenshot.value.path, "qualification.PNG");
  }
});

test("accepted-only responses are unavailable and can never fake observed passes", async () => {
  const cases: readonly {
    operation: Extract<
      RuntimeOperationName,
      "worldCreate" | "settle" | "assert" | "screenshot"
    >;
    tool: string;
    invoke: (adapter: RuntimeAdapter) => Promise<unknown>;
  }[] = [
    {
      operation: "worldCreate",
      tool: "voxellume.world.create",
      invoke: (adapter) =>
        adapter.worldCreate({
          sessionId: "session-fixture",
          name: "voxellume-qualification",
          seed: "424242",
          isolated: true,
        }),
    },
    {
      operation: "settle",
      tool: "voxellume.ticks.wait",
      invoke: (adapter) =>
        adapter.settle({ sessionId: "session-fixture", ticks: 40 }),
    },
    {
      operation: "assert",
      tool: "voxellume.assert",
      invoke: (adapter) =>
        adapter.assert({
          sessionId: "session-fixture",
          condition: "client.inWorld == true",
        }),
    },
    {
      operation: "screenshot",
      tool: "voxellume.screenshot",
      invoke: (adapter) =>
        adapter.screenshot({
          sessionId: "session-fixture",
          path: "qualification.png",
          maxBytes: 1_024,
        }),
    },
  ];

  for (const fixture of cases) {
    const created = createVerificationModAdapter({
      target: fabricTarget,
      instanceId,
      transport: {
        async call(tool) {
          if (tool === "voxellume.launch") {
            return {
              instanceId,
              minecraftVersion: fabricTarget.minecraftVersion,
              sessionId: "session-fixture",
              ownedPids: [4101],
              bridgeHost: "127.0.0.1",
              bridgePort: 37_491,
            };
          }
          assert.equal(tool, fixture.tool);
          return {
            instanceId,
            minecraftVersion: fabricTarget.minecraftVersion,
            accepted: true,
          };
        },
      },
    });
    assert.equal(created.status, "available");
    if (created.status !== "available") continue;
    const launched = await created.adapter.launch({
      projectId: "project-fixture",
      projectRoot: "/isolated/project",
      mode: "hidden",
    });
    assert.equal(launched.status, "passed");
    assert.deepEqual(await fixture.invoke(created.adapter), {
      status: "unavailable",
      code: "observation_unavailable",
      adapter: "voxellume",
      operation: fixture.operation,
    });
  }
});

test("adapter exposes no arbitrary command operation", async () => {
  const { adapter, calls } = adapterHarness();
  for (const command of [
    "time set day",
    "server.command",
    "schematic.paste",
    'Runtime.getRuntime().exec("id")',
  ]) {
    assert.deepEqual(
      await adapter.command({ sessionId: "session-fixture", command }),
      {
        status: "unsupported",
        code: "command_not_allowed",
        adapter: "voxellume",
        operation: "command",
      },
    );
  }
  assert.deepEqual(calls, []);
});
