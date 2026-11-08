import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  assertEulaApproved,
  assertNetworkApproved,
  loadApprovals,
  recordEulaApproval,
  recordNetworkApproval,
} from "../../src/core/execution/approvals.ts";
import {
  finalizeEvidence,
  readEvidence,
  type EvidenceCheckSubject,
} from "../../src/core/verification/evidence.ts";
import { hasReadOnlyMode } from "../../src/core/verification/evidence/read.ts";

const eulaUrl = "https://aka.ms/MinecraftEULA";
const approvedAt = "2026-11-06T12:00:00.000Z";
const network = {
  host: "repo.maven.apache.org",
  purpose: "gradle-dependencies",
  cacheIdentity: "gradle-9.8.2-fabric-1.21.1",
};
const secret = "rcon-test-secret-do-not-persist";

async function makeWritableTree(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await makeWritableTree(child);
    await chmod(child, entry.isDirectory() ? 0o755 : 0o644);
  }
  await chmod(path, 0o755);
}

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "voxellume-evidence-test-"));
  t.after(async () => {
    await makeWritableTree(root);
    await rm(root, { recursive: true, force: true });
  });
  const configRoot = join(root, "config");
  const projectRoot = join(root, "project");
  const evidenceRoot = join(root, "supervisor", "evidence");
  const inputRoot = join(root, "input");
  await Promise.all([
    mkdir(configRoot, { recursive: true }),
    mkdir(projectRoot, { recursive: true }),
    mkdir(inputRoot, { recursive: true }),
  ]);
  return { root, configRoot, projectRoot, evidenceRoot, inputRoot };
}

