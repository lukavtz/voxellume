import { join } from "node:path";

import { acquireHeldProjectLock } from "./execution/process/project-lock.ts";
import {
  validateAssets as validateProjectAssets,
  type AssetValidationRequest,
  type AssetValidationResult,
} from "./assets/validate-assets.ts";
import {
  inspectProject as inspectProjectFiles,
  type ProjectInspection,
} from "./projects/inspect-project.ts";
import {
  ScaffoldRollbackError,
  scaffoldProject as scaffoldProjectFiles,
  type ScaffoldModMetadata,
  type ScaffoldProjectResult,
} from "./projects/scaffold-project.ts";
import { domainFailure, domainSuccess, type DomainResult } from "./results.ts";
import { canonicalModSpecHash, validateModSpec } from "./spec/mod-spec.ts";
import {
  loadTargetPacks,
  type LoadedTargetPack,
} from "./targets/load-target-packs.ts";
import {
  resolveTarget as resolveTargetPack,
  type TargetResolution,
  type TargetRequest,
} from "./targets/resolve-target.ts";
import type { TargetLoader } from "./targets/target-pack.ts";
import {
  verifyProject as verifyProjectFiles,
  type VerificationIdentity,
  type VerificationPolicy,
  type VerificationProfile,
  type VerificationStageExecutor,
  type VerifyProjectResult,
} from "./verification/verify-project.ts";

export type OperationTargetRequest = Omit<TargetRequest, "targetPackId"> & {
  readonly targetPackId?: string | undefined;
};

export type ResolveTargetRequest = OperationTargetRequest;

export interface InspectProjectRequest {
  readonly projectRoot: string;
}

export interface ScaffoldProjectOperationRequest {
  readonly destination: string;
  readonly target: OperationTargetRequest;
  readonly mod: ScaffoldModMetadata;
  readonly loaders?: readonly TargetLoader[] | undefined;
}

export type ValidateAssetsOperationRequest = Omit<
  AssetValidationRequest,
  "targetPack"
> & { readonly target: OperationTargetRequest };

export type CoreAssetValidationRequest = ValidateAssetsOperationRequest;

export interface VerifyProjectOperationRequest {
  readonly projectRoot: string;
  readonly target: OperationTargetRequest;
  readonly modSpec: unknown;
  readonly profile: VerificationProfile;
  readonly identity: VerificationIdentity;
}

export interface CoreOperationCallOptions {
  readonly signal?: AbortSignal;
}

export type VerifyProjectCallOptions = CoreOperationCallOptions;

export type PathUsage = "inspect" | "scaffold" | "verify";

export interface HostVerificationConfiguration {
  readonly isolationRoot: string;
  readonly evidenceRoot: string;
  readonly agentWritableRoots: readonly string[];
  readonly policy: VerificationPolicy;
  readonly stageExecutor?: VerificationStageExecutor;
}

export interface CoreOperationsOptions {
  readonly catalogRoot: string;
  readonly authorizePath: (
    path: string,
    usage: PathUsage,
  ) => string | Promise<string>;
  readonly verification?: HostVerificationConfiguration;
}

type OperationTargetOutcome = Exclude<TargetResolution, { status: "resolved" }>;

export interface CoreOperations {
  resolveTarget(
    request: ResolveTargetRequest,
    options?: CoreOperationCallOptions,
  ): Promise<DomainResult<TargetResolution>>;
  inspectProject(
    request: InspectProjectRequest,
    options?: CoreOperationCallOptions,
  ): Promise<DomainResult<ProjectInspection<LoadedTargetPack>>>;
  scaffoldProject(
    request: ScaffoldProjectOperationRequest,
    options?: CoreOperationCallOptions,
  ): Promise<DomainResult<ScaffoldProjectResult | OperationTargetOutcome>>;
  validateAssets(
    request: ValidateAssetsOperationRequest,
    options?: CoreOperationCallOptions,
  ): Promise<DomainResult<AssetValidationResult | OperationTargetOutcome>>;
  verifyProject(
    request: VerifyProjectOperationRequest,
    options?: VerifyProjectCallOptions,
  ): Promise<DomainResult<VerifyProjectResult | OperationTargetOutcome>>;
}

class InvalidRequest extends Error {}
class CatalogUnavailable extends Error {}
class UnauthorizedRoot extends Error {}
class Cancelled extends Error {}

