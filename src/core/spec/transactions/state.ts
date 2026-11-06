import { canonicalJson, sha256 } from "../../targets/canonical-json.ts";
import type {
  TransactionCandidate,
  TransactionHooks,
  TransactionStatus,
} from "../transaction-types.ts";

export class TransactionFault extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class InjectedCrash extends Error {}

export const MOD_SPEC_PATH = "mod-spec.json";
export const verificationBindings = new WeakMap<TransactionCandidate, string>();

export function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown, fallback: string): string {
  return error instanceof TransactionFault ? error.code : fallback;
}

export function candidateDigest(candidate: TransactionCandidate): string {
  return sha256(
    canonicalJson({
      transactionId: candidate.transactionId,
      projectRoot: candidate.projectRoot,
      workspaceRoot: candidate.workspaceRoot,
      stagingRoot: candidate.stagingRoot,
      journalPath: candidate.journalPath,
      realProjectRoot: candidate.realProjectRoot,
      realStagingRoot: candidate.realStagingRoot,
      modSpec: candidate.modSpec,
      operations: candidate.operations,
      manifest: candidate.manifest,
    }),
  );
}

export function failed(
  candidate: TransactionCandidate,
  code: string,
  error: unknown,
): TransactionCandidate {
  candidate.status = "failed";
  candidate.error = { code, detail: detail(error) };
  return candidate;
}

export function cancelled(
  candidate: TransactionCandidate,
): TransactionCandidate {
  candidate.status = "cancelled";
  candidate.error = {
    code: "cancelled",
    detail: "Transaction cancellation was requested.",
  };
  return candidate;
}

export function isCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export function recoveryCandidate(candidate: TransactionCandidate): boolean {
  return (
    candidate.status === "recovery_required" && candidate.error.code.length > 0
  );
}

export async function transition(
  candidate: TransactionCandidate,
  status: TransactionStatus,
  hooks: TransactionHooks | undefined,
): Promise<void> {
  candidate.status = status;
  await hooks?.onTransition?.(status);
}