async function evidenceOptions(
  t: TestContext,
): Promise<Parameters<typeof finalizeEvidence>[0]> {
  const fixture = await setup(t);
  const logPath = join(fixture.inputRoot, "build.log");
  const artifactPath = join(fixture.inputRoot, "ruby-blade.jar");
  await writeFile(logPath, "BUILD SUCCESSFUL\n");
  await writeFile(artifactPath, "production jar bytes\n");
  return {
    evidenceRoot: fixture.evidenceRoot,
    agentWritableRoots: [fixture.projectRoot],
    sourceRoots: [fixture.inputRoot],
    transactionId: "transaction-01",
    baseProjectSha256: "a".repeat(64),
    modSpecSha256: "b".repeat(64),
    targetPackSha256: "c".repeat(64),
    finalTreeSha256: "d".repeat(64),
    environment: {
      os: "linux",
      arch: "x64",
      nodeVersion: "24.21.0",
      javaVersion: "21",
      containerImageDigest: "e".repeat(64),
    },
    checks: [
      {
        id: "build",
        requested: true,
        executed: true,
        status: "passed",
        requestedArgv: ["./gradlew", "--no-daemon", "clean", "build"],
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
  };
}

test("approvals start empty and never silently accept the Minecraft EULA", async (t) => {
  const { configRoot } = await setup(t);
  assert.deepEqual(await loadApprovals({ configRoot }), {
    schemaVersion: "approvals-1.0.0",
    eula: null,
    network: [],
  });
  await assert.rejects(assertEulaApproved({ configRoot, eulaUrl }), {
    code: "eula_not_approved",
  });
  await assert.rejects(assertNetworkApproved({ configRoot, ...network }), {
    code: "network_not_approved",
  });
});

test("approval persistence is exact, survives reload, and stays mode 0600", async (t) => {
  const { configRoot } = await setup(t);
  await recordEulaApproval({ configRoot, eulaUrl, approvedAt });
  await recordNetworkApproval({ configRoot, ...network, approvedAt });

  assert.deepEqual(await loadApprovals({ configRoot }), {
    schemaVersion: "approvals-1.0.0",
    eula: { url: eulaUrl, approvedAt },
    network: [{ ...network, approvedAt }],
  });
  assert.equal(
    (await stat(join(configRoot, "approvals.json"))).mode & 0o777,
    0o600,
  );
  await assert.doesNotReject(assertEulaApproved({ configRoot, eulaUrl }));
  await assert.doesNotReject(assertNetworkApproved({ configRoot, ...network }));
});

test("first approvals create a nested config root and persist both grants", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "voxellume-approval-first-use-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configRoot = join(root, "missing", "nested", "config");

  await Promise.all([
    recordEulaApproval({ configRoot, eulaUrl, approvedAt }),
    recordNetworkApproval({ configRoot, ...network, approvedAt }),
  ]);

  assert.deepEqual(await loadApprovals({ configRoot }), {
    schemaVersion: "approvals-1.0.0",
    eula: { url: eulaUrl, approvedAt },
    network: [{ ...network, approvedAt }],
  });
  await assert.doesNotReject(assertEulaApproved({ configRoot, eulaUrl }));
  await assert.doesNotReject(assertNetworkApproved({ configRoot, ...network }));
});

test("network approval does not bleed across host, purpose, or cache identity", async (t) => {
  const { configRoot } = await setup(t);
  await recordNetworkApproval({ configRoot, ...network, approvedAt });

  for (const override of [
    { host: "repo.maven.apache.org.evil.invalid" },
    { host: "maven.fabricmc.net" },
    { purpose: "asset-upload" },
    { cacheIdentity: "another-cache" },
  ]) {
    await assert.rejects(
      assertNetworkApproved({ configRoot, ...network, ...override }),
      { code: "network_not_approved" },
    );
  }
});

test("EULA approval is bound to the exact approved URL", async (t) => {
  const { configRoot } = await setup(t);
  await recordEulaApproval({ configRoot, eulaUrl, approvedAt });
  await assert.rejects(
    assertEulaApproved({
      configRoot,
      eulaUrl: "https://example.invalid/eula",
    }),
    { code: "eula_not_approved" },
  );
});

test("final evidence records identities, exact execution, artifacts, and environment", async (t) => {
  const options = await evidenceOptions(t);
  const manifest = await finalizeEvidence(options);

  assert.equal(manifest.transactionId, "transaction-01");
  assert.deepEqual(
    {
      baseProjectSha256: manifest.baseProjectSha256,
      modSpecSha256: manifest.modSpecSha256,
      targetPackSha256: manifest.targetPackSha256,
      finalTreeSha256: manifest.finalTreeSha256,
    },
    {
      baseProjectSha256: "a".repeat(64),
      modSpecSha256: "b".repeat(64),
      targetPackSha256: "c".repeat(64),
      finalTreeSha256: "d".repeat(64),
    },
  );
  assert.deepEqual(manifest.environment, options.environment);
  assert.deepEqual(manifest.checks[0], {
    id: "build",
    requested: true,
    executed: true,
    status: "passed",
    requestedArgv: ["./gradlew", "--no-daemon", "clean", "build"],
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
  assert.deepEqual(manifest.artifacts, [
    {
      name: "ruby-blade.jar",
      path: "artifacts/ruby-blade.jar",
      sizeBytes: 21,
      sha256: createHash("sha256")
        .update("production jar bytes\n")
        .digest("hex"),
    },
  ]);
  assert.deepEqual(
    await readEvidence({
      evidenceRoot: options.evidenceRoot,
      transactionId: options.transactionId,
    }),
    manifest,
  );
});

test("an unexecuted check can never be recorded as passed", async (t) => {
  const options = await evidenceOptions(t);
  options.checks[0] = {
    ...options.checks[0]!,
    executed: false,
    status: "passed",
    executedArgv: null,
    exitCode: null,
    logs: [],
  };
  await assert.rejects(finalizeEvidence(options), {
    code: "invalid_evidence_status",
  });
  await assert.rejects(
    stat(join(options.evidenceRoot, options.transactionId)),
    { code: "ENOENT" },
  );
});

test("an unexecuted runtime check can never be recorded as passed", async (t) => {
  const options = await evidenceOptions(t);
  options.checks[0] = {
    ...options.checks[0]!,
    executed: false,
    status: "passed",
    executedArgv: null,
    exitCode: null,
    subject: {
      class: "runtime",
      surface: "minecraft_server",
      scenario: { id: "server-state", state: "initialized", kind: "state" },
    },
    logs: [],
  };
  await assert.rejects(finalizeEvidence(options), {
    code: "invalid_evidence_status",
  });
});

test("runtime protocol checks pass without an operating-system exit code", async (t) => {
  for (const executable of ["rcon-client", "mineflayer"] as const) {
    await t.test(executable, async (t) => {
      const options = await evidenceOptions(t);
      options.checks[0] = {
        ...options.checks[0]!,
        requestedArgv: [executable, "assert-state"],
        executedArgv: [executable, "assert-state"],
        exitCode: null,
        subject: {
          class: "runtime",
          surface: "minecraft_server",
          scenario: {
            id: "protocol-state",
            state: "initialized",
            kind: "state",
          },
        },
      };

      const manifest = await finalizeEvidence(options);
      assert.equal(manifest.checks[0]!.status, "passed");
      assert.equal(manifest.checks[0]!.exitCode, null);
      assert.deepEqual(manifest.checks[0]!.executedArgv, [
        executable,
        "assert-state",
      ]);
      assert.deepEqual((await readEvidence(options)).checks[0]!.executedArgv, [
        executable,
        "assert-state",
      ]);
    });
  }
});

test("only actual runtime protocol operations can pass with a null exit code", async (t) => {
  const runtimeSubject: EvidenceCheckSubject = {
    class: "runtime",
    surface: "minecraft_server",
    scenario: { id: "protocol-state", state: "initialized", kind: "state" },
  };
  const invalidChecks: {
    name: string;
    mutate: (options: Parameters<typeof finalizeEvidence>[0]) => void;
  }[] = [
    {
      name: "runtime Gradle process without exit zero",
      mutate: (options) => {
        options.checks[0]!.exitCode = null;
        options.checks[0]!.subject = runtimeSubject;
      },
    },
    {
      name: "source protocol operation",
      mutate: (options) => {
        options.checks[0]!.requestedArgv = ["rcon-client", "assert-state"];
        options.checks[0]!.executedArgv = ["rcon-client", "assert-state"];
        options.checks[0]!.exitCode = null;
      },
    },
    {
      name: "protocol operation with fake process exit",
      mutate: (options) => {
        options.checks[0]!.requestedArgv = ["rcon-client", "assert-state"];
        options.checks[0]!.executedArgv = ["rcon-client", "assert-state"];
        options.checks[0]!.exitCode = 0;
        options.checks[0]!.subject = runtimeSubject;
      },
    },
    {
      name: "unexecuted protocol operation",
      mutate: (options) => {
        options.checks[0]!.executed = false;
        options.checks[0]!.requestedArgv = ["mineflayer", "assert-state"];
        options.checks[0]!.executedArgv = null;
        options.checks[0]!.exitCode = null;
        options.checks[0]!.subject = runtimeSubject;
        options.checks[0]!.logs = [];
      },
    },
    {
      name: "empty protocol operation",
      mutate: (options) => {
        options.checks[0]!.requestedArgv = ["mineflayer", "assert-state"];
        options.checks[0]!.executedArgv = [];
        options.checks[0]!.exitCode = null;
        options.checks[0]!.subject = runtimeSubject;
      },
    },
    {
      name: "protocol operation with zero exit and failed status",
      mutate: (options) => {
        options.checks[0]!.status = "failed";
        options.checks[0]!.requestedArgv = ["mineflayer", "assert-state"];
        options.checks[0]!.executedArgv = ["mineflayer", "assert-state"];
        options.checks[0]!.exitCode = 0;
        options.checks[0]!.subject = runtimeSubject;
      },
    },
  ];

  for (const { name, mutate } of invalidChecks) {
    await t.test(name, async (t) => {
      const options = await evidenceOptions(t);
      mutate(options);
      await assert.rejects(finalizeEvidence(options), {
        code: "invalid_evidence_status",
      });
    });
  }
});

test("timed-out and cancelled checks remain non-passing evidence", async (t) => {
  const options = await evidenceOptions(t);
  options.checks = (["timed_out", "cancelled"] as const).map((status) => ({
    id: status,
    requested: true,
    executed: true,
    status,
    requestedArgv: ["./gradlew", "--no-daemon", "runServer"],
    executedArgv: ["./gradlew", "--no-daemon", "runServer"],
    exitCode: null,
    subject: {
      class: "source",
      sourceSha256: "1".repeat(64),
      exportSha256: "2".repeat(64),
    },
    logs: [],
  }));
  const manifest = await finalizeEvidence(options);
  assert.deepEqual(
    manifest.checks.map((check) => [check.status, check.exitCode]),
    [
      ["timed_out", null],
      ["cancelled", null],
    ],
  );
  assert.ok(manifest.checks.every((check) => check.status !== "passed"));
});

test("pre-execution failures and timeouts cannot be published", async (t) => {
  for (const status of ["failed", "timed_out"] as const) {
    await t.test(status, async (t) => {
      const options = await evidenceOptions(t);
      options.checks[0] = {
        ...options.checks[0]!,
        requestedArgv: ["./gradlew", "runServer"],
        executed: false,
        status,
        executedArgv: null,
        exitCode: null,
        logs: [],
      };

      await assert.rejects(finalizeEvidence(options), {
        code: "invalid_evidence_status",
      });
    });
  }
});

test("pre-execution failures cannot invent argv or an exit code", async (t) => {
  for (const status of ["failed", "timed_out"] as const) {
    for (const field of ["executedArgv", "exitCode"] as const) {
      await t.test(`${status}:${field}`, async (t) => {
        const options = await evidenceOptions(t);
        options.checks[0] = {
          ...options.checks[0]!,
          executed: false,
          status,
          executedArgv: null,
          exitCode: null,
          logs: [],
        };
        if (field === "executedArgv") {
          options.checks[0]!.executedArgv = ["./gradlew", "runServer"];
        } else {
          options.checks[0]!.exitCode = 1;
        }
        await assert.rejects(finalizeEvidence(options), {
          code: "invalid_evidence_status",
        });
      });
    }
  }
});

test("finalized evidence is outside agent roots and recursively read-only", async (t) => {
  const options = await evidenceOptions(t);
  const directory = join(options.evidenceRoot, options.transactionId);
  await finalizeEvidence(options);

  for (const relative of [
    "",
    ...(await readdir(directory, { recursive: true })),
  ]) {
    const entry = await stat(join(directory, relative));
    assert.equal(
      hasReadOnlyMode(entry.mode, entry.isDirectory()),
      true,
      relative || "evidence root",
    );
  }

  const nested = await evidenceOptions(t);
  nested.evidenceRoot = join(nested.agentWritableRoots[0]!, "evidence");
  await assert.rejects(finalizeEvidence(nested), {
    code: "unauthorized_evidence_root",
  });
});

test("read-only evidence modes match platform semantics", () => {
  assert.equal(hasReadOnlyMode(0o40444, true, "win32"), true);
  assert.equal(hasReadOnlyMode(0o40555, true, "win32"), false);
  assert.equal(hasReadOnlyMode(0o40666, true, "win32"), false);
  assert.equal(hasReadOnlyMode(0o100444, false, "win32"), true);
  assert.equal(hasReadOnlyMode(0o100644, false, "win32"), false);
  assert.equal(hasReadOnlyMode(0o40555, true, "linux"), true);
  assert.equal(hasReadOnlyMode(0o40444, true, "linux"), false);
  assert.equal(hasReadOnlyMode(0o100444, false, "linux"), true);
});

test("evidence larger than 2 GiB fails before publication", async (t) => {
  const options = await evidenceOptions(t);
  await truncate(options.artifacts[0]!.path, 2 * 1024 ** 3 + 1);
  await assert.rejects(finalizeEvidence(options), {
    code: "evidence_limit_exceeded",
  });
  await assert.rejects(
    stat(join(options.evidenceRoot, options.transactionId)),
    { code: "ENOENT" },
  );
});

test("a log larger than 16 MiB fails closed without partial evidence", async (t) => {
  const options = await evidenceOptions(t);
  await truncate(options.checks[0]!.logs[0]!.path, 16 * 1024 ** 2 + 1);
  await assert.rejects(finalizeEvidence(options), {
    code: "output_limit_exceeded",
  });
  await assert.rejects(
    stat(join(options.evidenceRoot, options.transactionId)),
    { code: "ENOENT" },
  );
});

test("one invalid artifact cannot leave a partially published bundle", async (t) => {
  const options = await evidenceOptions(t);
  options.artifacts.push({
    name: "missing.jar",
    path: join(options.artifacts[0]!.path, "missing.jar"),
  });
  await assert.rejects(finalizeEvidence(options));
  await assert.rejects(
    stat(join(options.evidenceRoot, options.transactionId)),
    { code: "ENOENT" },
  );
});

test("tampering invalidates a finalized evidence bundle", async (t) => {
  const options = await evidenceOptions(t);
  await finalizeEvidence(options);
  const resultPath = join(
    options.evidenceRoot,
    options.transactionId,
    "result.json",
  );
  await chmod(resultPath, 0o644);
  await writeFile(resultPath, '{"transactionId":"forged"}\n');
  await chmod(resultPath, 0o444);

  await assert.rejects(
    readEvidence({
      evidenceRoot: options.evidenceRoot,
      transactionId: options.transactionId,
    }),
    { code: "evidence_integrity" },
  );
});

test("secrets are redacted from argv, logs, and environment everywhere", async (t) => {
  const options = await evidenceOptions(t);
  const command = ["./gradlew", "runServer", `--rcon-password=${secret}`];
  options.checks[0]!.requestedArgv = [...command];
  options.checks[0]!.executedArgv = [...command];
  options.environment.rconPassword = secret;
  await writeFile(options.checks[0]!.logs[0]!.path, `password=${secret}\n`);
  options.secretValues = [secret];
  const manifest = await finalizeEvidence(options);
  const directory = join(options.evidenceRoot, options.transactionId);

  assert.ok(manifest.checks[0]!.requestedArgv[2]!.includes("[REDACTED]"));
  assert.ok(manifest.checks[0]!.executedArgv?.[2]!.includes("[REDACTED]"));
  assert.equal(manifest.environment.rconPassword, "[REDACTED]");
  for (const relative of await readdir(directory, { recursive: true })) {
    const path = join(directory, relative);
    if ((await stat(path)).isFile()) {
      assert.equal((await readFile(path)).includes(secret), false, relative);
    }
  }
});

test("an artifact containing a secret is rejected rather than persisted", async (t) => {
  const options = await evidenceOptions(t);
  await writeFile(options.artifacts[0]!.path, `leaked ${secret}\n`);
  options.secretValues = [secret];
  await assert.rejects(finalizeEvidence(options), {
    code: "secret_in_artifact",
  });
  await assert.rejects(
    stat(join(options.evidenceRoot, options.transactionId)),
    { code: "ENOENT" },
  );
});

test("typed review subjects roundtrip with authenticated human approval", async (t) => {
  const subjects: EvidenceCheckSubject[] = [
    {
      class: "source",
      sourceSha256: "1".repeat(64),
      exportSha256: "2".repeat(64),
    },
    {
      class: "browser",
      surface: "blockbench",
      sourceSha256: "1".repeat(64),
      exportSha256: "2".repeat(64),
    },
    {
      class: "browser",
      surface: "minecraft_client",
      productionJarSha256: "3".repeat(64),
      baselineSha256: "4".repeat(64),
      scenario: { id: "idle-production", state: "idle", kind: "state" },
    },
    {
      class: "runtime",
      surface: "minecraft_server",
      productionJarSha256: "3".repeat(64),
      scenario: { id: "dedicated-state", state: "initialized", kind: "state" },
    },
    {
      class: "runtime",
      surface: "minecraft_client",
      scenario: {
        id: "multiplayer-sync",
        state: "two-clients",
        kind: "multiplayer",
      },
    },
    {
      class: "runtime",
      surface: "minecraft_server",
      scenario: {
        id: "restart-persistence",
        state: "restarted",
        kind: "restart",
      },
    },
    {
      class: "design_review",
      sourceSha256: "1".repeat(64),
      exportSha256: "2".repeat(64),
      reviewer: {
        id: "human-reviewer",
        revision: 1,
        rubric: "silhouette, UV, clipping, and animation quality",
        decision: "approved",
        kind: "human",
      },
    },
  ];

  for (const subject of subjects) {
    await t.test(`${subject.class}:${subject.surface ?? "none"}`, async (t) => {
      const options = await evidenceOptions(t);
      options.checks[0]!.subject = subject;
      const manifest = await finalizeEvidence(options);
      assert.match(manifest.integrity, /^[a-f0-9]{64}$/);
      assert.deepEqual(manifest.checks[0]!.subject, subject);
      assert.deepEqual(
        (await readEvidence(options)).checks[0]!.subject,
        subject,
      );
    });
  }
});

test("a stand-in or rejected reviewer cannot pass human design review", async (t) => {
  for (const reviewer of [
    {
      id: "agent-stand-in",
      revision: 1,
      rubric: "animation quality",
      decision: "approved",
      kind: "stand_in",
    },
    {
      id: "human-reviewer",
      revision: 1,
      rubric: "animation quality",
      decision: "rejected",
      kind: "human",
    },
  ] as const) {
    await t.test(`${reviewer.kind}:${reviewer.decision}`, async (t) => {
      const options = await evidenceOptions(t);
      options.checks[0]!.subject = {
        class: "design_review",
        sourceSha256: "1".repeat(64),
        exportSha256: "2".repeat(64),
        reviewer,
      };
      await assert.rejects(finalizeEvidence(options), {
        code: "human_review_required",
      });
    });
  }
});

test("review subjects enforce class requirements and exact field formats", async (t) => {
  const cases: { name: string; subject: EvidenceCheckSubject }[] = [
    {
      name: "source export hash",
      subject: { class: "source", sourceSha256: "1".repeat(64) },
    },
    {
      name: "browser surface",
      subject: { class: "browser", sourceSha256: "1".repeat(64) },
    },
    {
      name: "preview export hash",
      subject: {
        class: "browser",
        surface: "blender",
        sourceSha256: "1".repeat(64),
      },
    },
    {
      name: "client scenario",
      subject: {
        class: "browser",
        surface: "minecraft_client",
        productionJarSha256: "3".repeat(64),
        baselineSha256: "4".repeat(64),
      },
    },
    {
      name: "runtime surface",
      subject: {
        class: "runtime",
        surface: "blender",
        scenario: { id: "preview", state: "initialized", kind: "state" },
      },
    },
    {
      name: "runtime scenario",
      subject: { class: "runtime", surface: "minecraft_server" },
    },
    {
      name: "runtime production JAR hash",
      subject: {
        class: "runtime",
        surface: "minecraft_client",
        productionJarSha256: "ABC123",
        scenario: { id: "client", state: "initialized", kind: "state" },
      },
    },
    {
      name: "design reviewer",
      subject: {
        class: "design_review",
        sourceSha256: "1".repeat(64),
        exportSha256: "2".repeat(64),
      },
    },
    {
      name: "exact hash",
      subject: {
        class: "source",
        sourceSha256: "not-a-sha256",
        exportSha256: "2".repeat(64),
      },
    },
    {
      name: "scenario state",
      subject: {
        class: "browser",
        surface: "minecraft_client",
        productionJarSha256: "3".repeat(64),
        baselineSha256: "4".repeat(64),
        scenario: { id: "idle", state: "", kind: "state" },
      },
    },
    {
      name: "reviewer revision",
      subject: {
        class: "design_review",
        sourceSha256: "1".repeat(64),
        exportSha256: "2".repeat(64),
        reviewer: {
          id: "human-reviewer",
          revision: 0,
          rubric: "animation quality",
          decision: "approved",
          kind: "human",
        },
      },
    },
    {
      name: "reviewer rubric",
      subject: {
        class: "design_review",
        sourceSha256: "1".repeat(64),
        exportSha256: "2".repeat(64),
        reviewer: {
          id: "human-reviewer",
          revision: 1,
          rubric: " ",
          decision: "approved",
          kind: "human",
        },
      },
    },
  ];

  for (const { name, subject } of cases) {
    await t.test(name, async (t) => {
      const options = await evidenceOptions(t);
      options.checks[0]!.subject = subject;
      await assert.rejects(finalizeEvidence(options), {
        code: "invalid_evidence_subject",
      });
    });
  }
});
