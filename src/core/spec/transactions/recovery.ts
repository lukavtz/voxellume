import { rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { sha256 } from "../../targets/canonical-json.ts";
import type {
  TransactionCandidate,
  TransactionFaults,
  TransactionJournal,
} from "../transaction-types.ts";
import { atomicProjectWrite, writeJournal } from "./journal.ts";
import { expectedBaseHash, expectedStagedHash } from "./ownership.ts";
import {
  assertSafeDirectory,
  assertSafePath,
  pathExists,
  readSafeFile,
} from "./paths.ts";
import { detail, errorCode, TransactionFault } from "./state.ts";

async function cleanupTemporaryFiles(
  candidate: TransactionCandidate,
  journal: TransactionJournal,
): Promise<void> {
  for (const temporary of journal.temporaryFiles) {
    const path = await assertSafePath(
      candidate.realProjectRoot,
      temporary,
      true,
    );
    await rm(path, { force: true });
  }
}

async function rollback(
  candidate: TransactionCandidate,
  journal: TransactionJournal,
  faults: TransactionFaults | undefined,
): Promise<void> {
  if (faults?.failRollback) throw new Error("Injected rollback failure");
  if (journal.mode === "new") {
    const destinationExists = await pathExists(candidate.projectRoot);
    const stagingExists = await pathExists(candidate.stagingRoot);
    if (destinationExists) {
      if (stagingExists) {
        throw new TransactionFault(
          "rollback_conflict",
          "Both new-project roots exist during recovery",
        );
      }
      await assertSafeDirectory(candidate.realProjectRoot);
      await assertSafeDirectory(dirname(candidate.realProjectRoot));
      await rename(candidate.projectRoot, candidate.stagingRoot);
    }
    return;
  }

  for (const path of [...journal.appliedFiles].reverse()) {
    const backup = journal.backups[path];
    if (!backup)
      throw new TransactionFault(
        "recovery_required",
        `Journal has no backup for ${path}`,
      );
    const current = await readSafeFile(candidate.realProjectRoot, path, true);
    const currentHash = current === null ? null : sha256(current);
    const stagedHash = expectedStagedHash(candidate, path);
    const baseHash = expectedBaseHash(candidate, path);
    if (currentHash !== stagedHash) {
      if (currentHash === baseHash) continue;
      throw new TransactionFault(
        "rollback_conflict",
        `User bytes changed after apply: ${path}`,
      );
    }
    if (backup.data === null) {
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
        Buffer.from(backup.data, "base64"),
        false,
        false,
      );
    }
  }
  await cleanupTemporaryFiles(candidate, journal);
}

export async function recover(
  candidate: TransactionCandidate,
  code: string,
  error: unknown,
  journal: TransactionJournal,
  faults: TransactionFaults | undefined,
): Promise<TransactionCandidate> {
  candidate.error = { code, detail: detail(error) };
  try {
    await rollback(candidate, journal, faults);
    journal.status = "rolled_back";
    await writeJournal(candidate, journal);
    candidate.status = "rolled_back";
    return candidate;
  } catch (rollbackError) {
    candidate.status = "recovery_required";
    candidate.error = {
      code: errorCode(rollbackError, "rollback_failed"),
      detail: detail(rollbackError),
    };
    journal.status = "recovery_required";
    await writeJournal(candidate, journal).catch(() => undefined);
    return candidate;
  }
}
