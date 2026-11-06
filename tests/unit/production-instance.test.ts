import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { strToU8, zipSync } from "fflate";

import type { ProductionJarInspectionInput } from "../../src/core/verification/production-jar.ts";
import type {
  RuntimeAdapter,
  RuntimeOperationResult,
  RuntimeSession,
} from "../../src/core/verification/runtime-adapter.ts";
import {
  verifyProductionInstance,
  type ProductionInstanceStageId,
  type VerifyProductionInstanceInput,
  type VerifyProductionInstanceResult,
} from "../../src/core/verification/production-instance.ts";

const STAGES = [
  "inspection",
  "server",
  "persistence",
  "client",
  "multiplayer",
  "modpack",
] as const satisfies readonly ProductionInstanceStageId[];

const EXPECTED_IDENTITY = {
  environment: "production",
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
} as const;

const SERVER_BEHAVIOR = {
  id: "ruby_blade_durability",
  state: "damage=1;remaining=99",
  oracle: {
    kind: "item_durability",
    item: "ruby_tools:ruby_blade",
    damage: 1,
    remaining: 99,
  },
} as const;
const PERSISTENCE = {
  id: "ruby_blade_persistent_state",
  state: "damage=1;remaining=99",
  oracle: {
    savedState: "damage=1;remaining=99",
    restoredState: "damage=1;remaining=99",
  },
} as const;
const MULTIPLAYER = {
  id: "ruby_blade_multiplayer_state",
  state: "damage=1;remaining=99",
  actor: "alice",
  observer: "bravo",
  oracle: {
    sharedState: "damage=1;remaining=99",
    serverTick: 144,
  },
} as const;
const MODPACK = {
  id: "voxellume_production_test",
  version: "1.0.0",
  declaredMods: [
    "ruby_tools@1.0.0",
    "fabric-api@0.116.17+1.21.1",
    "cloth-config@15.0.140",
  ],
} as const;

