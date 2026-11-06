import { rm } from "node:fs/promises";

import { sha256 } from "../../targets/canonical-json.ts";
import type {
  CommitCandidateOptions,
  TransactionCandidate,
  TransactionJournal,
} from "../transaction-types.ts";
import { atomicProjectWrite, writeJournal } from "./journal.ts";
import {
  applyPaths,
  expectedBaseHash,
  expectedStagedHash,
} from "./ownership.ts";
import { assertSafePath, readSafeFile } from "./paths.ts";
import { recover } from "./recovery.ts";
import {
  detail,
  errorCode,
  InjectedCrash,
  isCancelled,
  TransactionFault,
  transition,
} from "./state.ts";

export async function commitExistingProject(
  candidate: TransactionCandidate,
  options: CommitCandidateOptions,
): Promise<TransactionCandidate> {
  const journal: TransactionJournal = {
    schemaVersion: "transaction-journal-1.0.0",
    transactionId: candidate.transactionId,
    projectRoot: candidate.projectRoot,
    mode: "existing",
    status: "applying",
    baseProjectSha256: candidate.manifest.base.projectSha256,
    directoryRenamed: false,
    appliedFiles: [],
    temporaryFiles: [],
    backups: {},
  };
  await writeJournal(candidate, journal);
  const paths = applyPaths(candidate);
  let appliedCount = 0;

  try {
    for (const path of paths) {
      if (isCancelled(options.signal)) {
        return await recover(
          candidate,
          "cancelled",
          "Cancellation during apply",
          journal,
          options.faults,
        );
      }
      await options.hooks?.beforeApplyFile?.({
        path,
        stagingRoot: candidate.stagingRoot,
        projectRoot: candidate.projectRoot,
      });
      if (isCancelled(options.signal)) {
        return await recover(
          candidate,
          "cancelled",
          "Cancellation after apply callback",
          journal,
          options.faults,
        );
      }

      const stagedHash = expectedStagedHash(candidate, path);
      const source =
        stagedHash === null
          ? null
          : await readSafeFile(candidate.realStagingRoot, path);
      if (stagedHash !== null && source === null) {
        throw new TransactionFault(
          "unsafe_path",
          `Staged source disappeared: ${path}`,
        );
      }
      const backup = await readSafeFile(candidate.realProjectRoot, path, true);
      const actualBaseHash = backup === null ? null : sha256(backup);
      if (actualBaseHash !== expectedBaseHash(candidate, path)) {
        throw new TransactionFault(
          "base_drift",
          `File changed before apply: ${path}`,
        );
      }

      journal.backups[path] = { data: backup?.toString("base64") ?? null };
      journal.appliedFiles.push(path);
      await writeJournal(candidate, journal);
      if (stagedHash === null) {
        const destination = await assertSafePath(
          candidate.realProjectRoot,
          path,
          true,
        );
        await rm(destination, { force: true });
      } else {
        await atomicProjectWrite(
          candidate,
          journal,
          path,
          source!,
          options.faults?.crashBeforeApplyRename === appliedCount + 1,
          true,
        );
      }
      appliedCount += 1;
      await options.hooks?.afterApplyFile?.({
        path,
        stagingRoot: candidate.stagingRoot,
        projectRoot: candidate.projectRoot,
      });

      const applied = await readSafeFile(candidate.realProjectRoot, path, true);
      const appliedHash = applied === null ? null : sha256(applied);
      if (appliedHash !== stagedHash) {
        throw new TransactionFault(
          "rollback_conflict",
          `File changed after apply: ${path}`,
        );
      }
      if (isCancelled(options.signal)) {
        throw new TransactionFault(
          "cancelled",
          "Cancellation after apply callback",
        );
      }
      if (options.faults?.crashAfterApplyFiles === appliedCount) {
        journal.status = "recovery_required";
        await writeJournal(candidate, journal);
        candidate.status = "recovery_required";
        candidate.error = {
          code: "recovery_required",
          detail: "Injected crash left a persisted partial apply",
        };
        return candidate;
      }
      if (options.faults?.failAfterApplyFiles === appliedCount) {
        throw new Error("Injected apply failure");
      }
    }
    journal.status = "committed";
    await writeJournal(candidate, journal);
    await transition(candidate, "committed", options.hooks);
    if (isCancelled(options.signal)) {
      throw new TransactionFault(
        "cancelled",
        "Cancellation after committed transition",
      );
    }
    return candidate;
  } catch (error) {
    if (error instanceof InjectedCrash) {
      journal.status = "recovery_required";
      await writeJournal(candidate, journal);
      candidate.status = "recovery_required";
      candidate.error = { code: "recovery_required", detail: detail(error) };
      return candidate;
    }
    return recover(
      candidate,
      errorCode(error, "apply_failed"),
      error,
      journal,
      options.faults,
    );
  }
}
