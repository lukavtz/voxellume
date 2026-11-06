import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { TargetCapability, TargetPack } from "../targets/target-pack.ts";
import { assertTargetCapability } from "../targets/resolve-target.ts";
import type { ModSpec } from "../spec/mod-spec.ts";
import {
  finalizeEvidence,
  readEvidence,
  type EvidenceCheckInput,
  type EvidenceCheckSubject,
  type EvidenceInputFile,
  type EvidenceStatus,
} from "./evidence.ts";

export type VerificationStage =
  | "static"
  | "build"
  | "server"
  | "gameTest"
  | "client"
  | "productionJar"
  | "visual"
  | "package";

export type VerificationProfile =
  | "static"
  | "build"
  | "server"
  | "gameTest"
  | "client"
  | "visual"
  | "release"
  | "full";

export interface VerificationRoots {
  readonly projectRoot: string;
  readonly isolationRoot: string;
  readonly evidenceRoot: string;
  readonly agentWritableRoots: readonly string[];
}

export interface VerificationIdentity {
  readonly transactionId: string;
  readonly baseProjectSha256: string;
  readonly modSpecSha256: string;
  readonly targetPackSha256: string;
  readonly finalTreeSha256: string;
}

export interface VerificationPolicy {
  readonly allowHostExecution?: boolean;
  readonly environment: Record<string, unknown>;
  readonly secretValues: readonly string[];
}

export interface VerificationStageCheck {
  readonly id: string;
  readonly requested: boolean;
  readonly checked: boolean;
  readonly status: EvidenceStatus;
  readonly requestedArgv: readonly string[];
  readonly executedArgv: readonly string[] | null;
  readonly exitCode: number | null;
  readonly subject: EvidenceCheckSubject;
  readonly logs: readonly EvidenceInputFile[];
}

export interface VerificationStageExecution {
  readonly checks: readonly VerificationStageCheck[];
  readonly artifacts?: readonly EvidenceInputFile[];
}

export interface VerificationStageContext {
  readonly stage: VerificationStage;
  readonly roots: VerificationRoots;
  readonly target: TargetPack;
  readonly modSpec: ModSpec;
  readonly identity: VerificationIdentity;
  readonly policy: VerificationPolicy;
  readonly signal?: AbortSignal;
}

export type VerificationStageExecutor = (
  context: VerificationStageContext,
) => Promise<VerificationStageExecution>;

export interface VerifyProjectOptions {
  readonly roots: VerificationRoots;
  readonly target: TargetPack;
  readonly modSpec: ModSpec;
  readonly profile: VerificationProfile;
  readonly identity: VerificationIdentity;
  readonly policy: VerificationPolicy;
  readonly signal?: AbortSignal;
  readonly stageExecutor?: VerificationStageExecutor;
}

export interface VerificationStageResult {
  readonly id: VerificationStage;
  readonly status: EvidenceStatus;
  readonly checks: readonly VerificationStageCheck[];
}

export interface VerifyProjectResult {
  readonly status: EvidenceStatus;
  readonly support: "verified" | "not_verified";
  readonly stages: readonly VerificationStageResult[];
  readonly evidence: {
    readonly transactionId: string;
    readonly sha256: string;
  };
  readonly error: {
    readonly code: string;
    readonly detail: string;
  };
}

const PROFILE_STAGES: Readonly<
  Record<VerificationProfile, readonly VerificationStage[]>
> = {
  static: ["static"],
  build: ["static", "build"],
  server: ["static", "build", "server"],
  gameTest: ["static", "build", "server", "gameTest"],
  client: ["static", "build", "server", "gameTest", "client"],
  visual: [
    "static",
    "build",
    "server",
    "gameTest",
    "client",
    "productionJar",
    "visual",
  ],
  release: [
    "static",
    "build",
    "server",
    "gameTest",
    "client",
    "productionJar",
    "package",
  ],
  full: [
    "static",
    "build",
    "server",
    "gameTest",
    "client",
    "productionJar",
    "visual",
    "package",
  ],
};