function loadedMods(productionJarSha256: string) {
  return [
    {
      id: "ruby_tools",
      version: "1.0.0",
      origin: "production_jar",
      sha256: productionJarSha256,
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
  ];
}

const CONDITIONS = {
  identity: "production.identity",
  serverBehavior: `production.server_behavior:${SERVER_BEHAVIOR.id}`,
  persistenceBefore: `production.persistence.before:${PERSISTENCE.id}`,
  persistenceAfter: `production.persistence.after:${PERSISTENCE.id}`,
  multiplayer: `production.multiplayer:${MULTIPLAYER.id}`,
  modpack: `production.modpack:${MODPACK.id}`,
} as const;

type DeepMutable<T> = T extends Uint8Array
  ? T
  : T extends readonly (infer U)[]
    ? DeepMutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T;

type MutableInput = Omit<
  DeepMutable<VerifyProductionInstanceInput>,
  "adapters"
> & {
  readonly adapters: VerifyProductionInstanceInput["adapters"];
};
type Role = "server" | "client" | "observer";
type Surface = "minecraft_server" | "minecraft_client";
type AdapterMethod = "launch" | "assert" | "cancel" | "cleanup";

interface RecordedCall {
  readonly role: Role;
  readonly surface: Surface;
  readonly method: string;
  readonly input: unknown;
}

interface AdapterOverride {
  readonly role?: Role;
  readonly surface?: Surface;
  readonly method: AdapterMethod;
  readonly condition?: string;
  readonly launch?: number;
  readonly status?: "failed" | "unavailable" | "unsupported";
  readonly code?: string;
  readonly value?: unknown;
}

function passed<T>(value: T): RuntimeOperationResult<T> {
  return { status: "passed", value };
}

function failed(
  surface: Surface,
  method: string,
  session: RuntimeSession,
  status: "failed" | "unavailable" | "unsupported",
  code: string,
): RuntimeOperationResult<never> {
  return { status, code, adapter: "voxellume", operation: method, session };
}

function productionJar(extraEntries: Readonly<Record<string, string>> = {}) {
  const bytes = zipSync(
    {
      "fabric.mod.json": strToU8(
        `${JSON.stringify({
          schemaVersion: 1,
          id: "ruby_tools",
          version: "1.0.0",
          name: "Ruby Tools",
          depends: { minecraft: "1.21.1" },
        })}\n`,
      ),
      "ruby_tools/RubyBlade.class": strToU8("synthetic remapped class bytes"),
      "assets/ruby_tools/models/item/ruby_blade.json": strToU8(
        '{"parent":"minecraft:item/generated"}\n',
      ),
      ...Object.fromEntries(
        Object.entries(extraEntries).map(([name, value]) => [
          name,
          strToU8(value),
        ]),
      ),
    },
    { level: 6 },
  );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const input: ProductionJarInspectionInput = {
    bytes,
    artifact: {
      path: "build/libs/ruby_tools-1.0.0.jar",
      glob: "build/libs/ruby_tools-1.0.0.jar",
      sha256,
    },
    metadata: {
      path: "fabric.mod.json",
      modId: "ruby_tools",
      version: "1.0.0",
      minecraftVersion: "1.21.1",
    },
    remapEvidence: {
      executed: true,
      status: "passed",
      productionJarSha256: sha256,
    },
    limits: {
      maxEntries: 32,
      maxTotalUncompressedBytes: 1_000_000,
      maxEntryUncompressedBytes: 500_000,
      maxCompressionRatio: 200,
    },
  };
  return { bytes, sha256, input };
}

function defaultAssertion(
  role: Role,
  condition: string,
  jarSha256: string,
  launches: number,
): unknown {
  switch (condition) {
    case CONDITIONS.identity:
      return { ...EXPECTED_IDENTITY, productionJarSha256: jarSha256 };
    case CONDITIONS.serverBehavior:
      return { ...SERVER_BEHAVIOR };
    case CONDITIONS.persistenceBefore:
      return {
        id: PERSISTENCE.id,
        state: PERSISTENCE.state,
        savedState: PERSISTENCE.oracle.savedState,
      };
    case CONDITIONS.persistenceAfter:
      return {
        id: PERSISTENCE.id,
        state: PERSISTENCE.state,
        savedState: PERSISTENCE.oracle.savedState,
        restoredState: PERSISTENCE.oracle.restoredState,
        sessionId: "server-2",
      };
    case CONDITIONS.multiplayer:
      return {
        id: MULTIPLAYER.id,
        state: MULTIPLAYER.state,
        actor: MULTIPLAYER.actor,
        observer: MULTIPLAYER.observer,
        participant:
          role === "observer" ? MULTIPLAYER.observer : MULTIPLAYER.actor,
        sessionId: `${role}-${launches}`,
        serverSessionId: "server-2",
        sharedState: MULTIPLAYER.oracle.sharedState,
        serverTick: MULTIPLAYER.oracle.serverTick,
        synchronized: true,
      };
    case CONDITIONS.modpack:
      return {
        ...MODPACK,
        compatible: true,
        loadedMods: loadedMods(jarSha256),
      };
    default:
      throw new Error(`Unexpected ${role} assertion: ${condition}`);
  }
}

function fakeAdapter(
  role: Role,
  jarSha256: string,
  calls: RecordedCall[],
  overrides: readonly AdapterOverride[],
): RuntimeAdapter {
  const surface: Surface =
    role === "server" ? "minecraft_server" : "minecraft_client";
  let launches = 0;
  let session: RuntimeSession = { id: `${role}-0`, ownedPids: [] };

  const overrideFor = (
    method: AdapterMethod,
    condition?: string,
  ): AdapterOverride | undefined =>
    overrides.find(
      (override) =>
        (override.role === undefined || override.role === role) &&
        (override.surface === undefined || override.surface === surface) &&
        override.method === method &&
        (override.condition === undefined ||
          override.condition === condition) &&
        (override.launch === undefined || override.launch === launches),
    );

  const operationResult = (
    method: AdapterMethod,
    condition: string | undefined,
    value: unknown,
  ): RuntimeOperationResult<unknown> => {
    const override = overrideFor(method, condition);
    if (override?.status !== undefined) {
      return failed(
        surface,
        method,
        session,
        override.status,
        override.code ?? "injected_failure",
      );
    }
    if (override !== undefined && "value" in override) {
      return passed(override.value);
    }
    return passed(value);
  };

  const unexpected = async (): Promise<RuntimeOperationResult<never>> => {
    throw new Error(`Unexpected operation on ${role}`);
  };

  return {
    id: "voxellume",
    revision: "voxellume-verification-mod",
    target: { minecraftVersion: "1.21.1", loader: "fabric" },
    capabilities: {
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
    },
    async launch(input) {
      launches += 1;
      calls.push({
        role,
        surface,
        method: "launch",
        input: structuredClone(input),
      });
      const ownedPids =
        role === "server"
          ? launches === 1
            ? [4101, 4102]
            : [4201]
          : role === "client"
            ? [5101, 5102]
            : [5201, 5202];
      session = { id: `${role}-${launches}`, ownedPids };
      const override = overrideFor("launch");
      if (override?.status !== undefined) {
        return failed(
          surface,
          "launch",
          session,
          override.status,
          override.code ?? "launch_failed",
        );
      }
      return passed(session);
    },
    async worldCreate(input) {
      calls.push({
        role,
        surface,
        method: "worldCreate",
        input: structuredClone(input),
      });
      return passed({ created: true });
    },
    settle: unexpected,
    input: unexpected,
    command: unexpected,
    async assert(input) {
      calls.push({
        role,
        surface,
        method: "assert",
        input: structuredClone(input),
      });
      const override = overrideFor("assert", input.condition);
      if (override?.status !== undefined) {
        return failed(
          surface,
          "assert",
          session,
          override.status,
          override.code ?? "injected_failure",
        );
      }
      const observed =
        override !== undefined && "value" in override
          ? override.value
          : defaultAssertion(role, input.condition ?? "", jarSha256, launches);
      return passed({
        instanceId: "123e4567-e89b-42d3-a456-426614174000",
        minecraftVersion: "1.21.1",
        condition: input.condition,
        passed: true,
        observed,
        atTick: 142,
      });
    },
    screenshot: unexpected,
    async cancel(input) {
      calls.push({
        role,
        surface,
        method: "cancel",
        input: structuredClone(input),
      });
      return operationResult("cancel", undefined, {
        cancelled: true,
        cancelledAtTick: 144,
      });
    },
    async cleanup(input) {
      calls.push({
        role,
        surface,
        method: "cleanup",
        input: structuredClone(input),
      });
      return operationResult("cleanup", undefined, {
        terminatedOwnedPids: [...input.ownedPids],
        remainingOwnedPids: [],
      });
    },
  };
}

const fixtureRoots: string[] = [];
after(() => {
  for (const root of fixtureRoots)
    rmSync(root, { recursive: true, force: true });
});

function harness(overrides: readonly AdapterOverride[] = []) {
  const jar = productionJar();
  const calls: RecordedCall[] = [];
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "voxellume-production-test-")),
  );
  fixtureRoots.push(root);
  const userSaveRoot = join(root, "user-saves");
  const serverRoot = join(root, "isolated", "server");
  const clientRoot = join(root, "isolated", "client");
  const observerRoot = join(root, "isolated", "observer");
  for (const path of [userSaveRoot, serverRoot, clientRoot, observerRoot]) {
    mkdirSync(path, { recursive: true });
  }
  const input: MutableInput = {
    productionJar: jar.input,
    adapters: {
      server: fakeAdapter("server", jar.sha256, calls, overrides),
      client: fakeAdapter("client", jar.sha256, calls, overrides),
      observer: fakeAdapter("observer", jar.sha256, calls, overrides),
    },
    profiles: {
      server: {
        projectId: "production-server",
        projectRoot: serverRoot,
        pristine: true,
      },
      client: {
        projectId: "production-client",
        projectRoot: clientRoot,
        pristine: true,
      },
      observer: {
        projectId: "production-observer",
        projectRoot: observerRoot,
        pristine: true,
      },
    },
    userSaveRoots: [userSaveRoot],
    world: { name: "voxellume-production", seed: "8675309" },
    identity: {
      ...EXPECTED_IDENTITY,
      remap: { ...EXPECTED_IDENTITY.remap },
      dependencies: EXPECTED_IDENTITY.dependencies.map((dependency) => ({
        ...dependency,
      })),
    },
    scenarios: {
      dedicatedServer: {
        ...SERVER_BEHAVIOR,
        oracle: { ...SERVER_BEHAVIOR.oracle },
      },
      persistence: {
        ...PERSISTENCE,
        oracle: { ...PERSISTENCE.oracle },
      },
      multiplayer: {
        ...MULTIPLAYER,
        oracle: { ...MULTIPLAYER.oracle },
      },
    },
    modpack: {
      ...MODPACK,
      declaredMods: [...MODPACK.declaredMods],
      loadedMods: loadedMods(jar.sha256),
    },
  };
  return { input, calls, jar, root, userSaveRoot };
}

