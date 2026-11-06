import { mkdir, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { canonicalJson, sha256 } from "../../targets/canonical-json.ts";
import type { OperationValidationResult } from "../operations.ts";
import { validateOperations } from "../operations.ts";
import type {
  BuildCandidateOptions,
  GenerateContext,
  TransactionCandidate,
} from "../transaction-types.ts";
import { acquireProjectLock, canonicalProjectKey } from "./lock.ts";
import { generatedFiles } from "./ownership.ts";
import {
  assertSafeDirectory,
  assertSafePath,
  atomicWrite,
  pathsOverlap,
  readSafeFile,
  safeRelativePath,
  validateTransactionId,
} from "./paths.ts";
import {
  candidateDigest,
  cancelled,
  errorCode,
  failed,
  isCancelled,
  MOD_SPEC_PATH,
  TransactionFault,
  transition,
  verificationBindings,
} from "./state.ts";
import { copyTree, projectHash, snapshotTree } from "./tree.ts";

function operationFailure(
  candidate: TransactionCandidate,
  result: Exclude<OperationValidationResult, { status: "validated" }>,
): TransactionCandidate {
  const code =
    result.status === "unsupported_request"
      ? "unsupported_request"
      : result.status === "clarification_required"
        ? "clarification_required"
        : "invalid_operations";
  const explanation =
    "reason" in result && typeof result.reason === "string"
      ? result.reason
      : "question" in result && typeof result.question === "string"
        ? result.question
        : canonicalJson("issues" in result ? result.issues : []);
  return failed(candidate, code, explanation);
}

export async function assertStagingUnchanged(
  candidate: TransactionCandidate,
): Promise<void> {
  await assertSafeDirectory(candidate.realStagingRoot);
  const tree = await snapshotTree(candidate.realStagingRoot);
  if (tree === null) throw new Error("Candidate staging tree is missing");
  for (const file of candidate.manifest.files) {
    const expected = file.sha256 as string | null;
    if (
      expected === null
        ? tree[file.path] !== undefined
        : tree[file.path] !== expected
    ) {
      throw new TransactionFault(
        "candidate_tampered",
        `Generated file changed after verification: ${file.path}`,
      );
    }
  }
  for (const artifact of candidate.manifest.artifacts) {
    if (tree[artifact.path] !== artifact.sha256) {
      throw new Error(`Artifact changed after verification: ${artifact.path}`);
    }
  }
  const modSpecBytes = await readSafeFile(
    candidate.realStagingRoot,
    MOD_SPEC_PATH,
  );
  if (modSpecBytes === null)
    throw new TransactionFault("unsafe_path", "Canonical ModSpec is missing");
  if (sha256(modSpecBytes) !== sha256(canonicalJson(candidate.modSpec))) {
    throw new Error("Canonical ModSpec changed after verification");
  }
}

export async function stageCandidate(
  options: BuildCandidateOptions,
): Promise<TransactionCandidate> {
  const projectRoot = resolve(options.projectRoot);
  const workspaceRoot = resolve(options.workspaceRoot);
  const root = join(workspaceRoot, options.transactionId);
  const candidate: TransactionCandidate = {
    transactionId: options.transactionId,
    projectRoot,
    workspaceRoot,
    stagingRoot: join(root, "staging"),
    journalPath: join(root, "journal.json"),
    realProjectRoot: projectRoot,
    realStagingRoot: join(root, "staging"),
    modSpec: options.modSpec,
    operations: [],
    status: "proposed",
    error: { code: "", detail: "" },
    manifest: {
      base: {
        modSpecSha256: sha256(canonicalJson(options.modSpec)),
        projectSha256: sha256(canonicalJson([])),
        packSha256: options.targetPack.packSha256,
      },
      targetPack: { ...options.targetPack },
      files: [],
      baseFileSha256: {},
      stagingTreeSha256: sha256(canonicalJson([])),
      artifacts: [],
    },
  };

  try {
    validateTransactionId(options.transactionId);
    if (
      pathsOverlap(projectRoot, workspaceRoot) ||
      pathsOverlap(workspaceRoot, projectRoot)
    ) {
      throw new Error(
        "Project and transaction workspace roots must be disjoint",
      );
    }
    candidate.manifest.base.projectSha256 = projectHash(
      await snapshotTree(projectRoot),
    );
    await transition(candidate, "proposed", options.hooks);
    if (isCancelled(options.signal)) return cancelled(candidate);

    if (
      options.modSpec.targetPackId !== options.targetPack.id ||
      options.modSpec.targetPackRevision !== options.targetPack.revision
    ) {
      return failed(
        candidate,
        "target_mismatch",
        "ModSpec and target pack coordinates differ",
      );
    }
    const validation = validateOperations(options.modSpec, options.operations);
    if (validation.status !== "validated") {
      return operationFailure(candidate, validation);
    }
    candidate.operations = validation.operations;
    await transition(candidate, "validated", options.hooks);
    if (isCancelled(options.signal)) return cancelled(candidate);
  } catch (error) {
    return failed(candidate, "validation_failed", error);
  }

  const release = await acquireProjectLock(projectRoot);
  try {
    if (isCancelled(options.signal)) return cancelled(candidate);
    candidate.realProjectRoot = await canonicalProjectKey(projectRoot);
    const baseTree = await snapshotTree(projectRoot);
    candidate.manifest.base.projectSha256 = projectHash(baseTree);
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(root, { recursive: false });
    if (baseTree === null) {
      await mkdir(candidate.stagingRoot, { recursive: false });
    } else {
      await copyTree(projectRoot, candidate.stagingRoot);
    }
    candidate.realStagingRoot = await realpath(candidate.stagingRoot);

    const context: GenerateContext = {
      stagingRoot: candidate.stagingRoot,
      modSpec: options.modSpec,
      operations: candidate.operations,
      targetPack: candidate.manifest.targetPack,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    let generated: { artifacts: string[] };
    try {
      generated = await options.generate(context);
    } catch (error) {
      return failed(candidate, "generation_failed", error);
    }
    if (isCancelled(options.signal)) return cancelled(candidate);

    await atomicWrite(
      await assertSafePath(candidate.realStagingRoot, MOD_SPEC_PATH, true),
      canonicalJson(options.modSpec),
    );
    await assertSafeDirectory(candidate.realStagingRoot);
    const stagingTree = await snapshotTree(candidate.realStagingRoot);
    if (stagingTree === null)
      throw new Error("Generator removed the staging root");
    const artifacts = new Map<string, string>();
    const productionJar = (options.modSpec.delivery as Record<string, unknown>)
      .productionJar;
    for (const artifactPath of generated.artifacts) {
      const normalized = safeRelativePath(artifactPath);
      if (
        normalized !== productionJar &&
        !normalized.startsWith(`build${sep}`)
      ) {
        throw new TransactionFault(
          "ownership_violation",
          `Artifact is outside the owned build tree: ${normalized}`,
        );
      }
      if (artifacts.has(normalized))
        throw new TransactionFault(
          "ownership_violation",
          `Duplicate artifact: ${normalized}`,
        );
      const hash = stagingTree[normalized];
      if (hash === undefined)
        throw new TransactionFault(
          "ownership_violation",
          `Artifact is not a staged regular file: ${normalized}`,
        );
      artifacts.set(normalized, hash);
    }
    candidate.manifest.artifacts = [...artifacts]
      .map(([path, hash]) => ({ path, sha256: hash }))
      .sort((left, right) => left.path.localeCompare(right.path));
    candidate.manifest.files = generatedFiles(
      baseTree,
      stagingTree,
      options.modSpec,
      new Set(artifacts.keys()),
    );
    candidate.manifest.baseFileSha256 = Object.fromEntries(
      candidate.manifest.files
        .filter((file) => file.baseSha256 !== null)
        .map((file) => [file.path, file.baseSha256!]),
    );
    const baseModSpecHash = baseTree?.[MOD_SPEC_PATH];
    if (baseModSpecHash !== undefined) {
      candidate.manifest.baseFileSha256[MOD_SPEC_PATH] = baseModSpecHash;
    }
    candidate.manifest.stagingTreeSha256 = sha256(
      canonicalJson(
        candidate.manifest.files.map((file) => [file.path, file.sha256]),
      ),
    );

    await transition(candidate, "staged", options.hooks);
    if (isCancelled(options.signal)) return cancelled(candidate);

    let verification;
    try {
      verification = await options.verify({
        ...context,
        manifest: candidate.manifest,
      });
    } catch (error) {
      return failed(candidate, "verification_failed", error);
    }
    if (isCancelled(options.signal) || verification.status === "cancelled") {
      return cancelled(candidate);
    }
    if (verification.status !== "passed") {
      return failed(
        candidate,
        verification.status === "failed"
          ? "verification_failed"
          : `verification_${verification.status}`,
        verification.detail ?? `Verification returned ${verification.status}`,
      );
    }
    const verificationBinding = candidateDigest(candidate);
    await transition(candidate, "verified", options.hooks);
    if (isCancelled(options.signal)) return cancelled(candidate);
    verificationBindings.set(candidate, verificationBinding);
    return candidate;
  } catch (error) {
    return failed(candidate, errorCode(error, "staging_failed"), error);
  } finally {
    release();
  }
}
