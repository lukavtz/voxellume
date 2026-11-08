import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCandidate,
  type BuildCandidateOptions,
  type TransactionCandidate,
  type TransactionFaults,
  type TransactionHooks,
} from "../../src/core/spec/transactions.ts";

const fixtureRoot = fileURLToPath(
  new URL("../../fixtures/transactions/base-project/", import.meta.url),
);
const userNotes =
  "These user-owned bytes must survive every transaction outcome.\n";
const outsideNotes = "Outside bytes must survive every recovery outcome.\n";

export const sourcePath =
  "src/main/java/dev/voxellume/ruby_tools/RubyBlade.java";
export const artifactPath = "build/libs/ruby-blade.jar";
export const packSha256 =
  "68c937a859d70079d37872de761a3b78f23e4c5c5224cdcb2f7fd4ca51b7d3b8";

export type BuildOptions = BuildCandidateOptions;
export type Candidate = TransactionCandidate;
export type TreeSnapshot = Record<string, string>;

// These additive option hooks place the two otherwise unreachable faults.
export type RecoveryFaults = TransactionFaults & {
  crashBeforeApplyRename?: number;
};
export type RecoveryHooks = TransactionHooks & {
  afterDirectorySwap?: (event: {
    stagingRoot: string;
    projectRoot: string;
  }) => unknown | Promise<unknown>;
};

export interface Fixture {
  root: string;
  projectRoot: string;
  workspaceRoot: string;
  outsideRoot: string;
  modSpec: BuildOptions["modSpec"];
}

export interface CandidateOverrides {
  transactionId?: string;
  marker?: string;
  bookkeeping?: Record<string, unknown>;
  generate?: BuildOptions["generate"];
  verify?: BuildOptions["verify"];
  operations?: BuildOptions["operations"];
  signal?: AbortSignal;
  hooks?: BuildOptions["hooks"];
}

export interface TestJournal {
  schemaVersion: string;
  transactionId: string;
  projectRoot: string;
  status: string;
  baseProjectSha256: string;
  appliedFiles: string[];
  temporaryFiles: string[];
  backups: Record<string, { data: string | null }>;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

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
      assert.ok(child);
      for (const [name, hash] of Object.entries(child)) {
        snapshot[posix.join(entry.name, name)] = hash;
      }
    } else {
      assert.ok(entry.isFile(), `unexpected non-file fixture entry: ${path}`);
      snapshot[entry.name] = sha256(await readFile(path));
    }
  }
  return Object.fromEntries(
    Object.entries(snapshot).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export async function setup(
  t: TestContext,
  options: { newProject?: boolean } = {},
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-transactions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  const workspaceRoot = join(root, "transactions");
  const outsideRoot = join(root, "outside");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(outsideRoot, { recursive: true });
  await writeFile(join(outsideRoot, "sentinel.txt"), outsideNotes);
  if (!options.newProject) {
    await cp(fixtureRoot, projectRoot, { recursive: true });
    // build/ is ignored, so every checkout must create its own last-good artifact.
    await mkdir(join(projectRoot, dirname(artifactPath)), { recursive: true });
    await writeFile(
      join(projectRoot, artifactPath),
      "last-good-production-artifact\n",
    );
  }
  const modSpec = JSON.parse(
    await readFile(join(fixtureRoot, "mod-spec.json"), "utf8"),
  ) as BuildOptions["modSpec"];
  return { root, projectRoot, workspaceRoot, outsideRoot, modSpec };
}

export function generatedSource(marker: string): string {
  return `package dev.voxellume.ruby_tools;\n\npublic final class RubyBlade {\n  public static final String STATE = ${JSON.stringify(marker)};\n}\n`;
}

export function makeOptions(
  fixture: Fixture,
  options: CandidateOverrides = {},
): BuildOptions {
  const marker = options.marker ?? "candidate";
  return {
    transactionId: options.transactionId ?? "tx-fixture-0001",
    projectRoot: fixture.projectRoot,
    workspaceRoot: fixture.workspaceRoot,
    modSpec: fixture.modSpec,
    operations: options.operations ?? [],
    targetPack: {
      id: "java-fabric-1.21.1-r1",
      revision: 1,
      packSha256,
    },
    bookkeeping: options.bookkeeping ?? {
      createdAt: "2026-01-01T00:00:00.000Z",
      randomId: "random-fixture-id",
      selector: { displayName: "Ruby Blade" },
    },
    generate:
      options.generate ??
      (async ({ stagingRoot, modSpec }) => {
        assert.equal(modSpec.namespace, "ruby_tools");
        const source = join(stagingRoot, sourcePath);
        const artifact = join(stagingRoot, artifactPath);
        await mkdir(dirname(source), { recursive: true });
        await mkdir(dirname(artifact), { recursive: true });
        await writeFile(source, generatedSource(marker));
        await writeFile(artifact, `production:${marker}\n`);
        return { artifacts: [artifactPath] };
      }),
    verify: options.verify ?? (async () => ({ status: "passed" })),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
  };
}

export async function verifiedCandidate(
  fixture: Fixture,
  options: CandidateOverrides = {},
): Promise<Candidate> {
  const candidate = await buildCandidate(makeOptions(fixture, options));
  assert.equal(candidate.status, "verified", candidate.error?.detail);
  return candidate;
}

export async function readJournal(candidate: Candidate): Promise<TestJournal> {
  return JSON.parse(
    await readFile(candidate.journalPath, "utf8"),
  ) as TestJournal;
}

export async function assertOutsideBytes(fixture: Fixture): Promise<void> {
  assert.equal(
    await readFile(join(fixture.outsideRoot, "sentinel.txt"), "utf8"),
    outsideNotes,
  );
}

export async function assertUserBytes(fixture: Fixture): Promise<void> {
  assert.equal(
    await readFile(join(fixture.projectRoot, "user-notes.txt"), "utf8"),
    userNotes,
  );
}
