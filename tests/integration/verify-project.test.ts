import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runVerificationProcess } from "../../src/core/execution/process.ts";
import {
  canonicalModSpecHash,
  validateModSpec,
} from "../../src/core/spec/mod-spec.ts";
import type { ModSpec } from "../../src/core/spec/mod-spec.ts";
import type { TargetPack } from "../../src/core/targets/target-pack.ts";
import {
  readEvidence,
  type EvidenceCheckSubject,
} from "../../src/core/verification/evidence.ts";
import {
  verifyProject,
  type VerificationStageCheck,
  type VerificationStageExecutor,
  type VerifyProjectOptions,
} from "../../src/core/verification/verify-project.ts";

const productionJarBytes = Buffer.from("fake remapped production jar\n");
const productionJarRelative = "build/libs/ruby_tools-1.0.0.jar";

async function makeWritableTree(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await makeWritableTree(child);
    await chmod(child, entry.isDirectory() ? 0o755 : 0o644);
  }
  await chmod(path, 0o755);
}

async function readJson(path: string | URL): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function targetFixture(): Promise<TargetPack> {
  const directory = new URL(
    "../../target-packs/java/fabric/1.21.1/",
    import.meta.url,
  );
  const [pack, docs, verification] = await Promise.all(
    ["target.json", "docs.json", "verification.json"].map((name) =>
      readJson(new URL(name, directory)),
    ),
  );
  return {
    ...pack,
    docs,
    verification: {
      ...verification,
      capabilities: {
        build: true,
        server: true,
        client: true,
        gameTest: true,
        visual: true,
      },
      evidenceManifest: {
        path: "qualification/java-fabric-1.21.1-r1/result.json",
        sha256: "f".repeat(64),
      },
    },
    status: "supported",
  } as unknown as TargetPack;
}

async function modSpecFixture(): Promise<ModSpec> {
  const document = await readJson(
    new URL("../../fixtures/mod-spec/valid.json", import.meta.url),
  );
  const result = validateModSpec(document);
  assert.ok(result.status === "valid");
  return result.spec;
}

