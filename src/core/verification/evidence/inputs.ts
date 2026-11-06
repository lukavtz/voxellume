import { createHash } from "node:crypto";
import { type BigIntStats, constants, createWriteStream } from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { component, transactionComponent } from "./paths.ts";
import { redactText } from "./redaction.ts";
import {
  EvidenceError,
  type EvidenceCheckInput,
  type EvidenceInputFile,
  type EvidenceStoredFile,
  type FinalizeEvidenceOptions,
  fail,
  STATUSES,
} from "./types.ts";

const MAX_LOG_BYTES = 16 * 1024 ** 2;
const MAX_EVIDENCE_BYTES = 2 * 1024 ** 3;

export interface SourceSnapshot {
  path: string;
  metadata: BigIntStats;
}

interface AuthorizedSourceRoot {
  path: string;
  canonicalPath: string;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validArgv(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((argument) => typeof argument === "string")
  );
}

const SHA256 = /^[a-f0-9]{64}$/;

function invalidSubject(): never {
  return fail("invalid_evidence_subject", "Invalid evidence check subject.");
}

function validateSubject(check: EvidenceCheckInput): void {
  const subject = check.subject;
  if (
    subject === null ||
    typeof subject !== "object" ||
    Array.isArray(subject)
  ) {
    invalidSubject();
  }
  for (const key of [
    "sourceSha256",
    "exportSha256",
    "productionJarSha256",
    "baselineSha256",
  ] as const) {
    const value = subject[key];
    if (
      value !== undefined &&
      (typeof value !== "string" || !SHA256.test(value))
    ) {
      invalidSubject();
    }
  }
  if (
    !["source", "browser", "design_review"].includes(subject.class) ||
    (subject.surface !== undefined &&
      !["blockbench", "blender", "minecraft_client"].includes(subject.surface))
  ) {
    invalidSubject();
  }
  if (subject.scenario !== undefined) {
    const scenario = subject.scenario;
    if (
      scenario === null ||
      typeof scenario !== "object" ||
      Array.isArray(scenario) ||
      typeof scenario.id !== "string" ||
      scenario.id.trim().length === 0 ||
      typeof scenario.state !== "string" ||
      scenario.state.trim().length === 0 ||
      !["state", "multiplayer", "restart"].includes(scenario.kind)
    ) {
      invalidSubject();
    }
  }
  if (subject.reviewer !== undefined) {
    const reviewer = subject.reviewer;
    if (
      reviewer === null ||
      typeof reviewer !== "object" ||
      Array.isArray(reviewer) ||
      typeof reviewer.id !== "string" ||
      reviewer.id.trim().length === 0 ||
      !Number.isInteger(reviewer.revision) ||
      reviewer.revision <= 0 ||
      typeof reviewer.rubric !== "string" ||
      reviewer.rubric.trim().length === 0 ||
      !["approved", "rejected"].includes(reviewer.decision) ||
      !["human", "stand_in"].includes(reviewer.kind)
    ) {
      invalidSubject();
    }
  }

  const required = (
    fields: (
      | "sourceSha256"
      | "exportSha256"
      | "productionJarSha256"
      | "baselineSha256"
      | "scenario"
      | "reviewer"
    )[],
  ): void => {
    if (fields.some((key) => subject[key] === undefined)) invalidSubject();
  };
  if (subject.class === "source") {
    required(["sourceSha256", "exportSha256"]);
  } else if (subject.class === "browser") {
    if (subject.surface === undefined) invalidSubject();
    if (subject.surface === "minecraft_client") {
      required(["productionJarSha256", "baselineSha256", "scenario"]);
    } else {
      required(["sourceSha256", "exportSha256"]);
    }
  } else {
    required(["sourceSha256", "exportSha256", "reviewer"]);
  }

  if (
    check.status === "passed" &&
    subject.reviewer !== undefined &&
    subject.class !== "source" &&
    (subject.reviewer.kind !== "human" ||
      subject.reviewer.decision !== "approved")
  ) {
    fail(
      "human_review_required",
      "A passed review requires an approved human reviewer.",
    );
  }
}

