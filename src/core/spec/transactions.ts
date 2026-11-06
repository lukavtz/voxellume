import type {
  BuildCandidateOptions,
  CommitCandidateOptions,
  TransactionCandidate,
} from "./transaction-types.ts";
import { commit } from "./transactions/commit.ts";
import { stageCandidate } from "./transactions/stage.ts";

export type {
  BuildCandidateOptions,
  CommitCandidateOptions,
  GenerateContext,
  TargetPackReference,
  TransactionCandidate,
  TransactionError,
  TransactionFaults,
  TransactionFile,
  TransactionHooks,
  TransactionManifest,
  TransactionStatus,
  VerifyContext,
} from "./transaction-types.ts";

export async function buildCandidate(
  options: BuildCandidateOptions,
): Promise<TransactionCandidate> {
  return stageCandidate(options);
}

export async function commitCandidate(
  options: CommitCandidateOptions,
): Promise<TransactionCandidate> {
  return commit(options);
}
