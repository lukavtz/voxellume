import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  createCoreOperations,
  type CoreOperations,
  type CoreOperationsOptions,
} from "../core/operations.ts";

export interface HostCoreOperationsOptions {
  readonly catalogRoot: string;
  readonly authorizedProjectRoot: string;
  readonly transactionStagingRoot: string;
  readonly verification?: CoreOperationsOptions["verification"];
}

function outsideRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path !== "" &&
    (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path))
  );
}

async function authorizeExistingPath(
  root: string,
  candidate: string,
): Promise<string> {
  const realRoot = await realpath(root);
  let realCandidate: string;
  try {
    realCandidate = await realpath(resolve(realRoot, candidate));
  } catch (error) {
    throw new Error(`Path must be an existing real path: ${candidate}`, {
      cause: error,
    });
  }
  if (outsideRoot(realRoot, realCandidate)) {
    throw new Error(
      `Path is outside the authorized project root: ${candidate}`,
    );
  }
  return realCandidate;
}

async function ensureDirectoryWithinRoot(
  projectRoot: string,
  realProjectRoot: string,
  stagingRoot: string,
): Promise<string> {
  const intended = isAbsolute(stagingRoot)
    ? resolve(realProjectRoot, relative(projectRoot, stagingRoot))
    : resolve(realProjectRoot, stagingRoot);
  if (intended === realProjectRoot || outsideRoot(realProjectRoot, intended)) {
    throw new Error("Transaction staging must remain inside the project root");
  }
  const stagingRelative = relative(realProjectRoot, intended);
  let current = realProjectRoot;
  for (const component of stagingRelative.split(sep)) {
    current = join(current, component);
    let info = await lstat(current).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (info === undefined) {
      await mkdir(current, { recursive: false });
      info = await lstat(current);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("Staging path contains a non-directory or symbolic link");
    }
  }
  const realStaging = await realpath(intended);
  if (
    realStaging === realProjectRoot ||
    outsideRoot(realProjectRoot, realStaging)
  ) {
    throw new Error("Transaction staging resolves outside the project root");
  }
  return realStaging;
}

async function authorizeScaffoldDestination(
  projectRoot: string,
  stagingRoot: string,
  candidate: string,
): Promise<string> {
  const realProjectRoot = await realpath(projectRoot);
  const realRoot = await ensureDirectoryWithinRoot(
    projectRoot,
    realProjectRoot,
    stagingRoot,
  );
  const requested = isAbsolute(candidate)
    ? resolve(realRoot, relative(stagingRoot, candidate))
    : resolve(realRoot, candidate);
  const name = relative(realRoot, requested);
  if (
    name === "" ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    isAbsolute(name)
  ) {
    throw new Error("Scaffold destination must be one staging child");
  }
  await mkdir(requested, { recursive: false }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  const realCandidate = await realpath(requested);
  if (
    dirname(realCandidate) !== realRoot ||
    !(await stat(realCandidate)).isDirectory()
  ) {
    throw new Error("Scaffold destination is not a real staging directory");
  }
  return realCandidate;
}

export function createHostCoreOperations(
  options: HostCoreOperationsOptions,
): CoreOperations {
  return createCoreOperations({
    catalogRoot: options.catalogRoot,
    authorizePath(path, usage) {
      return usage === "scaffold"
        ? authorizeScaffoldDestination(
            options.authorizedProjectRoot,
            options.transactionStagingRoot,
            path,
          )
        : authorizeExistingPath(options.authorizedProjectRoot, path);
    },
    ...(options.verification === undefined
      ? {}
      : { verification: options.verification }),
  });
}