const STAGE_CAPABILITIES: Readonly<
  Partial<Record<VerificationStage, TargetCapability>>
> = {
  build: "build",
  server: "server",
  gameTest: "gameTest",
  client: "client",
  visual: "visual",
};

const EMPTY_SUBJECT: EvidenceCheckSubject = {
  class: "source",
  sourceSha256: "0".repeat(64),
  exportSha256: "0".repeat(64),
};

function requestedArgv(stage: VerificationStage, target: TargetPack): string[] {
  const capability = STAGE_CAPABILITIES[stage];
  const configured =
    capability === undefined
      ? undefined
      : target.verification.checks[capability]?.argv;
  return configured === undefined ? [`internal:${stage}`] : [...configured];
}

function unexecutedCheck(
  stage: VerificationStage,
  target: TargetPack,
  status: "cancelled" | "unsupported" | "unavailable",
): VerificationStageCheck {
  return {
    id: stage,
    requested: true,
    checked: false,
    status,
    requestedArgv: requestedArgv(stage, target),
    executedArgv: null,
    exitCode: null,
    subject: EMPTY_SUBJECT,
    logs: [],
  };
}

function aggregateStatus(
  checks: readonly VerificationStageCheck[],
): EvidenceStatus {
  return checks.find((check) => check.status !== "passed")?.status ?? "passed";
}

function evidenceCheck(check: VerificationStageCheck): EvidenceCheckInput {
  return {
    id: check.id,
    requested: check.requested,
    executed: check.checked,
    status: check.status,
    requestedArgv: [...check.requestedArgv],
    executedArgv: check.executedArgv === null ? null : [...check.executedArgv],
    exitCode: check.exitCode,
    subject: check.subject,
    logs: [...check.logs],
  };
}

const SHA256 = /^[0-9a-f]{64}$/;

function validSourceSubject(subject: EvidenceCheckSubject): boolean {
  return (
    subject.class === "source" &&
    SHA256.test(subject.sourceSha256 ?? "") &&
    SHA256.test(subject.exportSha256 ?? "") &&
    subject.reviewer === undefined
  );
}

function validScenario(subject: EvidenceCheckSubject): boolean {
  const scenario = subject.scenario;
  return (
    scenario !== undefined &&
    scenario.id.trim().length > 0 &&
    scenario.state.trim().length > 0 &&
    ["state", "multiplayer", "restart"].includes(scenario.kind)
  );
}

function validRuntimeSubject(
  subject: EvidenceCheckSubject,
  surface: "minecraft_server" | "minecraft_client",
): boolean {
  return (
    subject.class === "runtime" &&
    subject.surface === surface &&
    validScenario(subject) &&
    subject.reviewer === undefined
  );
}

function validVisualReviewSubject(subject: EvidenceCheckSubject): boolean {
  const reviewer = subject.reviewer;
  return (
    subject.class === "design_review" &&
    SHA256.test(subject.sourceSha256 ?? "") &&
    SHA256.test(subject.exportSha256 ?? "") &&
    reviewer !== undefined &&
    reviewer.id.trim().length > 0 &&
    Number.isInteger(reviewer.revision) &&
    reviewer.revision > 0 &&
    reviewer.rubric.trim().length > 0 &&
    reviewer.kind === "human" &&
    reviewer.decision === "approved"
  );
}

function validVisualCaptureSubject(
  subject: EvidenceCheckSubject,
  productionJarSha256: string,
): boolean {
  return (
    subject.class === "browser" &&
    subject.surface === "minecraft_client" &&
    subject.productionJarSha256 === productionJarSha256 &&
    SHA256.test(subject.baselineSha256 ?? "") &&
    validScenario(subject) &&
    subject.reviewer === undefined
  );
}

