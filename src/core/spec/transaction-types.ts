import type { ModSpec } from "./mod-spec.ts";
import type { ModOperation } from "./operations.ts";

export type TransactionStatus =
  | "proposed"
  | "validated"
  | "staged"
  | "verified"
  | "committed"
  | "failed"
  | "cancelled"
  | "rolled_back"
  | "recovery_required";

export interface TransactionError {
  code: string;
  detail: string;
}

export interface TargetPackReference {
  id: string;
  revision: number;
  packSha256: string;
}

export interface TransactionFile {
  path: string;
  /** Deleted owned files expose null at runtime; string preserves the original public TS API. */
  sha256: string;
  baseSha256: string | null;
  owner: "generated";
}

export interface TransactionManifest {
  base: {
    modSpecSha256: string;
    projectSha256: string;
    packSha256: string;
  };
  targetPack: TargetPackReference;
  files: TransactionFile[];
  baseFileSha256: Record<string, string>;
  stagingTreeSha256: string;
  artifacts: Array<{ path: string; sha256: string }>;
}

export interface TransactionCandidate {
  transactionId: string;
  projectRoot: string;
  workspaceRoot: string;
  stagingRoot: string;
  journalPath: string;
  realProjectRoot: string;
  realStagingRoot: string;
  modSpec: ModSpec;
  operations: ModOperation[];
  status: TransactionStatus;
  manifest: TransactionManifest;
  error: TransactionError;
}

export interface GenerateContext {
  stagingRoot: string;
  modSpec: ModSpec;
  operations: ModOperation[];
  targetPack: TargetPackReference;
  signal?: AbortSignal;
}

export interface VerifyContext extends GenerateContext {
  manifest: TransactionManifest;
}

export interface TransactionHooks {
  onTransition?: (status: TransactionStatus) => unknown | Promise<unknown>;
  beforeDirectorySwap?: (event: {
    stagingRoot: string;
    projectRoot: string;
  }) => unknown | Promise<unknown>;
  afterDirectorySwap?: (event: {
    stagingRoot: string;
    projectRoot: string;
  }) => unknown | Promise<unknown>;
  beforeApplyFile?: (event: {
    path: string;
    stagingRoot: string;
    projectRoot: string;
  }) => unknown | Promise<unknown>;
  afterApplyFile?: (event: {
    path: string;
    stagingRoot: string;
    projectRoot: string;
  }) => unknown | Promise<unknown>;
}

export interface BuildCandidateOptions {
  transactionId: string;
  projectRoot: string;
  workspaceRoot: string;
  modSpec: ModSpec;
  operations: ModOperation[];
  targetPack: TargetPackReference;
  bookkeeping?: Record<string, unknown>;
  generate: (context: GenerateContext) => Promise<{ artifacts: string[] }>;
  verify: (context: VerifyContext) => Promise<{
    status:
      | "passed"
      | "failed"
      | "timed_out"
      | "cancelled"
      | "unsupported"
      | "unavailable";
    detail?: string;
  }>;
  signal?: AbortSignal;
  hooks?: TransactionHooks;
}

export interface TransactionFaults {
  failBeforeDirectorySwap?: boolean;
  failAfterApplyFiles?: number;
  crashAfterApplyFiles?: number;
  crashBeforeApplyRename?: number;
  crashAfterDirectorySwap?: boolean;
  failRollback?: boolean;
}

export interface CommitCandidateOptions {
  candidate: TransactionCandidate;
  signal?: AbortSignal;
  hooks?: TransactionHooks;
  faults?: TransactionFaults;
}

export type TreeSnapshot = Record<string, string>;

export interface JournalBackup {
  data: string | null;
}

export interface TransactionJournal {
  schemaVersion: "transaction-journal-1.0.0";
  transactionId: string;
  projectRoot: string;
  mode: "new" | "existing";
  status: "applying" | "rolled_back" | "committed" | "recovery_required";
  baseProjectSha256: string;
  directoryRenamed: boolean;
  appliedFiles: string[];
  temporaryFiles: string[];
  backups: Record<string, JournalBackup>;
}
