import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  loadApprovals,
  recordEulaApproval,
  recordNetworkApproval,
} from "../../src/core/execution/approvals.ts";
import {
  grantAuthorizedRoot,
  readAuthorizedFile,
  releaseAuthorizedRoot,
  writeAuthorizedFile,
} from "../../src/core/execution/paths.ts";
import {
  finalizeEvidence,
  readEvidence,
  type EvidenceCheckInput,
  type EvidenceManifest,
  type FinalizeEvidenceOptions,
} from "../../src/core/verification/evidence.ts";

type HardenedEvidenceCheckInput = Omit<EvidenceCheckInput, "argv"> & {
  requestedArgv: string[];
  executedArgv: string[] | null;
};

type HardenedFinalizeEvidenceOptions = Omit<
  FinalizeEvidenceOptions,
  "checks"
> & {
  sourceRoots: string[];
  checks: HardenedEvidenceCheckInput[];
};

interface EvidenceFixture {
  root: string;
  projectRoot: string;
  inputRoot: string;
  outsideRoot: string;
  evidenceRoot: string;
}

interface HardenedEvidenceFixture extends EvidenceFixture {
  options: HardenedFinalizeEvidenceOptions;
}

const eulaUrl = "https://aka.ms/MinecraftEULA";
const approvedAt = "2026-11-06T12:00:00.000Z";

async function makeWritableTree(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await makeWritableTree(child);
    await chmod(child, entry.isDirectory() ? 0o755 : 0o644);
  }
  await chmod(path, 0o755);
}

async function setupEvidence(t: TestContext): Promise<EvidenceFixture> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-evidence-hardening-"));
  t.after(async () => {
    await makeWritableTree(root);
    await rm(root, { recursive: true, force: true });
  });
  const projectRoot = join(root, "project");
  const inputRoot = join(root, "input");
  const outsideRoot = join(root, "outside");
  const evidenceRoot = join(root, "supervisor", "evidence");
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(inputRoot, { recursive: true }),
    mkdir(outsideRoot, { recursive: true }),
  ]);
  return { root, projectRoot, inputRoot, outsideRoot, evidenceRoot };
}

async function evidenceOptions(
  t: TestContext,
): Promise<HardenedEvidenceFixture> {
  const fixture = await setupEvidence(t);
  const logPath = join(fixture.inputRoot, "build.log");
  const artifactPath = join(fixture.inputRoot, "ruby-blade.jar");
  await writeFile(logPath, "BUILD SUCCESSFUL\n");
  await writeFile(artifactPath, "production jar bytes\n");
  return {
    ...fixture,
    options: {
      evidenceRoot: fixture.evidenceRoot,
      agentWritableRoots: [fixture.projectRoot],
      sourceRoots: [fixture.inputRoot],
      transactionId: "transaction-01",
      baseProjectSha256: "a".repeat(64),
      modSpecSha256: "b".repeat(64),
      targetPackSha256: "c".repeat(64),
      finalTreeSha256: "d".repeat(64),
      environment: { os: "linux", arch: "x64", javaVersion: "21" },
      checks: [
        {
          id: "build",
          requested: true,
          executed: true,
          status: "passed" as const,
          requestedArgv: ["./gradlew", "clean", "build"],
          executedArgv: ["./gradlew", "--no-daemon", "clean", "build"],
          exitCode: 0,
          subject: {
            class: "source",
            sourceSha256: "1".repeat(64),
            exportSha256: "2".repeat(64),
          },
          logs: [{ name: "stdout.log", path: logPath }],
        },
      ],
      artifacts: [{ name: "ruby-blade.jar", path: artifactPath }],
      secretValues: [],
    },
  };
}

async function assertNoEvidence(options: {
  evidenceRoot: string;
  transactionId: string;
}): Promise<void> {
  await assert.rejects(
    stat(join(options.evidenceRoot, options.transactionId)),
    { code: "ENOENT" },
  );
}

async function tamperManifest(
  options: FinalizeEvidenceOptions,
  mutate: (manifest: EvidenceManifest) => void,
): Promise<void> {
  const directory = join(options.evidenceRoot, options.transactionId);
  const resultPath = join(directory, "result.json");
  const checksumsPath = join(directory, "SHA256SUMS");
  await chmod(resultPath, 0o644);
  await chmod(checksumsPath, 0o644);
  const manifest = JSON.parse(
    await readFile(resultPath, "utf8"),
  ) as EvidenceManifest;
  mutate(manifest);
  const result = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(resultPath, result);
  const digest = createHash("sha256").update(result).digest("hex");
  const checksums = (await readFile(checksumsPath, "utf8"))
    .split("\n")
    .map((line) =>
      line.endsWith("  result.json") ? `${digest}  result.json` : line,
    )
    .join("\n");
  await writeFile(checksumsPath, checksums);
  await chmod(resultPath, 0o444);
  await chmod(checksumsPath, 0o444);
}