function validStageSubjects(
  stage: VerificationStage,
  checks: readonly VerificationStageCheck[],
  productionJarSha256: string | null,
): boolean {
  if (stage === "visual") {
    return (
      productionJarSha256 !== null &&
      checks.some((check) =>
        validVisualCaptureSubject(check.subject, productionJarSha256),
      ) &&
      checks.some((check) => validVisualReviewSubject(check.subject)) &&
      checks.every(
        (check) =>
          validVisualCaptureSubject(check.subject, productionJarSha256) ||
          validVisualReviewSubject(check.subject),
      )
    );
  }
  return checks.every((check) => {
    const subject = check.subject;
    if (stage === "static" || stage === "build" || stage === "package") {
      return validSourceSubject(subject);
    }
    if (stage === "server" || stage === "gameTest") {
      return validRuntimeSubject(subject, "minecraft_server");
    }
    if (stage === "client") {
      return validRuntimeSubject(subject, "minecraft_client");
    }
    return (
      productionJarSha256 !== null &&
      validRuntimeSubject(subject, "minecraft_client") &&
      subject.productionJarSha256 === productionJarSha256
    );
  });
}

function invalidatePassedChecks(
  checks: readonly VerificationStageCheck[],
): VerificationStageCheck[] {
  return checks.map((check) => {
    if (check.status !== "passed") return check;
    if (check.checked && check.executedArgv !== null) {
      return { ...check, status: "failed", exitCode: null };
    }
    return {
      ...check,
      checked: false,
      status: "unavailable",
      executedArgv: null,
      exitCode: null,
    };
  });
}

interface ProductionJarIdentity {
  readonly path: string;
  readonly sha256: string;
}

async function productionJarIdentity(
  options: VerifyProjectOptions,
): Promise<ProductionJarIdentity | null> {
  const delivery = options.modSpec.delivery as Record<string, unknown>;
  const artifact = delivery.productionJar;
  if (typeof artifact !== "string" || artifact.length === 0) return null;
  const projectRoot = resolve(options.roots.projectRoot);
  const path = resolve(projectRoot, artifact);
  const child = relative(projectRoot, path);
  if (
    child.length === 0 ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) {
    return null;
  }
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return { path, sha256: hash.digest("hex") };
  } catch {
    return null;
  }
}

/**
 * Runs only the selected profile. Host and human adapters supply actual checks;
 * missing adapters and blocked capabilities remain explicit non-passes.
 */