function stage(
  result: VerifyProductionInstanceResult,
  id: ProductionInstanceStageId,
) {
  const found = result.stages.find((candidate) => candidate.id === id);
  assert.ok(found, `missing ${id} stage`);
  return found;
}

function assertBlocked(
  result: VerifyProductionInstanceResult,
  failedStage: ProductionInstanceStageId,
  code: string,
  status: "failed" | "unavailable" | "unsupported" = "failed",
): void {
  assert.equal(result.status, status);
  assert.equal(result.support, "not_verified");
  assert.equal(result.error?.code, code);
  assert.deepEqual(
    result.stages.map((candidate) => candidate.id),
    STAGES,
  );
  const failedIndex = STAGES.indexOf(failedStage);
  for (const [index, candidate] of result.stages.entries()) {
    if (index < failedIndex) assert.equal(candidate.status, "passed");
    if (index === failedIndex) assert.equal(candidate.status, status);
    if (index > failedIndex) {
      assert.equal(candidate.status, "unavailable");
      assert.ok(candidate.checks.length > 0);
      for (const check of candidate.checks) {
        assert.equal(check.requested, true);
        assert.equal(check.checked, false);
        assert.equal(check.status, "unavailable");
        assert.equal(check.executedArgv, null);
        assert.equal(check.exitCode, null);
      }
    }
  }
}

function runtimeArgv(condition: string): string[] {
  return ["runtime-adapter", "voxellume", "assert", condition];
}

