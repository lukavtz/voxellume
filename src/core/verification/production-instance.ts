import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type {
  EvidenceCheckSubject,
  EvidenceReviewScenario,
  EvidenceStatus,
} from "./evidence.ts";
import {
  inspectProductionJar,
  type ProductionJarInspectionInput,
} from "./production-jar.ts";
import type {
  RuntimeAdapter,
  RuntimeOperationResult,
  RuntimeSession,
} from "./runtime-adapter.ts";

export type ProductionInstanceStageId =
  | "inspection"
  | "server"
  | "persistence"
  | "client"
  | "multiplayer"
  | "modpack";

type Surface = "minecraft_server" | "minecraft_client";
type ScenarioKind = "state" | "multiplayer" | "restart";

interface StateScenario {
  readonly id: string;
  readonly state: string;
}

interface LoadedMod {
  readonly id: string;
  readonly version: string;
  readonly origin: string;
  readonly sha256: string;
}

export interface VerifyProductionInstanceInput {
  readonly productionJar: ProductionJarInspectionInput;
  readonly adapters: {
    readonly server: RuntimeAdapter;
    readonly client: RuntimeAdapter;
    readonly observer: RuntimeAdapter;
  };
  readonly profiles: {
    readonly server: {
      readonly projectId: string;
      readonly projectRoot: string;
      readonly pristine: boolean;
    };
    readonly client: {
      readonly projectId: string;
      readonly projectRoot: string;
      readonly pristine: boolean;
    };
    readonly observer: {
      readonly projectId: string;
      readonly projectRoot: string;
      readonly pristine: boolean;
    };
  };
  readonly userSaveRoots: readonly string[];
  readonly world: { readonly name: string; readonly seed: string };
  readonly identity: {
    readonly environment: "production";
    readonly modId: string;
    readonly modVersion: string;
    readonly minecraftVersion: string;
    readonly protocolVersion: number;
    readonly remapped: true;
    readonly remap: {
      readonly sourceNamespace: string;
      readonly runtimeNamespace: string;
      readonly mappedClass: string;
    };
    readonly dependencies: readonly {
      readonly id: string;
      readonly version: string;
    }[];
  };
  readonly scenarios: {
    readonly dedicatedServer: StateScenario & {
      readonly oracle: {
        readonly kind: "item_durability";
        readonly item: string;
        readonly damage: number;
        readonly remaining: number;
      };
    };
    readonly persistence: StateScenario & {
      readonly oracle: {
        readonly savedState: string;
        readonly restoredState: string;
      };
    };
    readonly multiplayer: StateScenario & {
      readonly actor: string;
      readonly observer: string;
      readonly oracle: {
        readonly sharedState: string;
        readonly serverTick: number;
      };
    };
  };
  readonly modpack: {
    readonly id: string;
    readonly version: string;
    readonly declaredMods: readonly string[];
    readonly loadedMods: readonly LoadedMod[];
  };
}

export interface ProductionInstanceCheck {
  readonly id: string;
  readonly requested: true;
  readonly checked: boolean;
  readonly status: EvidenceStatus;
  readonly requestedArgv: readonly string[];
  readonly executedArgv: readonly string[] | null;
  readonly exitCode: number | null;
  readonly subject: EvidenceCheckSubject;
  readonly logs: readonly [];
}

export interface ProductionInstanceStage {
  readonly id: ProductionInstanceStageId;
  readonly status: EvidenceStatus;
  readonly checks: readonly ProductionInstanceCheck[];
}

export interface ProductionInstanceCleanup {
  readonly surface: Surface;
  readonly sessionId: string;
  readonly ownedPids: readonly number[];
  readonly cancelStatus: EvidenceStatus;
  readonly cleanupStatus: EvidenceStatus;
}

export interface VerifyProductionInstanceResult {
  readonly status: EvidenceStatus;
  readonly support: "verified" | "not_verified";
  readonly productionJarSha256: string;
  readonly stages: readonly ProductionInstanceStage[];
  readonly cleanup: readonly ProductionInstanceCleanup[];
  readonly error: { readonly code: string; readonly detail: string };
}

