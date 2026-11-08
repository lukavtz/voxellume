import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalModSpecHash,
  validateModSpec,
} from "../../src/core/spec/mod-spec.ts";
import type { TargetPack } from "../../src/core/targets/target-pack.ts";
import { readEvidence } from "../../src/core/verification/evidence.ts";
import {
  verifyProject,
  type VerificationStageCheck,
  type VerificationStageContext,
  type VerificationStageExecutor,
} from "../../src/core/verification/verify-project.ts";
import { createServerBehaviorExecutor } from "../../src/core/verification/server-behavior.ts";

const serverInstance = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  version: "1.21.1",
};
const identityCommand = `voxellume test identity ${serverInstance.id}`;

function rconPacket(id: number, type: number, payload = ""): Uint8Array {
  const payloadBytes = new TextEncoder().encode(payload);
  const body = new Uint8Array(14 + payloadBytes.byteLength);
  const view = new DataView(body.buffer);
  view.setInt32(0, body.byteLength - 4, true);
  view.setInt32(4, id, true);
  view.setInt32(8, type, true);
  body.set(payloadBytes, 12);
  return body;
}

async function makeWritableTree(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await makeWritableTree(child);
    await chmod(child, entry.isDirectory() ? 0o755 : 0o644);
  }
  await chmod(path, 0o755);
}

async function readJson(path: string | URL): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function targetFixture(): Promise<TargetPack> {
  const directory = new URL(
    "../../target-packs/java/fabric/1.21.1/",
    import.meta.url,
  );
  const [pack, docs, verification] = await Promise.all([
    readJson(new URL("target.json", directory)),
    readJson(new URL("docs.json", directory)),
    readJson(new URL("verification.json", directory)),
  ]);
  return {
    ...pack,
    docs,
    verification: {
      ...verification,
      checks: {
        ...(verification.checks as Record<string, unknown>),
        server: {
          ...(verification.checks as Record<string, Record<string, unknown>>)
            .server,
          argv: ["./gradlew", "runServer"],
        },
      },
      capabilities: {
        build: true,
        server: true,
        client: true,
        gameTest: true,
        visual: true,
      },
      evidenceManifest: {
        path: "qualification/java-fabric-1.21.1-r1/result.json",
        sha256: "f".repeat(64),
      },
    },
    status: "supported",
  } as unknown as TargetPack;
}

async function modSpecFixture(
  commandResponse: string,
  mode: "valid" | "empty" | "unlinked" = "valid",
) {
  const document = await readJson(
    new URL("../../fixtures/mod-spec/valid.json", import.meta.url),
  );
  const acceptance = [
    {
      id: "accept_server_command",
      featureId: "ruby_blade",
      behavior: "The test command returns the exact expected response.",
      kind: "server",
      implementationUnitIds: ["unit_ruby_blade"],
      checkIds: ["server.command"],
      fixture: "fixtures/server/command.json",
      expected: {
        assertion: {
          kind: "command",
          command: "voxellume test command",
          response: commandResponse,
        },
      },
    },
    {
      id: "accept_server_status",
      featureId: "ruby_blade",
      behavior: "The server reports two online players.",
      kind: "server",
      implementationUnitIds: ["unit_ruby_blade"],
      checkIds: ["server.status"],
      fixture: "fixtures/server/status.json",
      expected: {
        assertion: {
          kind: "status",
          command: "voxellume status online",
          response: "online=2",
        },
      },
    },
    {
      id: "accept_server_multiplayer",
      featureId: "ruby_blade",
      behavior:
        "Independent players observe identical ruby blade inventory state.",
      kind: "server",
      implementationUnitIds: ["unit_ruby_blade"],
      checkIds: ["server.multiplayer"],
      fixture: "fixtures/server/multiplayer.json",
      expected: {
        assertion: {
          kind: "multiplayer",
          players: ["alice", "bravo"],
          oracle: { kind: "inventory", item: "ruby_blade", count: 1 },
        },
      },
    },
  ];
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
  if (mode === "empty") {
    document.acceptance = originalAcceptance;
    features[0]!.acceptanceIds = ["accept_ruby_blade_damage"];
    scenarios[0]!.acceptanceIds = originalAcceptance.map((entry) => entry.id);
  } else if (mode === "unlinked") {
    scenarios[0]!.acceptanceIds = originalAcceptance.map((entry) => entry.id);
  }
  const result = validateModSpec(document);
  assert.ok(result.status === "valid");
  return result.spec;
}