test("a real fake gradlew clean build persists exact logs and authenticated artifact evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "voxellume-verify-integration-"));
  t.after(async () => {
    await makeWritableTree(root);
    await rm(root, { recursive: true, force: true });
  });
  const projectRoot = join(root, "project with spaces");
  const isolationRoot = join(root, "isolation");
  const evidenceRoot = join(root, "supervisor", "evidence");
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(isolationRoot, { recursive: true }),
  ]);
  const wrapper = join(projectRoot, "gradlew");
  await writeFile(
    wrapper,
    `#!${process.execPath}
import { mkdirSync, writeFileSync } from "node:fs";
console.log("clean build: ruby_tools");
console.log("argv=" + JSON.stringify(process.argv.slice(2)));
mkdirSync("build/libs", { recursive: true });
writeFileSync(${JSON.stringify(productionJarRelative)}, ${JSON.stringify(productionJarBytes.toString("utf8"))});
console.log("BUILD SUCCESSFUL");
`,
  );
  await chmod(wrapper, 0o755);

  const target = await targetFixture();
  const modSpec = await modSpecFixture();
  const sourceSubject: EvidenceCheckSubject = {
    class: "source",
    sourceSha256: "1".repeat(64),
    exportSha256: "2".repeat(64),
  };
  const stageExecutor: VerificationStageExecutor = async ({
    stage,
    roots,
    identity,
    signal,
  }) => {
    if (stage === "static") {
      const check: VerificationStageCheck = {
        id: "static",
        requested: true,
        checked: true,
        status: "passed",
        requestedArgv: ["internal:static"],
        executedArgv: ["internal:static"],
        exitCode: 0,
        subject: sourceSubject,
        logs: [],
      };
      return { checks: [check] };
    }
    assert.equal(stage, "build");
    const requestedArgv = target.verification.checks.build?.argv;
    assert.ok(requestedArgv);
    const processResult = await runVerificationProcess({
      transactionId: identity.transactionId,
      projectRoot: roots.projectRoot,
      isolationRoot: roots.isolationRoot,
      verification: target.verification,
      capability: "build",
      backend: "host",
      containerRuntime: "node",
      allowHostExecution: true,
      ...(signal === undefined ? {} : { signal }),
    });
    const checked = processResult.status !== "unavailable";
    const logs = [];
    if (checked) {
      const logDirectory = join(roots.projectRoot, ".verification");
      await mkdir(logDirectory, { recursive: true });
      const stdoutPath = join(logDirectory, "build.stdout.log");
      await writeFile(stdoutPath, processResult.stdout);
      logs.push({ name: "stdout.log", path: stdoutPath });
      if (processResult.stderr.length > 0) {
        const stderrPath = join(logDirectory, "build.stderr.log");
        await writeFile(stderrPath, processResult.stderr);
        logs.push({ name: "stderr.log", path: stderrPath });
      }
    }
    const check: VerificationStageCheck = {
      id: "build",
      requested: true,
      checked,
      status: processResult.status,
      requestedArgv: [...requestedArgv],
      executedArgv: processResult.executed
        ? [...processResult.executed.argv]
        : null,
      exitCode: processResult.exitCode,
      subject: {
        ...sourceSubject,
        productionJarSha256: createHash("sha256")
          .update(productionJarBytes)
          .digest("hex"),
      },
      logs,
    };
    return {
      checks: [check],
      ...(processResult.status === "passed"
        ? {
            artifacts: [
              {
                name: "ruby_tools-1.0.0.jar",
                path: join(roots.projectRoot, productionJarRelative),
              },
            ],
          }
        : {}),
    };
  };
  const options: VerifyProjectOptions = {
    roots: {
      projectRoot,
      isolationRoot,
      evidenceRoot,
      agentWritableRoots: [projectRoot, isolationRoot],
    },
    target,
    modSpec,
    profile: "build",
    identity: {
      transactionId: "tx-real-fake-gradlew",
      baseProjectSha256: "a".repeat(64),
      modSpecSha256: canonicalModSpecHash(modSpec),
      targetPackSha256: target.packSha256,
      finalTreeSha256: "d".repeat(64),
    },
    policy: {
      allowHostExecution: true,
      environment: {
        os: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        executor: "host-only-fake-gradlew",
      },
      secretValues: [],
    },
    signal: new AbortController().signal,
    stageExecutor,
  };

  const result = await verifyProject(options);
  assert.equal(result.status, "passed", result.error?.detail);
  assert.equal(result.support, "not_verified");
  assert.deepEqual(
    result.stages.map((stage) => [stage.id, stage.status]),
    [
      ["static", "passed"],
      ["build", "passed"],
    ],
  );

  const manifest = await readEvidence({
    evidenceRoot,
    transactionId: options.identity.transactionId,
  });
  assert.deepEqual(result.evidence, {
    transactionId: options.identity.transactionId,
    sha256: manifest.integrity,
  });
  const build = manifest.checks.find((check) => check.id === "build");
  assert.ok(build);
  assert.deepEqual(build.requestedArgv, [
    "./gradlew",
    "--no-daemon",
    "clean",
    "build",
  ]);
  assert.deepEqual(build.executedArgv, build.requestedArgv);
  assert.equal(build.executed, true);
  assert.equal(build.status, "passed");
  assert.equal(build.exitCode, 0);
  const stdout = build.logs.find((log) => log.name === "stdout.log");
  assert.ok(stdout);
  const expectedStdout =
    'clean build: ruby_tools\nargv=["--no-daemon","clean","build"]\nBUILD SUCCESSFUL\n';
  assert.equal(stdout.path, "checks/build/stdout.log");
  assert.equal(stdout.sizeBytes, Buffer.byteLength(expectedStdout));
  assert.equal(
    stdout.sha256,
    createHash("sha256").update(expectedStdout).digest("hex"),
  );
  assert.equal(
    await readFile(
      join(evidenceRoot, options.identity.transactionId, stdout.path),
      "utf8",
    ),
    expectedStdout,
  );
  assert.deepEqual(manifest.artifacts, [
    {
      name: "ruby_tools-1.0.0.jar",
      path: "artifacts/ruby_tools-1.0.0.jar",
      sizeBytes: productionJarBytes.byteLength,
      sha256: createHash("sha256").update(productionJarBytes).digest("hex"),
    },
  ]);
  assert.equal(
    await readFile(
      join(
        evidenceRoot,
        options.identity.transactionId,
        "artifacts/ruby_tools-1.0.0.jar",
      ),
      "utf8",
    ),
    productionJarBytes.toString("utf8"),
  );

  const storedArtifact = join(
    evidenceRoot,
    options.identity.transactionId,
    "artifacts/ruby_tools-1.0.0.jar",
  );
  await chmod(storedArtifact, 0o644);
  await writeFile(storedArtifact, "tampered production jar\n");
  await chmod(storedArtifact, 0o444);
  await assert.rejects(
    readEvidence({
      evidenceRoot,
      transactionId: options.identity.transactionId,
    }),
    { code: "evidence_integrity" },
  );
});
