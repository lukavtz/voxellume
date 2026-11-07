import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, win32 } from "node:path";

import { unzipSync } from "fflate";

export type SourceOperation =
  | "resolve_artifact"
  | "find_class"
  | "get_members"
  | "map_symbol"
  | "read_source"
  | "search_source"
  | "diff_classes";

const OPERATIONS: Readonly<Record<SourceOperation, true>> = {
  resolve_artifact: true,
  find_class: true,
  get_members: true,
  map_symbol: true,
  read_source: true,
  search_source: true,
  diff_classes: true,
};

export type SourceMappingKind =
  | "mojang"
  | "yarn"
  | "intermediary"
  | "parchment"
  | "parchment-layer"
  | "quilt"
  | "none";

const MAPPING_KINDS: Readonly<Record<SourceMappingKind, true>> = {
  mojang: true,
  yarn: true,
  intermediary: true,
  parchment: true,
  "parchment-layer": true,
  quilt: true,
  none: true,
};

export interface SourceTarget {
  readonly minecraftVersion: string;
  readonly loader: string;
  readonly mappings: {
    readonly kind: SourceMappingKind;
    readonly version?: string | undefined;
  };
}

export interface SourceArtifactIdentity {
  readonly coordinates: string;
  readonly version: string;
  readonly sha256: string;
}

/** A host-granted local artifact, identified by exact coordinates and hash. */
export interface SourceArtifactRecord extends SourceArtifactIdentity {
  readonly id: string;
  readonly root: string;
  readonly path: string;
}

export interface SourceRequest {
  readonly operation: SourceOperation;
  readonly target?: SourceTarget | undefined;
  readonly artifact?: SourceArtifactIdentity | undefined;
  readonly artifactId?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly className?: string | undefined;
  readonly symbol?: string | undefined;
  readonly query?: string | undefined;
  readonly mapping?: SourceMappingKind | undefined;
  readonly rightArtifactId?: string | undefined;
  readonly rightArtifact?: SourceArtifactIdentity | undefined;
  readonly rightTarget?: SourceTarget | undefined;
  readonly runtimeArtifactId?: string | undefined;
  readonly runtimeArtifact?: SourceArtifactIdentity | undefined;
}

/** Only these fields ever reach a candidate; everything else is host-only. */
export interface SourceCandidateRequest {
  readonly operation: SourceOperation;
  readonly target: SourceTarget;
  readonly artifact?: SourceArtifactIdentity | undefined;
  readonly artifactId?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly className?: string | undefined;
  readonly symbol?: string | undefined;
  readonly query?: string | undefined;
  readonly mapping?: SourceMappingKind | undefined;
  readonly rightArtifactId?: string | undefined;
  readonly rightArtifact?: SourceArtifactIdentity | undefined;
  readonly rightTarget?: SourceTarget | undefined;
  readonly runtimeArtifactId?: string | undefined;
  readonly runtimeArtifact?: SourceArtifactIdentity | undefined;
}

export interface SourceCandidateContext {
  readonly offline: boolean;
  readonly signal?: AbortSignal | undefined;
}

export interface SourceCandidate {
  readonly id: string;
  readonly revision: string;
  invoke(
    request: SourceCandidateRequest,
    context: SourceCandidateContext,
  ): Promise<unknown>;
  /** Every candidate owns resources; disposal is part of the contract. */
  dispose(): Promise<void>;
}

export interface SourceLimits {
  readonly artifactBytes: number;
  readonly archiveEntryBytes: number;
  readonly nestedEntryBytes: number;
  readonly responseBytes: number;
  readonly sourceBytes: number;
  readonly processLogBytes: number;
}

const DEFAULT_LIMITS: SourceLimits = Object.freeze({
  artifactBytes: 512 * 1024 ** 2,
  archiveEntryBytes: 64 * 1024 ** 2,
  nestedEntryBytes: 64 * 1024 ** 2,
  responseBytes: 256 * 1024,
  sourceBytes: 64 * 1024,
  processLogBytes: 1024 * 1024,
});

export interface SourceFacadeConfig {
  readonly candidates: readonly SourceCandidate[];
  readonly artifacts?: readonly SourceArtifactRecord[] | undefined;
  readonly limits?: Partial<SourceLimits> | undefined;
}

export type SourceFailureStatus =
  "not_found" | "unsupported" | "unavailable" | "failed" | "cancelled";

