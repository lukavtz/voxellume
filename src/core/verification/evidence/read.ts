import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { authenticateCanonical } from "../../spec/transactions/journal-integrity.ts";
import { transactionComponent } from "./paths.ts";
import {
  EvidenceError,
  type EvidenceManifest,
  EVIDENCE_INTEGRITY_PURPOSE,
  fail,
} from "./types.ts";

export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function walkFiles(
  root: string,
  current = root,
): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(root, absolute)));
    else if (entry.isFile()) {
      files.push(
        `${current.slice(root.length + 1)}${current === root ? "" : "/"}${entry.name}`,
      );
    } else fail("evidence_integrity", "Evidence contains a non-regular file.");
  }
  return files.sort();
}

function integrity(error: unknown): never {
  if (error instanceof EvidenceError) throw error;
  throw new EvidenceError(
    "evidence_integrity",
    "Evidence integrity validation failed.",
  );
}

export function hasReadOnlyMode(
  mode: number,
  directory: boolean,
  platform = process.platform,
): boolean {
  // Windows/libuv does not expose execute bits; read-only directories are 0444.
  const expected = platform === "win32" ? 0o444 : directory ? 0o555 : 0o444;
  return (mode & 0o777) === expected;
}

export async function readEvidence(options: {
  evidenceRoot: string;
  transactionId: string;
}): Promise<EvidenceManifest> {
  transactionComponent(options.transactionId);
  const directory = join(options.evidenceRoot, options.transactionId);
  try {
    const root = await lstat(directory);
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      !hasReadOnlyMode(root.mode, true)
    ) {
      fail("evidence_integrity", "Evidence root is invalid.");
    }
    const actual = await walkFiles(directory);
    for (const relative of actual) {
      const metadata = await lstat(join(directory, relative));
      if (!hasReadOnlyMode(metadata.mode, metadata.isDirectory())) {
        fail("evidence_integrity", "Evidence file permissions are invalid.");
      }
    }
    const checksumText = await readFile(join(directory, "SHA256SUMS"), "utf8");
    const expected = new Map<string, string>();
    for (const line of checksumText.split("\n")) {
      if (line.length === 0) continue;
      const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
      const digest = match?.[1];
      const relative = match?.[2];
      if (
        digest === undefined ||
        relative === undefined ||
        relative === "SHA256SUMS" ||
        expected.has(relative)
      ) {
        fail("evidence_integrity", "Evidence checksum manifest is invalid.");
      }
      if (
        relative.startsWith("/") ||
        relative.includes("\\") ||
        relative
          .split("/")
          .some((part) => part.length === 0 || part === "." || part === "..")
      ) {
        fail("evidence_integrity", "Evidence checksum path is invalid.");
      }
      expected.set(relative, digest);
    }
    const covered = actual.filter((path) => path !== "SHA256SUMS");
    if (
      covered.length !== expected.size ||
      covered.some((path) => !expected.has(path)) ||
      !expected.has("result.json")
    ) {
      fail("evidence_integrity", "Evidence checksum coverage is incomplete.");
    }
    for (const [relative, digest] of expected) {
      if ((await hashFile(join(directory, relative))) !== digest) {
        fail("evidence_integrity", "Evidence checksum mismatch.");
      }
    }
    const manifest = await authenticateCanonical<EvidenceManifest>(
      JSON.parse(await readFile(join(directory, "result.json"), "utf8")),
      EVIDENCE_INTEGRITY_PURPOSE,
    );
    if (manifest.transactionId !== options.transactionId) {
      fail("evidence_integrity", "Evidence transaction identity mismatch.");
    }
    const storedFiles = [
      ...manifest.artifacts,
      ...manifest.checks.flatMap((check) => check.logs),
    ];
    const storedPaths = new Set<string>();
    for (const file of storedFiles) {
      if (
        storedPaths.has(file.path) ||
        expected.get(file.path) !== file.sha256
      ) {
        fail("evidence_integrity", "Evidence stored-file identity mismatch.");
      }
      storedPaths.add(file.path);
    }
    if (storedPaths.size !== expected.size - 1) {
      fail(
        "evidence_integrity",
        "Evidence manifest file coverage is incomplete.",
      );
    }
    return manifest;
  } catch (error) {
    integrity(error);
  }
}
