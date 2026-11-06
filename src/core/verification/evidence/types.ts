export const STATUSES = [
  "passed",
  "failed",
  "timed_out",
  "cancelled",
  "unsupported",
  "unavailable",
] as const;

export type EvidenceStatus = (typeof STATUSES)[number];

export interface EvidenceInputFile {
  name: string;
  path: string;
}

export interface EvidenceCheckInput {
  id: string;
  requested: boolean;
  executed: boolean;
  status: EvidenceStatus;
  requestedArgv: string[];
  executedArgv: string[] | null;
  exitCode: number | null;
  logs: EvidenceInputFile[];
}

export interface FinalizeEvidenceOptions {
  evidenceRoot: string;
  agentWritableRoots: string[];
  sourceRoots: string[];
  transactionId: string;
  baseProjectSha256: string;
  modSpecSha256: string;
  targetPackSha256: string;
  finalTreeSha256: string;
  environment: Record<string, unknown>;
  checks: EvidenceCheckInput[];
  artifacts: EvidenceInputFile[];
  secretValues: string[];
}

export interface EvidenceStoredFile {
  name: string;
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface EvidenceCheck {
  id: string;
  requested: boolean;
  executed: boolean;
  status: EvidenceStatus;
  requestedArgv: string[];
  executedArgv: string[] | null;
  exitCode: number | null;
  logs: EvidenceStoredFile[];
}

export interface EvidenceManifest {
  transactionId: string;
  baseProjectSha256: string;
  modSpecSha256: string;
  targetPackSha256: string;
  finalTreeSha256: string;
  environment: Record<string, unknown>;
  checks: EvidenceCheck[];
  artifacts: EvidenceStoredFile[];
}

export class EvidenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function fail(code: string, message: string): never {
  throw new EvidenceError(code, message);
}