test("inspects the exact production JAR before any profile or runtime action", async (t) => {
  await t.test(
    "missing remap evidence blocks every runtime stage",
    async () => {
      const { input, calls, jar } = harness();
      input.productionJar.remapEvidence = {
        executed: false,
        status: "unavailable",
        productionJarSha256: jar.sha256,
      };
      const result = await verifyProductionInstance(input);
      assertBlocked(result, "inspection", "remap_evidence_required");
      assert.equal(stage(result, "inspection").checks[0]?.checked, true);
      assert.deepEqual(calls, []);
      assert.deepEqual(result.cleanup, []);
    },
  );

  for (const [name, path] of [
    ["verification classes", "dev/voxellume/verification/GameTest.class"],
    ["bridge configuration", "voxellume-bridge.json"],
    ["test resources", "data/ruby_tools/gametest/ruby_blade.json"],
  ] as const) {
    await t.test(`rejects ${name} in the production artifact`, async () => {
      const jar = productionJar({ [path]: "test only" });
      const { input, calls } = harness();
      input.productionJar = jar.input;
      const result = await verifyProductionInstance(input);
      assertBlocked(result, "inspection", "forbidden_production_entry");
      assert.deepEqual(stage(result, "inspection").checks[0]?.logs, []);
      assert.deepEqual(calls, []);
    });
  }
});

test("requires separate pristine profiles and a fixed isolated world outside user saves", async (t) => {
  for (const [code, mutate] of [
    [
      "pristine_profile_required",
      (input: MutableInput) => {
        input.profiles.client.pristine = false;
      },
    ],
    [
      "separate_profiles_required",
      (input: MutableInput) => {
        input.profiles.client.projectRoot = input.profiles.server.projectRoot;
      },
    ],
    [
      "separate_profiles_required",
      (input: MutableInput) => {
        input.profiles.client.projectRoot = join(
          input.profiles.server.projectRoot,
          "client",
        );
        mkdirSync(input.profiles.client.projectRoot);
      },
    ],
    [
      "user_saves_forbidden",
      (input: MutableInput) => {
        input.profiles.server.projectRoot = join(
          input.userSaveRoots[0]!,
          "voxellume-server",
        );
        mkdirSync(input.profiles.server.projectRoot);
      },
    ],
    [
      "fixed_seed_required",
      (input: MutableInput) => {
        input.world.seed = " ";
      },
    ],
  ] as const) {
    await t.test(code, async () => {
      const { input, calls } = harness();
      mutate(input);
      const result = await verifyProductionInstance(input);
      assert.equal(result.support, "not_verified");
      assert.equal(result.error?.code, code);
      assert.deepEqual(calls, []);
    });
  }

  await t.test(
    "user_saves_forbidden when a profile contains saves",
    async () => {
      const { input, calls } = harness();
      input.userSaveRoots = [join(input.profiles.server.projectRoot, "saves")];
      mkdirSync(input.userSaveRoots[0]!);
      const result = await verifyProductionInstance(input);
      assert.equal(result.support, "not_verified");
      assert.equal(result.error?.code, "user_saves_forbidden");
      assert.deepEqual(calls, []);
    },
  );

  await t.test(
    "user_saves_forbidden through a symlinked save root",
    async () => {
      const { input, calls, root, userSaveRoot } = harness();
      const linkedProfile = join(root, "linked-server");
      symlinkSync(userSaveRoot, linkedProfile, "dir");
      input.profiles.server.projectRoot = linkedProfile;
      const result = await verifyProductionInstance(input);
      assert.equal(result.support, "not_verified");
      assert.equal(result.error?.code, "user_saves_forbidden");
      assert.deepEqual(calls, []);
    },
  );
});