function validateCheck(check: EvidenceCheckInput): void {
  component(check.id, "check ID");
  if (
    typeof check.requested !== "boolean" ||
    typeof check.executed !== "boolean" ||
    !STATUSES.includes(check.status) ||
    !validArgv(check.requestedArgv) ||
    (check.executedArgv !== null && !validArgv(check.executedArgv)) ||
    (check.exitCode !== null && !Number.isInteger(check.exitCode)) ||
    !Array.isArray(check.logs)
  ) {
    fail("invalid_evidence", "Invalid check evidence.");
  }

  const { requestedArgv, executedArgv } = check;
  if (
    (!check.requested && check.executed) ||
    (check.requested && requestedArgv.length === 0) ||
    (!check.requested && requestedArgv.length !== 0) ||
    (check.executed && (executedArgv === null || executedArgv.length === 0)) ||
    (!check.executed && executedArgv !== null) ||
    (!check.executed && check.exitCode !== null) ||
    (check.exitCode === 0 && check.status !== "passed") ||
    (check.status === "passed" &&
      (!check.executed ||
        check.exitCode !== 0 ||
        executedArgv === null ||
        executedArgv.length === 0)) ||
    (check.status === "failed" && !check.executed) ||
    (check.status === "timed_out" && !check.executed) ||
    ((check.status === "unsupported" || check.status === "unavailable") &&
      check.executed)
  ) {
    fail(
      "invalid_evidence_status",
      "Execution flags, status, command, and exit code must agree.",
    );
  }
  validateSubject(check);
}

function contained(root: string, path: string): boolean {
  const child = relative(root, path);
  return (
    child === "" ||
    (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  );
}

async function assertNoSymlinkComponents(
  root: string,
  path: string,
): Promise<void> {
  const parts = relative(root, path).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) {
      fail(
        "unsafe_symlink",
        "Evidence input cannot traverse a symbolic link inside its source root.",
      );
    }
  }
}

async function snapshotSource(
  input: EvidenceInputFile,
  authorizedRoots: AuthorizedSourceRoot[],
): Promise<SourceSnapshot> {
  const path = resolve(input.path);
  const metadata = await lstat(path, { bigint: true });
  if (metadata.isSymbolicLink()) {
    fail("unsafe_symlink", "Evidence input cannot be a symbolic link.");
  }
  if (!metadata.isFile()) {
    fail("invalid_evidence_file", "Evidence input must be a regular file.");
  }

  const canonicalPath = await realpath(path);
  const lexicalRoot = authorizedRoots.find((root) =>
    contained(root.path, path),
  );
  const canonicalRoot = authorizedRoots.find((root) =>
    contained(root.canonicalPath, canonicalPath),
  );
  if (authorizedRoots.length > 0 && canonicalRoot === undefined) {
    if (lexicalRoot !== undefined) {
      await assertNoSymlinkComponents(lexicalRoot.path, path);
    }
    fail(
      "unauthorized_evidence_source",
      "Evidence input is outside every authorized source root.",
    );
  }
  if (lexicalRoot !== undefined) {
    await assertNoSymlinkComponents(lexicalRoot.path, path);
  } else if (canonicalRoot !== undefined) {
    await assertNoSymlinkComponents(canonicalRoot.canonicalPath, canonicalPath);
  }
  return { path, metadata };
}