export async function verifyProject(
  options: VerifyProjectOptions,
): Promise<VerifyProjectResult> {
  const selected = PROFILE_STAGES[options.profile];
  const stages: VerificationStageResult[] = [];
  const artifacts: EvidenceInputFile[] = [];
  const artifactSources = new Set<string>();
  let productionJar: ProductionJarIdentity | null | undefined;
  let terminal: VerificationStageResult | undefined;
  let error: VerifyProjectResult["error"] | undefined;

  for (const stage of selected) {
    if (terminal !== undefined) {
      stages.push({
        id: stage,
        status: "unavailable",
        checks: [unexecutedCheck(stage, options.target, "unavailable")],
      });
      continue;
    }

    const capability = STAGE_CAPABILITIES[stage];
    if (capability !== undefined) {
      const qualification = assertTargetCapability(options.target, capability);
      if (qualification.status === "unsupported") {
        error = {
          code: qualification.code,
          detail: `Target "${options.target.id}" cannot run required ${capability} verification.`,
        };
        terminal = {
          id: stage,
          status: "unsupported",
          checks: [unexecutedCheck(stage, options.target, "unsupported")],
        };
        stages.push(terminal);
        continue;
      }
    }

    if (options.signal?.aborted) {
      terminal = {
        id: stage,
        status: "cancelled",
        checks: [unexecutedCheck(stage, options.target, "cancelled")],
      };
      stages.push(terminal);
      error = {
        code: "verification_cancelled",
        detail: `Verification was cancelled before ${stage}.`,
      };
      continue;
    }

    if (options.stageExecutor === undefined) {
      terminal = {
        id: stage,
        status: "unavailable",
        checks: [unexecutedCheck(stage, options.target, "unavailable")],
      };
      stages.push(terminal);
      error = {
        code: "stage_executor_unavailable",
        detail: `No host adapter is available for ${stage}.`,
      };
      continue;
    }

    const execution = await options.stageExecutor({
      stage,
      roots: options.roots,
      target: options.target,
      modSpec: options.modSpec,
      identity: options.identity,
      policy: options.policy,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    for (const artifact of execution.artifacts ?? []) {
      const source = `${artifact.name}\0${artifact.path}`;
      if (artifactSources.has(source)) continue;
      artifactSources.add(source);
      const name = artifacts.some((existing) => existing.name === artifact.name)
        ? `${stage}-${artifact.name}`
        : artifact.name;
      artifacts.push({ name, path: artifact.path });
    }

    const aborted = options.signal?.aborted === true;
    let checks: readonly VerificationStageCheck[] =
      execution.checks.length === 0
        ? [
            unexecutedCheck(
              stage,
              options.target,
              aborted ? "cancelled" : "unavailable",
            ),
          ]
        : execution.checks;
    if (aborted) {
      checks = checks.map((check) => ({
        ...check,
        status: "cancelled",
        exitCode: null,
      }));
      error = {
        code: "verification_cancelled",
        detail: `Verification was cancelled after ${stage}.`,
      };
    } else if (execution.checks.length === 0) {
      error = {
        code: "empty_stage_result",
        detail: `The ${stage} adapter returned no checks.`,
      };
    } else if (aggregateStatus(checks) === "passed") {
      if (
        (stage === "productionJar" || stage === "visual") &&
        (options.policy.environment.productionJar !== true ||
          options.policy.environment.cleanInstance !== true)
      ) {
        checks = invalidatePassedChecks(checks);
        error = {
          code: "invalid_stage_environment",
          detail: `${stage} requires productionJar=true and cleanInstance=true.`,
        };
      } else {
        if (
          (stage === "productionJar" || stage === "visual") &&
          productionJar === undefined
        ) {
          productionJar = await productionJarIdentity(options);
        }
        const currentProductionJar = productionJar;
        const productionArtifactRecorded =
          stage !== "productionJar" ||
          (currentProductionJar != null &&
            artifacts.some(
              (artifact) =>
                resolve(artifact.path) === currentProductionJar.path,
            ));
        if (
          !productionArtifactRecorded ||
          !validStageSubjects(
            stage,
            checks,
            currentProductionJar?.sha256 ?? null,
          )
        ) {
          checks = invalidatePassedChecks(checks);
          error = {
            code: "invalid_stage_subject",
            detail: `The ${stage} adapter returned an invalid evidence subject or production artifact identity.`,
          };
        }
      }
    }

    const result: VerificationStageResult = {
      id: stage,
      status: aggregateStatus(checks),
      checks,
    };
    stages.push(result);
    if (result.status !== "passed") terminal = result;
  }

  await finalizeEvidence({
    evidenceRoot: options.roots.evidenceRoot,
    agentWritableRoots: [...options.roots.agentWritableRoots],
    sourceRoots: [options.roots.projectRoot, options.roots.isolationRoot],
    transactionId: options.identity.transactionId,
    baseProjectSha256: options.identity.baseProjectSha256,
    modSpecSha256: options.identity.modSpecSha256,
    targetPackSha256: options.identity.targetPackSha256,
    finalTreeSha256: options.identity.finalTreeSha256,
    environment: options.policy.environment,
    checks: stages.flatMap((stage) => stage.checks.map(evidenceCheck)),
    artifacts,
    secretValues: [...options.policy.secretValues],
  });
  const authenticated = await readEvidence({
    evidenceRoot: options.roots.evidenceRoot,
    transactionId: options.identity.transactionId,
  });
  const status = terminal?.status ?? "passed";

  return {
    status,
    support:
      options.profile === "full" && status === "passed"
        ? "verified"
        : "not_verified",
    stages,
    evidence: {
      transactionId: options.identity.transactionId,
      sha256: authenticated.integrity,
    },
    error: error ?? { code: "", detail: "" },
  };
}