export type SourceResult =
  | {
      readonly status: "ok";
      readonly operation: string;
      readonly value: unknown;
    }
  | {
      readonly status: SourceFailureStatus;
      readonly operation: string;
      readonly code: string;
    };

export interface SourceFacade {
  invoke(
    request: SourceRequest,
    context?: { offline?: boolean; signal?: AbortSignal | undefined },
  ): Promise<SourceResult>;
  dispose(): Promise<void>;
}

export interface SourceFacadeError extends Error {
  readonly code: string;
}

function facadeError(code: string, message: string): SourceFacadeError {
  return Object.assign(new Error(message), { code });
}

const FORBIDDEN_ARGUMENTS: Readonly<Record<string, true>> = {
  outputFile: true,
  jarPath: true,
  rawJarPath: true,
  delete: true,
  upload: true,
  runtime: true,
  cacheDelete: true,
};

const CANDIDATE_ERROR_CODES: Readonly<Record<string, SourceFailureStatus>> = {
  not_found: "not_found",
  unsupported: "unsupported",
  unavailable: "unavailable",
  cancelled: "cancelled",
};

const CANDIDATE_ERROR_RESULT_CODES: Readonly<Record<string, string>> = {
  not_found: "not_found",
  unsupported: "unsupported_operation",
  unavailable: "candidate_unavailable",
  cancelled: "cancelled",
};

function failure(
  status: SourceFailureStatus,
  operation: string,
  code: string,
): SourceResult {
  return { status, operation, code };
}

function isExactCoordinate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "latest" &&
    !value.includes("*")
  );
}

function normalizeTarget(target: unknown): SourceTarget | undefined {
  if (target === null || typeof target !== "object") return undefined;
  if (!("minecraftVersion" in target)) return undefined;
  if (!("loader" in target)) return undefined;
  if (!("mappings" in target)) return undefined;
  const { minecraftVersion, loader, mappings } = target;
  if (!isExactCoordinate(minecraftVersion)) return undefined;
  if (!isExactCoordinate(loader)) return undefined;
  if (mappings === null || typeof mappings !== "object") return undefined;
  if (!("kind" in mappings)) return undefined;
  const kind = mappings.kind;
  if (typeof kind !== "string" || !Object.hasOwn(MAPPING_KINDS, kind)) {
    return undefined;
  }
  const mappingKind = kind as SourceMappingKind;
  const version = "version" in mappings ? mappings.version : undefined;
  if (mappingKind === "none") {
    if (version !== undefined && typeof version !== "string") return undefined;
    return { minecraftVersion, loader, mappings: { kind: mappingKind } };
  }
  if (!isExactCoordinate(version)) return undefined;
  return { minecraftVersion, loader, mappings: { kind: mappingKind, version } };
}

/** Rebuilds the identity so no host-only field can ride along to a candidate. */
function normalizeArtifact(
  artifact: SourceArtifactIdentity | undefined,
): SourceArtifactIdentity | undefined {
  if (artifact === undefined) return undefined;
  if (
    !isExactCoordinate(artifact.coordinates) ||
    !isExactCoordinate(artifact.version) ||
    typeof artifact.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(artifact.sha256)
  ) {
    return undefined;
  }
  return {
    coordinates: artifact.coordinates,
    version: artifact.version,
    sha256: artifact.sha256,
  };
}

function candidateErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  if (!("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function fsErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  if (!("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

interface Settled {
  readonly kind: "value" | "error" | "cancelled";
  readonly value?: unknown;
  readonly error?: unknown;
}

/**
 * Cancellation acknowledgement budget: candidates get this long to finish
 * their own child-process cleanup before the facade returns `cancelled`.
 */
const CANCEL_GRACE_MS = 900;

function settle(
  promise: Promise<unknown>,
  signal: AbortSignal,
): Promise<Settled> {
  const { promise: result, resolve: finish } = Promise.withResolvers<Settled>();
  let done = false;
  const settleWith = (outcome: Settled): void => {
    if (done) return;
    done = true;
    finish(outcome);
  };
  promise.then(
    (value) => settleWith({ kind: "value", value }),
    (error: unknown) => settleWith({ kind: "error", error }),
  );
  const beginCancel = (): void => {
    // Wait for the candidate's cleanup, then stop waiting.
    const timer = setTimeout(
      () => settleWith({ kind: "cancelled" }),
      CANCEL_GRACE_MS,
    );
    const stop = (): void => {
      clearTimeout(timer);
    };
    promise.then(stop, stop);
  };
  if (signal.aborted) beginCancel();
  else signal.addEventListener("abort", beginCancel, { once: true });
  return result;
}

function unsafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes("\0") || path.includes("\\")) {
    return true;
  }
  const parts = path.split("/");
  return parts.some(
    (part) => part.length === 0 || part === "." || part === "..",
  );
}