test("passes only with complete production evidence and exact owned-PID cleanup", async () => {
  const { input, calls, jar } = harness();
  const result = await verifyProductionInstance(input);

  assert.equal(result.status, "passed", result.error?.detail);
  assert.equal(result.support, "verified");
  assert.equal(result.productionJarSha256, jar.sha256);
  assert.deepEqual(
    result.stages.map((candidate) => [
      candidate.id,
      candidate.status,
      candidate.checks.map((check) => check.id),
    ]),
    [
      ["inspection", "passed", ["jar.inspect"]],
      ["server", "passed", ["server.identity", "server.behavior"]],
      ["persistence", "passed", ["persistence.before", "persistence.after"]],
      ["client", "passed", ["client.identity", "client.observer_identity"]],
      ["multiplayer", "passed", ["multiplayer.actor", "multiplayer.observer"]],
      ["modpack", "passed", ["modpack.compatibility"]],
    ],
  );

  const expectedChecks = [
    ["jar.inspect", ["internal:inspect-production-jar"]],
    ["server.identity", runtimeArgv(CONDITIONS.identity)],
    ["server.behavior", runtimeArgv(CONDITIONS.serverBehavior)],
    ["persistence.before", runtimeArgv(CONDITIONS.persistenceBefore)],
    ["persistence.after", runtimeArgv(CONDITIONS.persistenceAfter)],
    ["client.identity", runtimeArgv(CONDITIONS.identity)],
    ["client.observer_identity", runtimeArgv(CONDITIONS.identity)],
    ["multiplayer.actor", runtimeArgv(CONDITIONS.multiplayer)],
    ["multiplayer.observer", runtimeArgv(CONDITIONS.multiplayer)],
    ["modpack.compatibility", runtimeArgv(CONDITIONS.modpack)],
  ] as const;
  const actualChecks = result.stages.flatMap((candidate) => candidate.checks);
  assert.equal(actualChecks.length, expectedChecks.length);
  for (const [index, check] of actualChecks.entries()) {
    const [id, argv] = expectedChecks[index]!;
    assert.equal(check.id, id);
    assert.equal(check.requested, true);
    assert.equal(check.checked, true);
    assert.equal(check.status, "passed");
    assert.deepEqual(check.requestedArgv, argv);
    assert.deepEqual(check.executedArgv, argv);
    assert.equal(check.exitCode, 0);
    assert.deepEqual(check.logs, []);
    if (id !== "jar.inspect") {
      assert.equal(check.subject.class, "runtime");
      assert.equal(check.subject.productionJarSha256, jar.sha256);
    }
  }
  assert.deepEqual(actualChecks[0]?.subject, {
    class: "source",
    sourceSha256: jar.sha256,
    exportSha256: jar.sha256,
  });
  assert.deepEqual(actualChecks[1]?.subject, {
    class: "runtime",
    surface: "minecraft_server",
    productionJarSha256: jar.sha256,
    scenario: {
      id: "production_server_identity",
      state: "production",
      kind: "state",
    },
  });
  assert.deepEqual(actualChecks[2]?.subject, {
    class: "runtime",
    surface: "minecraft_server",
    productionJarSha256: jar.sha256,
    scenario: {
      id: SERVER_BEHAVIOR.id,
      state: SERVER_BEHAVIOR.state,
      kind: "state",
    },
  });
  assert.deepEqual(actualChecks[3]?.subject, {
    class: "runtime",
    surface: "minecraft_server",
    productionJarSha256: jar.sha256,
    scenario: {
      id: PERSISTENCE.id,
      state: PERSISTENCE.state,
      kind: "restart",
    },
  });
  assert.deepEqual(actualChecks[4]?.subject, actualChecks[3]?.subject);
  assert.deepEqual(actualChecks[5]?.subject, {
    class: "runtime",
    surface: "minecraft_client",
    productionJarSha256: jar.sha256,
    scenario: {
      id: "production_client_identity",
      state: "production",
      kind: "state",
    },
  });
  assert.deepEqual(actualChecks[6]?.subject, {
    class: "runtime",
    surface: "minecraft_client",
    productionJarSha256: jar.sha256,
    scenario: {
      id: "production_observer_identity",
      state: "production",
      kind: "state",
    },
  });
  for (const index of [7, 8]) {
    assert.deepEqual(actualChecks[index]?.subject, {
      class: "runtime",
      surface: "minecraft_client",
      productionJarSha256: jar.sha256,
      scenario: {
        id: MULTIPLAYER.id,
        state: MULTIPLAYER.state,
        kind: "multiplayer",
      },
    });
  }
  assert.deepEqual(actualChecks[9]?.subject, {
    class: "runtime",
    surface: "minecraft_client",
    productionJarSha256: jar.sha256,
    scenario: {
      id: MODPACK.id,
      state: "compatible",
      kind: "state",
    },
  });

  assert.deepEqual(result.cleanup, [
    {
      surface: "minecraft_server",
      sessionId: "server-1",
      ownedPids: [4101, 4102],
      cancelStatus: "passed",
      cleanupStatus: "passed",
    },
    {
      surface: "minecraft_server",
      sessionId: "server-2",
      ownedPids: [4201],
      cancelStatus: "passed",
      cleanupStatus: "passed",
    },
    {
      surface: "minecraft_client",
      sessionId: "client-1",
      ownedPids: [5101, 5102],
      cancelStatus: "passed",
      cleanupStatus: "passed",
    },
    {
      surface: "minecraft_client",
      sessionId: "observer-1",
      ownedPids: [5201, 5202],
      cancelStatus: "passed",
      cleanupStatus: "passed",
    },
  ]);

  assert.deepEqual(
    calls.map((call) => `${call.role}.${call.method}`),
    [
      "server.launch",
      "server.worldCreate",
      "server.assert",
      "server.assert",
      "server.assert",
      "server.cancel",
      "server.cleanup",
      "server.launch",
      "server.assert",
      "client.launch",
      "client.assert",
      "observer.launch",
      "observer.assert",
      "client.assert",
      "observer.assert",
      "client.assert",
      "server.cancel",
      "server.cleanup",
      "client.cancel",
      "client.cleanup",
      "observer.cancel",
      "observer.cleanup",
    ],
  );
  const launches = calls.filter((call) => call.method === "launch");
  assert.deepEqual(
    launches.map((call) => call.input),
    [
      {
        projectId: "production-server",
        projectRoot: input.profiles.server.projectRoot,
        mode: "hidden",
      },
      {
        projectId: "production-server",
        projectRoot: input.profiles.server.projectRoot,
        mode: "hidden",
      },
      {
        projectId: "production-client",
        projectRoot: input.profiles.client.projectRoot,
        mode: "visible",
      },
      {
        projectId: "production-observer",
        projectRoot: input.profiles.observer.projectRoot,
        mode: "visible",
      },
    ],
  );
  const worlds = calls.filter((call) => call.method === "worldCreate");
  assert.deepEqual(
    worlds.map((call) => call.input),
    [
      {
        sessionId: "server-1",
        name: "voxellume-production",
        seed: "8675309",
        isolated: true,
      },
    ],
  );
  const multiplayerCalls = calls.filter(
    (call) =>
      call.method === "assert" &&
      typeof call.input === "object" &&
      call.input !== null &&
      "condition" in call.input &&
      call.input.condition === CONDITIONS.multiplayer,
  );
  assert.deepEqual(
    multiplayerCalls.map((call) => call.input),
    [
      { sessionId: "client-1", condition: CONDITIONS.multiplayer },
      { sessionId: "observer-1", condition: CONDITIONS.multiplayer },
    ],
  );
  const processCalls = calls.filter(
    (call) => call.method === "cancel" || call.method === "cleanup",
  );
  assert.deepEqual(
    processCalls.map((call) => call.input),
    result.cleanup.flatMap((cleanup) => [
      { sessionId: cleanup.sessionId, ownedPids: cleanup.ownedPids },
      { sessionId: cleanup.sessionId, ownedPids: cleanup.ownedPids },
    ]),
  );
  assert.equal(
    calls.some((call) => call.method === "screenshot"),
    false,
    "production behavior evidence must not claim a visual review",
  );
});

