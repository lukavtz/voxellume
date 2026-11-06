import { realpath, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  CommitCandidateOptions,
  TransactionCandidate,
  TransactionJournal,
} from "../transaction-types.ts";
import { commitExistingProject } from "./apply.ts";
import { readJournal, writeJournal } from "./journal.ts";
import { acquireProjectLock } from "./lock.ts";
import { assertSafeDirectory, pathExists } from "./paths.ts";
import { recover } from "./recovery.ts";
import { assertStagingUnchanged } from "./stage.ts";
import {
  candidateDigest,
  cancelled,
  detail,
  errorCode,
  failed,
  isCancelled,
  recoveryCandidate,
  TransactionFault,
  transition,
  verificationBindings,
} from "./state.ts";
import { projectHash, snapshotTree } from "./tree.ts";

async function commitNewProject(
  candidate: TransactionCandidate,
  options: CommitCandidateOptions,
): Promise<TransactionCandidate> {
  const journal: TransactionJournal = {
    schemaVersion: "transaction-journal-1.0.0",
    transactionId: candidate.transactionId,
    projectRoot: candidate.projectRoot,
    mode: "new",
    status: "applying",
    baseProjectSha256: candidate.manifest.base.projectSha256,
    directoryRenamed: false,
    appliedFiles: [],
    temporaryFiles: [],
    backups: {},
  };
  await writeJournal(candidate, journal);
  try {
    const stagingDevice = (await stat(candidate.realStagingRoot)).dev;
    const projectParent = await realpath(dirname(candidate.realProjectRoot));
    const parentDevice = (await stat(projectParent)).dev;
    if (stagingDevice !== parentDevice) {
      throw new Error(
        "New-project staging and destination are on different filesystems",
      );
    }
    await options.hooks?.beforeDirectorySwap?.({
      stagingRoot: candidate.stagingRoot,
      projectRoot: candidate.projectRoot,
    });
    if (options.faults?.failBeforeDirectorySwap) {
      throw new Error("Injected directory swap failure");
    }
    await assertSafeDirectory(candidate.realStagingRoot);
    await assertSafeDirectory(dirname(candidate.realProjectRoot));
    if (await pathExists(candidate.projectRoot)) {
      throw new TransactionFault(
        "base_drift",
        "New-project destination appeared during commit",
      );
    }
    if (isCancelled(options.signal)) {
      return await recover(
        candidate,
        "cancelled",
        "Cancellation before directory swap",
        journal,
        options.faults,
      );
    }
    await rename(candidate.stagingRoot, candidate.projectRoot);
    journal.directoryRenamed = true;
    await options.hooks?.afterDirectorySwap?.({
      stagingRoot: candidate.stagingRoot,
      projectRoot: candidate.projectRoot,
    });
    if (options.faults?.crashAfterDirectorySwap) {
      journal.status = "recovery_required";
      await writeJournal(candidate, journal);
      candidate.status = "recovery_required";
      candidate.error = {
        code: "recovery_required",
        detail: "Injected crash after new-project directory rename",
      };
      return candidate;
    }
    if (isCancelled(options.signal)) {
      throw new TransactionFault(
        "cancelled",
        "Cancellation after directory swap",
      );
    }
    journal.status = "committed";
    await writeJournal(candidate, journal);
    await transition(candidate, "committed", options.hooks);
    return candidate;
  } catch (error) {
    return recover(
      candidate,
      errorCode(error, "directory_swap_failed"),
      error,
      journal,
      options.faults,
    );
  }
}

export async function commit(
  options: CommitCandidateOptions,
): Promise<TransactionCandidate> {
  const candidate = options.candidate;
  if (candidate.status === "verified") {
    const binding = verificationBindings.get(candidate);
    if (binding === undefined) {
      return failed(
        candidate,
        "verification_required",
        "Candidate has no private successful verification binding",
      );
    }
    if (binding !== candidateDigest(candidate)) {
      return failed(
        candidate,
        "candidate_tampered",
        "Candidate changed after successful verification",
      );
    }
  } else if (!recoveryCandidate(candidate)) {
    return failed(
      candidate,
      "invalid_transition",
      `Cannot commit from ${candidate.status}`,
    );
  }
  if (isCancelled(options.signal)) return cancelled(candidate);

  const release = await acquireProjectLock(candidate.projectRoot);
  try {
    if (isCancelled(options.signal)) return cancelled(candidate);
    if (recoveryCandidate(candidate)) {
      try {
        const journal = await readJournal(candidate);
        return await recover(
          candidate,
          candidate.error?.code ?? "recovery_required",
          candidate.error?.detail ?? "Recovery is required",
          journal,
          options.faults,
        );
      } catch (error) {
        candidate.status = "recovery_required";
        candidate.error = { code: "recovery_required", detail: detail(error) };
        return candidate;
      }
    }

    const currentTree = await snapshotTree(candidate.projectRoot);
    if (projectHash(currentTree) !== candidate.manifest.base.projectSha256) {
      return failed(
        candidate,
        "base_drift",
        "Canonical project changed after candidate verification",
      );
    }
    await assertStagingUnchanged(candidate);
    if (currentTree === null) return await commitNewProject(candidate, options);
    return await commitExistingProject(candidate, options);
  } catch (error) {
    return failed(candidate, "commit_failed", error);
  } finally {
    release();
  }
}
