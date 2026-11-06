import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, sha256 } from "../../targets/canonical-json.ts";
import type { TreeSnapshot } from "../transaction-types.ts";

export async function snapshotTree(root: string): Promise<TreeSnapshot | null> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const snapshot: TreeSnapshot = {};
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const child = await snapshotTree(path);
      if (child === null)
        throw new Error(`Directory disappeared while hashing: ${path}`);
      for (const [name, hash] of Object.entries(child)) {
        snapshot[join(entry.name, name)] = hash;
      }
    } else if (entry.isFile()) {
      snapshot[entry.name] = sha256(await readFile(path));
    } else {
      throw new Error(
        `Transaction trees may contain only regular files and directories: ${path}`,
      );
    }
  }
  return Object.fromEntries(
    Object.entries(snapshot).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function projectHash(tree: TreeSnapshot | null): string {
  return sha256(canonicalJson(Object.entries(tree ?? {})));
}

export async function copyTree(
  source: string,
  destination: string,
): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  await mkdir(destination, { recursive: false });
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyTree(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath);
    } else {
      throw new Error(`Cannot stage non-regular project entry: ${sourcePath}`);
    }
  }
}
