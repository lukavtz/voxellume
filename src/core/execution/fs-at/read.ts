import { readFileSync } from "node:fs";
import { join } from "node:path";

import { closeQuietly, statFd, wrapNodeError } from "./native.ts";
import { openLeaf, root, validatePath } from "./root.ts";
import {
  NativeDirFdError,
  type NativeRoot,
  type RootFile,
  type RootStat,
} from "./types.ts";

export function resolvePosixRootPath(
  rootValue: NativeRoot,
  path: string,
  options: { allowMissingLeaf?: boolean } = {},
): string {
  const openedRoot = root(rootValue);
  try {
    statPosixRootFile(openedRoot, path);
  } catch (error) {
    if (
      !options.allowMissingLeaf ||
      !(error instanceof NativeDirFdError) ||
      error.code !== "not_found"
    ) {
      throw error;
    }
  }
  return join(openedRoot.realPath, ...validatePath(path));
}

export function statPosixRootFile(
  rootValue: NativeRoot,
  path: string,
): RootStat {
  const leaf = openLeaf(rootValue, path);
  if (leaf.fd === null) {
    closeQuietly(leaf.parentFd);
    throw new NativeDirFdError("not_found", `File does not exist: ${path}`);
  }
  try {
    return statFd(leaf.fd);
  } catch (error) {
    throw wrapNodeError(error, "fstat", path);
  } finally {
    closeQuietly(leaf.fd);
    closeQuietly(leaf.parentFd);
  }
}

export function readPosixRootFile(
  rootValue: NativeRoot,
  path: string,
): RootFile {
  const leaf = openLeaf(rootValue, path);
  if (leaf.fd === null) {
    closeQuietly(leaf.parentFd);
    throw new NativeDirFdError("not_found", `File does not exist: ${path}`);
  }
  try {
    const before = statFd(leaf.fd);
    if (before.kind !== "file") {
      throw new NativeDirFdError(
        "not_regular_file",
        `Not a regular file: ${path}`,
      );
    }
    const contents = readFileSync(leaf.fd);
    const stat = statFd(leaf.fd);
    if (stat.revision !== before.revision) {
      throw new NativeDirFdError(
        "revision_conflict",
        `File changed while reading: ${path}`,
      );
    }
    return { contents, revision: stat.revision, stat };
  } catch (error) {
    throw wrapNodeError(error, "read", path);
  } finally {
    closeQuietly(leaf.fd);
    closeQuietly(leaf.parentFd);
  }
}