async function startFakeRconServer(
  password: string,
  responses: ReadonlyMap<string, string>,
) {
  const state = {
    connections: 0,
    closedConnections: 0,
    authenticatedConnections: 0,
    commands: [] as string[],
  };
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    state.connections += 1;
    sockets.add(socket);
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      buffered = Buffer.concat([buffered, bytes]);
      while (buffered.length >= 4) {
        const length = buffered.readInt32LE(0);
        if (length < 10) {
          socket.destroy(new Error("invalid RCON packet length"));
          return;
        }
        if (buffered.length < length + 4) return;
        const packet = buffered.subarray(0, length + 4);
        buffered = buffered.subarray(length + 4);
        const id = packet.readInt32LE(4);
        const type = packet.readInt32LE(8);
        const payload = packet.toString("utf8", 12, packet.length - 2);
        if (type === 3) {
          if (payload !== password) {
            socket.write(rconPacket(-1, 2));
            socket.end();
            continue;
          }
          state.authenticatedConnections += 1;
          socket.write(rconPacket(id, 0));
          socket.write(rconPacket(id, 2));
          continue;
        }
        if (type !== 2) {
          socket.destroy(new Error(`unexpected RCON packet type ${type}`));
          return;
        }
        state.commands.push(payload);
        const response = responses.get(payload);
        if (response === undefined) {
          socket.destroy(new Error(`unexpected RCON command ${payload}`));
          return;
        }
        socket.write(rconPacket(id, 0, response));
      }
    });
    socket.on("close", () => {
      state.closedConnections += 1;
      sockets.delete(socket);
    });
  });
  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fake RCON server has no TCP address.");
  }
  return {
    port: address.port,
    state,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      if (!server.listening) return;
      const closed = Promise.withResolvers<void>();
      server.close((error) => {
        if (error === undefined) closed.resolve();
        else closed.reject(error);
      });
      await closed.promise;
    },
  };
}

function passingSourceCheck(
  context: VerificationStageContext,
): VerificationStageCheck {
  const argv =
    context.stage === "build"
      ? context.target.verification.checks.build?.argv
      : ["internal:static"];
  if (argv === undefined) throw new Error("Missing build verification argv.");
  return {
    id: context.stage,
    requested: true,
    checked: true,
    status: "passed",
    requestedArgv: [...argv],
    executedArgv: [...argv],
    exitCode: 0,
    subject: {
      class: "source",
      sourceSha256: "1".repeat(64),
      exportSha256: "2".repeat(64),
    },
    logs: [],
  };
}

