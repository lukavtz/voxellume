import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { win32 } from "node:path";

import { TransactionFault } from "./state.ts";

let temporaryFileCounter = 0;

export function validateTransactionId(value: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new Error("transactionId must be a stable filename-safe identifier");
  }
}

export function safeRelativePath(value: string): string {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    throw new Error(
      `Invalid relative transaction path: ${JSON.stringify(value)}`,
    );
  }
  const normalized = value.split("/").join(sep);
  const parts = normalized.split(sep);
  if (
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new Error(
      `Transaction path escapes its root: ${JSON.stringify(value)}`,
    );
  }
  return normalized;
}

export function containedPath(root: string, value: string): string {
  const relativePath = safeRelativePath(value);
  const rootPath = resolve(root);
  const destination = resolve(rootPath, relativePath);
  const relation = relative(rootPath, destination);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error(
      `Transaction path escapes its root: ${JSON.stringify(value)}`,
    );
  }
  return destination;
}

export async function assertSafeDirectory(path: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    throw new TransactionFault(
      "unsafe_path",
      `Transaction root is unavailable: ${path}`,
    );
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new TransactionFault(
      "unsafe_path",
      `Transaction root is not a real directory: ${path}`,
    );
  }
}

export async function assertSafePath(
  root: string,
  value: string,
  allowMissing: boolean,
): Promise<string> {
  const destination = containedPath(root, value);
  await assertSafeDirectory(root);
  const parts = safeRelativePath(value).split(sep);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return destination;
      }
      throw new TransactionFault(
        "unsafe_path",
        `Transaction path is unavailable: ${current}`,
      );
    }
    if (
      info.isSymbolicLink() ||
      (current !== destination && !info.isDirectory())
    ) {
      throw new TransactionFault(
        "unsafe_path",
        `Transaction path crosses a link or non-directory: ${current}`,
      );
    }
    if (current === destination && !info.isFile()) {
      throw new TransactionFault(
        "unsafe_path",
        `Transaction target is not a regular file: ${current}`,
      );
    }
  }
  return destination;
}

export async function readSafeFile(
  root: string,
  value: string,
  allowMissing = false,
): Promise<Buffer | null> {
  const path = await assertSafePath(root, value, allowMissing);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT")
      return null;
    throw new TransactionFault(
      "unsafe_path",
      `Cannot safely read transaction file: ${path}`,
    );
  }
  try {
    const opened = await handle.stat();
    const pathInfo = await lstat(path);
    if (
      !opened.isFile() ||
      opened.dev !== pathInfo.dev ||
      opened.ino !== pathInfo.ino
    ) {
      throw new TransactionFault(
        "unsafe_path",
        `Transaction source identity changed: ${path}`,
      );
    }
    const canonicalRoot = await realpath(root);
    const canonicalPath = await realpath(path);
    const relation = relative(canonicalRoot, canonicalPath);
    if (
      relation === ".." ||
      relation.startsWith(`..${sep}`) ||
      isAbsolute(relation)
    ) {
      throw new TransactionFault(
        "unsafe_path",
        `Opened source escapes its transaction root: ${path}`,
      );
    }
    await assertSafePath(root, value, false);
    const afterCheck = await lstat(path);
    if (afterCheck.dev !== opened.dev || afterCheck.ino !== opened.ino) {
      throw new TransactionFault(
        "unsafe_path",
        `Transaction source changed during validation: ${path}`,
      );
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export function pathsOverlap(left: string, right: string): boolean {
  const relation = relative(resolve(left), resolve(right));
  return (
    relation === "" ||
    (!relation.startsWith(`..${sep}`) &&
      relation !== ".." &&
      !isAbsolute(relation))
  );
}

export function temporaryPath(path: string): string {
  temporaryFileCounter += 1;
  return join(
    dirname(path),
    `.${basename(path)}.voxellume-${process.pid}-${temporaryFileCounter}.tmp`,
  );
}

export async function atomicWrite(
  path: string,
  contents: string | Uint8Array,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = temporaryPath(path);
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
