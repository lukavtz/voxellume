import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import { Rcon } from "rcon-client";

import type { JsonObject } from "../spec/mod-spec.ts";
import { redactText } from "./evidence/redaction.ts";
import type { EvidenceStatus } from "./evidence/types.ts";
import type {
  VerificationStageCheck,
  VerificationStageContext,
  VerificationStageExecutor,
} from "./verify-project.ts";

// Mineflayer 4.39.0's transitive declarations are not valid under strict TS 7.
const { createBot: createMineflayerBot, testedVersions } = createRequire(
  import.meta.url,
)("mineflayer") as {
  createBot(config: BotConfig): unknown;
  testedVersions: string[];
};

const UUID_SOURCE =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$(?![\\s\\S])`, "i");
const VERIFICATION_COMMAND = new RegExp(
  `^voxellume (?:(?:test|status|assert) [a-z0-9_-]+|assert [a-z0-9_-]+ [a-z0-9_-]+ -?(?:\\d+(?:\\.\\d+)?|\\.\\d+)|test identity ${UUID_SOURCE})$(?![\\s\\S])`,
);

interface RconConfig {
  readonly host: string;
  readonly port: number;
  readonly password: string;
}

interface BotConfig {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly version: string;
}

interface RconClient {
  connect(): Promise<unknown>;
  send(command: string): Promise<string>;
  end(): Promise<void>;
  destroy(): void;
}

interface ProbeInventory {
  items(): Array<{ name: string; count: number }>;
}

interface ProbeBot {
  readonly username: string;
  readonly inventory: ProbeInventory;
  confirmServerInstance?(
    id: string,
  ):
    | { instanceId: string; version: string }
    | Promise<{ instanceId: string; version: string }>;
  blockAt(position: {
    x: number;
    y: number;
    z: number;
  }): { name: string } | null;
  readonly players: Record<string, { username: string } | undefined>;
  synchronizedState?(
    players: readonly string[],
    oracle: { kind: "inventory"; item: string; count: number },
  ): boolean | Promise<boolean>;
  quit(reason?: string): void;
  once?(event: string, listener: (...args: unknown[]) => void): unknown;
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface ServerInstance {
  readonly id: string;
  readonly version: string;
}

export interface ServerBehaviorOptions {
  readonly serverInstance: ServerInstance;
  readonly rcon: RconConfig;
  readonly bot?: BotConfig;
  readonly timeoutMs?: number;
  readonly createRcon?: (config: RconConfig) => RconClient;
  readonly createBot?: (config: BotConfig) => ProbeBot;
}

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

interface AssertionEntry {
  readonly id: string;
  readonly scenarioId: string;
  readonly assertion: ServerAssertion;
  lines: string[];
}

class Interruption extends Error {
  readonly status: "cancelled" | "timed_out";

  constructor(status: "cancelled" | "timed_out") {
    super(status);
    this.status = status;
  }
}

class IdentityUnavailable extends Error {}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertionFrom(value: unknown): ServerAssertion | undefined {
  if (!isObject(value) || typeof value.kind !== "string") return undefined;
  if (value.kind === "command" || value.kind === "status") {
    return typeof value.command === "string" &&
      typeof value.response === "string"
      ? { kind: value.kind, command: value.command, response: value.response }
      : undefined;
  }
  if (value.kind === "inventory") {
    return typeof value.item === "string" &&
      Number.isSafeInteger(value.count) &&
      (value.count as number) >= 0
      ? { kind: "inventory", item: value.item, count: value.count as number }
      : undefined;
  }
  if (value.kind === "world") {
    const position = value.position;
    return isObject(position) &&
      [position.x, position.y, position.z].every(
        (coordinate) =>
          typeof coordinate === "number" && Number.isFinite(coordinate),
      ) &&
      typeof value.block === "string"
      ? {
          kind: "world",
          position: {
            x: position.x as number,
            y: position.y as number,
            z: position.z as number,
          },
          block: value.block,
        }
      : undefined;
  }
  if (value.kind === "multiplayer") {
    const oracle = value.oracle;
    return Array.isArray(value.players) &&
      value.players.length > 0 &&
      value.players.every((player) => typeof player === "string") &&
      isObject(oracle) &&
      oracle.kind === "inventory" &&
      typeof oracle.item === "string" &&
      Number.isSafeInteger(oracle.count) &&
      (oracle.count as number) >= 0
      ? {
          kind: "multiplayer",
          players: [...value.players],
          oracle: {
            kind: "inventory",
            item: oracle.item,
            count: oracle.count as number,
          },
        }
      : undefined;
  }
  return undefined;
}

function entries(
  context: VerificationStageContext,
): AssertionEntry[] | "invalid" | "unlinked" {
  const result: AssertionEntry[] = [];
  const scenarios = (context.modSpec.runtime as JsonObject)
    .scenarios as JsonObject[];
  for (const acceptance of context.modSpec.acceptance) {
    if (acceptance.kind !== "server") continue;
    if (!isObject(acceptance.expected)) return "invalid";
    const assertion = assertionFrom(acceptance.expected.assertion);
    const acceptanceId = acceptance.id;
    if (assertion === undefined || typeof acceptanceId !== "string")
      return "invalid";
    if (
      (assertion.kind === "command" || assertion.kind === "status") &&
      !VERIFICATION_COMMAND.test(assertion.command)
    ) {
      return "invalid";
    }
    const linkedScenario = scenarios.find(
      (candidate) =>
        typeof candidate.id === "string" &&
        Array.isArray(candidate.acceptanceIds) &&
        candidate.acceptanceIds.includes(acceptanceId),
    );
    if (linkedScenario === undefined) return "unlinked";
    const declaredId = Array.isArray(acceptance.checkIds)
      ? acceptance.checkIds.find(
          (id): id is string =>
            typeof id === "string" && /^server\.[A-Za-z0-9_-]+$/.test(id),
        )
      : undefined;
    result.push({
      id: declaredId ?? `server.${assertion.kind}`,
      scenarioId: linkedScenario.id as string,
      assertion,
      lines: [],
    });
  }
  return result;
}

async function bounded<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new Interruption("cancelled");
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  const timeout = Promise.withResolvers<never>();
  timer = setTimeout(
    () => timeout.reject(new Interruption("timed_out")),
    timeoutMs,
  );
  const cancelled = Promise.withResolvers<never>();
  if (signal !== undefined) {
    abort = () => cancelled.reject(new Interruption("cancelled"));
    signal.addEventListener("abort", abort, { once: true });
  }
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      timeout.promise,
      cancelled.promise,
    ]);
  } finally {
    clearTimeout(timer);
    if (signal !== undefined && abort !== undefined) {
      signal.removeEventListener("abort", abort);
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scenario(
  entry: AssertionEntry,
  state: string,
): VerificationStageCheck["subject"] {
  return {
    class: "runtime",
    surface: "minecraft_server",
    scenario: {
      id: entry.scenarioId,
      state,
      kind: entry.assertion.kind === "multiplayer" ? "multiplayer" : "state",
    },
  };
}

function protocolArgv(assertion: ServerAssertion): string[] {
  if (assertion.kind === "command" || assertion.kind === "status") {
    return ["rcon-client", "send", assertion.command];
  }
  if (assertion.kind === "inventory") {
    return ["mineflayer", "inventory", assertion.item];
  }
  if (assertion.kind === "world") {
    return [
      "mineflayer",
      "world",
      String(assertion.position.x),
      String(assertion.position.y),
      String(assertion.position.z),
      assertion.block,
    ];
  }
  if (assertion.kind === "multiplayer") {
    return ["mineflayer", "multiplayer", ...assertion.players];
  }
  throw new Error("Unsupported assertion.");
}

function check(
  context: VerificationStageContext,
  entry: AssertionEntry,
  status: EvidenceStatus,
  checked: boolean,
  log: { name: string; path: string } | undefined,
  operationArgv?: readonly string[],
): VerificationStageCheck {
  const argv = [...context.target.verification.checks.server!.argv];
  return {
    id: entry.id,
    requested: true,
    checked,
    status,
    requestedArgv: argv,
    executedArgv: checked
      ? [...(operationArgv ?? protocolArgv(entry.assertion))]
      : null,
    exitCode: null,
    subject: scenario(entry, status === "passed" ? "completed" : status),
    logs: log === undefined ? [] : [log],
  };
}

function fallbackCheck(
  context: VerificationStageContext,
  status: EvidenceStatus,
): VerificationStageCheck {
  const argv = [...(context.target.verification.checks.server?.argv ?? [])];
  return {
    id: "server",
    requested: true,
    checked: false,
    status,
    requestedArgv: argv,
    executedArgv: null,
    exitCode: null,
    subject: {
      class: "source",
      sourceSha256: "0".repeat(64),
      exportSha256: "0".repeat(64),
    },
    logs: [],
  };
}

async function waitForSpawn(
  bot: ProbeBot,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  if (bot.once === undefined || bot.off === undefined) return;
  const ready = Promise.withResolvers<void>();
  const spawn = () => {
    cleanup();
    ready.resolve();
  };
  const failure = (...args: unknown[]) => {
    cleanup();
    ready.reject(
      new Error(args.map(String).join(" ") || "Mineflayer bot disconnected."),
    );
  };
  const cleanup = () => {
    bot.off!("spawn", spawn);
    bot.off!("error", failure);
    bot.off!("kicked", failure);
    bot.off!("end", failure);
  };
  bot.once("spawn", spawn);
  bot.once("error", failure);
  bot.once("kicked", failure);
  bot.once("end", failure);
  try {
    await bounded(() => ready.promise, timeoutMs, signal);
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function runAssertion(
  entry: AssertionEntry,
  rcon: RconClient,
  bot: ProbeBot | undefined,
): Promise<void> {
  const assertion = entry.assertion;
  if (assertion.kind === "command" || assertion.kind === "status") {
    entry.lines.push(`command: ${assertion.command}`);
    const response = await rcon.send(assertion.command);
    entry.lines.push(`expected: ${assertion.response}`, `actual: ${response}`);
    if (response !== assertion.response)
      throw new Error("RCON response did not match.");
    return;
  }
  if (bot === undefined) throw new Error("Mineflayer bot is unavailable.");
  if (assertion.kind === "inventory") {
    const count = bot.inventory
      .items()
      .filter((item) => item.name === assertion.item)
      .reduce((total, item) => total + item.count, 0);
    entry.lines.push(
      `inventory ${assertion.item}: expected=${assertion.count} actual=${count}`,
    );
    if (count !== assertion.count)
      throw new Error("Inventory count did not match.");
    return;
  }
  if (assertion.kind === "world") {
    const block = bot.blockAt(assertion.position);
    entry.lines.push(
      `world ${assertion.position.x},${assertion.position.y},${assertion.position.z}: expected=${assertion.block} actual=${block?.name ?? "null"}`,
    );
    if (block?.name !== assertion.block)
      throw new Error("World block did not match.");
    return;
  }
  if (assertion.kind !== "multiplayer")
    throw new Error("Unsupported assertion.");
  const participants = assertion.players.filter(
    (player) => player !== bot.username,
  );
  const missing = participants.filter(
    (player) => bot.players[player] === undefined,
  );
  entry.lines.push(
    `multiplayer expected=${participants.join(",")} online=${Object.keys(bot.players).join(",")}`,
  );
  if (participants.length === 0 || missing.length > 0)
    throw new Error(`Independent players missing: ${missing.join(",")}`);
  if (bot.synchronizedState === undefined)
    throw new Error("No synchronized-state oracle is available.");
  const synchronized = await bot.synchronizedState(
    participants,
    assertion.oracle,
  );
  entry.lines.push(`synchronized=${synchronized}`);
  if (!synchronized) throw new Error("Multiplayer state did not match.");
}

function defaultRcon(config: RconConfig, timeoutMs: number): RconClient {
  const client = new Rcon({ ...config, timeout: timeoutMs, maxPending: 1 });
  return {
    connect: () => client.connect(),
    send: (command) => client.send(command),
    end: () => {
      const socket = client.socket;
      if (socket === null) return Promise.resolve();
      const closed = Promise.withResolvers<void>();
      socket.once("close", closed.resolve);
      socket.destroy();
      return closed.promise;
    },
    destroy: () => client.socket?.destroy(),
  };
}

export function createServerBehaviorExecutor(
  options: ServerBehaviorOptions,
): VerificationStageExecutor {
  const timeoutMs = options.timeoutMs ?? 10_000;
  return async (context) => {
    const assertions = entries(context);
    if (context.stage !== "server") {
      return { checks: [fallbackCheck(context, "unavailable")] };
    }
    if (
      assertions === "invalid" ||
      assertions === "unlinked" ||
      assertions.length === 0
    ) {
      return {
        checks: [fallbackCheck(context, "unavailable")],
      };
    }

    const invalidConfiguration =
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      !["127.0.0.1", "::1"].includes(options.rcon.host) ||
      !Number.isInteger(options.rcon.port) ||
      options.rcon.port < 1 ||
      options.rcon.port > 65_535 ||
      options.rcon.password.length === 0 ||
      (options.bot !== undefined &&
        (!["127.0.0.1", "::1"].includes(options.bot.host) ||
          !Number.isInteger(options.bot.port) ||
          options.bot.port < 1 ||
          options.bot.port > 65_535 ||
          options.bot.username.length === 0)) ||
      (options.bot !== undefined &&
        assertions.some(
          (entry) =>
            entry.assertion.kind === "multiplayer" &&
            entry.assertion.players.every(
              (player) => player === options.bot!.username,
            ),
        ));
    if (invalidConfiguration) {
      return {
        checks: assertions.map((entry) =>
          check(context, entry, "unavailable", false, undefined),
        ),
      };
    }
    if (
      !UUID_PATTERN.test(options.serverInstance?.id ?? "") ||
      options.serverInstance.version !== context.target.minecraft.version ||
      options.bot === undefined ||
      options.bot.version !== context.target.minecraft.version ||
      !testedVersions.includes(context.target.minecraft.version)
    ) {
      return {
        checks: assertions.map((entry) =>
          check(context, entry, "unavailable", false, undefined),
        ),
      };
    }
    if (context.signal?.aborted) {
      return {
        checks: assertions.map((entry) =>
          check(context, entry, "cancelled", false, undefined),
        ),
      };
    }

    const createRcon =
      options.createRcon ??
      ((config: RconConfig) => defaultRcon(config, timeoutMs));
    const createBot =
      options.createBot ??
      ((config: BotConfig) =>
        createMineflayerBot(config) as unknown as ProbeBot);
    const results: Array<{
      entry: AssertionEntry;
      status: EvidenceStatus;
      checked: boolean;
      operationArgv?: readonly string[];
    }> = [];
    let rcon: RconClient | undefined;
    let rconConnected = false;
    let bot: ProbeBot | undefined;
    let setupOperation: readonly string[] | undefined;
    let terminal: EvidenceStatus | undefined;
    const cleanupErrors: string[] = [];

    try {
      rcon = createRcon(options.rcon);
      setupOperation = ["rcon-client", "connect"];
      await bounded(() => rcon!.connect(), timeoutMs, context.signal);
      rconConnected = true;
      setupOperation = ["mineflayer", "connect"];
      bot = createBot(options.bot);
      await waitForSpawn(bot, timeoutMs, context.signal);
      setupOperation = undefined;
      if (bot.username !== options.bot.username) {
        throw new IdentityUnavailable(
          "Mineflayer handshake username did not match the trusted configuration.",
        );
      }
      const identityCommand = `voxellume test identity ${options.serverInstance.id}`;
      for (const entry of assertions) {
        entry.lines.push(`identity command: ${identityCommand}`);
      }
      let actualServerVersion: string;
      setupOperation = ["rcon-client", "send", identityCommand];
      try {
        actualServerVersion = await bounded(
          () => rcon!.send(identityCommand),
          timeoutMs,
          context.signal,
        );
      } catch (error) {
        if (error instanceof Interruption) throw error;
        throw new IdentityUnavailable(
          `Verification-mod identity handshake failed: ${errorText(error)}`,
        );
      }
      for (const entry of assertions) {
        entry.lines.push(`server release: ${actualServerVersion}`);
      }
      if (actualServerVersion !== context.target.minecraft.version) {
        throw new IdentityUnavailable(
          `Server release ${actualServerVersion} did not match target ${context.target.minecraft.version}.`,
        );
      }
      setupOperation = undefined;
      if (bot.confirmServerInstance === undefined) {
        throw new IdentityUnavailable(
          "Mineflayer verification-mod instance confirmation is unavailable.",
        );
      }
      setupOperation = [
        "mineflayer",
        "confirmServerInstance",
        options.serverInstance.id,
      ];
      let botIdentity: { instanceId: string; version: string };
      try {
        botIdentity = await bounded(
          () =>
            Promise.resolve(
              bot!.confirmServerInstance!(options.serverInstance.id),
            ),
          timeoutMs,
          context.signal,
        );
      } catch (error) {
        if (error instanceof Interruption) throw error;
        throw new IdentityUnavailable(
          `Mineflayer instance confirmation failed: ${errorText(error)}`,
        );
      }
      if (!isObject(botIdentity)) {
        throw new IdentityUnavailable(
          "Malformed Mineflayer instance identity.",
        );
      }
      for (const entry of assertions) {
        entry.lines.push(
          `bot instance: ${String(botIdentity.instanceId)}`,
          `bot release: ${String(botIdentity.version)}`,
        );
      }
      if (
        botIdentity.instanceId !== options.serverInstance.id ||
        botIdentity.version !== context.target.minecraft.version
      ) {
        throw new IdentityUnavailable(
          "Mineflayer endpoint identity did not match the trusted server instance.",
        );
      }
      setupOperation = undefined;
      if (
        assertions.some((entry) => entry.assertion.kind === "multiplayer") &&
        bot.synchronizedState === undefined
      ) {
        throw new IdentityUnavailable(
          "No synchronized-state oracle is available.",
        );
      }
      for (const entry of assertions) {
        if (terminal !== undefined) {
          results.push({
            entry,
            status: terminal === "cancelled" ? "cancelled" : "unavailable",
            checked: false,
          });
          continue;
        }
        let started = false;
        try {
          await bounded(
            () => {
              started = true;
              return runAssertion(entry, rcon!, bot);
            },
            timeoutMs,
            context.signal,
          );
          results.push({ entry, status: "passed", checked: true });
        } catch (error) {
          const status =
            error instanceof Interruption ? error.status : "failed";
          entry.lines.push(`error: ${errorText(error)}`);
          results.push({ entry, status, checked: started });
          terminal = status;
        }
      }
    } catch (error) {
      const status =
        error instanceof Interruption
          ? error.status
          : error instanceof IdentityUnavailable
            ? "unavailable"
            : "failed";
      const setupAttempted =
        setupOperation !== undefined && status !== "unavailable";
      const resultStatus =
        status === "failed" && !setupAttempted ? "unavailable" : status;
      for (const entry of assertions.slice(results.length)) {
        entry.lines.push(`error: ${errorText(error)}`);
        results.push({
          entry,
          status: resultStatus,
          checked: setupAttempted,
          ...(setupAttempted ? { operationArgv: setupOperation! } : {}),
        });
      }
      terminal = resultStatus;
    } finally {
      if (bot !== undefined) {
        try {
          await bounded(
            () => Promise.resolve().then(() => bot!.quit()),
            timeoutMs,
          );
        } catch (error) {
          cleanupErrors.push(`bot cleanup: ${errorText(error)}`);
        }
      }
      if (rcon !== undefined) {
        try {
          if (rconConnected) {
            await bounded(() => rcon!.end(), timeoutMs);
          } else {
            rcon.destroy();
          }
        } catch (error) {
          cleanupErrors.push(`RCON cleanup: ${errorText(error)}`);
          try {
            rcon.destroy();
          } catch (destroyError) {
            cleanupErrors.push(`RCON destroy: ${errorText(destroyError)}`);
          }
        }
      }
    }

    if (cleanupErrors.length > 0) {
      for (const result of results) {
        result.entry.lines.push(...cleanupErrors);
        if (result.status === "passed") {
          result.status = "failed";
          result.checked = true;
        }
      }
      if (
        !results.some(
          (result) =>
            result.status === "failed" || result.status === "unavailable",
        )
      ) {
        const first = results[0];
        if (first !== undefined) {
          first.status = "failed";
          if (!first.checked) {
            first.checked = true;
            first.operationArgv = cleanupErrors.some((error) =>
              error.startsWith("RCON"),
            )
              ? ["rcon-client", "end"]
              : ["mineflayer", "quit"];
          }
        }
      }
    }

    const secrets = [
      ...new Set([options.rcon.password, ...context.policy.secretValues]),
    ].filter((secret) => secret.length > 0);
    const directory = join(
      context.roots.isolationRoot,
      "verification",
      "server-behavior",
      context.identity.transactionId,
    );
    const checks: VerificationStageCheck[] = [];
    for (const result of results) {
      let log: { name: string; path: string } | undefined;
      if (result.entry.lines.length > 0) {
        const name = `${result.entry.id}.log`;
        const path = join(directory, name);
        try {
          await mkdir(directory, { recursive: true });
          await writeFile(
            path,
            `${redactText(result.entry.lines.join("\n"), secrets)}\n`,
            { encoding: "utf8", mode: 0o600 },
          );
          log = { name, path };
        } catch {
          result.status = "failed";
          result.checked = true;
        }
      }
      checks.push(
        check(
          context,
          result.entry,
          result.status,
          result.checked,
          log,
          result.operationArgv,
        ),
      );
    }
    return { checks };
  };
}