test("real rcon-client passes a deterministic loopback fake server and publishes redacted runtime evidence", async (t) => {
  const password = randomBytes(24).toString("base64url");
  const commandResponse = `command-ok password=${password}`;
  const responses = new Map([
    [identityCommand, serverInstance.version],
    ["voxellume test command", commandResponse],
    ["voxellume status online", "online=2"],
  ]);
  const fakeServer = await startFakeRconServer(password, responses);
  t.after(() => fakeServer.close());
  const root = await mkdtemp(join(tmpdir(), "voxellume-server-integration-"));
  t.after(async () => {
    await makeWritableTree(root);
    await rm(root, { recursive: true, force: true });
  });
  const projectRoot = join(root, "project");
  const isolationRoot = join(root, "isolation");
  const evidenceRoot = join(root, "supervisor", "evidence");
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(isolationRoot, { recursive: true }),
  ]);
  const target = await targetFixture();
  const modSpec = await modSpecFixture(commandResponse);
  let botCreations = 0;
  let botQuitCalls = 0;
  const serverExecutor = createServerBehaviorExecutor({
    serverInstance,
    rcon: {
      host: "127.0.0.1",
      port: fakeServer.port,
      password,
    },
    bot: {
      host: "127.0.0.1",
      port: 25565,
      username: "voxellume_probe",
      version: "1.21.1",
    },
    timeoutMs: 1_000,
    createBot: (config) => {
      botCreations += 1;
      const events = new EventEmitter();
      const bot = {
        username: config.username,
        version: config.version,
        confirmServerInstance: async () => ({
          instanceId: serverInstance.id,
          version: serverInstance.version,
        }),
        inventory: {
          items: () => [{ name: "ruby_blade", count: 1 }],
        },
        blockAt: () => null,
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
          botQuitCalls += 1;
        },
      };
      queueMicrotask(() => events.emit("spawn"));
      return bot;
    },
  });
  const stageExecutor: VerificationStageExecutor = async (context) =>
    context.stage === "server"
      ? serverExecutor(context)
      : { checks: [passingSourceCheck(context)] };
  const identity = {
    transactionId: "tx-server-rcon-integration",
    baseProjectSha256: "a".repeat(64),
    modSpecSha256: canonicalModSpecHash(modSpec),
    targetPackSha256: target.packSha256,
    finalTreeSha256: "d".repeat(64),
  };

  const result = await verifyProject({
    roots: {
      projectRoot,
      isolationRoot,
      evidenceRoot,
      agentWritableRoots: [projectRoot, isolationRoot],
    },
    target,
    modSpec,
    profile: "server",
    identity,
    policy: {
      environment: {
        executor: "real-rcon-client-with-fake-loopback-server",
        minecraftServer: "protocol-fake-not-a-real-minecraft-launch",
        mineflayerBot: "fixture-only-not-a-real-client",
      },
      secretValues: [password],
    },
    signal: new AbortController().signal,
    stageExecutor,
  });

  assert.equal(result.status, "passed");
  assert.deepEqual(
    result.stages.map((stage) => ({ id: stage.id, status: stage.status })),
    [
      { id: "static", status: "passed" },
      { id: "build", status: "passed" },
      { id: "server", status: "passed" },
    ],
  );
  assert.equal(fakeServer.state.connections, 1);
  assert.equal(fakeServer.state.authenticatedConnections, 1);
  assert.equal(fakeServer.state.closedConnections, 1);
  assert.equal(botCreations, 1);
  assert.equal(botQuitCalls, 1);
  assert.deepEqual(fakeServer.state.commands, [
    identityCommand,
    "voxellume test command",
    "voxellume status online",
  ]);

  const manifest = await readEvidence({
    evidenceRoot,
    transactionId: identity.transactionId,
  });
  assert.deepEqual(result.evidence, {
    transactionId: identity.transactionId,
    sha256: manifest.integrity,
  });
  const serverChecks = manifest.checks.filter((check) =>
    check.id.startsWith("server."),
  );
  assert.deepEqual(
    serverChecks.map((check) => ({
      id: check.id,
      requested: check.requested,
      executed: check.executed,
      status: check.status,
      executedArgv: check.executedArgv,
      exitCode: check.exitCode,
      subject: check.subject,
    })),
    [
      {
        id: "server.command",
        requested: true,
        executed: true,
        status: "passed",
        executedArgv: ["rcon-client", "send", "voxellume test command"],
        exitCode: null,
        subject: {
          class: "runtime",
          surface: "minecraft_server",
          scenario: {
            id: "scenario_ruby_tools_multiplayer",
            state: "completed",
            kind: "state",
          },
        },
      },
      {
        id: "server.status",
        requested: true,
        executed: true,
        status: "passed",
        executedArgv: ["rcon-client", "send", "voxellume status online"],
        exitCode: null,
        subject: {
          class: "runtime",
          surface: "minecraft_server",
          scenario: {
            id: "scenario_ruby_tools_multiplayer",
            state: "completed",
            kind: "state",
          },
        },
      },
      {
        id: "server.multiplayer",
        requested: true,
        executed: true,
        status: "passed",
        executedArgv: ["mineflayer", "multiplayer", "alice", "bravo"],
        exitCode: null,
        subject: {
          class: "runtime",
          surface: "minecraft_server",
          scenario: {
            id: "scenario_ruby_tools_multiplayer",
            state: "completed",
            kind: "multiplayer",
          },
        },
      },
    ],
  );
  for (const entry of await readdir(evidenceRoot, { recursive: true })) {
    const path = join(evidenceRoot, entry);
    if (!(await stat(path)).isFile()) continue;
    assert.equal(
      (await readFile(path)).includes(Buffer.from(password)),
      false,
      `RCON password leaked into ${entry}`,
    );
  }
  assert.equal(
    serverChecks.some(
      (check) =>
        check.subject.class === "browser" ||
        check.subject.surface === "minecraft_client",
    ),
    false,
  );
});