/**
 * Archive entry names may end with a single directory slash; interior empty,
 * `.` and `..` components are rejected.
 */
function archiveEntryError(name: string): string | undefined {
  if (name.length === 0 || name.includes("\0") || name.includes("\\")) {
    return "archive_traversal";
  }
  if (isAbsolute(name) || win32.isAbsolute(name) || /^[A-Za-z]:/.test(name)) {
    return "archive_absolute_path";
  }
  const trimmed = name.endsWith("/") ? name.slice(0, -1) : name;
  if (trimmed.length === 0) return "archive_traversal";
  const parts = trimmed.split("/");
  if (
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    return "archive_traversal";
  }
  return undefined;
}

interface ArchiveScan {
  readonly error: string | undefined;
  readonly nested: readonly string[];
}

/**
 * Metadata-only pass: the filter sees central-directory sizes, so names and
 * caps are enforced before any entry is decompressed.
 */
function scanArchive(
  bytes: Uint8Array,
  entryLimit: number,
  nestedLimit: number,
  collectNested: boolean,
): ArchiveScan {
  const nested: string[] = [];
  let error: string | undefined;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        if (error !== undefined) return false;
        const nameError = archiveEntryError(file.name);
        if (nameError !== undefined) {
          error = nameError;
          return false;
        }
        if (file.name.endsWith(".jar")) {
          if (file.originalSize > nestedLimit) {
            error = "nested_entry_too_large";
            return false;
          }
          if (collectNested) nested.push(file.name);
          return false;
        }
        if (file.originalSize > entryLimit) {
          error = "archive_entry_too_large";
          return false;
        }
        return false;
      },
    });
  } catch {
    error ??= "archive_invalid";
  }
  return { error, nested };
}

function readNestedEntry(
  bytes: Uint8Array,
  name: string,
  limit: number,
): Uint8Array | undefined {
  try {
    const files = unzipSync(bytes, {
      filter: (file) => file.name === name && file.originalSize <= limit,
    });
    return files[name];
  } catch {
    return undefined;
  }
}