test("dedicated behavior requires a declared oracle and matching observed state", async (t) => {
  await t.test(
    "arbitrary behavior without an expected definition",
    async () => {
      const { input, calls } = harness();
      input.scenarios.dedicatedServer.id = "arbitrary_behavior";
      Reflect.deleteProperty(input.scenarios.dedicatedServer, "oracle");
      const result = await verifyProductionInstance(input);
      assert.equal(result.support, "not_verified");
      assert.equal(result.error?.code, "production_scenario_required");
      assert.deepEqual(calls, []);
    },
  );

  await t.test("observed behavior state differs from the oracle", async () => {
    const { input } = harness([
      {
        role: "server",
        method: "assert",
        condition: CONDITIONS.serverBehavior,
        value: { ...SERVER_BEHAVIOR, state: "damage=0;remaining=100" },
      },
    ]);
    const result = await verifyProductionInstance(input);
    assertBlocked(result, "server", "dedicated_server_mismatch");
  });
});

test("requires exact remapped dependency and protocol identity on server and real client", async (t) => {
  const mismatches = [
    ["development instance", { environment: "development" }],
    ["preview instance", { environment: "preview" }],
    ["wrong JAR", { productionJarSha256: "0".repeat(64) }],
    ["unremapped code", { remapped: false }],
    ["boolean-only remap evidence", { remap: undefined }],
    [
      "Mojang runtime namespace",
      { remap: { ...EXPECTED_IDENTITY.remap, runtimeNamespace: "mojang" } },
    ],
    [
      "unmapped runtime namespace",
      { remap: { ...EXPECTED_IDENTITY.remap, runtimeNamespace: "unmapped" } },
    ],
    ["wrong mod", { modId: "other_mod" }],
    ["wrong mod version", { modVersion: "1.0.1" }],
    ["wrong Minecraft version", { minecraftVersion: "1.21.2" }],
    ["wrong protocol", { protocolVersion: 768 }],
    [
      "wrong dependencies",
      {
        dependencies: [
          { id: "minecraft", version: "1.21.1" },
          { id: "fabricloader", version: "0.20.1" },
        ],
      },
    ],
  ] as const;

  for (const role of ["server", "client", "observer"] as const) {
    for (const [name, mutation] of mismatches) {
      await t.test(`${role}: rejects ${name}`, async () => {
        const jar = productionJar();
        const value = {
          ...EXPECTED_IDENTITY,
          productionJarSha256: jar.sha256,
          ...mutation,
        };
        const { input } = harness([
          {
            role,
            method: "assert",
            condition: CONDITIONS.identity,
            value,
          },
        ]);
        const result = await verifyProductionInstance(input);
        assertBlocked(
          result,
          role === "server" ? "server" : "client",
          "production_identity_mismatch",
        );
      });
    }
  }
});