test("failed setup, timed out setup, and unavailable fallbacks finalize evidence", async (t) => {
  const cases = [
    {
      name: "failed RCON setup",
      mode: "valid",
      status: "failed",
      timeoutMs: 100,
      connect: async () => {
        throw new Error("connect failed");
      },
    },
    {
      name: "timed out RCON setup",
      mode: "valid",
      status: "timed_out",
      timeoutMs: 1,
      connect: () => Promise.withResolvers<void>().promise,
    },
    {
      name: "no server assertions",
      mode: "empty",
      status: "unavailable",
      timeoutMs: 100,
      connect: async () => "unexpected connection",
    },
    {
      name: "acceptance missing from every scenario",
      mode: "unlinked",
      status: "unavailable",
      timeoutMs: 100,
      connect: async () => "unexpected connection",
    },
  ] as const;

  for (const [index, fixture] of cases.entries()) {
    await t.test(fixture.name, async (t) => {
      const root = await mkdtemp(join(tmpdir(), "voxellume-server-nonpass-"));
      t.after(async () => {
        await makeWritableTree(root);
        await rm(root, { recursive: true, force: true });
      });
      const projectRoot = join(root, "project");
      const isolationRoot = join(root, "isolation");
      const evidenceRoot = join(root, "supervisor", "evidence");
      await Promise.all([
        mkdir(projectRoot, { recursive: true }),
        mkdir(isolationRoot, { recursive: true }),
      ]);
      const target = await targetFixture();
      const modSpec = await modSpecFixture("unused", fixture.mode);
      const serverExecutor = createServerBehaviorExecutor({
        serverInstance,
        rcon: {
          host: "127.0.0.1",
          port: 25575,
          password: "nonpass-generated-secret",
        },
        bot: {
          host: "127.0.0.1",
          port: 25565,
          username: "voxellume_probe",
          version: "1.21.1",
        },
        timeoutMs: fixture.timeoutMs,
        createRcon: () => ({
          connect: fixture.connect,
          send: async () => {
            throw new Error("unexpected assertion command");
          },
          end: async () => {},
          destroy: () => {},
        }),
        createBot: () => {
          throw new Error("unexpected bot creation");
        },
      });
      const stageExecutor: VerificationStageExecutor = async (context) =>
        context.stage === "server"
          ? serverExecutor(context)
          : { checks: [passingSourceCheck(context)] };
      const identity = {
        transactionId: `tx-server-nonpass-${index}`,
        baseProjectSha256: "a".repeat(64),
        modSpecSha256: canonicalModSpecHash(modSpec),
        targetPackSha256: target.packSha256,
        finalTreeSha256: "d".repeat(64),
      };

      const result = await verifyProject({
        roots: {
          projectRoot,
          isolationRoot,
          evidenceRoot,
          agentWritableRoots: [projectRoot, isolationRoot],
        },
        target,
        modSpec,
        profile: "server",
        identity,
        policy: {
          environment: { executor: "nonpass-publication-fixture" },
          secretValues: ["nonpass-generated-secret"],
        },
        signal: new AbortController().signal,
        stageExecutor,
      });

      assert.equal(result.status, fixture.status);
      assert.equal(result.support, "not_verified");
      const serverStage = result.stages.find((stage) => stage.id === "server");
      assert.ok(serverStage);
      const attempted = fixture.status !== "unavailable";
      assert.equal(
        serverStage.checks.every(
          (check) =>
            check.status === fixture.status &&
            check.checked === attempted &&
            check.exitCode === null,
        ),
        true,
      );
      assert.deepEqual(
        serverStage.checks.map((check) => check.executedArgv),
        serverStage.checks.map(() =>
          attempted ? ["rcon-client", "connect"] : null,
        ),
      );
      const manifest = await readEvidence({
        evidenceRoot,
        transactionId: identity.transactionId,
      });
      assert.deepEqual(result.evidence, {
        transactionId: identity.transactionId,
        sha256: manifest.integrity,
      });
      assert.equal(
        manifest.checks
          .filter(
            (check) => check.id === "server" || check.id.startsWith("server."),
          )
          .every(
            (check) =>
              check.status === fixture.status && check.executed === attempted,
          ),
        true,
      );
    });
  }
});