const loaders: Record<string, true> = {
  fabric: true,
  neoforge: true,
  forge: true,
  quilt: true,
};
const profiles: Record<string, true> = {
  static: true,
  build: true,
  server: true,
  gameTest: true,
  client: true,
  visual: true,
  release: true,
  full: true,
};
const identifier = /^[a-z][a-z0-9_]{1,63}$/;
const javaPackage = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const minecraftVersion = /^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/;
const targetPackId = /^[a-z0-9][a-z0-9.-]*-r[1-9][0-9]*$/;
const sha256 = /^[a-f0-9]{64}$/;

function snapshot(value: unknown): unknown {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new InvalidRequest();
    return JSON.parse(encoded) as unknown;
  } catch {
    throw new InvalidRequest();
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function object(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidRequest();
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new InvalidRequest();
  }
  return record;
}

function nonemptyString(value: unknown, singleLine = false): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    (singleLine && /[\r\n]/.test(value))
  ) {
    throw new InvalidRequest();
  }
  return value;
}

function targetRequest(value: unknown): TargetRequest {
  const request = object(
    value,
    ["edition", "minecraftVersion", "loader"],
    ["targetPackId"],
  );
  if (
    request.edition !== "java" ||
    typeof request.minecraftVersion !== "string" ||
    !minecraftVersion.test(request.minecraftVersion) ||
    typeof request.loader !== "string" ||
    !loaders[request.loader]
  ) {
    throw new InvalidRequest();
  }
  if (
    request.targetPackId !== undefined &&
    (typeof request.targetPackId !== "string" ||
      !targetPackId.test(request.targetPackId))
  ) {
    throw new InvalidRequest();
  }
  return {
    edition: "java",
    minecraftVersion: request.minecraftVersion,
    loader: request.loader,
    ...(request.targetPackId === undefined
      ? {}
      : { targetPackId: request.targetPackId }),
  };
}

function modMetadata(value: unknown): ScaffoldModMetadata {
  const mod = object(value, [
    "modId",
    "namespace",
    "javaPackage",
    "name",
    "version",
    "description",
    "authors",
    "license",
  ]);
  if (
    typeof mod.modId !== "string" ||
    !identifier.test(mod.modId) ||
    typeof mod.namespace !== "string" ||
    !identifier.test(mod.namespace) ||
    typeof mod.javaPackage !== "string" ||
    !javaPackage.test(mod.javaPackage) ||
    !Array.isArray(mod.authors) ||
    mod.authors.length === 0
  ) {
    throw new InvalidRequest();
  }
  const authors = mod.authors.map((author) => nonemptyString(author, true));
  return {
    modId: mod.modId,
    namespace: mod.namespace,
    javaPackage: mod.javaPackage,
    name: nonemptyString(mod.name, true),
    version: nonemptyString(mod.version, true),
    description: nonemptyString(mod.description, true),
    authors,
    license: nonemptyString(mod.license, true),
  };
}

function assetRequest(value: unknown): ValidateAssetsOperationRequest {
  const request = object(value, [
    "target",
    "modId",
    "namespace",
    "metadataFile",
    "files",
    "registry",
    "animations",
    "requiredLangKeys",
    "datagen",
  ]);
  if (
    typeof request.modId !== "string" ||
    !identifier.test(request.modId) ||
    typeof request.namespace !== "string" ||
    !identifier.test(request.namespace)
  ) {
    throw new InvalidRequest();
  }
  const files = object(request.files, []);
  if (
    Object.values(files).some((contents) => typeof contents !== "string") ||
    !Array.isArray(request.registry) ||
    !Array.isArray(request.animations) ||
    !Array.isArray(request.requiredLangKeys) ||
    request.requiredLangKeys.some((key) => typeof key !== "string") ||
    !Array.isArray(request.datagen)
  ) {
    throw new InvalidRequest();
  }
  for (const entry of request.datagen) {
    const item = object(entry, ["path", "expectedSha256"]);
    nonemptyString(item.path);
    if (
      typeof item.expectedSha256 !== "string" ||
      !sha256.test(item.expectedSha256)
    ) {
      throw new InvalidRequest();
    }
  }
  return {
    target: targetRequest(request.target),
    modId: request.modId,
    namespace: request.namespace,
    metadataFile: nonemptyString(request.metadataFile),
    files: files as Record<string, string>,
    registry: request.registry as AssetValidationRequest["registry"],
    animations: request.animations as AssetValidationRequest["animations"],
    requiredLangKeys: request.requiredLangKeys as string[],
    datagen: request.datagen as AssetValidationRequest["datagen"],
  };
}