async function waitForStagingEntry(
  options: { evidenceRoot: string; transactionId: string },
  basename: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const entries = await readdir(options.evidenceRoot, {
      recursive: true,
    }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    if (
      entries.some(
        (entry) =>
          entry.startsWith(`.${options.transactionId}.`) &&
          entry.endsWith(basename),
      )
    ) {
      return;
    }
    if (Date.now() >= deadline) {
      assert.fail(`Timed out waiting for staging entry ${basename}.`);
    }
    await delay(1);
  }
}

test("artifact sources reject outside roots and symlink escapes before publication", async (t) => {
  await t.test("outside an authorized source root", async (t) => {
    const fixture = await evidenceOptions(t);
    const { options } = fixture;
    const outside = join(fixture.outsideRoot, "outside.jar");
    await writeFile(outside, "outside artifact\n");
    options.artifacts[0]!.path = outside;

    await assert.rejects(finalizeEvidence(options), {
      code: "unauthorized_evidence_source",
    });
    await assertNoEvidence(options);
  });

  await t.test("a symlink inside an authorized source root", async (t) => {
    const fixture = await evidenceOptions(t);
    const { options } = fixture;
    const outside = join(fixture.outsideRoot, "outside.jar");
    const linked = join(fixture.inputRoot, "linked.jar");
    await writeFile(outside, "outside artifact\n");
    await symlink(outside, linked);
    options.artifacts[0]!.path = linked;

    await assert.rejects(finalizeEvidence(options), { code: "unsafe_symlink" });
    await assertNoEvidence(options);
  });
});

test("an artifact swapped after preflight invalidates evidence", async (t) => {
  const { inputRoot, options } = await evidenceOptions(t);
  const artifact = options.artifacts[0]!.path;
  const retired = join(inputRoot, "retired.jar");
  await writeFile(
    options.checks[0]!.logs[0]!.path,
    Buffer.alloc(16 * 1024 ** 2, 0x61),
  );

  const finalizing = finalizeEvidence(options);
  await waitForStagingEntry(options, "stdout.log");
  await rename(artifact, retired);
  await writeFile(artifact, "replacement artifact\n");

  await assert.rejects(finalizing, { code: "evidence_source_changed" });
  await assertNoEvidence(options);
});

test("an artifact modified during copying cannot produce torn evidence", async (t) => {
  const { options } = await evidenceOptions(t);
  const artifact = options.artifacts[0]!.path;
  await writeFile(artifact, Buffer.alloc(64 * 1024 ** 2, 0x61));

  const finalizing = finalizeEvidence(options);
  await waitForStagingEntry(options, "ruby-blade.jar");
  await writeFile(artifact, Buffer.alloc(64 * 1024 ** 2, 0x62));

  await assert.rejects(finalizing, { code: "evidence_source_changed" });
  await assertNoEvidence(options);
});

