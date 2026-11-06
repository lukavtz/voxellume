import { realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const projectLocks = new Map<string, Promise<void>>();

export async function canonicalProjectKey(
  projectRoot: string,
): Promise<string> {
  try {
    return await realpath(projectRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(await realpath(dirname(projectRoot)), basename(projectRoot));
  }
}

export async function acquireProjectLock(
  projectRoot: string,
): Promise<() => void> {
  const key = await canonicalProjectKey(projectRoot);
  const previous = projectLocks.get(key) ?? Promise.resolve();
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  const tail = previous.then(() => held);
  projectLocks.set(key, tail);
  await previous;
  return () => {
    release();
    if (projectLocks.get(key) === tail) projectLocks.delete(key);
  };
}