function sameSource(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function openSource(source: SourceSnapshot): Promise<FileHandle> {
  let handle: FileHandle;
  try {
    handle = await open(source.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    fail("evidence_source_changed", "Evidence input changed before copying.");
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameSource(source.metadata, opened)) {
      fail("evidence_source_changed", "Evidence input changed before copying.");
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertSourceUnchanged(
  handle: FileHandle,
  source: SourceSnapshot,
): Promise<void> {
  const current = await handle.stat({ bigint: true });
  if (!sameSource(source.metadata, current)) {
    fail("evidence_source_changed", "Evidence input changed while copying.");
  }
}

function validateHashes(options: FinalizeEvidenceOptions): void {
  for (const value of [
    options.baseProjectSha256,
    options.modSpecSha256,
    options.targetPackSha256,
    options.finalTreeSha256,
  ]) {
    if (!/^[0-9a-f]{64}$/.test(value)) {
      fail(
        "invalid_evidence",
        "Evidence identity hashes must be SHA-256 hex digests.",
      );
    }
  }
}

export async function preflight(
  options: FinalizeEvidenceOptions,
): Promise<Map<EvidenceInputFile, SourceSnapshot>> {
  transactionComponent(options.transactionId);
  validateHashes(options);
  if (!Array.isArray(options.checks) || !Array.isArray(options.artifacts)) {
    fail("invalid_evidence", "Checks and artifacts must be arrays.");
  }
  if (
    !Array.isArray(options.secretValues) ||
    options.secretValues.some(
      (secret) => typeof secret !== "string" || secret.length === 0,
    )
  ) {
    fail("invalid_evidence", "Secret values must be non-empty strings.");
  }

  const destinations = new Set<string>();
  const files: {
    input: EvidenceInputFile;
    destination: string;
    log: boolean;
  }[] = [];
  for (const check of options.checks) {
    validateCheck(check);
    for (const log of check.logs) {
      component(log.name, "log name");
      files.push({
        input: log,
        destination: `checks/${check.id}/${log.name}`,
        log: true,
      });
    }
  }
  for (const artifact of options.artifacts) {
    component(artifact.name, "artifact name");
    files.push({
      input: artifact,
      destination: `artifacts/${artifact.name}`,
      log: false,
    });
  }

  if (!Array.isArray(options.sourceRoots) || options.sourceRoots.length === 0) {
    fail("invalid_evidence", "At least one evidence source root is required.");
  }
  const authorizedRoots = await Promise.all(
    options.sourceRoots.map(async (root) => ({
      path: resolve(root),
      canonicalPath: await realpath(root),
    })),
  );
  const snapshots = new Map<EvidenceInputFile, SourceSnapshot>();
  let total = 0;
  for (const file of files) {
    if (destinations.has(file.destination)) {
      fail("invalid_evidence_path", "Evidence output paths must be unique.");
    }
    destinations.add(file.destination);
    const source = await snapshotSource(file.input, authorizedRoots);
    snapshots.set(file.input, source);
    if (file.log && source.metadata.size > BigInt(MAX_LOG_BYTES)) {
      fail("output_limit_exceeded", "A process log exceeds the 16 MiB limit.");
    }
    total += Number(source.metadata.size);
    if (total > MAX_EVIDENCE_BYTES) {
      fail("evidence_limit_exceeded", "Evidence exceeds the 2 GiB limit.");
    }
  }
  return snapshots;
}

export async function writeLog(
  source: SourceSnapshot,
  destination: string,
  secrets: string[],
  budget: { bytes: number },
): Promise<EvidenceStoredFile> {
  const handle = await openSource(source);
  try {
    const input = await readFile(handle);
    if (input.byteLength > MAX_LOG_BYTES) {
      fail("output_limit_exceeded", "A process log exceeds the 16 MiB limit.");
    }
    const output = Buffer.from(
      redactText(input.toString("utf8"), secrets),
      "utf8",
    );
    if (output.byteLength > MAX_LOG_BYTES) {
      fail(
        "output_limit_exceeded",
        "A redacted process log exceeds the 16 MiB limit.",
      );
    }
    budget.bytes += output.byteLength;
    if (budget.bytes > MAX_EVIDENCE_BYTES) {
      fail("evidence_limit_exceeded", "Evidence exceeds the 2 GiB limit.");
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, output, { flag: "wx", mode: 0o600 });
    await assertSourceUnchanged(handle, source);
    return {
      name: basename(destination),
      path: "",
      sizeBytes: output.byteLength,
      sha256: sha256(output),
    };
  } finally {
    await handle.close();
  }
}

export async function copyArtifact(
  source: SourceSnapshot,
  destination: string,
  secrets: Buffer[],
  budget: { bytes: number },
): Promise<{ sizeBytes: number; sha256: string }> {
  await mkdir(dirname(destination), { recursive: true });
  const handle = await openSource(source);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  let tail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const longestSecret = secrets.reduce(
    (longest, secret) => Math.max(longest, secret.length),
    0,
  );
  try {
    const input = handle.createReadStream({ autoClose: false });
    const scanner = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const searchable =
          tail.length === 0 ? bytes : Buffer.concat([tail, bytes]);
        if (secrets.some((secret) => searchable.includes(secret))) {
          callback(
            new EvidenceError(
              "secret_in_artifact",
              "Artifact contains a secret.",
            ),
          );
          return;
        }
        sizeBytes += bytes.length;
        budget.bytes += bytes.length;
        if (budget.bytes > MAX_EVIDENCE_BYTES) {
          callback(
            new EvidenceError(
              "evidence_limit_exceeded",
              "Evidence exceeds the 2 GiB limit.",
            ),
          );
          return;
        }
        hash.update(bytes);
        tail =
          longestSecret <= 1
            ? Buffer.alloc(0)
            : searchable.subarray(
                Math.max(0, searchable.length - longestSecret + 1),
              );
        callback(null, bytes);
      },
    });
    await pipeline(
      input,
      scanner,
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    );
    await assertSourceUnchanged(handle, source);
  } finally {
    await handle.close();
  }
  return { sizeBytes, sha256: hash.digest("hex") };
}