function validateArchive(
  bytes: Uint8Array,
  limits: SourceLimits,
): string | undefined {
  const outer = scanArchive(
    bytes,
    limits.archiveEntryBytes,
    limits.nestedEntryBytes,
    true,
  );
  if (outer.error !== undefined) return outer.error;
  for (const name of outer.nested) {
    const nestedBytes = readNestedEntry(bytes, name, limits.nestedEntryBytes);
    if (nestedBytes === undefined) return "archive_invalid";
    if (nestedBytes.byteLength > limits.nestedEntryBytes) {
      return "nested_entry_too_large";
    }
    const inner = scanArchive(
      nestedBytes,
      limits.nestedEntryBytes,
      limits.nestedEntryBytes,
      false,
    );
    if (inner.error !== undefined) {
      return inner.error === "archive_entry_too_large"
        ? "nested_entry_too_large"
        : inner.error;
    }
  }
  return undefined;
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

interface VerifiedArtifact {
  readonly identity: FileIdentity;
  readonly error: string | undefined;
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function verifyArtifact(
  record: SourceArtifactRecord,
  limits: SourceLimits,
  cache: Map<string, VerifiedArtifact>,
): Promise<string | undefined> {
  const path = record.path;
  if (isAbsolute(path) || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
    return "absolute_artifact_path";
  }
  if (unsafeRelativePath(path)) return "outside_artifact_root";
  if (!isAbsolute(record.root)) return "outside_artifact_root";

  let realRoot: string;
  try {
    realRoot = await realpath(record.root);
  } catch (error) {
    return fsErrorCode(error) === "ENOENT"
      ? "outside_artifact_root"
      : "artifact_unreadable";
  }

  const joined = join(realRoot, path);
  let isLink: boolean;
  try {
    isLink = (await lstat(joined)).isSymbolicLink();
  } catch (error) {
    return fsErrorCode(error) === "ENOENT"
      ? "artifact_not_found"
      : "artifact_unreadable";
  }
  if (isLink) return "unsafe_symlink";

  let realFile: string;
  try {
    realFile = await realpath(joined);
  } catch (error) {
    return fsErrorCode(error) === "ENOENT"
      ? "artifact_not_found"
      : "artifact_unreadable";
  }
  const relativeFile = relative(realRoot, realFile);
  if (
    relativeFile === "" ||
    isAbsolute(relativeFile) ||
    relativeFile.split(/[\\/]/).includes("..")
  ) {
    return "unsafe_symlink";
  }

  const key = `${record.id}:${record.sha256}`;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      realFile,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
  } catch (error) {
    const code = fsErrorCode(error);
    if (code === "ELOOP") return "unsafe_symlink";
    return code === "ENOENT" ? "artifact_not_found" : "artifact_unreadable";
  }
  try {
    const stats = await handle.stat();
    const identity: FileIdentity = {
      dev: stats.dev,
      ino: stats.ino,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      ctimeMs: stats.ctimeMs,
    };
    const cached = cache.get(key);
    if (cached !== undefined && sameIdentity(cached.identity, identity)) {
      return cached.error;
    }
    if (!stats.isFile()) return "artifact_not_found";
    if (stats.size > limits.artifactBytes) return "artifact_too_large";
    const bytes = await handle.readFile();
    if (bytes.byteLength > limits.artifactBytes) return "artifact_too_large";
    if (createHash("sha256").update(bytes).digest("hex") !== record.sha256) {
      return "artifact_sha256_mismatch";
    }
    const error = validateArchive(bytes, limits);
    cache.set(key, { identity, error });
    return error;
  } catch {
    return "artifact_unreadable";
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function createFacade(config: SourceFacadeConfig): SourceFacade {
  const candidates = [...config.candidates];
  if (candidates.length > 1) {
    throw facadeError(
      "multiple_source_candidates",
      "Exactly one source candidate may be selected",
    );
  }
  const selected = candidates[0];
  const artifacts = [...(config.artifacts ?? [])];
  const limits: SourceLimits = { ...DEFAULT_LIMITS, ...config.limits };
  const verified = new Map<string, VerifiedArtifact>();
  const active = new Set<AbortController>();
  let disabled = selected === undefined;
  let disposePromise: Promise<void> | undefined;

  async function artifactFailure(
    request: SourceRequest,
  ): Promise<string | undefined> {
    if (selected === undefined) return undefined;
    for (const [artifactId, artifact] of [
      [request.artifactId, request.artifact],
      [request.rightArtifactId, request.rightArtifact],
      [request.runtimeArtifactId, request.runtimeArtifact],
    ] as const) {
      if (artifactId === undefined) continue;
      const record = artifacts.find(
        (entry) =>
          entry.id === artifactId &&
          (artifact === undefined ||
            (entry.coordinates === artifact.coordinates &&
              entry.version === artifact.version &&
              entry.sha256 === artifact.sha256)),
      );
      if (record === undefined) return "artifact_not_found";
      const error = await verifyArtifact(record, limits, verified);
      if (error !== undefined) return error;
    }
    return undefined;
  }

  async function invoke(
    request: SourceRequest,
    context: { offline?: boolean; signal?: AbortSignal | undefined } = {},
  ): Promise<SourceResult> {
    const operation = request.operation;
    if (
      typeof operation !== "string" ||
      !Object.hasOwn(OPERATIONS, operation)
    ) {
      return failure("unsupported", String(operation), "unsupported_operation");
    }
    for (const key of Object.keys(request)) {
      if (Object.hasOwn(FORBIDDEN_ARGUMENTS, key)) {
        return failure("failed", operation, "forbidden_argument");
      }
    }
    if (disabled || selected === undefined) {
      return failure("unavailable", operation, "source_facade_disabled");
    }
    const callerSignal = context.signal;
    if (callerSignal?.aborted === true) {
      return failure("cancelled", operation, "cancelled");
    }
    const target = normalizeTarget(request.target);
    if (target === undefined) {
      return failure("failed", operation, "exact_target_required");
    }
    const mapping = request.mapping ?? target.mappings.kind;
    if (mapping !== target.mappings.kind) {
      return failure("unsupported", operation, "mapping_unavailable");
    }
    const artifact = normalizeArtifact(request.artifact);
    if (request.artifact !== undefined && artifact === undefined) {
      return failure("failed", operation, "artifact_invalid");
    }
    const rightArtifact = normalizeArtifact(request.rightArtifact);
    if (request.rightArtifact !== undefined && rightArtifact === undefined) {
      return failure("failed", operation, "artifact_invalid");
    }
    const runtimeArtifact = normalizeArtifact(request.runtimeArtifact);
    if (
      request.runtimeArtifact !== undefined &&
      runtimeArtifact === undefined
    ) {
      return failure("failed", operation, "artifact_invalid");
    }
    const rightTarget =
      request.rightTarget === undefined
        ? undefined
        : normalizeTarget(request.rightTarget);
    if (request.rightTarget !== undefined && rightTarget === undefined) {
      return failure("failed", operation, "exact_target_required");
    }

    const controller = new AbortController();
    let detach = (): void => {};
    if (callerSignal !== undefined) {
      const onAbort = (): void => {
        controller.abort(callerSignal.reason);
      };
      callerSignal.addEventListener("abort", onAbort, { once: true });
      detach = (): void => {
        callerSignal.removeEventListener("abort", onAbort);
      };
    }
    active.add(controller);

    try {
      // No await before the candidate call when no artifact is named: an
      // immediate abort must still reach the candidate's own abort listener.
      if (
        request.artifactId !== undefined ||
        request.rightArtifactId !== undefined ||
        request.runtimeArtifactId !== undefined
      ) {
        const artifactError = await artifactFailure(request);
        if (artifactError !== undefined) {
          return failure(
            artifactError === "artifact_not_found" ? "not_found" : "failed",
            operation,
            artifactError,
          );
        }
      }
      if (controller.signal.aborted) {
        return failure("cancelled", operation, "cancelled");
      }

      const candidateRequest: SourceCandidateRequest = {
        operation,
        target,
        mapping,
        artifact,
        artifactId: request.artifactId,
        workspaceId: request.workspaceId,
        className: request.className,
        symbol: request.symbol,
        query: request.query,
        rightArtifactId: request.rightArtifactId,
        rightArtifact,
        rightTarget,
        runtimeArtifactId: request.runtimeArtifactId,
        runtimeArtifact,
      };

      let candidatePromise: Promise<unknown>;
      try {
        candidatePromise = Promise.resolve(
          selected.invoke(candidateRequest, {
            offline: context.offline === true,
            signal: controller.signal,
          }),
        );
      } catch (error) {
        candidatePromise = Promise.reject(error);
      }

      const outcome = await settle(candidatePromise, controller.signal);
      if (controller.signal.aborted) {
        return failure("cancelled", operation, "cancelled");
      }
      if (outcome.kind === "error") {
        const code = candidateErrorCode(outcome.error);
        const status =
          code === undefined ? undefined : CANDIDATE_ERROR_CODES[code];
        if (status !== undefined && code !== undefined) {
          return failure(
            status,
            operation,
            CANDIDATE_ERROR_RESULT_CODES[code] ?? code,
          );
        }
        disabled = true;
        return failure("unavailable", operation, "candidate_failed");
      }
      const value = outcome.value;
      if (
        value !== null &&
        typeof value === "object" &&
        "source" in value &&
        typeof value.source === "string" &&
        utf8Bytes(value.source) > limits.sourceBytes
      ) {
        return failure("failed", operation, "source_response_too_large");
      }
      const serialized = JSON.stringify(value);
      if (
        serialized !== undefined &&
        utf8Bytes(serialized) > limits.responseBytes
      ) {
        return failure("failed", operation, "response_too_large");
      }
      return { status: "ok", operation, value };
    } finally {
      detach();
      active.delete(controller);
    }
  }

  return {
    invoke,
    dispose(): Promise<void> {
      disposePromise ??= (async () => {
        disabled = true;
        for (const controller of active) controller.abort();
        active.clear();
        await Promise.all(
          candidates.map(async (candidate) => {
            await candidate.dispose();
          }),
        );
      })();
      return disposePromise;
    },
  };
}

export function createSourceFacade(config: SourceFacadeConfig): SourceFacade {
  return createFacade(config);
}
