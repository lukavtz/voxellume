import {
  TARGET_UNSUPPORTED_REASON_CODES,
  type TargetCapability,
  type TargetPack,
  type TargetReason,
  type TargetReasonEvidence,
  type TargetUnsupportedReasonCode,
} from "./target-pack.ts";

export interface TargetRequest {
  readonly edition: "java";
  readonly minecraftVersion: string;
  readonly loader: string;
  readonly targetPackId?: string;
}

/** Structural input keeps pure resolution independent of document loading. */
export interface TargetResolverPack {
  readonly id: string;
  readonly edition: "java";
  readonly status: string;
  readonly reason?: {
    readonly code: string;
    readonly detail: string;
    readonly evidence: readonly TargetReasonEvidence[];
  };
  readonly minecraft: { readonly version: string };
  readonly loader: { readonly id: string };
}

export interface TargetCapabilityPack extends TargetResolverPack {
  readonly packSha256: string;
  readonly verification: {
    readonly capabilities: Readonly<Partial<Record<TargetCapability, boolean>>>;
    readonly evidenceManifest?: {
      readonly path: string;
      readonly sha256: string;
    };
  };
}

export type TargetResolutionErrorCode =
  "unsupported_target" | "target_not_found" | "target_mismatch";

export interface TargetUnsupportedResolution {
  readonly status: "unsupported";
  readonly code: TargetResolutionErrorCode;
  readonly requested: TargetRequest;
  readonly reason: TargetReason;
}

export type TargetResolution<Pack extends TargetResolverPack = TargetPack> =
  | { readonly status: "resolved"; readonly target: Pack }
  | TargetUnsupportedResolution
  | { readonly status: "ambiguous"; readonly candidates: readonly Pack[] };

export type TargetCapabilityResult<
  Pack extends TargetCapabilityPack = TargetPack,
> =
  | {
      readonly status: "supported";
      readonly target: Pack;
      readonly capability: TargetCapability;
    }
  | {
      readonly status: "unsupported";
      readonly code:
        "capability_unavailable" | "missing_qualification_evidence";
      readonly capability: TargetCapability;
    };

function compareIds(
  left: TargetResolverPack,
  right: TargetResolverPack,
): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function isReasonCode(code: string): code is TargetUnsupportedReasonCode {
  return TARGET_UNSUPPORTED_REASON_CODES.some(
    (candidate) => candidate === code,
  );
}

function reason(
  code: TargetUnsupportedReasonCode,
  detail: string,
): TargetReason {
  return { code, detail, evidence: [] };
}

function unsupported(
  requested: TargetRequest,
  code: TargetResolutionErrorCode,
  targetReason: TargetReason,
): TargetUnsupportedResolution {
  return { status: "unsupported", code, requested, reason: targetReason };
}

function nonSupportedReason(pack: TargetResolverPack): TargetReason {
  if (pack.reason && isReasonCode(pack.reason.code)) {
    return {
      code: pack.reason.code,
      detail: pack.reason.detail,
      evidence: pack.reason.evidence,
    };
  }
  return reason(
    "no_qualified_pack",
    `Target pack "${pack.id}" has status "${pack.status}" and is not qualified.`,
  );
}

function resolveCandidates<Pack extends TargetResolverPack>(
  requested: TargetRequest,
  matches: readonly Pack[],
): TargetResolution<Pack> {
  const supported = matches.filter((pack) => pack.status === "supported");
  if (supported.length === 1) {
    return { status: "resolved", target: supported[0]! };
  }
  if (supported.length > 1) {
    return { status: "ambiguous", candidates: [...supported].sort(compareIds) };
  }
  if (matches.length > 0) {
    const selected = matches.reduce((first, pack) =>
      compareIds(pack, first) < 0 ? pack : first,
    );
    return unsupported(
      requested,
      "unsupported_target",
      nonSupportedReason(selected),
    );
  }
  return unsupported(
    requested,
    "unsupported_target",
    reason(
      "no_qualified_pack",
      "No supported target pack exactly matches the requested coordinates.",
    ),
  );
}

export function resolveTarget<Pack extends TargetResolverPack>(
  requested: TargetRequest,
  packs: readonly Pack[],
): TargetResolution<Pack> {
  if (requested.targetPackId !== undefined) {
    const identified = packs.filter(
      (pack) => pack.id === requested.targetPackId,
    );
    if (identified.length === 0) {
      return unsupported(
        requested,
        "target_not_found",
        reason(
          "no_qualified_pack",
          `Target pack "${requested.targetPackId}" does not exist in the catalog.`,
        ),
      );
    }
    const matches = identified.filter(
      (pack) =>
        pack.edition === requested.edition &&
        pack.minecraft.version === requested.minecraftVersion &&
        pack.loader.id === requested.loader,
    );
    if (matches.length === 0) {
      return unsupported(
        requested,
        "target_mismatch",
        reason(
          "no_qualified_pack",
          `Target pack "${requested.targetPackId}" does not match the requested coordinates.`,
        ),
      );
    }
    return resolveCandidates(requested, matches);
  }

  return resolveCandidates(
    requested,
    packs.filter(
      (pack) =>
        pack.edition === requested.edition &&
        pack.minecraft.version === requested.minecraftVersion &&
        pack.loader.id === requested.loader,
    ),
  );
}

const SHA256 = /^[0-9a-f]{64}$/;

export function assertTargetCapability<Pack extends TargetCapabilityPack>(
  pack: Pack,
  capability: TargetCapability,
): TargetCapabilityResult<Pack> {
  if (
    pack.status !== "supported" ||
    pack.verification.capabilities[capability] !== true
  ) {
    return {
      status: "unsupported",
      code: "capability_unavailable",
      capability,
    };
  }

  const evidence = pack.verification.evidenceManifest;
  if (
    !SHA256.test(pack.packSha256) ||
    !evidence ||
    evidence.path.length === 0 ||
    !SHA256.test(evidence.sha256)
  ) {
    return {
      status: "unsupported",
      code: "missing_qualification_evidence",
      capability,
    };
  }

  return { status: "supported", target: pack, capability };
}