function verificationRequest(value: unknown): VerifyProjectOperationRequest {
  const request = object(value, [
    "projectRoot",
    "target",
    "modSpec",
    "profile",
    "identity",
  ]);
  if (typeof request.profile !== "string" || !profiles[request.profile]) {
    throw new InvalidRequest();
  }
  const identity = object(request.identity, [
    "transactionId",
    "baseProjectSha256",
    "modSpecSha256",
    "targetPackSha256",
    "finalTreeSha256",
  ]);
  const transactionId = nonemptyString(identity.transactionId, true);
  if (
    transactionId === "." ||
    transactionId === ".." ||
    transactionId.includes("/") ||
    transactionId.includes("\\")
  ) {
    throw new InvalidRequest();
  }
  for (const key of [
    "baseProjectSha256",
    "modSpecSha256",
    "targetPackSha256",
    "finalTreeSha256",
  ] as const) {
    if (typeof identity[key] !== "string" || !sha256.test(identity[key])) {
      throw new InvalidRequest();
    }
  }
  return {
    projectRoot: nonemptyString(request.projectRoot),
    target: targetRequest(request.target),
    modSpec: request.modSpec,
    profile: request.profile as VerificationProfile,
    identity: identity as unknown as VerificationIdentity,
  };
}

function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Cancelled();
}

function failure(error: unknown, signal?: AbortSignal) {
  if (
    !(error instanceof ScaffoldRollbackError) &&
    (error instanceof Cancelled || signal?.aborted)
  ) {
    return domainFailure({
      code: "cancelled",
      detail: "Operation was cancelled.",
      retryable: false,
    });
  }
  if (error instanceof ScaffoldRollbackError) {
    return domainFailure({
      code: "recovery_required",
      detail: "Scaffold rollback failed; recovery is required.",
      retryable: false,
    });
  }
  if (error instanceof InvalidRequest) {
    return domainFailure({
      code: "invalid_arguments",
      detail: "Operation arguments are invalid.",
      retryable: false,
    });
  }
  if (error instanceof CatalogUnavailable) {
    return domainFailure({
      code: "catalog_unavailable",
      detail: "Target catalog is unavailable.",
      retryable: true,
    });
  }
  if (error instanceof UnauthorizedRoot) {
    return domainFailure({
      code: "unauthorized_root",
      detail: "Path authorization failed.",
      retryable: false,
    });
  }
  return domainFailure({
    code: "internal_error",
    detail: "The operation could not be completed.",
    retryable: false,
  });
}

