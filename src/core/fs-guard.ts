import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export class PathEscapeError extends Error {
  readonly code = "destination_outside_root";
  constructor(detail: string) {
    super(detail);
    this.name = "PathEscapeError";
  }
}

/**
 * Resolve a user-supplied path and prove it stays inside `root`, following
 * symlinks in every existing ancestor. Missing leaf segments are allowed.
 */
export async function resolveInsideRoot(root: string, candidate: string): Promise<string> {
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    throw new PathEscapeError(`root ${root} does not exist`);
  }
  let probe = resolve(realRoot, candidate);
  const missing: string[] = [];
  for (;;) {
    try {
      probe = await realpath(probe);
      break;
    } catch {
      const parent = dirname(probe);
      if (parent === probe) {
        throw new PathEscapeError(`cannot resolve ${candidate}`);
      }
      missing.unshift(basename(probe));
      probe = parent;
    }
  }
  const resolved = join(probe, ...missing);
  const inside = relative(realRoot, resolved);
  if (inside.startsWith("..") || isAbsolute(inside)) {
    throw new PathEscapeError(`${candidate} resolves outside the working directory`);
  }
  return resolved;
}
