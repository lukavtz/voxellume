import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

import { sha256 } from "../../targets/canonical-json.ts";
import type {
  TransactionCandidate,
  TransactionJournal,
} from "../transaction-types.ts";
import { applyPaths, expectedBaseHash } from "./ownership.ts";
import {
  assertSafePath,
  atomicWrite,
  readSafeFile,
  safeRelativePath,
  temporaryPath,
} from "./paths.ts";
import { authenticateJournal, sealJournal } from "./journal-integrity.ts";
import { InjectedCrash, TransactionFault } from "./state.ts";

export async function atomicProjectWrite(
  candidate: TransactionCandidate,
  journal: TransactionJournal,
  path: string,
  contents: Uint8Array,
  crashBeforeRename: boolean,
  checkBaseDrift: boolean,
): Promise<void> {
  const destination = await assertSafePath(
    candidate.realProjectRoot,
    path,
    true,
  );
  await mkdir(dirname(destination), { recursive: true });
  await assertSafePath(candidate.realProjectRoot, path, true);
  const temporary = temporaryPath(destination);
  const temporaryRelative = relative(candidate.realProjectRoot, temporary);
  if (!journal.temporaryFiles.includes(temporaryRelative)) {
    journal.temporaryFiles.push(temporaryRelative);
  }
  await writeJournal(candidate, journal);
  let preserveForCrash = false;
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(contents);
    await handle.close();
    handle = undefined;
    if (crashBeforeRename) {
      preserveForCrash = true;
      throw new InjectedCrash("Injected crash before apply rename");
    }
    await assertSafePath(candidate.realProjectRoot, path, true);
    if (checkBaseDrift) {
      const latest = await readSafeFile(candidate.realProjectRoot, path, true);
      const latestHash = latest === null ? null : sha256(latest);
      if (latestHash !== expectedBaseHash(candidate, path)) {
        throw new TransactionFault(
          "base_drift",
          `File changed immediately before rename: ${path}`,
        );
      }
    }
    const temporaryInfo = await lstat(temporary);
    if (!temporaryInfo.isFile() || temporaryInfo.isSymbolicLink()) {
      throw new TransactionFault(
        "unsafe_path",
        "Apply temporary changed before rename",
      );
    }
    await rename(temporary, destination);
  } finally {
    await handle?.close();
    if (!preserveForCrash)
      await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function writeJournal(
  candidate: TransactionCandidate,
  journal: TransactionJournal,
): Promise<void> {
  const stored = await sealJournal(journal);
  await atomicWrite(
    candidate.journalPath,
    `${JSON.stringify(stored, null, 2)}\n`,
  );
}

export async function readJournal(
  candidate: TransactionCandidate,
): Promise<TransactionJournal> {
  let stored: unknown;
  try {
    stored = JSON.parse(await readFile(candidate.journalPath, "utf8"));
  } catch {
    throw new TransactionFault(
      "recovery_required",
      "Transaction journal is unreadable",
    );
  }
  const journal = await authenticateJournal(stored);
  const keys = [
    "appliedFiles",
    "backups",
    "baseProjectSha256",
    "directoryRenamed",
    "mode",
    "projectRoot",
    "schemaVersion",
    "status",
    "temporaryFiles",
    "transactionId",
  ];
  const validShape =
    journal !== null &&
    typeof journal === "object" &&
    Object.keys(journal).sort().join(",") === keys.join(",") &&
    journal.schemaVersion === "transaction-journal-1.0.0" &&
    journal.transactionId === candidate.transactionId &&
    resolve(journal.projectRoot) === resolve(candidate.projectRoot) &&
    (journal.mode === "new" || journal.mode === "existing") &&
    (journal.status === "applying" || journal.status === "recovery_required") &&
    journal.baseProjectSha256 === candidate.manifest.base.projectSha256 &&
    typeof journal.directoryRenamed === "boolean" &&
    Array.isArray(journal.appliedFiles) &&
    journal.appliedFiles.every((path) => typeof path === "string") &&
    Array.isArray(journal.temporaryFiles) &&
    journal.temporaryFiles.every((path) => typeof path === "string") &&
    journal.backups !== null &&
    typeof journal.backups === "object" &&
    !Array.isArray(journal.backups);
  if (!validShape)
    throw new TransactionFault(
      "recovery_required",
      "Invalid transaction journal",
    );

  const expectedPaths = journal.mode === "new" ? [] : applyPaths(candidate);
  const appliedFiles = journal.appliedFiles;
  if (
    appliedFiles.length > expectedPaths.length ||
    appliedFiles.some((path, index) => path !== expectedPaths[index])
  ) {
    throw new TransactionFault(
      "recovery_required",
      "Journal apply paths are not an owned prefix",
    );
  }
  const backupKeys = Object.keys(journal.backups).sort();
  if (backupKeys.join(",") !== [...appliedFiles].sort().join(",")) {
    throw new TransactionFault(
      "recovery_required",
      "Journal backups do not match applied files",
    );
  }
  for (const path of appliedFiles) {
    const backup = journal.backups[path];
    if (
      !backup ||
      Object.keys(backup).sort().join(",") !== "data" ||
      (backup.data !== null && typeof backup.data !== "string")
    ) {
      throw new TransactionFault(
        "recovery_required",
        `Invalid journal backup for ${path}`,
      );
    }
    const expectedBase = expectedBaseHash(candidate, path);
    if (backup.data === null) {
      if (expectedBase !== null) {
        throw new TransactionFault(
          "recovery_required",
          `Missing backup bytes for ${path}`,
        );
      }
    } else if (
      expectedBase === null ||
      sha256(Buffer.from(backup.data, "base64")) !== expectedBase
    ) {
      throw new TransactionFault(
        "recovery_required",
        `Backup hash mismatch for ${path}`,
      );
    }
  }
  for (const temporary of journal.temporaryFiles) {
    safeRelativePath(temporary);
    const owned = appliedFiles.some((path) => {
      const name = basename(temporary);
      return (
        dirname(temporary) === dirname(path) &&
        name.startsWith(`.${basename(path)}.voxellume-`) &&
        name.endsWith(".tmp")
      );
    });
    if (!owned) {
      throw new TransactionFault(
        "recovery_required",
        `Unowned journal temporary: ${temporary}`,
      );
    }
  }
  return journal;
}
