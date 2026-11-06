import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { validateModSpec, type ModSpec } from "../../src/core/spec/mod-spec.ts";
import type { TargetPack } from "../../src/core/targets/target-pack.ts";
import type {
  VerificationStage,
  VerificationStageCheck,
  VerificationStageContext,
  VerificationStageExecution,
} from "../../src/core/verification/verify-project.ts";
import { createServerBehaviorExecutor } from "../../src/core/verification/server-behavior.ts";

type ServerAssertion =
  | { kind: "command" | "status"; command: string; response: string }
  | { kind: "inventory"; item: string; count: number }
  | {
      kind: "world";
      position: { x: number; y: number; z: number };
      block: string;
    }
  | {
      kind: "multiplayer";
      players: string[];
      oracle: { kind: "inventory"; item: string; count: number };
    };

interface HarnessOptions {
  assertions?: ServerAssertion[];
  stage?: VerificationStage;
  targetVersion?: string;
  botVersion?: string;
  rconHost?: string;
  botHost?: string;
  withBot?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  omitScenarioLinks?: boolean;
  botIdentity?: "valid" | "different" | "wrongVersion" | "missing";
}

const password = "generated-rcon-password-unit-secret";
const serverInstanceId = "123e4567-e89b-42d3-a456-426614174000";
const serverArgv = ["./gradlew", "runServer"];
const commandAssertion: ServerAssertion = {
  kind: "command",
  command: "voxellume test command",
  response: "command-ok",
};
const statusAssertion: ServerAssertion = {
  kind: "status",
  command: "voxellume status online",
  response: "online=2",
};
const inventoryAssertion: ServerAssertion = {
  kind: "inventory",
  item: "ruby_blade",
  count: 1,
};
const worldAssertion: ServerAssertion = {
  kind: "world",
  position: { x: 1, y: 64, z: -2 },
  block: "ruby_block",
};
const multiplayerAssertion: ServerAssertion = {
  kind: "multiplayer",
  players: ["alice", "bravo"],
  oracle: { kind: "inventory", item: "ruby_blade", count: 1 },
};

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function targetFixture(version: string): Promise<TargetPack> {
  const directory = new URL(
    "../../target-packs/java/fabric/1.21.1/",
    import.meta.url,
  );
  const [pack, docs, verification] = await Promise.all([
    readJson(new URL("target.json", directory).pathname),
    readJson(new URL("docs.json", directory).pathname),
    readJson(new URL("verification.json", directory).pathname),
  ]);
  return {
    ...pack,
    minecraft: {
      ...(pack.minecraft as Record<string, unknown>),
      version,
    },
    docs,
    verification: {
      ...verification,
      checks: {
        ...(verification.checks as Record<string, unknown>),
        server: {
          ...(verification.checks as Record<string, Record<string, unknown>>)
            .server,
          argv: serverArgv,
        },
      },
    },
  } as unknown as TargetPack;
}

async function modSpecFixture(
  assertions: readonly ServerAssertion[],
): Promise<ModSpec> {
  const document = await readJson(
    new URL("../../fixtures/mod-spec/valid.json", import.meta.url).pathname,
  );
  const acceptance = assertions.map((assertion) => ({
    id: `accept_server_${assertion.kind}`,
    featureId: "ruby_blade",
    behavior: `The dedicated server satisfies the ${assertion.kind} assertion.`,
    kind: "server",
    implementationUnitIds: ["unit_ruby_blade"],
    checkIds: [`server.${assertion.kind}`],
    fixture: `fixtures/server/${assertion.kind}.json`,
    expected: { assertion },
  }));
  const originalAcceptance = document.acceptance as Record<string, unknown>[];
  document.acceptance = [...originalAcceptance, ...acceptance];
  const features = document.features as Record<string, unknown>[];
  features[0]!.acceptanceIds = [
    "accept_ruby_blade_damage",
    ...acceptance.map((entry) => entry.id),
  ];
  const runtime = document.runtime as Record<string, unknown>;
  const scenarios = runtime.scenarios as Record<string, unknown>[];
  scenarios[0]!.acceptanceIds = (
    document.acceptance as Record<string, unknown>[]
  ).map((entry) => entry.id);
  const result = validateModSpec(document);
  assert.ok(result.status === "valid");
  return result.spec;
}

