import { realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import { CodedError } from "./errors.ts";

export { CodedError as PathEscapeError };

const ESCAPE_CODE = "destination_outside_root";

/** True when `error` is the path-escape failure. */
export function isPathEscape(error: unknown): boolean {
  return error instanceof CodedError && error.code === ESCAPE_CODE;
}

const UNC_PREFIX = /^\\\\/;
const DRIVE_PREFIX = /^[A-Za-z]:/;

/** Coded failure for a path that leaves the working directory. */
function outside(detail: string): CodedError {
  return new CodedError(ESCAPE_CODE, detail);
}

/** Path as shown to the caller: relative to the root, never a host absolute path. */
function displayPath(root: string, candidate: string): string {
  const shown = relative(root, resolve(root, candidate));
  return shown === "" ? "." : shown;
}

/** Reject a UNC or drive-qualified path that resolves outside the root. */
function rejectOutsideLexical(lexicalRoot: string, candidate: string): void {
  const shown = displayPath(lexicalRoot, candidate);
  if (!(shown.startsWith("..") || isAbsolute(shown))) return;
  if (UNC_PREFIX.test(candidate) || DRIVE_PREFIX.test(candidate)) {
    throw outside(`${shown} is outside the working directory`);
  }
}

async function realRootOf(root: string): Promise<string> {
  try {
    return await realpath(root);
  } catch {
    throw outside("root does not exist");
  }
}

/** Resolve through the deepest existing ancestor and re-append missing segments. */
async function resolveThroughAncestors(
  realRoot: string,
  candidate: string,
): Promise<string> {
  let probe = resolve(realRoot, candidate);
  const missing: string[] = [];
  for (;;) {
    try {
      return join(await realpath(probe), ...missing);
    } catch {
      const parent = dirname(probe);
      if (parent === probe) {
        throw outside(`cannot resolve ${basename(candidate)}`);
      }
      missing.unshift(basename(probe));
      probe = parent;
    }
  }
}

/**
 * Resolve a user-supplied path and prove it stays inside `root`, following
 * symlinks in every existing ancestor. Missing leaf segments are allowed.
 */
export async function resolveInsideRoot(
  root: string,
  candidate: string,
): Promise<string> {
  const lexicalRoot = resolve(root);
  rejectOutsideLexical(lexicalRoot, candidate);
  const realRoot = await realRootOf(root);
  const resolved = await resolveThroughAncestors(realRoot, candidate);
  const inside = relative(realRoot, resolved);
  if (inside.startsWith("..") || isAbsolute(inside)) {
    throw outside(
      `${displayPath(realRoot, resolved)} is outside the working directory`,
    );
  }
  return resolved;
}