test("a failed required stage stops downstream success claims but still cleans owned processes", async (t) => {
  const failures = [
    ["server", CONDITIONS.identity, "server"],
    ["server", CONDITIONS.serverBehavior, "server"],
    ["persistence", CONDITIONS.persistenceBefore, "server"],
    ["persistence", CONDITIONS.persistenceAfter, "server"],
    ["client", CONDITIONS.identity, "client"],
    ["client", CONDITIONS.identity, "observer"],
    ["multiplayer", CONDITIONS.multiplayer, "client"],
    ["multiplayer", CONDITIONS.multiplayer, "observer"],
    ["modpack", CONDITIONS.modpack, "client"],
  ] as const;

  for (const [expectedStage, condition, role] of failures) {
    await t.test(`${role}: ${condition}`, async () => {
      const { input, calls } = harness([
        {
          role,
          method: "assert",
          condition,
          status: "failed",
          code: "injected_stage_failure",
        },
      ]);
      const result = await verifyProductionInstance(input);
      assertBlocked(result, expectedStage, "injected_stage_failure");
      assert.ok(calls.some((call) => call.method === "cancel"));
      assert.ok(calls.some((call) => call.method === "cleanup"));
    });
  }
});

test("missing runtime observations are failures, not implicit passes", async (t) => {
  const missing = [
    ["server", CONDITIONS.identity, "production_identity_mismatch", "server"],
    [
      "server",
      CONDITIONS.serverBehavior,
      "dedicated_server_mismatch",
      "server",
    ],
    [
      "persistence",
      CONDITIONS.persistenceBefore,
      "persistence_mismatch",
      "server",
    ],
    [
      "persistence",
      CONDITIONS.persistenceAfter,
      "persistence_mismatch",
      "server",
    ],
    ["client", CONDITIONS.identity, "production_identity_mismatch", "client"],
    ["client", CONDITIONS.identity, "production_identity_mismatch", "observer"],
    ["multiplayer", CONDITIONS.multiplayer, "multiplayer_mismatch", "client"],
    ["multiplayer", CONDITIONS.multiplayer, "multiplayer_mismatch", "observer"],
    ["modpack", CONDITIONS.modpack, "modpack_mismatch", "client"],
  ] as const;

  for (const [expectedStage, condition, code, role] of missing) {
    await t.test(`${role}: ${condition}`, async () => {
      const { input } = harness([
        { role, method: "assert", condition, value: undefined },
      ]);
      const result = await verifyProductionInstance(input);
      assertBlocked(result, expectedStage, code);
    });
  }
});

test("persistence compares state across a real restart without recreating the world", async (t) => {
  await t.test("changed state after restart blocks support", async () => {
    const { input, calls } = harness([
      {
        surface: "minecraft_server",
        method: "assert",
        condition: CONDITIONS.persistenceAfter,
        value: {
          id: PERSISTENCE.id,
          state: "damage=0;remaining=100",
          savedState: PERSISTENCE.oracle.savedState,
          restoredState: "damage=0;remaining=100",
          sessionId: "server-2",
        },
      },
    ]);
    const result = await verifyProductionInstance(input);
    assertBlocked(result, "persistence", "persistence_mismatch");
    assert.equal(calls.filter((call) => call.method === "launch").length, 2);
    assert.equal(
      calls.filter((call) => call.method === "worldCreate").length,
      1,
    );
  });

  await t.test("state alone cannot prove restored persistence", async () => {
    const { input } = harness([
      {
        role: "server",
        method: "assert",
        condition: CONDITIONS.persistenceAfter,
        value: { id: PERSISTENCE.id, state: PERSISTENCE.state },
      },
    ]);
    const result = await verifyProductionInstance(input);
    assertBlocked(result, "persistence", "persistence_mismatch");
  });

  await t.test("a failed restart launch cannot claim persistence", async () => {
    const { input } = harness([
      {
        surface: "minecraft_server",
        method: "launch",
        launch: 2,
        status: "failed",
        code: "restart_failed",
      },
    ]);
    const result = await verifyProductionInstance(input);
    assertBlocked(result, "persistence", "restart_failed");
  });
});

