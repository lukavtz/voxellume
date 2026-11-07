import {
  acquireHeldProjectLock,
  canonicalProjectKey,
} from "../../execution/process/project-lock.ts";

export { canonicalProjectKey };

export async function acquireProjectLock(
  projectRoot: string,
): Promise<() => void> {
  const held = await acquireHeldProjectLock(projectRoot);
  if (held === null) throw new Error("Project lock acquisition was cancelled");
  return held.release;
}
