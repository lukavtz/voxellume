const projectLocks = new Map<string, Promise<void>>();

export type ProjectLockRelease = () => void;

export async function acquireProjectLock(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<ProjectLockRelease | null> {
  if (signal?.aborted) return null;

  const previous = projectLocks.get(projectRoot);
  const current = Promise.withResolvers<void>();
  const tail = previous?.then(() => current.promise) ?? current.promise;
  projectLocks.set(projectRoot, tail);

  const release = () => {
    current.resolve();
    if (projectLocks.get(projectRoot) === tail)
      projectLocks.delete(projectRoot);
  };

  if (previous === undefined) return release;

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

  if (!acquired) {
    release();
    return null;
  }
  return release;
}
