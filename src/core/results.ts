import { canonicalJson } from "./targets/canonical-json.ts";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface DomainEvidenceReference {
  path: string;
  sha256: string;
  checkId?: string;
}

export interface DomainError {
  code: string;
  detail: string;
  retryable: boolean;
  details?: JsonValue;
}

type DomainSuccess<T> = {
  schemaVersion: "domain-result-1.0.0";
  status: "ok";
  value: T;
  evidence: readonly DomainEvidenceReference[];
};

type DomainFailure = {
  schemaVersion: "domain-result-1.0.0";
  status: "error";
  error: DomainError;
  evidence: readonly DomainEvidenceReference[];
};

export type DomainResult<T> = DomainSuccess<T> | DomainFailure;

function validateEvidence(evidence: readonly DomainEvidenceReference[]): void {
  for (const reference of evidence) {
    if (!/^[a-f0-9]{64}$/.test(reference.sha256)) {
      throw new TypeError(
        "Evidence sha256 must be 64 lowercase hexadecimal characters",
      );
    }
  }
}

export function domainSuccess<T>(
  value: T,
  evidence: readonly DomainEvidenceReference[] = [],
): DomainSuccess<T> {
  validateEvidence(evidence);
  return {
    schemaVersion: "domain-result-1.0.0",
    status: "ok",
    value,
    evidence,
  };
}

export function domainFailure(
  input: DomainError & { evidence?: readonly DomainEvidenceReference[] },
): DomainFailure {
  const evidence = input.evidence ?? [];
  validateEvidence(evidence);
  if (!input.code.trim() || !input.detail.trim()) {
    throw new TypeError("Domain error code and detail must be nonempty");
  }
  if (input.details instanceof Error) {
    throw new TypeError("Domain error details must be JSON-safe");
  }

  const error: DomainError = {
    code: input.code,
    detail: input.detail,
    retryable: input.retryable,
    ...(input.details === undefined ? {} : { details: input.details }),
  };
  return {
    schemaVersion: "domain-result-1.0.0",
    status: "error",
    error,
    evidence,
  };
}

export function serializeDomainResult(result: DomainResult<unknown>): string {
  return canonicalJson(result);
}