async function createHarness(t: TestContext, options: HarnessOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "voxellume-server-unit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  const isolationRoot = join(root, "isolation");
  const evidenceRoot = join(root, "evidence");
  const assertions = options.assertions ?? [commandAssertion];
  const targetVersion = options.targetVersion ?? "1.21.1";
  const serverInstance = { id: serverInstanceId, version: targetVersion };
  const identityCommand = `voxellume test identity ${serverInstanceId}`;
  const target = await targetFixture(targetVersion);
  const modSpec = await modSpecFixture(assertions);
  if (options.omitScenarioLinks === true) {
    const runtime = modSpec.runtime as Record<string, unknown>;
    const scenarios = runtime.scenarios as Record<string, unknown>[];
    scenarios[0]!.acceptanceIds = [
      "accept_ruby_blade_damage",
      "accept_ruby_block_drops",
    ];
  }
  const context: VerificationStageContext = {
    stage: options.stage ?? "server",
    roots: {
      projectRoot,
      isolationRoot,
      evidenceRoot,
      agentWritableRoots: [projectRoot, isolationRoot],
    },
    target,
    modSpec,
    identity: {
      transactionId: "tx-server-unit",
      baseProjectSha256: "a".repeat(64),
      modSpecSha256: "b".repeat(64),
      targetPackSha256: target.packSha256,
      finalTreeSha256: "d".repeat(64),
    },
    policy: {
      environment: { executor: "unit-fake" },
      secretValues: [password],
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };

  const responses = new Map(
    assertions.flatMap((assertion) =>
      assertion.kind === "command" || assertion.kind === "status"
        ? [[assertion.command, assertion.response] as const]
        : [],
    ),
  );
  responses.set(identityCommand, targetVersion);
  const state = {
    rconCreations: 0,
    rconConnections: 0,
    botCreations: 0,
    botConfirmCalls: 0,
    confirmedInstanceIds: [] as string[],
    endCalls: 0,
    destroyCalls: 0,
    quitCalls: 0,
    activeSends: 0,
    maxActiveSends: 0,
    commands: [] as string[],
    seenRconConfig: undefined as unknown,
    seenBotConfig: undefined as unknown,
    send: async (command: string): Promise<string> => {
      state.activeSends += 1;
      state.maxActiveSends = Math.max(state.maxActiveSends, state.activeSends);
      await Promise.resolve();
      state.activeSends -= 1;
      const response = responses.get(command);
      if (response === undefined)
        throw new Error(`Unexpected command: ${command}`);
      return response;
    },
    connect: async (): Promise<void> => {},
    end: async (): Promise<void> => {
      state.endCalls += 1;
    },
    destroy: (): void => {
      state.destroyCalls += 1;
    },
    createBot: () => {
      const events = new EventEmitter();
      const bot = {
        username: "voxellume_probe",
        version: options.botVersion ?? targetVersion,
        ...(options.botIdentity === "missing"
          ? {}
          : {
              confirmServerInstance: async (id: string) => {
                state.botConfirmCalls += 1;
                state.confirmedInstanceIds.push(id);
                return {
                  instanceId:
                    options.botIdentity === "different"
                      ? "00000000-0000-4000-8000-000000000002"
                      : serverInstanceId,
                  version:
                    options.botIdentity === "wrongVersion"
                      ? "1.21.2"
                      : targetVersion,
                };
              },
            }),
        inventory: {
          items: () => [{ name: "ruby_blade", count: 1 }],
        },
        blockAt: (position: { x: number; y: number; z: number }) =>
          position.x === 1 && position.y === 64 && position.z === -2
            ? { name: "ruby_block" }
            : null,
        players: {
          voxellume_probe: { username: "voxellume_probe" },
          alice: { username: "alice" },
          bravo: { username: "bravo" },
        },
        synchronizedState: (
          players: readonly string[],
          oracle: { kind: "inventory"; item: string; count: number },
        ) =>
          players.length === 2 &&
          players.includes("alice") &&
          players.includes("bravo") &&
          oracle.kind === "inventory" &&
          oracle.item === "ruby_blade" &&
          oracle.count === 1,
        once: (event: string, listener: (...args: unknown[]) => void) =>
          events.once(event, listener),
        off: (event: string, listener: (...args: unknown[]) => void) =>
          events.off(event, listener),
        quit: () => {
          state.quitCalls += 1;
        },
      };
      queueMicrotask(() => events.emit("spawn"));
      return bot;
    },
  };

  const executor = createServerBehaviorExecutor({
    rcon: {
      host: options.rconHost ?? "127.0.0.1",
      port: 25575,
      password,
    },
    serverInstance,
    ...((options.withBot ?? true)
      ? {
          bot: {
            host: options.botHost ?? "127.0.0.1",
            port: 25565,
            username: "voxellume_probe",
            version: options.botVersion ?? targetVersion,
          },
        }
      : {}),
    timeoutMs: options.timeoutMs ?? 100,
    createRcon: (config) => {
      state.seenRconConfig = config;
      state.rconCreations += 1;
      return {
        connect: async () => {
          state.rconConnections += 1;
          return state.connect();
        },
        send: async (command) => {
          state.commands.push(command);
          return state.send(command);
        },
        end: state.end,
        destroy: state.destroy,
      };
    },
    createBot: (config) => {
      state.seenBotConfig = config;
      state.botCreations += 1;
      return state.createBot();
    },
  });

  return { context, executor, state, responses, root, identityCommand };
}

function checkShape(check: VerificationStageCheck) {
  return {
    id: check.id,
    requested: check.requested,
    checked: check.checked,
    status: check.status,
    requestedArgv: check.requestedArgv,
    executedArgv: check.executedArgv,
    exitCode: check.exitCode,
    subject: check.subject,
    logNames: check.logs.map((log) => log.name),
  };
}

function passedShape(
  id: string,
  executedArgv: readonly string[],
  kind: "state" | "multiplayer" = "state",
) {
  return {
    id,
    requested: true,
    checked: true,
    status: "passed",
    requestedArgv: serverArgv,
    executedArgv,
    exitCode: null,
    subject: {
      class: "runtime",
      surface: "minecraft_server",
      scenario: {
        id: "scenario_ruby_tools_multiplayer",
        state: "completed",
        kind,
      },
    },
    logNames: [`${id}.log`],
  };
}

async function executionLogText(
  execution: VerificationStageExecution,
): Promise<string> {
  const contents = await Promise.all(
    execution.checks.flatMap((check) =>
      check.logs.map((log) => readFile(log.path, "utf8")),
    ),
  );
  return contents.join("\n");
}

test("one RCON instance runs command and status checks in strict order", async (t) => {
  const { context, executor, state } = await createHarness(t, {
    assertions: [commandAssertion, statusAssertion],
  });

  const execution = await executor(context);

  assert.deepEqual(execution.checks.map(checkShape), [
    passedShape("server.command", [
      "rcon-client",
      "send",
      "voxellume test command",
    ]),
    passedShape("server.status", [
      "rcon-client",
      "send",
      "voxellume status online",
    ]),
  ]);
  assert.equal(execution.artifacts, undefined);
  assert.equal(state.rconCreations, 1);
  assert.equal(state.rconConnections, 1);
  assert.equal(state.botCreations, 1);
  assert.equal(state.endCalls, 1);
  assert.equal(state.quitCalls, 1);
  assert.equal(state.maxActiveSends, 1);
  assert.deepEqual(state.commands, [
    `voxellume test identity ${serverInstanceId}`,
    "voxellume test command",
    "voxellume status online",
  ]);
  assert.deepEqual(state.seenRconConfig, {
    host: "127.0.0.1",
    port: 25575,
    password,
  });
  const logs = await executionLogText(execution);
  assert.match(logs, /voxellume test command/);
  assert.match(logs, /command-ok/);
  assert.match(logs, /online=2/);
});

test("bot inventory, world, and multiplayer checks are runtime server evidence only", async (t) => {
  const { context, executor, state } = await createHarness(t, {
    assertions: [inventoryAssertion, worldAssertion, multiplayerAssertion],
    withBot: true,
  });

  const execution = await executor(context);

  assert.deepEqual(execution.checks.map(checkShape), [
    passedShape("server.inventory", ["mineflayer", "inventory", "ruby_blade"]),
    passedShape("server.world", [
      "mineflayer",
      "world",
      "1",
      "64",
      "-2",
      "ruby_block",
    ]),
    passedShape(
      "server.multiplayer",
      ["mineflayer", "multiplayer", "alice", "bravo"],
      "multiplayer",
    ),
  ]);
  assert.equal(state.botCreations, 1);
  assert.equal(state.quitCalls, 1);
  assert.equal(state.rconConnections, 1);
  assert.equal(state.endCalls, 1);
  assert.deepEqual(state.seenBotConfig, {
    host: "127.0.0.1",
    port: 25565,
    username: "voxellume_probe",
    version: "1.21.1",
  });
  for (const check of execution.checks) {
    assert.equal(check.subject.class, "runtime");
    assert.equal(check.subject.surface, "minecraft_server");
    assert.notEqual(check.subject.surface, "minecraft_client");
    assert.equal("baselineSha256" in check.subject, false);
    assert.equal("reviewer" in check.subject, false);
  }
});

test("an expected response mismatch fails without leaking credentials and cleans up once", async (t) => {
  const { context, executor, state, identityCommand } = await createHarness(t, {
    assertions: [commandAssertion, inventoryAssertion],
    withBot: true,
  });
  const send = state.send;
  state.send = async (command) =>
    command === identityCommand ? send(command) : "unexpected-response";

  const execution = await executor(context);

  assert.equal(execution.checks[0]!.id, "server.command");
  assert.equal(execution.checks[0]!.checked, true);
  assert.equal(execution.checks[0]!.status, "failed");
  assert.equal(execution.checks[0]!.exitCode, null);
  assert.equal(
    execution.checks.some((check) => check.status === "passed"),
    false,
  );
  assert.equal(state.endCalls, 1);
  assert.equal(state.quitCalls, 1);
  const logs = await executionLogText(execution);
  assert.match(logs, /unexpected-response/);
  assert.doesNotMatch(logs, new RegExp(password));
  assert.doesNotMatch(JSON.stringify(execution), new RegExp(password));
});

test("only literal IPv4 and IPv6 loopback endpoints are accepted", async (t) => {
  for (const host of [
    "localhost",
    "0.0.0.0",
    "192.168.1.8",
    "example.test",
    "::ffff:127.0.0.1",
  ]) {
    await t.test(`rejects RCON host ${host}`, async (t) => {
      const { context, executor, state } = await createHarness(t, {
        rconHost: host,
      });
      const execution = await executor(context);
      assert.equal(execution.checks.length > 0, true);
      assert.equal(
        execution.checks.every(
          (check) => check.status === "unavailable" && check.checked === false,
        ),
        true,
      );
      assert.equal(state.rconConnections, 0);
      assert.equal(state.botCreations, 0);
    });
  }

  await t.test("rejects a non-loopback bot host", async (t) => {
    const { context, executor, state } = await createHarness(t, {
      assertions: [inventoryAssertion],
      withBot: true,
      botHost: "127.0.0.2",
    });
    const execution = await executor(context);
    assert.equal(
      execution.checks.every(
        (check) => check.status === "unavailable" && check.checked === false,
      ),
      true,
    );
    assert.equal(state.rconConnections, 0);
    assert.equal(state.botCreations, 0);
  });

  await t.test("accepts the exact IPv6 loopback address", async (t) => {
    const { context, executor, state } = await createHarness(t, {
      assertions: [commandAssertion, inventoryAssertion],
      withBot: true,
      rconHost: "::1",
      botHost: "::1",
    });
    const execution = await executor(context);
    assert.equal(
      execution.checks.every((check) => check.status === "passed"),
      true,
    );
    assert.equal(state.endCalls, 1);
    assert.equal(state.quitCalls, 1);
  });
});

test("secrets echoed by RCON are redacted from returned logs and results", async (t) => {
  const { context, executor, responses } = await createHarness(t);
  const acceptance = context.modSpec.acceptance.find(
    (entry) => entry.id === "accept_server_command",
  );
  assert.ok(acceptance);
  acceptance.expected = {
    assertion: { ...commandAssertion, response: `password=${password}` },
  };
  responses.set(commandAssertion.command, `password=${password}`);

  const execution = await executor(context);

  assert.equal(execution.checks[0]!.status, "passed");
  const logs = await executionLogText(execution);
  assert.doesNotMatch(logs, new RegExp(password));
  assert.match(logs, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(execution), new RegExp(password));
});

test("only strict typed Voxellume commands reach RCON", async (t) => {
  for (const command of [
    "stop",
    "op alice",
    "save-all",
    "function voxellume:reset",
    "say arbitrary console input",
    "voxellume integration command",
    "voxellume test command; stop",
    "voxellume test command\nstop",
  ]) {
    await t.test(`rejects ${JSON.stringify(command)}`, async (t) => {
      const assertion: ServerAssertion = {
        kind: "command",
        command,
        response: "must-not-run",
      };
      const { context, executor, state } = await createHarness(t, {
        assertions: [assertion],
      });
      const execution = await executor(context);
      assert.equal(
        execution.checks.every(
          (check) =>
            check.status === "unavailable" &&
            check.checked === false &&
            check.executedArgv === null &&
            check.exitCode === null,
        ),
        true,
      );
      assert.equal(state.rconCreations, 0);
      assert.equal(state.rconConnections, 0);
      assert.equal(state.botCreations, 0);
      assert.deepEqual(state.commands, []);
    });
  }

  await t.test(
    "allows the typed assert form with an exact-version bot",
    async (t) => {
      const assertion: ServerAssertion = {
        kind: "command",
        command: "voxellume assert ruby_blade",
        response: "assertion-ok",
      };
      const { context, executor, state } = await createHarness(t, {
        assertions: [assertion],
      });
      const execution = await executor(context);
      assert.deepEqual(execution.checks.map(checkShape), [
        passedShape("server.command", [
          "rcon-client",
          "send",
          "voxellume assert ruby_blade",
        ]),
      ]);
      assert.equal(state.botCreations, 1);
      assert.equal(state.quitCalls, 1);
    },
  );
});

test("command and status checks without an exact-version bot are unavailable", async (t) => {
  const { context, executor, state } = await createHarness(t, {
    assertions: [commandAssertion, statusAssertion],
    withBot: false,
  });

  const execution = await executor(context);

  assert.deepEqual(
    execution.checks.map((check) => ({
      id: check.id,
      checked: check.checked,
      status: check.status,
      executedArgv: check.executedArgv,
      exitCode: check.exitCode,
    })),
    ["server.command", "server.status"].map((id) => ({
      id,
      checked: false,
      status: "unavailable",
      executedArgv: null,
      exitCode: null,
    })),
  );
  assert.equal(state.rconCreations, 0);
  assert.equal(state.rconConnections, 0);
  assert.equal(state.botCreations, 0);
});

test("acceptance absent from every runtime scenario is unavailable without fallback", async (t) => {
  const { context, executor, state } = await createHarness(t, {
    assertions: [commandAssertion],
    omitScenarioLinks: true,
  });

  const execution = await executor(context);

  assert.equal(execution.checks.length, 1);
  assert.equal(execution.checks[0]!.status, "unavailable");
  assert.equal(execution.checks[0]!.checked, false);
  assert.equal(execution.checks[0]!.executedArgv, null);
  assert.equal(execution.checks[0]!.exitCode, null);
  assert.notEqual(execution.checks[0]!.subject.scenario?.state, "completed");
  assert.equal(state.rconCreations, 0);
  assert.equal(state.rconConnections, 0);
  assert.equal(state.botCreations, 0);
});

test("multiplayer requires an independent participant and synchronized state", async (t) => {
  for (const players of [[], ["voxellume_probe"]]) {
    await t.test(`rejects players ${JSON.stringify(players)}`, async (t) => {
      const assertion: ServerAssertion = {
        ...multiplayerAssertion,
        players,
      };
      const { context, executor, state } = await createHarness(t, {
        assertions: [assertion],
      });
      const execution = await executor(context);
      assert.equal(execution.checks[0]!.status, "unavailable");
      assert.equal(execution.checks[0]!.checked, false);
      assert.equal(execution.checks[0]!.executedArgv, null);
      assert.equal(execution.checks[0]!.exitCode, null);
      assert.equal(state.rconCreations, 0);
      assert.equal(state.botCreations, 0);
    });
  }

  await t.test(
    "fails when the synchronized-state oracle is false",
    async (t) => {
      const { context, executor, state } = await createHarness(t, {
        assertions: [multiplayerAssertion],
      });
      const createBot = state.createBot;
      state.createBot = () => ({
        ...createBot(),
        synchronizedState: () => false,
      });
      const execution = await executor(context);
      assert.equal(execution.checks[0]!.status, "failed");
      assert.equal(execution.checks[0]!.checked, true);
      assert.equal(execution.checks[0]!.exitCode, null);
      assert.equal(state.endCalls, 1);
      assert.equal(state.quitCalls, 1);
    },
  );
});

test("a hung or cancelled connect destroys late completion without passing", async (t) => {
  for (const interruption of ["timed_out", "cancelled"] as const) {
    await t.test(interruption, async (t) => {
      const controller = new AbortController();
      const pending = Promise.withResolvers<void>();
      const { context, executor, state } = await createHarness(t, {
        timeoutMs: interruption === "timed_out" ? 1 : 100,
        ...(interruption === "cancelled" ? { signal: controller.signal } : {}),
      });
      state.connect = () => {
        if (interruption === "cancelled") controller.abort();
        return pending.promise;
      };

      const execution = await executor(context);
      assert.equal(
        execution.checks.every(
          (check) =>
            check.status === interruption &&
            check.checked === true &&
            check.executedArgv?.join("\n") ===
              ["rcon-client", "connect"].join("\n") &&
            check.exitCode === null,
        ),
        true,
      );
      assert.equal(state.rconCreations, 1);
      assert.equal(state.rconConnections, 1);
      assert.equal(state.destroyCalls, 1);
      assert.equal(state.endCalls, 0);
      assert.equal(state.botCreations, 0);
      pending.resolve();
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(
        execution.checks.some((check) => check.status === "passed"),
        false,
      );
      assert.equal(state.destroyCalls, 1);
      assert.equal(state.endCalls, 0);
      assert.deepEqual(state.commands, []);
    });
  }
});

test("verification-mod identity binds RCON work to the host instance and exact release", async (t) => {
  await t.test(
    "actual 1.21.2 cannot satisfy configured target 1.21.3",
    async (t) => {
      const { context, executor, state, responses, identityCommand } =
        await createHarness(t, { targetVersion: "1.21.3" });
      responses.set(identityCommand, "1.21.2");

      const execution = await executor(context);

      assert.equal(
        execution.checks.every(
          (check) => check.status === "unavailable" && check.checked === false,
        ),
        true,
      );
      assert.deepEqual(state.commands, [identityCommand]);
      assert.equal(state.commands.includes(commandAssertion.command), false);
      assert.equal(
        execution.checks.some((check) => check.status === "passed"),
        false,
      );
    },
  );

  await t.test(
    "a different trusted instance UUID is rejected before assertions",
    async (t) => {
      const { context, executor, state, responses, identityCommand } =
        await createHarness(t);
      responses.set(identityCommand, "unknown-instance");

      const execution = await executor(context);

      assert.equal(
        execution.checks.every(
          (check) => check.status === "unavailable" && check.checked === false,
        ),
        true,
      );
      assert.deepEqual(state.commands, [identityCommand]);
      assert.equal(state.commands.includes(commandAssertion.command), false);
      assert.equal(
        execution.checks.some((check) => check.status === "passed"),
        false,
      );
    },
  );

  await t.test(
    "missing identity handshake is unavailable and never passes",
    async (t) => {
      const { context, executor, state, responses, identityCommand } =
        await createHarness(t);
      responses.delete(identityCommand);

      const execution = await executor(context);

      assert.equal(
        execution.checks.every(
          (check) => check.status === "unavailable" && check.checked === false,
        ),
        true,
      );
      assert.deepEqual(state.commands, [identityCommand]);
      assert.equal(state.commands.includes(commandAssertion.command), false);
      assert.equal(
        execution.checks.some((check) => check.status === "passed"),
        false,
      );
    },
  );
});

test("RCON and bot verification-mod identities must bind to the same instance", async (t) => {
  for (const fixture of [
    { botIdentity: "different", confirmCalls: 1, name: "different bot UUID" },
    { botIdentity: "missing", confirmCalls: 0, name: "missing bot handshake" },
    {
      botIdentity: "wrongVersion",
      confirmCalls: 1,
      name: "different bot plugin release",
    },
  ] as const) {
    await t.test(fixture.name, async (t) => {
      const { context, executor, state, identityCommand } = await createHarness(
        t,
        {
          assertions: [commandAssertion, inventoryAssertion],
          botIdentity: fixture.botIdentity,
        },
      );

      const execution = await executor(context);

      assert.equal(
        execution.checks.every(
          (check) => check.status === "unavailable" && check.checked === false,
        ),
        true,
      );
      assert.equal(
        execution.checks.some((check) => check.status === "passed"),
        false,
      );
      assert.deepEqual(state.commands, [identityCommand]);
      assert.equal(state.commands.includes(commandAssertion.command), false);
      assert.equal(state.rconConnections, 1);
      assert.equal(state.botCreations, 1);
      assert.equal(state.botConfirmCalls, fixture.confirmCalls);
      assert.deepEqual(
        state.confirmedInstanceIds,
        Array.from({ length: fixture.confirmCalls }, () => serverInstanceId),
      );
      assert.equal(state.endCalls, 1);
      assert.equal(state.quitCalls, 1);
    });
  }
});

test("Mineflayer support is exact and never falls back to a nearby version", async (t) => {
  for (const version of ["1.21.1", "1.21.11", "26.1"]) {
    await t.test(`allows tested version ${version}`, async (t) => {
      const { context, executor, state } = await createHarness(t, {
        assertions: [inventoryAssertion],
        targetVersion: version,
        withBot: true,
      });
      const execution = await executor(context);
      assert.equal(execution.checks[0]!.status, "passed");
      assert.deepEqual(state.seenBotConfig, {
        host: "127.0.0.1",
        port: 25565,
        username: "voxellume_probe",
        version,
      });
      assert.equal(state.quitCalls, 1);
    });
  }

  for (const version of ["26.2", "26.3"]) {
    await t.test(`returns unavailable for ${version}`, async (t) => {
      const { context, executor, state } = await createHarness(t, {
        assertions: [inventoryAssertion],
        targetVersion: version,
        withBot: true,
      });
      const execution = await executor(context);
      assert.deepEqual(
        execution.checks.map((check) => ({
          id: check.id,
          checked: check.checked,
          status: check.status,
          executedArgv: check.executedArgv,
          exitCode: check.exitCode,
        })),
        [
          {
            id: "server.inventory",
            checked: false,
            status: "unavailable",
            executedArgv: null,
            exitCode: null,
          },
        ],
      );
      assert.equal(state.rconConnections, 0);
      assert.equal(state.botCreations, 0);
      assert.equal(state.endCalls, 0);
      assert.equal(state.quitCalls, 0);
    });
  }

  await t.test(
    "rejects a bot version different from the exact target",
    async (t) => {
      const { context, executor, state } = await createHarness(t, {
        assertions: [inventoryAssertion],
        targetVersion: "1.21.1",
        botVersion: "1.21.11",
        withBot: true,
      });
      const execution = await executor(context);
      assert.equal(execution.checks[0]!.status, "unavailable");
      assert.equal(execution.checks[0]!.checked, false);
      assert.equal(state.botCreations, 0);
      assert.equal(state.rconConnections, 0);
    },
  );
});

test("cancellation, timeout, and client errors clean up acquired clients exactly once", async (t) => {
  await t.test(
    "pre-cancelled execution acquires nothing and cannot pass",
    async (t) => {
      const controller = new AbortController();
      controller.abort();
      const { context, executor, state } = await createHarness(t, {
        assertions: [commandAssertion, inventoryAssertion],
        withBot: true,
        signal: controller.signal,
      });
      const execution = await executor(context);
      assert.equal(
        execution.checks.every(
          (check) => check.status === "cancelled" && check.checked === false,
        ),
        true,
      );
      assert.equal(state.rconConnections, 0);
      assert.equal(state.botCreations, 0);
    },
  );

  await t.test(
    "cancellation during a command closes both clients",
    async (t) => {
      const controller = new AbortController();
      const { context, executor, state, identityCommand } = await createHarness(
        t,
        {
          assertions: [commandAssertion, inventoryAssertion],
          withBot: true,
          signal: controller.signal,
        },
      );
      const send = state.send;
      state.send = (command) => {
        if (command === identityCommand) return send(command);
        controller.abort();
        return Promise.withResolvers<string>().promise;
      };
      const execution = await executor(context);
      assert.equal(
        execution.checks.some((check) => check.status === "cancelled"),
        true,
      );
      assert.equal(execution.checks[0]!.checked, true);
      assert.deepEqual(execution.checks[0]!.executedArgv, [
        "rcon-client",
        "send",
        commandAssertion.command,
      ]);
      assert.equal(execution.checks[0]!.exitCode, null);
      assert.equal(
        execution.checks.some((check) => check.status === "passed"),
        false,
      );
      assert.equal(state.endCalls, 1);
      assert.equal(state.quitCalls, 1);
    },
  );

  await t.test(
    "a hung command times out and closes both clients",
    async (t) => {
      const { context, executor, state, identityCommand } = await createHarness(
        t,
        {
          assertions: [commandAssertion, inventoryAssertion],
          withBot: true,
          timeoutMs: 1,
        },
      );
      const send = state.send;
      state.send = (command) =>
        command === identityCommand
          ? send(command)
          : Promise.withResolvers<string>().promise;
      const execution = await executor(context);
      assert.equal(
        execution.checks.some((check) => check.status === "timed_out"),
        true,
      );
      assert.equal(execution.checks[0]!.checked, true);
      assert.deepEqual(execution.checks[0]!.executedArgv, [
        "rcon-client",
        "send",
        commandAssertion.command,
      ]);
      assert.equal(execution.checks[0]!.exitCode, null);
      assert.equal(
        execution.checks.some((check) => check.status === "passed"),
        false,
      );
      assert.equal(state.endCalls, 1);
      assert.equal(state.quitCalls, 1);
    },
  );

  await t.test(
    "an RCON connect error acquires no bot and cannot pass",
    async (t) => {
      const { context, executor, state } = await createHarness(t, {
        assertions: [commandAssertion, inventoryAssertion],
        withBot: true,
      });
      state.connect = async () => {
        throw new Error("connect exploded");
      };
      const execution = await executor(context);
      assert.equal(
        execution.checks.every(
          (check) =>
            check.status === "failed" &&
            check.checked === true &&
            check.executedArgv?.join("\n") ===
              ["rcon-client", "connect"].join("\n") &&
            check.exitCode === null,
        ),
        true,
      );
      assert.equal(state.rconConnections, 1);
      assert.equal(state.botCreations, 0);
      assert.equal(state.destroyCalls, 1);
      assert.equal(state.endCalls, 0);
      assert.equal(state.quitCalls, 0);
    },
  );

  await t.test("a send error fails and closes both clients", async (t) => {
    const { context, executor, state, identityCommand } = await createHarness(
      t,
      {
        assertions: [commandAssertion, inventoryAssertion],
        withBot: true,
      },
    );
    const send = state.send;
    state.send = async (command) => {
      if (command === identityCommand) return send(command);
      throw new Error("send exploded");
    };
    const execution = await executor(context);
    assert.equal(execution.checks[0]!.status, "failed");
    assert.equal(state.endCalls, 1);
    assert.equal(state.quitCalls, 1);
  });

  await t.test(
    "a bot creation error closes the connected RCON client",
    async (t) => {
      const { context, executor, state } = await createHarness(t, {
        assertions: [inventoryAssertion],
        withBot: true,
      });
      state.createBot = () => {
        throw new Error("bot creation exploded");
      };
      const execution = await executor(context);
      assert.equal(execution.checks[0]!.status, "failed");
      assert.equal(execution.checks[0]!.checked, true);
      assert.deepEqual(execution.checks[0]!.executedArgv, [
        "mineflayer",
        "connect",
      ]);
      assert.equal(execution.checks[0]!.exitCode, null);
      assert.equal(state.rconConnections, 1);
      assert.equal(state.endCalls, 1);
      assert.equal(state.quitCalls, 0);
    },
  );

  await t.test("an RCON close error still quits the bot once", async (t) => {
    const { context, executor, state } = await createHarness(t, {
      assertions: [commandAssertion, inventoryAssertion],
      withBot: true,
    });
    state.end = async () => {
      state.endCalls += 1;
      throw new Error("end exploded");
    };
    const execution = await executor(context);
    assert.equal(
      execution.checks.some((check) => check.status === "failed"),
      true,
    );
    assert.equal(state.endCalls, 1);
    assert.equal(state.quitCalls, 1);
  });

  await t.test("a bot quit error still ends RCON once", async (t) => {
    const { context, executor, state } = await createHarness(t, {
      assertions: [commandAssertion, inventoryAssertion],
      withBot: true,
    });
    const createBot = state.createBot;
    state.createBot = () => ({
      ...createBot(),
      quit: () => {
        state.quitCalls += 1;
        throw new Error("quit exploded");
      },
    });
    const execution = await executor(context);
    assert.equal(
      execution.checks.some((check) => check.status === "failed"),
      true,
    );
    assert.equal(state.endCalls, 1);
    assert.equal(state.quitCalls, 1);
  });
});

test("a non-server stage is rejected before acquiring clients", async (t) => {
  const { context, executor, state } = await createHarness(t, {
    stage: "client",
    withBot: true,
  });

  const execution = await executor(context);

  assert.deepEqual(
    execution.checks.map((check) => ({
      id: check.id,
      requested: check.requested,
      checked: check.checked,
      status: check.status,
      executedArgv: check.executedArgv,
      exitCode: check.exitCode,
    })),
    [
      {
        id: "server",
        requested: true,
        checked: false,
        status: "unavailable",
        executedArgv: null,
        exitCode: null,
      },
    ],
  );
  assert.equal(state.rconConnections, 0);
  assert.equal(state.botCreations, 0);
});

test("no server assertions returns an explicit unexecuted unavailable result", async (t) => {
  const { context, executor, state } = await createHarness(t, {
    assertions: [],
    withBot: true,
  });

  const execution = await executor(context);

  assert.deepEqual(
    execution.checks.map((check) => ({
      id: check.id,
      requested: check.requested,
      checked: check.checked,
      status: check.status,
      executedArgv: check.executedArgv,
      exitCode: check.exitCode,
    })),
    [
      {
        id: "server",
        requested: true,
        checked: false,
        status: "unavailable",
        executedArgv: null,
        exitCode: null,
      },
    ],
  );
  assert.equal(state.rconConnections, 0);
  assert.equal(state.botCreations, 0);
  assert.equal(state.endCalls, 0);
  assert.equal(state.quitCalls, 0);
});
