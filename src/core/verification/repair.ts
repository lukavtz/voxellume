export interface RepairCheck {
  id: string;
  acceptanceHash: string;
}

export interface RepairCheckResult {
  check: RepairCheck;
  status: "passed" | "failed";
  evidence: Record<string, unknown>;
}

export interface RepairChange {
  diff: string;
  evidence: Record<string, unknown>;
}

export interface RepairAttempt {
  attempt: number;
  change?: RepairChange;
  check?: RepairCheckResult;
}

export interface RepairVerificationOptions {
  check: RepairCheck;
  runCheck: (context: {
    attempt: number;
    check: RepairCheck;
    signal?: AbortSignal | undefined;
  }) => Promise<RepairCheckResult>;
  applyChange: (context: {
    attempt: number;
    failure: RepairCheckResult;
    signal?: AbortSignal | undefined;
  }) => Promise<RepairChange>;
  restore: (context: { attempt: number }) => Promise<void>;
  maxAttempts?: number;
  signal?: AbortSignal | undefined;
}

export interface RepairVerificationResult {
  status: "passed" | "failed" | "cancelled" | "recovery_required";
  originalFailure: RepairCheckResult | null;
  attempts: RepairAttempt[];
}

export async function repairVerification(
  options: RepairVerificationOptions,
): Promise<RepairVerificationResult> {
  const attempts: RepairAttempt[] = [];
  if (options.signal?.aborted) {
    return { status: "cancelled", originalFailure: null, attempts };
  }

  let originalFailure: RepairCheckResult;
  try {
    const initial = await options.runCheck({
      attempt: 0,
      check: options.check,
      signal: options.signal,
    });
    if (options.signal?.aborted) {
      return { status: "cancelled", originalFailure: null, attempts };
    }
    if (initial.status === "passed") {
      const sameCheck =
        initial.check.id === options.check.id &&
        initial.check.acceptanceHash === options.check.acceptanceHash;
      return {
        status: sameCheck ? "passed" : "failed",
        originalFailure: null,
        attempts,
      };
    }
    originalFailure = initial;
  } catch {
    return { status: "failed", originalFailure: null, attempts };
  }

  const restore = async (attempt: number): Promise<boolean> => {
    try {
      await options.restore({ attempt });
      return true;
    } catch {
      return false;
    }
  };
  const finish = async (
    status: "failed" | "cancelled",
    attempt: number,
  ): Promise<RepairVerificationResult> => ({
    status: (await restore(attempt)) ? status : "recovery_required",
    originalFailure,
    attempts,
  });

  const maxAttempts = Math.min(options.maxAttempts ?? 3, 3);
  let failure = originalFailure;
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    if (options.signal?.aborted) {
      return { status: "cancelled", originalFailure, attempts };
    }

    const attempt: RepairAttempt = { attempt: attemptNumber };
    attempts.push(attempt);
    try {
      attempt.change = await options.applyChange({
        attempt: attemptNumber,
        failure,
        signal: options.signal,
      });
    } catch {
      return finish(
        options.signal?.aborted ? "cancelled" : "failed",
        attemptNumber,
      );
    }
    if (options.signal?.aborted) {
      return finish("cancelled", attemptNumber);
    }

    try {
      attempt.check = await options.runCheck({
        attempt: attemptNumber,
        check: options.check,
        signal: options.signal,
      });
    } catch {
      return finish(
        options.signal?.aborted ? "cancelled" : "failed",
        attemptNumber,
      );
    }
    if (options.signal?.aborted) {
      return finish("cancelled", attemptNumber);
    }

    const sameCheck =
      attempt.check.check.id === options.check.id &&
      attempt.check.check.acceptanceHash === options.check.acceptanceHash;
    if (attempt.check.status === "passed" && sameCheck) {
      return { status: "passed", originalFailure, attempts };
    }
    if (!(await restore(attemptNumber))) {
      return { status: "recovery_required", originalFailure, attempts };
    }
    if (!sameCheck) {
      return { status: "failed", originalFailure, attempts };
    }
    failure = attempt.check;
  }

  return { status: "failed", originalFailure, attempts };
}