test("multiplayer requires independent actor and observer with synchronized state", async (t) => {
  for (const [name, value] of [
    ["observer differs", { observer: "steve" }],
    ["actor differs", { actor: "steve" }],
    ["same participant", { actor: "bravo", observer: "bravo" }],
    ["wrong participant", { participant: "bravo" }],
    ["wrong client session", { sessionId: "observer-1" }],
    ["stopped server session", { serverSessionId: "server-1" }],
    [
      "boolean-only synchronization",
      { sharedState: undefined, serverTick: undefined },
    ],
    ["different shared state", { sharedState: "damage=0;remaining=100" }],
    ["wrong server tick", { serverTick: 143 }],
    ["unsynchronized", { synchronized: false }],
    ["state differs", { state: "damage=0;remaining=100" }],
  ] as const) {
    await t.test(name, async () => {
      const { input } = harness([
        {
          role: "client",
          method: "assert",
          condition: CONDITIONS.multiplayer,
          value: {
            id: MULTIPLAYER.id,
            state: MULTIPLAYER.state,
            actor: MULTIPLAYER.actor,
            observer: MULTIPLAYER.observer,
            participant: MULTIPLAYER.actor,
            sessionId: "client-1",
            serverSessionId: "server-2",
            sharedState: MULTIPLAYER.oracle.sharedState,
            serverTick: MULTIPLAYER.oracle.serverTick,
            synchronized: true,
            ...value,
          },
        },
      ]);
      const result = await verifyProductionInstance(input);
      assertBlocked(result, "multiplayer", "multiplayer_mismatch");
    });
  }

  await t.test(
    "one client session cannot claim both participant names",
    async () => {
      const { input, calls } = harness([
        {
          role: "observer",
          method: "assert",
          condition: CONDITIONS.multiplayer,
          value: {
            id: MULTIPLAYER.id,
            state: MULTIPLAYER.state,
            actor: MULTIPLAYER.actor,
            observer: MULTIPLAYER.observer,
            participant: MULTIPLAYER.observer,
            sessionId: "client-1",
            serverSessionId: "server-2",
            sharedState: MULTIPLAYER.oracle.sharedState,
            serverTick: MULTIPLAYER.oracle.serverTick,
            synchronized: true,
          },
        },
      ]);
      const result = await verifyProductionInstance(input);
      assertBlocked(result, "multiplayer", "multiplayer_mismatch");
      const launches = calls.filter((call) => call.method === "launch");
      assert.deepEqual(
        launches.map((call) => call.role),
        ["server", "server", "client", "observer"],
      );
    },
  );
});

test("modpack evidence must match the complete declaration and pass compatibility", async (t) => {
  for (const [name, value] of [
    ["wrong pack", { id: "other_pack" }],
    ["wrong revision", { version: "1.0.1" }],
    ["undeclared content", { declaredMods: ["ruby_tools@1.0.0"] }],
    ["boolean-only compatibility", { loadedMods: undefined }],
    [
      "development mod origin",
      {
        loadedMods: loadedMods(productionJar().sha256).map((mod, index) =>
          index === 0 ? { ...mod, origin: "development_output" } : mod,
        ),
      },
    ],
    [
      "wrong production origin hash",
      { loadedMods: loadedMods("0".repeat(64)) },
    ],
    ["incompatible", { compatible: false }],
  ] as const) {
    await t.test(name, async () => {
      const { input } = harness([
        {
          surface: "minecraft_client",
          method: "assert",
          condition: CONDITIONS.modpack,
          value: {
            ...MODPACK,
            compatible: true,
            loadedMods: loadedMods(productionJar().sha256),
            ...value,
          },
        },
      ]);
      const result = await verifyProductionInstance(input);
      assertBlocked(result, "modpack", "modpack_mismatch");
    });
  }

  await t.test(
    "an empty declaration is not compatibility evidence",
    async () => {
      const { input, calls } = harness();
      input.modpack.declaredMods = [];
      const result = await verifyProductionInstance(input);
      assert.equal(result.support, "not_verified");
      assert.equal(result.error?.code, "modpack_declaration_required");
      assert.deepEqual(calls, []);
    },
  );
});

test("cleanup requires exact terminated PIDs and an empty remaining set", async (t) => {
  for (const [name, value] of [
    ["bare pass", undefined],
    ["requested PIDs only", { ownedPids: [5101, 5102] }],
    [
      "partial termination",
      { terminatedOwnedPids: [5101], remainingOwnedPids: [] },
    ],
    [
      "surviving PID",
      { terminatedOwnedPids: [5101, 5102], remainingOwnedPids: [5102] },
    ],
    [
      "unowned PID",
      { terminatedOwnedPids: [5101, 5102, 9999], remainingOwnedPids: [] },
    ],
  ] as const) {
    await t.test(name, async () => {
      const { input } = harness([{ role: "client", method: "cleanup", value }]);
      const result = await verifyProductionInstance(input);
      assert.equal(result.status, "unavailable");
      assert.equal(result.support, "not_verified");
      assert.equal(result.error?.code, "cleanup_observation_required");
      assert.ok(
        result.stages.every((candidate) => candidate.status === "passed"),
      );
    });
  }
});

test("cancel and cleanup failures block support and never widen the owned PID set", async (t) => {
  for (const method of ["cancel", "cleanup"] as const) {
    await t.test(method, async () => {
      const { input, calls } = harness([
        {
          surface: "minecraft_client",
          method,
          status: "failed",
          code: `${method}_failed`,
        },
      ]);
      const result = await verifyProductionInstance(input);
      assert.equal(result.status, "failed");
      assert.equal(result.support, "not_verified");
      assert.equal(result.error?.code, `${method}_failed`);
      assert.ok(
        result.stages.every((candidate) => candidate.status === "passed"),
      );
      const clientCalls = calls.filter(
        (call) =>
          call.role === "client" &&
          (call.method === "cancel" || call.method === "cleanup"),
      );
      assert.deepEqual(
        clientCalls.map((call) => call.input),
        [
          { sessionId: "client-1", ownedPids: [5101, 5102] },
          { sessionId: "client-1", ownedPids: [5101, 5102] },
        ],
      );
    });
  }
});
