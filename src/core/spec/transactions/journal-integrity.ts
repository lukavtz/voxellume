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

async function journalMac(journal: TransactionJournal): Promise<Buffer> {
  const secret = await loadJournalSecret();
  return createHmac("sha256", secret).update(canonicalJson(journal)).digest();
}

export async function sealJournal(
  journal: TransactionJournal,
): Promise<StoredTransactionJournal> {
  return { ...journal, integrity: (await journalMac(journal)).toString("hex") };
}

export async function authenticateJournal(
  value: unknown,
): Promise<TransactionJournal> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("integrity" in value) ||
    typeof value.integrity !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.integrity)
  ) {
    throw new TransactionFault(
      "recovery_required",
      "Transaction journal integrity is missing or malformed",
    );
  }
  const { integrity, ...journal } = value;
  const expected = await journalMac(journal as TransactionJournal);
  if (!timingSafeEqual(Buffer.from(integrity, "hex"), expected)) {
    throw new TransactionFault(
      "recovery_required",
      "Transaction journal integrity check failed",
    );
  }
  return journal as TransactionJournal;
}
