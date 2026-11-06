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
  send(command: string): Promise<string>;
  end(): Promise<void>;
}

interface ProbeBot {
  readonly username: string;
  readonly inventory: {
    items(): Array<{ name: string; count: number }>;
  };
  blockAt(position: {
    x: number;
    y: number;
    z: number;
  }): { name: string } | null;
  readonly players: Record<string, { username: string } | undefined>;
  quit(reason?: string): void;
  once?(event: string, listener: (...args: never[]) => void): unknown;
  off?(event: string, listener: (...args: never[]) => void): unknown;
}

export interface ServerBehaviorOptions {
  readonly rcon: RconConfig;
  readonly bot?: BotConfig;
  readonly timeoutMs?: number;
  readonly connectRcon?: (config: RconConfig) => Promise<RconClient>;
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
  | { kind: "multiplayer"; players: string[] };

interface AssertionEntry {
  readonly id: string;
  readonly acceptanceId: string;
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
    return Array.isArray(value.players) &&
      value.players.every((player) => typeof player === "string")
      ? { kind: "multiplayer", players: [...value.players] }
      : undefined;
  }
  return undefined;
}

function entries(
  context: VerificationStageContext,
): AssertionEntry[] | undefined {
  const result: AssertionEntry[] = [];
  for (const acceptance of context.modSpec.acceptance) {
    if (acceptance.kind !== "server") continue;
    if (!isObject(acceptance.expected)) return undefined;
    const assertion = assertionFrom(acceptance.expected.assertion);
    const acceptanceId = acceptance.id;
    if (assertion === undefined || typeof acceptanceId !== "string")
      return undefined;
    const declaredId = Array.isArray(acceptance.checkIds)
      ? acceptance.checkIds.find(
          (id): id is string =>
            typeof id === "string" && /^server\.[A-Za-z0-9_-]+$/.test(id),
        )
      : undefined;
    result.push({
      id: declaredId ?? `server.${assertion.kind}`,
      acceptanceId,
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
  context: VerificationStageContext,
  entry: AssertionEntry,
  state: string,
): VerificationStageCheck["subject"] {
  const scenarios = (context.modSpec.runtime as JsonObject)
    .scenarios as JsonObject[];
  const selected =
    scenarios.find(
      (candidate) =>
        Array.isArray(candidate.acceptanceIds) &&
        candidate.acceptanceIds.includes(entry.acceptanceId),
    ) ?? scenarios[0];
  return {
    class: "runtime",
    surface: "minecraft_server",
    scenario: {
      id: typeof selected?.id === "string" ? selected.id : "server_behavior",
      state,
      kind: entry.assertion.kind === "multiplayer" ? "multiplayer" : "state",
    },
  };
}

function check(
  context: VerificationStageContext,
  entry: AssertionEntry,
  status: EvidenceStatus,
  checked: boolean,
  log: { name: string; path: string } | undefined,
): VerificationStageCheck {
  const argv = [...context.target.verification.checks.server!.argv];
  return {
    id: entry.id,
    requested: true,
    checked,
    status,
    requestedArgv: argv,
    executedArgv: checked ? argv : null,
    exitCode: checked ? (status === "passed" ? 0 : 1) : null,
    subject: scenario(context, entry, checked ? "completed" : status),
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
    subject: { class: "runtime", surface: "minecraft_server" },
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
  const failure = (...args: never[]) => {
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
  const missing = assertion.players.filter(
    (player) => bot.players[player] === undefined,
  );
  entry.lines.push(
    `multiplayer expected=${assertion.players.join(",")} online=${Object.keys(bot.players).join(",")}`,
  );
  if (missing.length > 0)
    throw new Error(`Players missing: ${missing.join(",")}`);
}

export function createServerBehaviorExecutor(
  options: ServerBehaviorOptions,
): VerificationStageExecutor {
  const timeoutMs = options.timeoutMs ?? 10_000;
  return async (context) => {
    const assertions = entries(context);
    if (context.stage !== "server") {
      return { checks: [fallbackCheck(context, "failed")] };
    }
    if (assertions === undefined || assertions.length === 0) {
      return {
        checks: [
          fallbackCheck(
            context,
            assertions === undefined ? "failed" : "unavailable",
          ),
        ],
      };
    }

    const requiresBot = assertions.some((entry) =>
      ["inventory", "world", "multiplayer"].includes(entry.assertion.kind),
    );
    const invalidConfiguration =
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      !["127.0.0.1", "::1"].includes(options.rcon.host) ||
      !Number.isInteger(options.rcon.port) ||
      options.rcon.port < 1 ||
      options.rcon.port > 65_535 ||
      options.rcon.password.length === 0 ||
      (requiresBot &&
        options.bot !== undefined &&
        (!["127.0.0.1", "::1"].includes(options.bot.host) ||
          !Number.isInteger(options.bot.port) ||
          options.bot.port < 1 ||
          options.bot.port > 65_535 ||
          options.bot.username.length === 0));
    const unsupportedBot =
      requiresBot &&
      options.bot !== undefined &&
      (options.bot.version !== context.target.minecraft.version ||
        !testedVersions.includes(context.target.minecraft.version));
    if (invalidConfiguration) {
      return {
        checks: assertions.map((entry) =>
          check(context, entry, "failed", false, undefined),
        ),
      };
    }
    if (unsupportedBot || (requiresBot && options.bot === undefined)) {
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

    const connect =
      options.connectRcon ??
      ((config: RconConfig) =>
        Rcon.connect({ ...config, timeout: timeoutMs, maxPending: 1 }));
    const createBot =
      options.createBot ??
      ((config: BotConfig) =>
        createMineflayerBot(config) as unknown as ProbeBot);
    const results: Array<{
      entry: AssertionEntry;
      status: EvidenceStatus;
      checked: boolean;
    }> = [];
    let rcon: RconClient | undefined;
    let bot: ProbeBot | undefined;
    let terminal: EvidenceStatus | undefined;
    const cleanupErrors: string[] = [];

    try {
      rcon = await bounded(
        () => connect(options.rcon),
        timeoutMs,
        context.signal,
      );
      if (requiresBot) {
        bot = createBot(options.bot!);
        await waitForSpawn(bot, timeoutMs, context.signal);
      }
      for (const entry of assertions) {
        if (terminal !== undefined) {
          results.push({ entry, status: terminal, checked: false });
          continue;
        }
        try {
          await bounded(
            () => runAssertion(entry, rcon!, bot),
            timeoutMs,
            context.signal,
          );
          results.push({ entry, status: "passed", checked: true });
        } catch (error) {
          const status =
            error instanceof Interruption ? error.status : "failed";
          entry.lines.push(`error: ${errorText(error)}`);
          results.push({ entry, status, checked: status === "failed" });
          terminal = status;
        }
      }
    } catch (error) {
      const status = error instanceof Interruption ? error.status : "failed";
      for (const entry of assertions.slice(results.length)) {
        entry.lines.push(`error: ${errorText(error)}`);
        results.push({ entry, status, checked: false });
      }
      terminal = status;
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
          await bounded(() => rcon!.end(), timeoutMs);
        } catch (error) {
          cleanupErrors.push(`RCON cleanup: ${errorText(error)}`);
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
      if (!results.some((result) => result.status === "failed")) {
        const first = results[0];
        if (first !== undefined) {
          first.status = "failed";
          first.checked = false;
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
        check(context, result.entry, result.status, result.checked, log),
      );
    }
    return { checks };
  };
}
