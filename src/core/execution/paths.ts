import { isAbsolute, win32 } from "node:path";

import {
  NativeDirFdError,
  closeRoot,
  openRoot,
  readRootFile,
  resolveRootPath,
  writeRootFileAtomic,
  type NativeRoot,
  type RootFile,
  type RootRenamePaths,
} from "./fs-at.ts";

export type AuthorizedRoot = Readonly<
  | { realPath: string; kind: "project" }
  | {
      realPath: string;
      kind: "transactionStaging";
      transactionId: string;
    }
>;

export type GrantAuthorizedRootRequest =
  | { path: string; kind: "project" }
  | { path: string; kind: "transactionStaging"; transactionId: string };

export interface WriteAuthorizedFileRequest {
  readonly path: string;
  readonly contents: string | Uint8Array;
  readonly expectedRevision: string | null;
  readonly hooks?: {
    readonly beforeRename?: (paths: RootRenamePaths) => void | Promise<void>;
  };
}

export interface ArchiveEntry {
  readonly path: string;
  readonly kind: string;
  readonly linkPath?: string;
}

// The native descriptor and its authority live only in this module-private map.
// Merely copying the public fields cannot mint an authorized capability.
const authorities = new WeakMap<AuthorizedRoot, NativeRoot>();
const released = new WeakSet<AuthorizedRoot>();
const closing = new WeakMap<AuthorizedRoot, Promise<void>>();
const writers = new WeakMap<AuthorizedRoot, Promise<void>>();

function authority(root: AuthorizedRoot): NativeRoot {
  if (root === null || typeof root !== "object") {
    throw new NativeDirFdError(
      "unauthorized_root",
      "Root was not granted by the host",
    );
  }
  if (released.has(root)) {
    throw new NativeDirFdError("root_closed", "Root directory is closed");
  }
  const nativeRoot = authorities.get(root);
  if (nativeRoot === undefined) {
    throw new NativeDirFdError(
      "unauthorized_root",
      "Root was not granted by the host",
    );
  }
  return nativeRoot;
}

export async function grantAuthorizedRoot(
  request: GrantAuthorizedRootRequest,
): Promise<AuthorizedRoot> {
  const nativeRoot = openRoot(request.path);
  try {
    const root = Object.freeze(
      request.kind === "project"
        ? { realPath: nativeRoot.realPath, kind: request.kind }
        : {
            realPath: nativeRoot.realPath,
            kind: request.kind,
            transactionId: request.transactionId,
          },
    ) as AuthorizedRoot;
    authorities.set(root, nativeRoot);
    return root;
  } catch (error) {
    try {
      closeRoot(nativeRoot);
    } catch {
      // Preserve the grant failure; cleanup is best effort on this error path.
    }
    throw error;
  }
}

export async function releaseAuthorizedRoot(
  root: AuthorizedRoot,
): Promise<void> {
  const pendingClose = closing.get(root);
  if (pendingClose !== undefined) return pendingClose;
  const nativeRoot = authority(root);
  released.add(root);
  const close = (writers.get(root) ?? Promise.resolve()).then(() => {
    closeRoot(nativeRoot);
  });
  closing.set(root, close);
  return close;
}

export async function resolveAuthorizedPath(
  root: AuthorizedRoot,
  path: string,
): Promise<string> {
  return resolveRootPath(authority(root), path, { allowMissingLeaf: true });
}

export async function readAuthorizedFile(
  root: AuthorizedRoot,
  path: string,
): Promise<RootFile> {
  return readRootFile(authority(root), path);
}

export async function writeAuthorizedFile(
  root: AuthorizedRoot,
  request: WriteAuthorizedFileRequest,
): Promise<{ revision: string }> {
  authority(root);
  if (root.kind !== "transactionStaging") {
    throw new NativeDirFdError(
      "read_only_root",
      "Only transaction staging roots are writable",
    );
  }

  const previous = writers.get(root) ?? Promise.resolve();
  const result = previous.then(() =>
    writeRootFileAtomic(authority(root), {
      path: request.path,
      contents: Buffer.from(request.contents),
      expectedRevision: request.expectedRevision,
      ...(request.hooks?.beforeRename === undefined
        ? {}
        : { beforeRename: request.hooks.beforeRename }),
    }),
  );
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  writers.set(root, tail);
  try {
    return await result;
  } finally {
    if (writers.get(root) === tail) writers.delete(root);
  }
}

function validateArchivePath(path: string): void {
  if (path.length === 0 || path.includes("\0") || path.includes("\\")) {
    throw new NativeDirFdError(
      "invalid_path",
      "Archive path is empty or contains invalid characters",
    );
  }
  if (isAbsolute(path) || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
    throw new NativeDirFdError(
      "absolute_path",
      "Absolute archive paths are not allowed",
    );
  }
  const parts = path.split("/");
  if (parts.includes("..")) {
    throw new NativeDirFdError(
      "path_traversal",
      "Archive parent traversal is not allowed",
    );
  }
  if (parts.some((part) => part.length === 0 || part === ".")) {
    throw new NativeDirFdError(
      "invalid_path",
      "Archive path contains an invalid component",
    );
  }
}

export function assertSafeArchiveEntry(entry: ArchiveEntry): void {
  if (entry.kind === "hardlink") {
    throw new NativeDirFdError(
      "archive_hardlink",
      "Archive hardlinks are not allowed",
    );
  }
  validateArchivePath(entry.path);
  if (entry.kind === "symlink") {
    throw new NativeDirFdError(
      "unsafe_symlink",
      "Archive symlinks are not allowed",
    );
  }
}
