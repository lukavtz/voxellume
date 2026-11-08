import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { sealCanonical } from "../../spec/transactions/journal-integrity.ts";
import { copyArtifact, preflight, writeLog } from "./inputs.ts";
import { assertEvidenceRoot } from "./paths.ts";
import { hashFile, walkFiles } from "./read.ts";
import { redactText, redactValue } from "./redaction.ts";
import {
  type EvidenceCheck,
  type EvidenceCheckSubject,
  type EvidenceManifest,
  type EvidenceStoredFile,
  type FinalizeEvidenceOptions,
  EVIDENCE_INTEGRITY_PURPOSE,
  fail,
} from "./types.ts";

const MAX_EVIDENCE_BYTES = 2 * 1024 ** 3;

async function makeFilesReadOnly(root: string, current = root): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) await makeFilesReadOnly(root, path);
    else await chmod(path, 0o444);
  }
}

async function makeDirectoriesReadOnly(
  root: string,
  current = root,
): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) await makeDirectoriesReadOnly(root, path);
  }
  await chmod(current, 0o555);
}

async function removeStaging(path: string): Promise<void> {
  try {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await removeStaging(join(path, entry.name));
    }
    await chmod(path, 0o700);
  } catch {
    // The staging directory may not have been created yet.
  }
  await rm(path, { recursive: true, force: true }).catch(() => {});
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
    fail("evidence_exists", "Final evidence already exists.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function publishEvidence(
  options: FinalizeEvidenceOptions,
): Promise<EvidenceManifest> {
  const sources = await preflight(options);
  await assertEvidenceRoot(options.evidenceRoot, options.agentWritableRoots);
  await mkdir(options.evidenceRoot, { recursive: true });
  await assertEvidenceRoot(options.evidenceRoot, options.agentWritableRoots);

  const finalDirectory = join(options.evidenceRoot, options.transactionId);
  const lockDirectory = `${finalDirectory}.lock`;
  await mkdir(lockDirectory);
  let staging = "";
  let published = false;
  try {
    await assertAbsent(finalDirectory);
    staging = await mkdtemp(
      join(options.evidenceRoot, `.${options.transactionId}.`),
    );
    const secrets = [...new Set(options.secretValues)].sort(
      (a, b) => b.length - a.length,
    );
    const secretBytes = secrets.map((secret) => Buffer.from(secret, "utf8"));
    const budget = { bytes: 0 };
    const checks: EvidenceCheck[] = [];

    for (const input of options.checks) {
      const logs: EvidenceStoredFile[] = [];
      for (const log of input.logs) {
        const relative = `checks/${input.id}/${log.name}`;
        const stored = await writeLog(
          sources.get(log)!,
          join(staging, relative),
          secrets,
          budget,
        );
        stored.path = relative;
        stored.name = log.name;
        logs.push(stored);
      }
      const check: EvidenceCheck = {
        id: input.id,
        requested: input.requested,
        executed: input.executed,
        status: input.status,
        requestedArgv: input.requestedArgv.map((argument) =>
          redactText(argument, secrets),
        ),
        executedArgv:
          input.executedArgv === null
            ? null
            : input.executedArgv.map((argument) =>
                redactText(argument, secrets),
              ),
        exitCode: input.exitCode,
        subject: redactValue(input.subject, secrets) as EvidenceCheckSubject,
        logs,
      };
      checks.push(check);
    }

    const artifacts: EvidenceStoredFile[] = [];
    for (const artifact of options.artifacts) {
      const relative = `artifacts/${artifact.name}`;
      const stored = await copyArtifact(
        sources.get(artifact)!,
        join(staging, relative),
        secretBytes,
        budget,
      );
      artifacts.push({ name: artifact.name, path: relative, ...stored });
    }

    const unsignedManifest: Omit<EvidenceManifest, "integrity"> = {
      transactionId: options.transactionId,
      baseProjectSha256: options.baseProjectSha256,
      modSpecSha256: options.modSpecSha256,
      targetPackSha256: options.targetPackSha256,
      finalTreeSha256: options.finalTreeSha256,
      environment: redactValue(options.environment, secrets) as Record<
        string,
        unknown
      >,
      checks,
      artifacts,
    };
    const manifest = await sealCanonical(
      unsignedManifest,
      EVIDENCE_INTEGRITY_PURPOSE,
    );
    const result = Buffer.from(
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    if (secretBytes.some((secret) => result.includes(secret))) {
      fail("secret_in_metadata", "Evidence metadata contains a secret.");
    }
    budget.bytes += result.byteLength;
    if (budget.bytes > MAX_EVIDENCE_BYTES) {
      fail("evidence_limit_exceeded", "Evidence exceeds the 2 GiB limit.");
    }
    await writeFile(join(staging, "result.json"), result, {
      flag: "wx",
      mode: 0o600,
    });

    const files = (await walkFiles(staging)).filter(
      (path) => path !== "SHA256SUMS",
    );
    const checksumLines: string[] = [];
    for (const path of files) {
      checksumLines.push(`${await hashFile(join(staging, path))}  ${path}`);
    }
    const checksums = `${checksumLines.join("\n")}\n`;
    budget.bytes += Buffer.byteLength(checksums);
    if (budget.bytes > MAX_EVIDENCE_BYTES) {
      fail("evidence_limit_exceeded", "Evidence exceeds the 2 GiB limit.");
    }
    await writeFile(join(staging, "SHA256SUMS"), checksums, {
      flag: "wx",
      mode: 0o600,
    });

    await makeFilesReadOnly(staging);
    await assertAbsent(finalDirectory);
    await rename(staging, finalDirectory);
    try {
      await makeDirectoriesReadOnly(finalDirectory);
      published = true;
    } catch (error) {
      await removeStaging(finalDirectory);
      throw error;
    }
    return manifest;
  } finally {
    if (!published) await removeStaging(staging);
    await rm(lockDirectory, { recursive: true, force: true });
  }
}

export function finalizeEvidence(
  options: FinalizeEvidenceOptions,
): Promise<EvidenceManifest> {
  const result = publishEvidence(options);
  // A concurrent source mutation can fail finalization before the caller attaches
  // its rejection handler. Observe that rejection without changing the result.
  void result.catch(() => {});
  return result;
}
