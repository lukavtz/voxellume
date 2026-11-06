import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { canonicalJson } from "../../targets/canonical-json.ts";
import type {
  StoredTransactionJournal,
  TransactionJournal,
} from "../transaction-types.ts";
import { TransactionFault } from "./state.ts";

const secretDirectory = join(homedir(), ".config", "voxellume");
const secretPath = join(secretDirectory, "journal-secret");

async function loadJournalSecret(): Promise<Buffer> {
  await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(secretDirectory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("Journal secret parent is not a real directory");
  }
  await chmod(secretDirectory, 0o700);

  try {
    const handle = await open(
      secretPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const opened = await handle.stat();
      const current = await lstat(secretPath);
      if (
        !opened.isFile() ||
        opened.size !== 32 ||
        opened.nlink !== 1 ||
        (process.getuid !== undefined && opened.uid !== process.getuid()) ||
        opened.dev !== current.dev ||
        opened.ino !== current.ino ||
        current.isSymbolicLink()
      ) {
        throw new Error("Journal secret is not a regular 32-byte file");
      }
      await handle.chmod(0o600);
      const secret = await handle.readFile();
      if (secret.length !== 32) {
        throw new Error("Journal secret is not a regular 32-byte file");
      }
      return secret;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let handle;
  try {
    handle = await open(
      secretPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return loadJournalSecret();
    }
    throw error;
  }
  try {
    const created = await handle.stat();
    if (
      created.nlink !== 1 ||
      (process.getuid !== undefined && created.uid !== process.getuid())
    ) {
      throw new Error("Journal secret has unsafe ownership or links");
    }
    const secret = randomBytes(32);
    await handle.writeFile(secret);
    await handle.chmod(0o600);
    await handle.sync();
    return secret;
  } finally {
    await handle.close();
  }
}

export class CanonicalIntegrityError extends Error {}

async function canonicalMac(value: unknown, purpose?: string): Promise<Buffer> {
  const secret = await loadJournalSecret();
  const authenticated = purpose === undefined ? value : { purpose, value };
  return createHmac("sha256", secret)
    .update(canonicalJson(authenticated))
    .digest();
}

export async function sealCanonical<T extends object>(
  value: T,
  purpose?: string,
): Promise<T & { integrity: string }> {
  return {
    ...value,
    integrity: (await canonicalMac(value, purpose)).toString("hex"),
  };
}

export async function authenticateCanonical<T extends { integrity: string }>(
  value: unknown,
  purpose?: string,
): Promise<T> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("integrity" in value) ||
    typeof value.integrity !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.integrity)
  ) {
    throw new CanonicalIntegrityError(
      "Canonical integrity is missing or malformed",
    );
  }
  const { integrity, ...unsealed } = value;
  const expected = await canonicalMac(unsealed, purpose);
  if (!timingSafeEqual(Buffer.from(integrity, "hex"), expected)) {
    throw new CanonicalIntegrityError("Canonical integrity check failed");
  }
  return value as T;
}

export async function sealJournal(
  journal: TransactionJournal,
): Promise<StoredTransactionJournal> {
  return sealCanonical(journal);
}

export async function authenticateJournal(
  value: unknown,
): Promise<TransactionJournal> {
  try {
    const sealed = await authenticateCanonical<StoredTransactionJournal>(value);
    const { integrity: _integrity, ...journal } = sealed;
    return journal;
  } catch (error) {
    if (error instanceof CanonicalIntegrityError) {
      throw new TransactionFault("recovery_required", error.message);
    }
    throw error;
  }
}
