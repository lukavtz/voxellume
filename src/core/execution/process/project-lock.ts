import { readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

declare const capabilityBrand: unique symbol;

/** Opaque token; only the lock module can authenticate it. */
export interface ProjectLockCapability {
  readonly [capabilityBrand]: true;
}

export type ProjectLockRelease = () => void;

export interface HeldProjectLock {
  readonly key: string;
  readonly capability: ProjectLockCapability;
  readonly release: ProjectLockRelease;
}

interface CapabilityState {
  readonly key: string;
  released: boolean;
}

const projectLocks = new Map<string, Promise<void>>();
const capabilities = new WeakMap<ProjectLockCapability, CapabilityState>();

function canonicalWindowsProjectKey(projectRoot: string): string {
  let current = resolve(projectRoot).toLowerCase();
  for (let depth = 0; depth < 32; depth += 1) {
    try {
      current = resolve(dirname(current), readlinkSync(current)).toLowerCase();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EINVAL" || code === "ENOENT" || code === "ENOTDIR") {
        return current;
      }
      throw error;
    }
  }
  throw new Error("Too many symbolic links in project root");
}

export async function canonicalProjectKey(
  projectRoot: string,
): Promise<string> {
  if (process.platform === "win32") {
    return canonicalWindowsProjectKey(projectRoot);
  }
  try {
    // Keep lock acquisition off the libuv pool used by native process waits.
    return realpathSync(projectRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(realpathSync(dirname(projectRoot)), basename(projectRoot));
  }
}

export function assertHeldProjectLock(
  capability: ProjectLockCapability,
  canonicalPath: string,
): boolean {
  const state = capabilities.get(capability);
  return state?.key === canonicalPath && !state.released;
}

export async function acquireHeldProjectLock(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<HeldProjectLock | null> {
  if (signal?.aborted) return null;
  const lexicalKey =
    process.platform === "win32" ? resolve(projectRoot).toLowerCase() : null;
  const key =
    lexicalKey !== null && projectLocks.has(lexicalKey)
      ? lexicalKey
      : await canonicalProjectKey(projectRoot);
  if (signal?.aborted) return null;

  const previous = projectLocks.get(key);
  const current = Promise.withResolvers<void>();
  const tail = previous?.then(() => current.promise) ?? current.promise;
  projectLocks.set(key, tail);

  const capability = {} as ProjectLockCapability;
  const state: CapabilityState = { key, released: false };
  capabilities.set(capability, state);
  const release = () => {
    if (state.released) return;
    state.released = true;
    current.resolve();
    if (projectLocks.get(key) === tail) projectLocks.delete(key);
  };

  if (previous === undefined) return { key, capability, release };

  const wait = Promise.withResolvers<boolean>();
  let settled = false;
  const finish = (value: boolean) => {
    if (settled) return;
    settled = true;
    signal?.removeEventListener("abort", onAbort);
    wait.resolve(value);
  };
  const onAbort = () => finish(false);
  void previous.then(() => finish(true));
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const acquired = await wait.promise;

  if (!acquired || signal?.aborted) {
    release();
    return null;
  }
  return { key, capability, release };
}

export async function acquireProjectLock(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<ProjectLockRelease | null> {
  const held = await acquireHeldProjectLock(projectRoot, signal);
  return held?.release ?? null;
}