export function createCoreOperations(
  options: CoreOperationsOptions,
): CoreOperations {
  let catalogPromise: Promise<LoadedTargetPack[]> | undefined;

  async function catalog(signal?: AbortSignal): Promise<LoadedTargetPack[]> {
    checkCancellation(signal);
    const pending = (catalogPromise ??= loadTargetPacks(
      options.catalogRoot,
    ).then((packs) => deepFreeze(packs)));
    try {
      const packs = await pending;
      checkCancellation(signal);
      return packs;
    } catch (error) {
      if (catalogPromise === pending) catalogPromise = undefined;
      checkCancellation(signal);
      if (error instanceof Cancelled) throw error;
      throw new CatalogUnavailable();
    }
  }

  async function authorize(
    path: string,
    usage: PathUsage,
    signal?: AbortSignal,
  ): Promise<string> {
    checkCancellation(signal);
    try {
      const authorized = await options.authorizePath(path, usage);
      checkCancellation(signal);
      return nonemptyString(authorized);
    } catch (error) {
      checkCancellation(signal);
      if (error instanceof Cancelled) throw error;
      throw new UnauthorizedRoot();
    }
  }

  return {
    async resolveTarget(request, callOptions) {
      const signal = callOptions?.signal;
      try {
        const target = targetRequest(snapshot(request));
        checkCancellation(signal);
        return domainSuccess(resolveTargetPack(target, await catalog(signal)));
      } catch (error) {
        return failure(error, signal);
      }
    },

    async inspectProject(request, callOptions) {
      const signal = callOptions?.signal;
      try {
        const input = object(snapshot(request), ["projectRoot"]);
        checkCancellation(signal);
        const packs = await catalog(signal);
        const projectRoot = await authorize(
          nonemptyString(input.projectRoot),
          "inspect",
          signal,
        );
        const result = await inspectProjectFiles({
          projectRoot,
          targetPacks: packs,
        });
        checkCancellation(signal);
        return domainSuccess(result);
      } catch (error) {
        return failure(error, signal);
      }
    },

    async scaffoldProject(request, callOptions) {
      const signal = callOptions?.signal;
      try {
        checkCancellation(signal);
        const input = object(
          snapshot(request),
          ["destination", "target", "mod"],
          ["loaders"],
        );
        const target = targetRequest(input.target);
        const mod = modMetadata(input.mod);
        if (
          input.loaders !== undefined &&
          (!Array.isArray(input.loaders) ||
            input.loaders.length === 0 ||
            new Set(input.loaders).size !== input.loaders.length ||
            input.loaders.some(
              (loader) => typeof loader !== "string" || !loaders[loader],
            ))
        ) {
          throw new InvalidRequest();
        }
        const resolution = resolveTargetPack(target, await catalog(signal));
        if (resolution.status !== "resolved") return domainSuccess(resolution);
        const destination = await authorize(
          nonemptyString(input.destination),
          "scaffold",
          signal,
        );
        const lock = await acquireHeldProjectLock(destination, signal);
        if (lock === null) throw new Cancelled();
        try {
          const result = await scaffoldProjectFiles({
            destination,
            target: resolution.target,
            targetPackRoot: join(
              options.catalogRoot,
              resolution.target.edition,
              resolution.target.loader.id,
              resolution.target.minecraft.version,
            ),
            mod,
            ...(input.loaders === undefined
              ? {}
              : { loaders: input.loaders as TargetLoader[] }),
            ...(signal === undefined ? {} : { signal }),
          });
          checkCancellation(signal);
          return domainSuccess(result);
        } finally {
          lock.release();
        }
      } catch (error) {
        return failure(error, signal);
      }
    },

    async validateAssets(request, callOptions) {
      const signal = callOptions?.signal;
      try {
        const input = assetRequest(snapshot(request));
        checkCancellation(signal);
        const requestedTarget = targetRequest(input.target);
        const resolution = resolveTargetPack(
          requestedTarget,
          await catalog(signal),
        );
        if (resolution.status !== "resolved") return domainSuccess(resolution);
        const { target: _target, ...assets } = input;
        if (
          typeof resolution.target.minecraft.resourcePackVersion !== "number" ||
          typeof resolution.target.minecraft.dataPackVersion !== "number"
        ) {
          throw new InvalidRequest();
        }
        const result = validateProjectAssets({
          ...assets,
          targetPack: {
            id: resolution.target.id,
            revision: resolution.target.revision,
            minecraftVersion: resolution.target.minecraft.version,
            resourcePackFormat: resolution.target.minecraft.resourcePackVersion,
            dataPackFormat: resolution.target.minecraft.dataPackVersion,
          },
        });
        checkCancellation(signal);
        return domainSuccess(result);
      } catch (error) {
        return failure(error, signal);
      }
    },

    async verifyProject(request, callOptions) {
      const signal = callOptions?.signal;
      try {
        const input = verificationRequest(snapshot(request));
        checkCancellation(signal);
        const verification = options.verification;
        if (verification === undefined) {
          return domainFailure({
            code: "unavailable",
            detail: "Host verification is unavailable.",
            retryable: false,
          });
        }
        const resolution = resolveTargetPack(
          targetRequest(input.target),
          await catalog(signal),
        );
        if (resolution.status !== "resolved") return domainSuccess(resolution);
        const projectRoot = await authorize(
          input.projectRoot,
          "verify",
          signal,
        );
        const validated = validateModSpec(input.modSpec, {
          targetPackId: resolution.target.id,
          targetPackRevision: resolution.target.revision,
        });
        if (
          validated.status !== "valid" ||
          canonicalModSpecHash(validated.spec) !==
            input.identity.modSpecSha256 ||
          resolution.target.packSha256 !== input.identity.targetPackSha256
        ) {
          throw new InvalidRequest();
        }
        checkCancellation(signal);
        const lock = await acquireHeldProjectLock(projectRoot, signal);
        if (lock === null) throw new Cancelled();
        try {
          const result = await verifyProjectFiles({
            roots: {
              projectRoot,
              isolationRoot: verification.isolationRoot,
              evidenceRoot: verification.evidenceRoot,
              agentWritableRoots: verification.agentWritableRoots,
            },
            target: resolution.target,
            modSpec: validated.spec,
            profile: input.profile,
            identity: input.identity,
            policy: verification.policy,
            projectLock: lock.capability,
            ...(verification.stageExecutor === undefined
              ? {}
              : { stageExecutor: verification.stageExecutor }),
            ...(signal === undefined ? {} : { signal }),
          });
          checkCancellation(signal);
          return domainSuccess(result);
        } finally {
          lock.release();
        }
      } catch (error) {
        return failure(error, signal);
      }
    },
  };
}
