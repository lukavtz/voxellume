import { closeSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

import {
  closeQuietly,
  DIRECTORY_FLAGS,
  LEAF_FLAGS,
  openAt,
  wrapNodeError,
} from "./native.ts";
import { backend } from "./probe.ts";
import { NativeDirFdError, type NativeRoot } from "./types.ts";

class Root {
  readonly realPath: string;
  readonly fd: number;
  closed = false;

  constructor(realPath: string, fd: number) {
    this.realPath = realPath;
    this.fd = fd;
  }
}

export function root(value: NativeRoot): Root {
  if (!(value instanceof Root)) {
    throw new NativeDirFdError(
      "unauthorized_root",
      "Root was not opened by openRoot",
    );
  }
  if (value.closed) {
    throw new NativeDirFdError("root_closed", "Root directory is closed");
  }
  return value;
}

export function validatePath(path: string): string[] {
  if (path.length === 0 || path.includes("\0")) {
    throw new NativeDirFdError("invalid_path", "Path is empty or contains NUL");
  }
  if (isAbsolute(path)) {
    throw new NativeDirFdError(
      "absolute_path",
      "Absolute paths are not allowed",
    );
  }
  if (Buffer.byteLength(path) > 4096) {
    throw new NativeDirFdError("invalid_path", "Path exceeds 4096 bytes");
  }

  const parts = path.split("/");
  for (const part of parts) {
    if (part === "..") {
      throw new NativeDirFdError(
        "path_traversal",
        "Parent traversal is not allowed",
      );
    }
    if (part.length === 0 || part === "." || Buffer.byteLength(part) > 255) {
      throw new NativeDirFdError(
        "invalid_path",
        "Path contains an invalid component",
      );
    }
  }
  return parts;
}

export function openParent(
  rootValue: NativeRoot,
  parts: readonly string[],
): number {
  const openedRoot = root(rootValue);
  const native = backend();
  let fd = openAt(
    native,
    openedRoot.fd,
    ".",
    DIRECTORY_FLAGS,
    "missing_parent",
  )!;
  try {
    for (let index = 0; index < parts.length - 1; index += 1) {
      const next = openAt(
        native,
        fd,
        parts[index]!,
        DIRECTORY_FLAGS,
        "missing_parent",
      )!;
      closeQuietly(fd);
      fd = next;
    }
    return fd;
  } catch (error) {
    closeQuietly(fd);
    throw error;
  }
}

export function openLeaf(
  rootValue: NativeRoot,
  path: string,
  allowMissing = false,
): { parentFd: number; fd: number | null; base: string; parts: string[] } {
  const parts = validatePath(path);
  const parentFd = openParent(rootValue, parts);
  const base = parts.at(-1)!;
  try {
    const fd = openAt(
      backend(),
      parentFd,
      base,
      LEAF_FLAGS,
      "not_found",
      allowMissing,
    );
    return { parentFd, fd, base, parts };
  } catch (error) {
    closeQuietly(parentFd);
    throw error;
  }
}

export function openPosixRoot(rootPath: string): NativeRoot {
  const native = backend();
  let realPath: string;
  try {
    realPath = realpathSync(rootPath);
  } catch (error) {
    throw wrapNodeError(error, "realpath", rootPath);
  }

  // Pin the real root by walking from the filesystem root, never by a mutable
  // path after this point. A later rename/swap cannot redirect this descriptor.
  let fd = openAt(native, 0, "/", DIRECTORY_FLAGS, "invalid_root")!;
  try {
    for (const part of realPath.split("/").filter(Boolean)) {
      const next = openAt(native, fd, part, DIRECTORY_FLAGS, "invalid_root")!;
      closeQuietly(fd);
      fd = next;
    }
    return new Root(realPath, fd);
  } catch (error) {
    closeQuietly(fd);
    throw error;
  }
}

export function closePosixRoot(rootValue: NativeRoot): void {
  const openedRoot = root(rootValue);
  openedRoot.closed = true;
  closeSync(openedRoot.fd);
}