test("authorized-root release is idempotent and does not close independent grants", async (t) => {
  const rootPath = await mkdtemp(join(tmpdir(), "voxellume-root-release-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  await writeFile(join(rootPath, "file.txt"), "contents\n");
  const first = await grantAuthorizedRoot({ path: rootPath, kind: "project" });
  const second = await grantAuthorizedRoot({ path: rootPath, kind: "project" });
  t.after(() => releaseAuthorizedRoot(first));
  t.after(() => releaseAuthorizedRoot(second));

  await releaseAuthorizedRoot(first);
  await releaseAuthorizedRoot(first);
  await assert.rejects(readAuthorizedFile(first, "file.txt"), {
    code: "root_closed",
  });
  assert.equal(
    (await readAuthorizedFile(second, "file.txt")).contents.toString("utf8"),
    "contents\n",
  );
});

test("evidence preserves distinct requested and executed command records", async (t) => {
  const { options } = await evidenceOptions(t);
  const manifest = await finalizeEvidence(options);

  assert.deepEqual(manifest.checks[0], {
    id: "build",
    requested: true,
    executed: true,
    status: "passed",
    requestedArgv: ["./gradlew", "clean", "build"],
    executedArgv: ["./gradlew", "--no-daemon", "clean", "build"],
    exitCode: 0,
    subject: {
      class: "source",
      sourceSha256: "1".repeat(64),
      exportSha256: "2".repeat(64),
    },
    logs: [
      {
        name: "stdout.log",
        path: "checks/build/stdout.log",
        sizeBytes: 17,
        sha256: createHash("sha256").update("BUILD SUCCESSFUL\n").digest("hex"),
      },
    ],
  });
});

test("execution flags, statuses, and exit codes must agree", async (t) => {
  type InconsistentCheck =
    | { requested: false; executed: true; status: "passed"; exitCode: 0 }
    | {
        requested: true;
        executed: false;
        status: "failed" | "timed_out";
        exitCode: null;
      }
    | { requested: true; executed: true; status: "failed"; exitCode: 0 }
    | { requested: true; executed: true; status: "unavailable"; exitCode: 0 };
  const cases: readonly { name: string; check: InconsistentCheck }[] = [
    {
      name: "an unrequested command cannot have executed",
      check: {
        requested: false,
        executed: true,
        status: "passed",
        exitCode: 0,
      },
    },
    {
      name: "an unexecuted command cannot have failed",
      check: {
        requested: true,
        executed: false,
        status: "failed",
        exitCode: null,
      },
    },
    {
      name: "a zero exit cannot be failed",
      check: { requested: true, executed: true, status: "failed", exitCode: 0 },
    },
    {
      name: "an unexecuted command cannot have timed out",
      check: {
        requested: true,
        executed: false,
        status: "timed_out",
        exitCode: null,
      },
    },
    {
      name: "an executed command cannot be unavailable",
      check: {
        requested: true,
        executed: true,
        status: "unavailable",
        exitCode: 0,
      },
    },
  ];

  for (const { name, check } of cases) {
    await t.test(name, async (t) => {
      const { options } = await evidenceOptions(t);
      options.checks[0] = {
        ...options.checks[0]!,
        ...check,
        executedArgv: check.executed ? options.checks[0]!.executedArgv : null,
        logs: [],
      };
      await assert.rejects(finalizeEvidence(options), {
        code: "invalid_evidence_status",
      });
      await assertNoEvidence(options);
    });
  }
});

test("concurrent approval updates preserve every independent grant", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "voxellume-approval-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const network = Array.from({ length: 12 }, (_, index) => ({
    host: `repo-${index}.maven.invalid`,
    purpose: `dependencies-${index}`,
    cacheIdentity: `cache-${index}`,
    approvedAt: `2026-11-06T12:00:${String(index).padStart(2, "0")}.000Z`,
  }));

  await Promise.all([
    recordEulaApproval({ configRoot: root, eulaUrl, approvedAt }),
    ...network.map((approval) =>
      recordNetworkApproval({ configRoot: root, ...approval }),
    ),
  ]);

  const approvals = await loadApprovals({ configRoot: root });
  assert.deepEqual(approvals.eula, { url: eulaUrl, approvedAt });
  assert.deepEqual(
    [...approvals.network].sort((left, right) =>
      left.host.localeCompare(right.host),
    ),
    [...network].sort((left, right) => left.host.localeCompare(right.host)),
  );
});

test("concurrent updates through aliases of one config root preserve both grants", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "voxellume-approval-aliases-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configRoot = join(root, "config");
  const firstAlias = join(root, "first-alias");
  const secondAlias = join(root, "second-alias");
  await mkdir(configRoot);
  await symlink(configRoot, firstAlias, "dir");
  await symlink(configRoot, secondAlias, "dir");
  const network = {
    host: "maven.fabricmc.net",
    purpose: "gradle-dependencies",
    cacheIdentity: "fabric-1.21.1",
    approvedAt,
  };

  await Promise.all([
    recordEulaApproval({ configRoot: firstAlias, eulaUrl, approvedAt }),
    recordNetworkApproval({ configRoot: secondAlias, ...network }),
  ]);

  assert.deepEqual(await loadApprovals({ configRoot }), {
    schemaVersion: "approvals-1.0.0",
    eula: { url: eulaUrl, approvedAt },
    network: [network],
  });
});