interface MutableCheck {
  id: string;
  requested: true;
  checked: boolean;
  status: EvidenceStatus;
  requestedArgv: readonly string[];
  executedArgv: readonly string[] | null;
  exitCode: number | null;
  subject: EvidenceCheckSubject;
  logs: readonly [];
}

interface MutableStage {
  id: ProductionInstanceStageId;
  status: EvidenceStatus;
  checks: MutableCheck[];
}

interface ActiveSession {
  readonly surface: Surface;
  readonly adapter: RuntimeAdapter;
  readonly session: RuntimeSession;
  active: boolean;
}

const CONDITIONS = {
  identity: "production.identity",
  serverBehavior: (id: string) => `production.server_behavior:${id}`,
  persistenceBefore: (id: string) => `production.persistence.before:${id}`,
  persistenceAfter: (id: string) => `production.persistence.after:${id}`,
  multiplayer: (id: string) => `production.multiplayer:${id}`,
  modpack: (id: string) => `production.modpack:${id}`,
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function scenario(
  id: string,
  state: string,
  kind: ScenarioKind,
): EvidenceReviewScenario {
  return { id, state, kind };
}

function runtimeArgv(adapter: RuntimeAdapter, condition: string): string[] {
  return ["runtime-adapter", adapter.id, "assert", condition];
}

function pendingCheck(
  id: string,
  adapter: RuntimeAdapter,
  surface: Surface,
  productionJarSha256: string,
  condition: string,
  reviewScenario: NonNullable<EvidenceCheckSubject["scenario"]>,
): MutableCheck {
  return {
    id,
    requested: true,
    checked: false,
    status: "unavailable",
    requestedArgv: runtimeArgv(adapter, condition),
    executedArgv: null,
    exitCode: null,
    subject: {
      class: "runtime",
      surface,
      productionJarSha256,
      scenario: reviewScenario,
    },
    logs: [],
  };
}

function within(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

function validSession(value: unknown): value is RuntimeSession {
  if (!record(value) || !text(value.id) || !Array.isArray(value.ownedPids)) {
    return false;
  }
  return (
    value.ownedPids.length > 0 &&
    new Set(value.ownedPids).size === value.ownedPids.length &&
    value.ownedPids.every(
      (pid) =>
        Number.isSafeInteger(pid) && (pid as number) > 0 && pid !== process.pid,
    )
  );
}

function operationFailure(
  adapter: RuntimeAdapter,
  operation: string,
): RuntimeOperationResult<never> {
  return {
    status: "failed",
    code: "runtime_operation_failed",
    adapter: adapter.id,
    operation,
  };
}

function operationExitCode(status: EvidenceStatus): number | null {
  return status === "passed" ? 0 : status === "failed" ? 1 : null;
}

function exactTerminationObservation(
  value: unknown,
  ownedPids: readonly number[],
): boolean {
  if (!record(value)) return false;
  const terminated = value.terminatedOwnedPids;
  return (
    Array.isArray(terminated) &&
    terminated.length === ownedPids.length &&
    new Set(terminated).size === terminated.length &&
    terminated.every((pid) => ownedPids.includes(pid as number)) &&
    Array.isArray(value.remainingOwnedPids) &&
    value.remainingOwnedPids.length === 0
  );
}

export async function verifyProductionInstance(
  input: VerifyProductionInstanceInput,
): Promise<VerifyProductionInstanceResult> {
  const inspection = inspectProductionJar(input.productionJar);
  const sha256 = inspection.sha256;
  const server = input.adapters.server;
  const client = input.adapters.client;
  const observer = input.adapters.observer;
  const serverIdentity = CONDITIONS.identity;
  const serverBehavior = CONDITIONS.serverBehavior(
    input.scenarios.dedicatedServer.id,
  );
  const persistenceBefore = CONDITIONS.persistenceBefore(
    input.scenarios.persistence.id,
  );
  const persistenceAfter = CONDITIONS.persistenceAfter(
    input.scenarios.persistence.id,
  );
  const multiplayer = CONDITIONS.multiplayer(input.scenarios.multiplayer.id);
  const modpack = CONDITIONS.modpack(input.modpack.id);

  const stages: MutableStage[] = [
    {
      id: "inspection",
      status: inspection.status,
      checks: [
        {
          id: "jar.inspect",
          requested: true,
          checked: true,
          status: inspection.status,
          requestedArgv: ["internal:inspect-production-jar"],
          executedArgv: ["internal:inspect-production-jar"],
          exitCode: inspection.status === "passed" ? 0 : 1,
          subject: {
            class: "source",
            sourceSha256: sha256,
            exportSha256: sha256,
          },
          logs: [],
        },
      ],
    },
    {
      id: "server",
      status: "unavailable",
      checks: [
        pendingCheck(
          "server.identity",
          server,
          "minecraft_server",
          sha256,
          serverIdentity,
          scenario("production_server_identity", "production", "state"),
        ),
        pendingCheck(
          "server.behavior",
          server,
          "minecraft_server",
          sha256,
          serverBehavior,
          scenario(
            input.scenarios.dedicatedServer.id,
            input.scenarios.dedicatedServer.state,
            "state",
          ),
        ),
      ],
    },
    {
      id: "persistence",
      status: "unavailable",
      checks: [
        pendingCheck(
          "persistence.before",
          server,
          "minecraft_server",
          sha256,
          persistenceBefore,
          scenario(
            input.scenarios.persistence.id,
            input.scenarios.persistence.state,
            "restart",
          ),
        ),
        pendingCheck(
          "persistence.after",
          server,
          "minecraft_server",
          sha256,
          persistenceAfter,
          scenario(
            input.scenarios.persistence.id,
            input.scenarios.persistence.state,
            "restart",
          ),
        ),
      ],
    },
    {
      id: "client",
      status: "unavailable",
      checks: [
        pendingCheck(
          "client.identity",
          client,
          "minecraft_client",
          sha256,
          serverIdentity,
          scenario("production_client_identity", "production", "state"),
        ),
        pendingCheck(
          "client.observer_identity",
          observer,
          "minecraft_client",
          sha256,
          serverIdentity,
          scenario("production_observer_identity", "production", "state"),
        ),
      ],
    },
    {
      id: "multiplayer",
      status: "unavailable",
      checks: [
        pendingCheck(
          "multiplayer.actor",
          client,
          "minecraft_client",
          sha256,
          multiplayer,
          scenario(
            input.scenarios.multiplayer.id,
            input.scenarios.multiplayer.state,
            "multiplayer",
          ),
        ),
        pendingCheck(
          "multiplayer.observer",
          observer,
          "minecraft_client",
          sha256,
          multiplayer,
          scenario(
            input.scenarios.multiplayer.id,
            input.scenarios.multiplayer.state,
            "multiplayer",
          ),
        ),
      ],
    },
    {
      id: "modpack",
      status: "unavailable",
      checks: [
        pendingCheck(
          "modpack.compatibility",
          client,
          "minecraft_client",
          sha256,
          modpack,
          scenario(input.modpack.id, "compatible", "state"),
        ),
      ],
    },
  ];

  const cleanup: ProductionInstanceCleanup[] = [];
  const sessions: ActiveSession[] = [];
  let resultStatus: EvidenceStatus = inspection.status;
  let error: { code: string; detail: string } | undefined =
    inspection.status === "passed"
      ? undefined
      : {
          code: inspection.code ?? "production_jar_invalid",
          detail: "Exact production JAR inspection failed",
        };

  const findStage = (id: ProductionInstanceStageId): MutableStage =>
    stages.find((candidate) => candidate.id === id)!;
  const findCheck = (stageId: ProductionInstanceStageId, id: string) =>
    findStage(stageId).checks.find((candidate) => candidate.id === id)!;

  const setError = (status: EvidenceStatus, code: string, detail: string) => {
    if (error === undefined) {
      resultStatus = status;
      error = { code, detail };
    }
  };

  const failCheck = (
    stageId: ProductionInstanceStageId,
    checkId: string,
    status: EvidenceStatus,
    code: string,
    detail: string,
    checked: boolean,
  ): false => {
    const check = findCheck(stageId, checkId);
    check.checked = checked;
    check.status = status;
    check.executedArgv = checked ? check.requestedArgv : null;
    check.exitCode = checked ? operationExitCode(status) : null;
    findStage(stageId).status = status;
    setError(status, code, detail);
    return false;
  };

  const passCheck = (
    stageId: ProductionInstanceStageId,
    checkId: string,
  ): void => {
    const check = findCheck(stageId, checkId);
    check.checked = true;
    check.status = "passed";
    check.executedArgv = check.requestedArgv;
    check.exitCode = 0;
  };

  const closeSession = async (
    active: ActiveSession,
  ): Promise<{ code: string; detail: string } | undefined> => {
    if (!active.active) return undefined;
    active.active = false;
    const processInput = {
      sessionId: active.session.id,
      ownedPids: [...active.session.ownedPids],
    };
    let cancelResult: RuntimeOperationResult<unknown>;
    let cleanupResult: RuntimeOperationResult<unknown>;
    try {
      cancelResult = await active.adapter.cancel(processInput);
    } catch {
      cancelResult = operationFailure(active.adapter, "cancel");
    }
    try {
      cleanupResult = await active.adapter.cleanup(processInput);
    } catch {
      cleanupResult = operationFailure(active.adapter, "cleanup");
    }
    const cleanupObserved =
      cleanupResult.status === "passed" &&
      exactTerminationObservation(
        cleanupResult.value,
        active.session.ownedPids,
      );
    const cleanupStatus: EvidenceStatus =
      cleanupResult.status === "passed" && !cleanupObserved
        ? "unavailable"
        : cleanupResult.status;
    cleanup.push({
      surface: active.surface,
      sessionId: active.session.id,
      ownedPids: [...active.session.ownedPids],
      cancelStatus: cancelResult.status,
      cleanupStatus,
    });
    const failure =
      cancelResult.status !== "passed"
        ? {
            status: cancelResult.status,
            code: cancelResult.code,
            detail: `Failed to cancel owned ${active.surface} processes`,
          }
        : cleanupStatus !== "passed"
          ? {
              status: cleanupStatus,
              code:
                cleanupResult.status === "passed"
                  ? "cleanup_observation_required"
                  : cleanupResult.code,
              detail: `Failed to prove cleanup of owned ${active.surface} processes`,
            }
          : undefined;
    if (failure !== undefined) {
      setError(failure.status, failure.code, failure.detail);
      return { code: failure.code, detail: failure.detail };
    }
    return undefined;
  };

  const closeActive = async (): Promise<void> => {
    for (const active of sessions) await closeSession(active);
  };

  const finish = (): VerifyProductionInstanceResult => ({
    status: resultStatus,
    support:
      resultStatus === "passed" &&
      stages.every((candidate) => candidate.status === "passed")
        ? "verified"
        : "not_verified",
    productionJarSha256: sha256,
    stages,
    cleanup,
    error: error ?? { code: "", detail: "" },
  });

  if (inspection.status !== "passed") return finish();

  const preflightFailure = (
    code: string,
    detail: string,
    status: EvidenceStatus = "failed",
  ) => {
    setError(status, code, detail);
    return finish();
  };
  const configuredProfiles = [
    input.profiles.server,
    input.profiles.client,
    input.profiles.observer,
  ];
  if (configuredProfiles.some((profile) => !profile.pristine)) {
    return preflightFailure(
      "pristine_profile_required",
      "Server, client, and observer profiles must all be pristine",
    );
  }

  let serverProfile: (typeof configuredProfiles)[number];
  let clientProfile: (typeof configuredProfiles)[number];
  let observerProfile: (typeof configuredProfiles)[number];
  let saveRoots: string[];
  try {
    const roots = await Promise.all(
      configuredProfiles.map((profile) => realpath(profile.projectRoot)),
    );
    saveRoots = await Promise.all(
      input.userSaveRoots.map((root) => realpath(root)),
    );
    serverProfile = { ...configuredProfiles[0]!, projectRoot: roots[0]! };
    clientProfile = { ...configuredProfiles[1]!, projectRoot: roots[1]! };
    observerProfile = { ...configuredProfiles[2]!, projectRoot: roots[2]! };
  } catch {
    return preflightFailure(
      "profile_realpath_required",
      "Every profile and user-save root must resolve to an existing canonical path",
      "unavailable",
    );
  }

  const profiles = [serverProfile, clientProfile, observerProfile];
  if (
    new Set(profiles.map((profile) => profile.projectId)).size !==
      profiles.length ||
    profiles.some((profile, index) =>
      profiles
        .slice(index + 1)
        .some(
          (other) =>
            within(profile.projectRoot, other.projectRoot) ||
            within(other.projectRoot, profile.projectRoot),
        ),
    )
  ) {
    return preflightFailure(
      "separate_profiles_required",
      "Server, client, and observer require separate, non-overlapping canonical profiles",
    );
  }
  if (
    profiles.some((profile) =>
      saveRoots.some(
        (saveRoot) =>
          within(saveRoot, profile.projectRoot) ||
          within(profile.projectRoot, saveRoot),
      ),
    )
  ) {
    return preflightFailure(
      "user_saves_forbidden",
      "Production verification profiles and user saves must not overlap in either direction",
    );
  }
  if (!text(input.world.name)) {
    return preflightFailure(
      "world_name_required",
      "An isolated world name is required",
    );
  }
  if (!text(input.world.seed)) {
    return preflightFailure(
      "fixed_seed_required",
      "A fixed world seed is required",
    );
  }
  const expectedRemap = input.identity.remap;
  if (
    input.identity.environment !== "production" ||
    input.identity.remapped !== true ||
    !record(expectedRemap) ||
    !text(expectedRemap.sourceNamespace) ||
    !text(expectedRemap.runtimeNamespace) ||
    !text(expectedRemap.mappedClass) ||
    input.identity.modId !== input.productionJar.metadata.modId ||
    input.identity.modVersion !== input.productionJar.metadata.version ||
    input.identity.minecraftVersion !==
      input.productionJar.metadata.minecraftVersion ||
    !Number.isSafeInteger(input.identity.protocolVersion) ||
    input.identity.protocolVersion < 0 ||
    !Array.isArray(input.identity.dependencies) ||
    !input.identity.dependencies.every(
      (dependency) =>
        record(dependency) && text(dependency.id) && text(dependency.version),
    )
  ) {
    return preflightFailure(
      "production_identity_mismatch",
      "Expected identity must match the exact JAR and include concrete remap metadata",
    );
  }
  const serverOracle = input.scenarios.dedicatedServer.oracle;
  const persistenceOracle = input.scenarios.persistence.oracle;
  if (
    !text(input.scenarios.dedicatedServer.id) ||
    !text(input.scenarios.dedicatedServer.state) ||
    !record(serverOracle) ||
    serverOracle.kind !== "item_durability" ||
    !text(serverOracle.item) ||
    !Number.isSafeInteger(serverOracle.damage) ||
    (serverOracle.damage as number) < 0 ||
    !Number.isSafeInteger(serverOracle.remaining) ||
    (serverOracle.remaining as number) < 0 ||
    input.scenarios.dedicatedServer.state !==
      `damage=${serverOracle.damage};remaining=${serverOracle.remaining}` ||
    !text(input.scenarios.persistence.id) ||
    !text(input.scenarios.persistence.state) ||
    !record(persistenceOracle) ||
    !text(persistenceOracle.savedState) ||
    !text(persistenceOracle.restoredState) ||
    input.scenarios.persistence.state !== persistenceOracle.savedState ||
    persistenceOracle.savedState !== persistenceOracle.restoredState
  ) {
    return preflightFailure(
      "production_scenario_required",
      "Server and persistence scenarios require exact state",
    );
  }
  const multiplayerOracle = input.scenarios.multiplayer.oracle;
  if (
    !text(input.scenarios.multiplayer.id) ||
    !text(input.scenarios.multiplayer.state) ||
    !text(input.scenarios.multiplayer.actor) ||
    !text(input.scenarios.multiplayer.observer) ||
    input.scenarios.multiplayer.actor ===
      input.scenarios.multiplayer.observer ||
    !record(multiplayerOracle) ||
    !text(multiplayerOracle.sharedState) ||
    input.scenarios.multiplayer.state !== multiplayerOracle.sharedState ||
    !Number.isSafeInteger(multiplayerOracle.serverTick) ||
    (multiplayerOracle.serverTick as number) < 0
  ) {
    return preflightFailure(
      "independent_multiplayer_participants_required",
      "Multiplayer verification requires independent actor and observer",
    );
  }
  if (
    !text(input.modpack.id) ||
    !text(input.modpack.version) ||
    input.modpack.declaredMods.length === 0 ||
    !input.modpack.declaredMods.every(text) ||
    new Set(input.modpack.declaredMods).size !==
      input.modpack.declaredMods.length ||
    !Array.isArray(input.modpack.loadedMods) ||
    input.modpack.loadedMods.length === 0 ||
    !input.modpack.loadedMods.every(
      (mod) =>
        record(mod) &&
        text(mod.id) &&
        text(mod.version) &&
        text(mod.origin) &&
        typeof mod.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(mod.sha256),
    ) ||
    !isDeepStrictEqual(
      input.modpack.declaredMods,
      input.modpack.loadedMods.map((mod) => `${mod.id}@${mod.version}`),
    ) ||
    !input.modpack.loadedMods.some(
      (mod) =>
        mod.id === input.identity.modId &&
        mod.version === input.identity.modVersion &&
        mod.origin === "production_jar" &&
        mod.sha256 === sha256,
    )
  ) {
    return preflightFailure(
      "modpack_declaration_required",
      "A complete, non-empty modpack declaration is required",
    );
  }
  for (const adapter of [server, client, observer]) {
    if (
      !adapter.capabilities.launch ||
      !adapter.capabilities.realTicks ||
      !adapter.capabilities.assert ||
      !adapter.capabilities.cancel ||
      !adapter.capabilities.cleanup
    ) {
      return preflightFailure(
        "runtime_capability_required",
        "Production verification requires launch, real ticks, assertion, cancel, and cleanup capabilities",
        "unavailable",
      );
    }
  }
  if (!server.capabilities.worldCreate) {
    return preflightFailure(
      "runtime_capability_required",
      "Dedicated server verification requires isolated world creation",
      "unavailable",
    );
  }

  const launch = async (
    adapter: RuntimeAdapter,
    surface: Surface,
    profile: typeof serverProfile,
    mode: "hidden" | "visible",
    stageId: ProductionInstanceStageId,
    checkId: string,
  ): Promise<RuntimeSession | undefined> => {
    let launched: RuntimeOperationResult<RuntimeSession>;
    try {
      launched = await adapter.launch({
        projectId: profile.projectId,
        projectRoot: profile.projectRoot,
        mode,
      });
    } catch {
      launched = operationFailure(adapter, "launch");
    }
    if (launched.status !== "passed") {
      if (validSession(launched.session)) {
        sessions.push({
          surface,
          adapter,
          session: launched.session,
          active: true,
        });
      }
      failCheck(
        stageId,
        checkId,
        launched.status,
        launched.code,
        `Failed to launch ${surface}`,
        false,
      );
      return undefined;
    }
    if (!validSession(launched.value)) {
      failCheck(
        stageId,
        checkId,
        "failed",
        "invalid_runtime_session",
        "Runtime launch did not return an exact owned PID set",
        false,
      );
      return undefined;
    }
    const session = {
      id: launched.value.id,
      ownedPids: [...launched.value.ownedPids],
    };
    sessions.push({ surface, adapter, session, active: true });
    return session;
  };

  const createWorld = async (
    adapter: RuntimeAdapter,
    session: RuntimeSession,
    stageId: ProductionInstanceStageId,
    checkId: string,
  ): Promise<boolean> => {
    let created: RuntimeOperationResult<unknown>;
    try {
      created = await adapter.worldCreate({
        sessionId: session.id,
        name: input.world.name,
        seed: input.world.seed,
        isolated: true,
      });
    } catch {
      created = operationFailure(adapter, "worldCreate");
    }
    if (created.status === "passed") return true;
    return failCheck(
      stageId,
      checkId,
      created.status,
      created.code,
      "Failed to create the fixed isolated production world",
      false,
    );
  };

  const assertRuntime = async (
    adapter: RuntimeAdapter,
    session: RuntimeSession,
    stageId: ProductionInstanceStageId,
    checkId: string,
    condition: string,
    mismatchCode: string,
    matches: (value: unknown) => boolean,
  ): Promise<boolean> => {
    let asserted: RuntimeOperationResult<unknown>;
    try {
      asserted = await adapter.assert({ sessionId: session.id, condition });
    } catch {
      asserted = operationFailure(adapter, "assert");
    }
    if (asserted.status !== "passed") {
      return failCheck(
        stageId,
        checkId,
        asserted.status,
        asserted.code,
        `Runtime assertion failed: ${condition}`,
        true,
      );
    }
    const envelope = asserted.value;
    if (
      !record(envelope) ||
      envelope.condition !== condition ||
      envelope.passed !== true ||
      !record(envelope.observed) ||
      !Number.isSafeInteger(envelope.atTick) ||
      (envelope.atTick as number) < 0 ||
      !matches(envelope.observed)
    ) {
      return failCheck(
        stageId,
        checkId,
        "failed",
        mismatchCode,
        `Runtime observation did not match: ${condition}`,
        true,
      );
    }
    passCheck(stageId, checkId);
    return true;
  };

  const identityMatches = (value: unknown): boolean =>
    record(value) &&
    value.environment === "production" &&
    value.environment === input.identity.environment &&
    value.modId === input.identity.modId &&
    value.modVersion === input.identity.modVersion &&
    value.minecraftVersion === input.identity.minecraftVersion &&
    value.protocolVersion === input.identity.protocolVersion &&
    value.remapped === true &&
    value.remapped === input.identity.remapped &&
    isDeepStrictEqual(value.remap, input.identity.remap) &&
    value.productionJarSha256 === sha256 &&
    isDeepStrictEqual(value.dependencies, input.identity.dependencies);

  const stateMatches = (expected: StateScenario) => (value: unknown) =>
    record(value) && value.id === expected.id && value.state === expected.state;

  let dedicatedServer: RuntimeSession | undefined;
  const firstServer = await launch(
    server,
    "minecraft_server",
    serverProfile,
    "hidden",
    "server",
    "server.identity",
  );
  if (firstServer !== undefined) {
    if (
      !(await createWorld(server, firstServer, "server", "server.identity")) ||
      !(await assertRuntime(
        server,
        firstServer,
        "server",
        "server.identity",
        serverIdentity,
        "production_identity_mismatch",
        identityMatches,
      )) ||
      !(await assertRuntime(
        server,
        firstServer,
        "server",
        "server.behavior",
        serverBehavior,
        "dedicated_server_mismatch",
        (value) =>
          stateMatches(input.scenarios.dedicatedServer)(value) &&
          record(value) &&
          isDeepStrictEqual(
            value.oracle,
            input.scenarios.dedicatedServer.oracle,
          ),
      ))
    ) {
      await closeActive();
      return finish();
    }
    findStage("server").status = "passed";
    if (
      !(await assertRuntime(
        server,
        firstServer,
        "persistence",
        "persistence.before",
        persistenceBefore,
        "persistence_mismatch",
        (value) =>
          stateMatches(input.scenarios.persistence)(value) &&
          record(value) &&
          value.savedState === input.scenarios.persistence.oracle.savedState,
      ))
    ) {
      await closeActive();
      return finish();
    }
    const firstActive = sessions.find(
      (candidate) =>
        candidate.active && candidate.session.id === firstServer.id,
    );
    const firstCleanupError =
      firstActive === undefined ? undefined : await closeSession(firstActive);
    if (firstCleanupError !== undefined) {
      failCheck(
        "persistence",
        "persistence.after",
        resultStatus,
        firstCleanupError.code,
        firstCleanupError.detail,
        false,
      );
      await closeActive();
      return finish();
    }

    const restarted = await launch(
      server,
      "minecraft_server",
      serverProfile,
      "hidden",
      "persistence",
      "persistence.after",
    );
    if (restarted === undefined) {
      await closeActive();
      return finish();
    }
    if (
      !(await assertRuntime(
        server,
        restarted,
        "persistence",
        "persistence.after",
        persistenceAfter,
        "persistence_mismatch",
        (value) =>
          stateMatches(input.scenarios.persistence)(value) &&
          record(value) &&
          value.savedState === input.scenarios.persistence.oracle.savedState &&
          value.restoredState ===
            input.scenarios.persistence.oracle.restoredState &&
          value.sessionId === restarted.id,
      ))
    ) {
      await closeActive();
      return finish();
    }
    findStage("persistence").status = "passed";
    dedicatedServer = restarted;
  } else {
    await closeActive();
    return finish();
  }

  const realClient = await launch(
    client,
    "minecraft_client",
    clientProfile,
    "visible",
    "client",
    "client.identity",
  );
  if (realClient === undefined) {
    await closeActive();
    return finish();
  }
  if (
    !(await assertRuntime(
      client,
      realClient,
      "client",
      "client.identity",
      serverIdentity,
      "production_identity_mismatch",
      identityMatches,
    ))
  ) {
    await closeActive();
    return finish();
  }

  const observerClient = await launch(
    observer,
    "minecraft_client",
    observerProfile,
    "visible",
    "client",
    "client.observer_identity",
  );
  if (observerClient === undefined) {
    await closeActive();
    return finish();
  }
  if (
    !(await assertRuntime(
      observer,
      observerClient,
      "client",
      "client.observer_identity",
      serverIdentity,
      "production_identity_mismatch",
      identityMatches,
    ))
  ) {
    await closeActive();
    return finish();
  }
  findStage("client").status = "passed";

  if (dedicatedServer === undefined) {
    failCheck(
      "multiplayer",
      "multiplayer.actor",
      "unavailable",
      "dedicated_server_required",
      "Multiplayer verification requires the restarted dedicated server to remain live",
      false,
    );
    await closeActive();
    return finish();
  }

  const participantPids = [
    ...dedicatedServer.ownedPids,
    ...realClient.ownedPids,
    ...observerClient.ownedPids,
  ];
  if (
    new Set([dedicatedServer.id, realClient.id, observerClient.id]).size !==
      3 ||
    new Set(participantPids).size !== participantPids.length
  ) {
    failCheck(
      "multiplayer",
      "multiplayer.actor",
      "failed",
      "multiplayer_mismatch",
      "Actor, observer, and dedicated server require distinct live sessions and owned processes",
      false,
    );
    await closeActive();
    return finish();
  }

  const multiplayerMatches =
    (sessionId: string, participant: string) => (value: unknown) =>
      record(value) &&
      value.id === input.scenarios.multiplayer.id &&
      value.state === input.scenarios.multiplayer.state &&
      value.actor === input.scenarios.multiplayer.actor &&
      value.observer === input.scenarios.multiplayer.observer &&
      value.actor !== value.observer &&
      value.participant === participant &&
      value.sessionId === sessionId &&
      value.serverSessionId === dedicatedServer.id &&
      value.sharedState === input.scenarios.multiplayer.oracle.sharedState &&
      value.serverTick === input.scenarios.multiplayer.oracle.serverTick &&
      Number.isSafeInteger(value.serverTick) &&
      value.synchronized === true;

  if (
    !(await assertRuntime(
      client,
      realClient,
      "multiplayer",
      "multiplayer.actor",
      multiplayer,
      "multiplayer_mismatch",
      multiplayerMatches(realClient.id, input.scenarios.multiplayer.actor),
    )) ||
    !(await assertRuntime(
      observer,
      observerClient,
      "multiplayer",
      "multiplayer.observer",
      multiplayer,
      "multiplayer_mismatch",
      multiplayerMatches(
        observerClient.id,
        input.scenarios.multiplayer.observer,
      ),
    ))
  ) {
    await closeActive();
    return finish();
  }
  findStage("multiplayer").status = "passed";

  if (
    !(await assertRuntime(
      client,
      realClient,
      "modpack",
      "modpack.compatibility",
      modpack,
      "modpack_mismatch",
      (value) =>
        record(value) &&
        value.id === input.modpack.id &&
        value.version === input.modpack.version &&
        isDeepStrictEqual(value.declaredMods, input.modpack.declaredMods) &&
        isDeepStrictEqual(value.loadedMods, input.modpack.loadedMods) &&
        input.modpack.loadedMods.some(
          (mod) =>
            mod.id === input.identity.modId &&
            mod.version === input.identity.modVersion &&
            mod.origin === "production_jar" &&
            mod.sha256 === sha256,
        ) &&
        value.compatible === true,
    ))
  ) {
    await closeActive();
    return finish();
  }
  findStage("modpack").status = "passed";

  await closeActive();
  return finish();
}