test("replacement after temporary-file preparation is a revision conflict", async (t) => {
  const stagingPath = await mkdtemp(
    join(tmpdir(), "voxellume-cas-replacement-"),
  );
  t.after(() => rm(stagingPath, { recursive: true, force: true }));
  const staging = await grantAuthorizedRoot({
    path: stagingPath,
    kind: "transactionStaging",
    transactionId: "transaction-cas",
  });
  t.after(() => releaseAuthorizedRoot(staging));
  await writeFile(join(stagingPath, "existing.txt"), "original\n");
  const original = await readAuthorizedFile(staging, "existing.txt");
  const target = join(stagingPath, "existing.txt");
  const retired = join(stagingPath, "retired.txt");

  await assert.rejects(
    writeAuthorizedFile(staging, {
      path: "existing.txt",
      contents: "candidate\n",
      expectedRevision: original.revision,
      hooks: {
        beforeRename: async () => {
          await rename(target, retired);
          await writeFile(target, "external replacement\n", { flag: "wx" });
        },
      },
    }),
    { code: "revision_conflict" },
  );
  assert.equal(await readFile(target, "utf8"), "external replacement\n");
  assert.equal(await readFile(retired, "utf8"), "original\n");
});

test("unsigned and forged manifests fail after checksum repair", async (t) => {
  for (const kind of ["unsigned", "forged"] as const) {
    await t.test(kind, async (t) => {
      const { options } = await evidenceOptions(t);
      await finalizeEvidence(options);
      await tamperManifest(options, (manifest) => {
        if (kind === "unsigned") {
          delete (manifest as Partial<EvidenceManifest>).integrity;
        } else {
          manifest.integrity = "0".repeat(64);
        }
      });
      await assert.rejects(readEvidence(options), {
        code: "evidence_integrity",
      });
    });
  }
});

test("authenticated evidence binds stored log and artifact bytes", async (t) => {
  for (const relative of [
    "checks/build/stdout.log",
    "artifacts/ruby-blade.jar",
  ]) {
    await t.test(relative, async (t) => {
      const { options } = await evidenceOptions(t);
      await finalizeEvidence(options);
      const directory = join(options.evidenceRoot, options.transactionId);
      const path = join(directory, relative);
      const checksumsPath = join(directory, "SHA256SUMS");
      await chmod(path, 0o644);
      await chmod(checksumsPath, 0o644);
      await writeFile(path, "forged stored bytes\n");
      const digest = createHash("sha256")
        .update("forged stored bytes\n")
        .digest("hex");
      const checksums = (await readFile(checksumsPath, "utf8"))
        .split("\n")
        .map((line) =>
          line.endsWith(`  ${relative}`) ? `${digest}  ${relative}` : line,
        )
        .join("\n");
      await writeFile(checksumsPath, checksums);
      await chmod(path, 0o444);
      await chmod(checksumsPath, 0o444);

      await assert.rejects(readEvidence(options), {
        code: "evidence_integrity",
      });
    });
  }
});

test("authenticated evidence rejects altered review identity and execution", async (t) => {
  await t.test("subject hash", async (t) => {
    const { options } = await evidenceOptions(t);
    await finalizeEvidence(options);
    await tamperManifest(options, (manifest) => {
      manifest.checks[0]!.subject.sourceSha256 = "3".repeat(64);
    });
    await assert.rejects(readEvidence(options), { code: "evidence_integrity" });
  });

  await t.test("reviewer", async (t) => {
    const { options } = await evidenceOptions(t);
    options.checks[0]!.subject = {
      class: "design_review",
      sourceSha256: "1".repeat(64),
      exportSha256: "2".repeat(64),
      reviewer: {
        id: "human-reviewer",
        revision: 1,
        rubric: "animation quality",
        decision: "approved",
        kind: "human",
      },
    };
    await finalizeEvidence(options);
    await tamperManifest(options, (manifest) => {
      manifest.checks[0]!.subject.reviewer!.revision = 2;
    });
    await assert.rejects(readEvidence(options), { code: "evidence_integrity" });
  });

  await t.test("scenario", async (t) => {
    const { options } = await evidenceOptions(t);
    options.checks[0]!.subject = {
      class: "browser",
      surface: "minecraft_client",
      productionJarSha256: "4".repeat(64),
      baselineSha256: "5".repeat(64),
      scenario: { id: "idle", state: "idle", kind: "state" },
    };
    await finalizeEvidence(options);
    await tamperManifest(options, (manifest) => {
      manifest.checks[0]!.subject.scenario!.state = "walk";
    });
    await assert.rejects(readEvidence(options), { code: "evidence_integrity" });
  });

  await t.test("caller-authored unexecuted pass", async (t) => {
    const { options } = await evidenceOptions(t);
    await finalizeEvidence(options);
    await tamperManifest(options, (manifest) => {
      const check = manifest.checks[0]!;
      check.executed = false;
      check.executedArgv = null;
      check.exitCode = null;
      check.status = "passed";
    });
    await assert.rejects(readEvidence(options), { code: "evidence_integrity" });
  });
});
