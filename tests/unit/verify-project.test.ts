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
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  canonicalModSpecHash,
  validateModSpec,
} from "../../src/core/spec/mod-spec.ts";
import type { ModSpec } from "../../src/core/spec/mod-spec.ts";
import type { TargetPack } from "../../src/core/targets/target-pack.ts";
import {
  readEvidence,
  type EvidenceCheckSubject,
  type EvidenceStatus,
} from "../../src/core/verification/evidence.ts";
import {
  verifyProject,
  type VerificationProfile,
  type VerificationStage,
  type VerificationStageCheck,
  type VerificationStageExecution,
  type VerifyProjectOptions,
} from "../../src/core/verification/verify-project.ts";

const allStages = [
  "static",
  "build",
  "server",
  "gameTest",
  "client",
  "productionJar",
  "visual",
  "package",
] as const satisfies readonly VerificationStage[];

const profileStages: Readonly<
  Record<VerificationProfile, readonly VerificationStage[]>
> = {
  static: ["static"],
  build: ["static", "build"],
  server: ["static", "build", "server"],
  gameTest: ["static", "build", "server", "gameTest"],
  client: ["static", "build", "server", "gameTest", "client"],
  visual: [
    "static",
    "build",
    "server",
    "gameTest",
    "client",
    "productionJar",
    "visual",
  ],
  release: [
    "static",
    "build",
    "server",
    "gameTest",
    "client",
    "productionJar",
    "package",
  ],
  full: allStages,
};

let transactionSequence = 0;

async function makeWritableTree(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await makeWritableTree(child);
    await chmod(child, entry.isDirectory() ? 0o755 : 0o644);
  }
  await chmod(path, 0o755);
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function targetFixture(): Promise<TargetPack> {
  const directory = new URL(
    "../../target-packs/java/fabric/1.21.1/",
    import.meta.url,
  );
  const [pack, docs, verification] = await Promise.all(
    ["target.json", "docs.json", "verification.json"].map((name) =>
      readJson(new URL(name, directory).pathname),
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
    new URL("../../fixtures/mod-spec/valid.json", import.meta.url).pathname,
  );
  const result = validateModSpec(document);
  assert.ok(result.status === "valid");
  return result.spec;
}

function subjectFor(
  stage: VerificationStage,
  productionJarSha256: string,
): EvidenceCheckSubject {
  if (
    stage === "server" ||
    stage === "gameTest" ||
    stage === "client" ||
    stage === "productionJar"
  ) {
    return {
      class: "runtime",
      surface:
        stage === "client" || stage === "productionJar"
          ? "minecraft_client"
          : "minecraft_server",
      scenario: {
        id: `scenario_${stage}`,
        state: "completed",
        kind: "state",
      },
      ...(stage === "productionJar" ? { productionJarSha256 } : {}),
    };
  }
  if (stage === "visual") {
    return {
      class: "browser",
      surface: "minecraft_client",
      productionJarSha256,
      baselineSha256: "5".repeat(64),
      scenario: {
        id: "scenario_ruby_tools_inventory",
        state: "inventory_open",
        kind: "state",
      },
    };
  }
  return {
    class: "source",
    sourceSha256: "1".repeat(64),
    exportSha256: "2".repeat(64),
    ...(stage === "package" ? { productionJarSha256 } : {}),
  };
}

function visualReviewSubject(): EvidenceCheckSubject {
  return {
    class: "design_review",
    sourceSha256: "1".repeat(64),
    exportSha256: "2".repeat(64),
    reviewer: {
      id: "human-reviewer-1",
      revision: 1,
      rubric: "visual/ruby-tools-rubric.md",
      decision: "approved",
      kind: "human",
    },
  };
}

function requestedArgv(stage: VerificationStage, target: TargetPack): string[] {
  if (
    stage === "build" ||
    stage === "server" ||
    stage === "gameTest" ||
    stage === "client" ||
    stage === "visual"
  ) {
    const argv = target.verification.checks[stage]?.argv;
    assert.ok(argv, `missing ${stage} target check`);
    return [...argv];
  }
  return [`internal:${stage}`];
}

interface RunOptions {
  profile: VerificationProfile;
  target?: TargetPack;
  failure?: { stage: VerificationStage; status: EvidenceStatus };
  negativeControl?: boolean;
  collidingArtifactNames?: boolean;
  abortAfterStage?: VerificationStage;
  environment?: Record<string, unknown>;
  environmentBeforeStage?: {
    stage: VerificationStage;
    values: Record<string, unknown>;
  };
  mutateChecks?: (
    stage: VerificationStage,
    checks: VerificationStageCheck[],
  ) => VerificationStageCheck[];
}

async function runVerification(t: TestContext, run: RunOptions) {
  transactionSequence += 1;
  const root = await mkdtemp(join(tmpdir(), "voxellume-verify-unit-"));
  t.after(async () => {
    await makeWritableTree(root);
    await rm(root, { recursive: true, force: true });
  });
  const projectRoot = join(root, "project");
  const isolationRoot = join(root, "isolation");
  const evidenceRoot = join(root, "supervisor", "evidence");
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(isolationRoot, { recursive: true }),
  ]);

  const target = run.target ?? (await targetFixture());
  const modSpec = await modSpecFixture();
  if (run.negativeControl === true) {
    modSpec.acceptance.push({
      id: "accept_negative_control",
      featureId: "ruby_blade",
      behavior: "The negative control must reject an incorrect damage value.",
      kind: "gameTest",
      implementationUnitIds: ["unit_ruby_blade"],
      checkIds: ["gametest.negative_control.must_fail"],
      fixture: "fixtures/gametest/negative-control.json",
      expected: { damage: 8 },
    });
  }

  const productionJar = join(projectRoot, "build/libs/ruby_tools-1.0.0.jar");
  const productionJarBytes = Buffer.from("fake remapped production jar\n");
  await mkdir(dirname(productionJar), { recursive: true });
  await writeFile(productionJar, productionJarBytes);
  const productionJarSha256 = createHash("sha256")
    .update(productionJarBytes)
    .digest("hex");
  const observedStages: VerificationStage[] = [];

  async function executeCheck(
    stage: VerificationStage,
    id: string,
    status: EvidenceStatus,
    subject = subjectFor(stage, productionJarSha256),
  ): Promise<VerificationStageCheck> {
    const argv = requestedArgv(stage, target);
    const checked = status !== "unsupported" && status !== "unavailable";
    const logs = [];
    if (checked) {
      const path = join(projectRoot, ".verification", `${id}.log`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${id}: ${status}\n`);
      logs.push({ name: "stdout.log", path });
    }
    return {
      id,
      requested: true,
      checked,
      status,
      requestedArgv: argv,
      executedArgv: checked ? [...argv] : null,
      exitCode: status === "passed" ? 0 : status === "failed" ? 1 : null,
      subject,
      logs,
    };
  }

  const collisionFiles: {
    stage: VerificationStage;
    name: string;
    path: string;
    bytes: Buffer;
  }[] = [];
  if (run.collidingArtifactNames === true) {
    for (const fixture of [
      {
        stage: "server" as const,
        name: "latest.log",
        relative: "server/latest.log",
        text: "dedicated server log\n",
      },
      {
        stage: "client" as const,
        name: "latest.log",
        relative: "client/latest.log",
        text: "real client log\n",
      },
      {
        stage: "client" as const,
        name: "scene.png",
        relative: "client/scene.png",
        text: "client scene capture\n",
      },
      {
        stage: "visual" as const,
        name: "scene.png",
        relative: "visual/scene.png",
        text: "reviewed visual capture\n",
      },
    ]) {
      const path = join(projectRoot, ".verification-inputs", fixture.relative);
      await mkdir(dirname(path), { recursive: true });
      const bytes = Buffer.from(fixture.text, "utf8");
      await writeFile(path, bytes);
      collisionFiles.push({
        stage: fixture.stage,
        name: fixture.name,
        path,
        bytes,
      });
    }
  }

  const abortController = new AbortController();
  const options: VerifyProjectOptions = {
    roots: {
      projectRoot,
      isolationRoot,
      evidenceRoot,
      agentWritableRoots: [projectRoot, isolationRoot],
    },
    target,
    modSpec,
    profile: run.profile,
    identity: {
      transactionId: `tx-verify-unit-${transactionSequence}`,
      baseProjectSha256: "a".repeat(64),
      modSpecSha256: canonicalModSpecHash(modSpec),
      targetPackSha256: target.packSha256,
      finalTreeSha256: "d".repeat(64),
    },
    policy: {
      environment: {
        os: process.platform,
        arch: process.arch,
        javaVersion: "21",
        executor: "injected-host-only",
        productionJar: true,
        cleanInstance: true,
        ...run.environment,
      },
      secretValues: ["rcon-unit-secret"],
    },
    signal: abortController.signal,
    stageExecutor: async ({
      stage,
      policy,
    }): Promise<VerificationStageExecution> => {
      if (run.environmentBeforeStage?.stage === stage) {
        Object.assign(policy.environment, run.environmentBeforeStage.values);
      }
      observedStages.push(stage);
      const status =
        run.failure?.stage === stage ? run.failure.status : "passed";
      let checks: VerificationStageCheck[];
      if (stage === "gameTest" && run.negativeControl === true) {
        checks = [];
        for (const acceptance of modSpec.acceptance) {
          for (const id of acceptance.checkIds as string[]) {
            checks.push(
              await executeCheck(
                stage,
                id,
                id === "gametest.negative_control.must_fail"
                  ? "failed"
                  : "passed",
              ),
            );
          }
        }
      } else if (stage === "visual") {
        checks = [
          await executeCheck(stage, "visual", status),
          await executeCheck(
            stage,
            "visual.review",
            status,
            visualReviewSubject(),
          ),
        ];
      } else {
        checks = [await executeCheck(stage, stage, status)];
      }
      if (run.mutateChecks !== undefined) {
        checks = run.mutateChecks(stage, checks);
      }

      const artifacts = collisionFiles
        .filter((artifact) => artifact.stage === stage)
        .map((artifact) => ({ name: artifact.name, path: artifact.path }));
      if (stage === "server" && artifacts.length > 0) {
        artifacts.push({ ...artifacts[0]! });
      }
      if (stage === "productionJar" && status === "passed") {
        artifacts.push({ name: "ruby_tools-1.0.0.jar", path: productionJar });
      }
      if (run.abortAfterStage === stage) abortController.abort();
      return { checks, artifacts };
    },
  };

  const result = await verifyProject(options);
  const manifest = await readEvidence({
    evidenceRoot,
    transactionId: options.identity.transactionId,
  });
  assert.deepEqual(result.evidence, {
    transactionId: options.identity.transactionId,
    sha256: manifest.integrity,
  });
  return {
    result,
    manifest,
    observedStages,
    productionJarBytes,
    productionJarSha256,
    evidenceRoot,
    collisionFiles,
  };
}

test("profiles expose deterministic stages and only full verification claims support", async (t) => {
  for (const profile of Object.keys(profileStages) as VerificationProfile[]) {
    await t.test(profile, async (t) => {
      const { result, manifest } = await runVerification(t, { profile });
      const expected = profileStages[profile];
      assert.equal(result.status, "passed");
      assert.deepEqual(
        result.stages.map((stage) => stage.id),
        expected,
      );
      for (const stage of result.stages) {
        assert.equal(stage.status, "passed");
        assert.ok(stage.checks.length > 0);
        for (const check of stage.checks) {
          assert.equal(check.requested, true);
          assert.equal(check.checked, true);
          assert.equal(check.status, "passed");
        }
      }
      assert.equal(
        manifest.checks.length,
        expected.length + (expected.includes("visual") ? 1 : 0),
      );
      assert.equal(
        result.support,
        profile === "full" ? "verified" : "not_verified",
      );
      if (profile === "full") {
        const visual = manifest.checks.find((check) => check.id === "visual");
        assert.equal(visual?.subject.class, "browser");
        assert.equal(visual?.subject.surface, "minecraft_client");
        assert.equal(visual?.subject.reviewer, undefined);
        const review = manifest.checks.find(
          (check) => check.id === "visual.review",
        );
        assert.equal(review?.subject.class, "design_review");
        assert.deepEqual(review?.subject.reviewer, {
          id: "human-reviewer-1",
          revision: 1,
          rubric: "visual/ruby-tools-rubric.md",
          decision: "approved",
          kind: "human",
        });
      }
    });
  }
});

test("a static-only pass cannot claim full support", async (t) => {
  const { result, manifest } = await runVerification(t, { profile: "static" });
  assert.equal(result.status, "passed");
  assert.equal(result.support, "not_verified");
  assert.deepEqual(
    result.stages.map((stage) => stage.id),
    ["static"],
  );
  assert.deepEqual(
    manifest.checks.map((check) => check.id),
    ["static"],
  );
});

test("every non-passing stage stops downstream and records unexecuted checks", async (t) => {
  for (const status of [
    "failed",
    "cancelled",
    "timed_out",
    "unavailable",
    "unsupported",
  ] as const) {
    await t.test(status, async (t) => {
      const { result, manifest, observedStages } = await runVerification(t, {
        profile: "full",
        failure: { stage: "server", status },
      });
      assert.equal(result.status, status);
      assert.deepEqual(observedStages, ["static", "build", "server"]);
      assert.deepEqual(
        result.stages.map((stage) => [stage.id, stage.status]),
        [
          ["static", "passed"],
          ["build", "passed"],
          ["server", status],
          ["gameTest", "unavailable"],
          ["client", "unavailable"],
          ["productionJar", "unavailable"],
          ["visual", "unavailable"],
          ["package", "unavailable"],
        ],
      );
      for (const stage of result.stages.slice(3)) {
        assert.ok(stage.checks.length > 0);
        for (const check of stage.checks) {
          assert.equal(check.checked, false);
          assert.notEqual(check.status, "passed");
          assert.equal(check.executedArgv, null);
          assert.equal(check.exitCode, null);
        }
      }
      assert.equal(result.support, "not_verified");
      assert.deepEqual(
        manifest.checks.map((check) => [check.id, check.status]),
        result.stages.flatMap((stage) =>
          stage.checks.map((check) => [check.id, check.status]),
        ),
      );
      assert.ok(
        manifest.checks.every(
          (check) => check.executed || check.status !== "passed",
        ),
      );
    });
  }
});

test("target capability and qualification gates fail before host execution", async (t) => {
  await t.test("disabled capability", async (t) => {
    const target = await targetFixture();
    const gated = {
      ...target,
      verification: {
        ...target.verification,
        capabilities: { ...target.verification.capabilities, server: false },
      },
    };
    const { result, observedStages } = await runVerification(t, {
      profile: "full",
      target: gated,
    });
    assert.equal(result.status, "unsupported");
    assert.equal(result.error?.code, "capability_unavailable");
    assert.deepEqual(observedStages, ["static", "build"]);
    assert.equal(result.stages[2]?.checks[0]?.checked, false);
    assert.ok(
      result.stages
        .slice(3)
        .flatMap((stage) => stage.checks)
        .every((check) => !check.checked && check.status !== "passed"),
    );
  });

  await t.test("missing immutable qualification evidence", async (t) => {
    const target = await targetFixture();
    const { evidenceManifest: _evidenceManifest, ...verification } =
      target.verification;
    const gated = { ...target, verification };
    const { result, observedStages } = await runVerification(t, {
      profile: "build",
      target: gated,
    });
    assert.equal(result.status, "unsupported");
    assert.equal(result.error?.code, "missing_qualification_evidence");
    assert.deepEqual(observedStages, ["static"]);
    assert.equal(result.stages[1]?.checks[0]?.status, "unsupported");
    assert.equal(result.stages[1]?.checks[0]?.checked, false);
  });
});

test("ModSpec GameTest acceptance includes a failing negative control", async (t) => {
  const { result, manifest, observedStages } = await runVerification(t, {
    profile: "full",
    negativeControl: true,
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(observedStages, ["static", "build", "server", "gameTest"]);
  const gameTest = result.stages.find((stage) => stage.id === "gameTest");
  assert.deepEqual(
    gameTest?.checks.map((check) => [check.id, check.status]),
    [
      ["gametest.ruby_blade.damage", "passed"],
      ["gametest.ruby_block.drops", "passed"],
      ["gametest.negative_control.must_fail", "failed"],
    ],
  );
  assert.equal(
    manifest.checks.find(
      (check) => check.id === "gametest.negative_control.must_fail",
    )?.status,
    "failed",
  );
  for (const stage of result.stages.slice(4)) {
    assert.ok(
      stage.checks.every(
        (check) => check.checked === false && check.status !== "passed",
      ),
    );
  }
});

test("release records the exact production artifact and authenticates package evidence", async (t) => {
  const { result, manifest, productionJarBytes, productionJarSha256 } =
    await runVerification(t, { profile: "release" });
  assert.equal(result.status, "passed");
  assert.equal(result.support, "not_verified");
  assert.deepEqual(
    result.stages.map((stage) => stage.id),
    profileStages.release,
  );
  assert.equal(
    result.stages.some((stage) => stage.id === "visual"),
    false,
  );
  assert.deepEqual(manifest.artifacts, [
    {
      name: "ruby_tools-1.0.0.jar",
      path: "artifacts/ruby_tools-1.0.0.jar",
      sizeBytes: productionJarBytes.byteLength,
      sha256: createHash("sha256").update(productionJarBytes).digest("hex"),
    },
  ]);
  for (const id of ["productionJar", "package"]) {
    const check = manifest.checks.find((candidate) => candidate.id === id);
    assert.equal(check?.status, "passed");
    assert.equal(check?.subject.productionJarSha256, productionJarSha256);
  }
});

test("colliding artifact names preserve every stage's bytes through authenticated readback", async (t) => {
  const { result, manifest, evidenceRoot, collisionFiles } =
    await runVerification(t, {
      profile: "full",
      collidingArtifactNames: true,
    });
  assert.equal(result.status, "passed");
  assert.equal(result.support, "verified");
  assert.deepEqual(
    manifest.artifacts.map((artifact) => artifact.name),
    [
      "latest.log",
      "client-latest.log",
      "scene.png",
      "ruby_tools-1.0.0.jar",
      "visual-scene.png",
    ],
  );
  for (const fixture of collisionFiles) {
    const expectedName =
      fixture.stage === "server"
        ? fixture.name
        : fixture.stage === "client" && fixture.name === "scene.png"
          ? fixture.name
          : `${fixture.stage}-${fixture.name}`;
    const stored = manifest.artifacts.find(
      (artifact) => artifact.name === expectedName,
    );
    assert.ok(stored, `missing ${expectedName}`);
    assert.equal(stored.sizeBytes, fixture.bytes.byteLength);
    assert.equal(
      stored.sha256,
      createHash("sha256").update(fixture.bytes).digest("hex"),
    );
    assert.deepEqual(
      await readFile(
        join(evidenceRoot, result.evidence.transactionId, stored.path),
      ),
      fixture.bytes,
    );
  }
});

test("stage-specific check subjects and exact production identity are mandatory", async (t) => {
  const cases: {
    stage: VerificationStage;
    wrongSubject: (productionJarSha256: string) => EvidenceCheckSubject;
  }[] = [
    { stage: "static", wrongSubject: (hash) => subjectFor("server", hash) },
    { stage: "build", wrongSubject: (hash) => subjectFor("server", hash) },
    { stage: "server", wrongSubject: (hash) => subjectFor("client", hash) },
    { stage: "gameTest", wrongSubject: (hash) => subjectFor("static", hash) },
    { stage: "client", wrongSubject: (hash) => subjectFor("server", hash) },
    {
      stage: "productionJar",
      wrongSubject: (hash) => ({
        ...subjectFor("productionJar", hash),
        productionJarSha256: "0".repeat(64),
      }),
    },
    { stage: "package", wrongSubject: (hash) => subjectFor("server", hash) },
  ];
  for (const fixture of cases) {
    await t.test(fixture.stage, async (t) => {
      const { result, observedStages } = await runVerification(t, {
        profile: "full",
        mutateChecks: (stage, checks) =>
          stage === fixture.stage
            ? checks.map((check) => ({
                ...check,
                subject: fixture.wrongSubject("f".repeat(64)),
              }))
            : checks,
      });
      assert.equal(result.status, "failed");
      assert.equal(result.support, "not_verified");
      assert.equal(result.error.code, "invalid_stage_subject");
      assert.equal(observedStages.at(-1), fixture.stage);
    });
  }

  await t.test("visual requires a separate human design review", async (t) => {
    const { result } = await runVerification(t, {
      profile: "full",
      mutateChecks: (stage, checks) =>
        stage === "visual"
          ? checks.filter((check) => check.id === "visual")
          : checks,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.support, "not_verified");
    assert.equal(result.error.code, "invalid_stage_subject");
  });

  await t.test("visual rejects a stand-in reviewer", async (t) => {
    const { result, manifest } = await runVerification(t, {
      profile: "full",
      mutateChecks: (stage, checks) =>
        stage === "visual"
          ? checks.map((check) =>
              check.id === "visual.review"
                ? {
                    ...check,
                    subject: {
                      ...check.subject,
                      reviewer: {
                        ...check.subject.reviewer!,
                        kind: "stand_in" as const,
                      },
                    },
                  }
                : check,
            )
          : checks,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.support, "not_verified");
    assert.equal(result.error.code, "invalid_stage_subject");
    assert.equal(
      manifest.checks.find((check) => check.id === "visual.review")?.status,
      "failed",
    );
  });
});

test("production and visual passes require a clean production-JAR environment", async (t) => {
  for (const fixture of [
    {
      stage: "productionJar" as const,
      profile: "release" as const,
      environment: { productionJar: false },
    },
    {
      stage: "visual" as const,
      profile: "full" as const,
      environment: {},
      environmentBeforeStage: {
        stage: "visual" as const,
        values: { cleanInstance: false },
      },
    },
  ]) {
    await t.test(fixture.stage, async (t) => {
      const { result, observedStages } = await runVerification(t, {
        profile: fixture.profile,
        environment: fixture.environment,
        ...("environmentBeforeStage" in fixture
          ? { environmentBeforeStage: fixture.environmentBeforeStage }
          : {}),
      });
      assert.equal(result.status, "failed");
      assert.equal(result.support, "not_verified");
      assert.equal(result.error.code, "invalid_stage_environment");
      assert.equal(observedStages.at(-1), fixture.stage);
    });
  }
});

test("cancellation after an executor returns preserves evidence and blocks downstream", async (t) => {
  const { result, manifest, observedStages } = await runVerification(t, {
    profile: "full",
    abortAfterStage: "build",
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.support, "not_verified");
  assert.deepEqual(observedStages, ["static", "build"]);
  const build = result.stages.find((stage) => stage.id === "build");
  assert.equal(build?.status, "cancelled");
  assert.equal(build?.checks[0]?.checked, true);
  assert.equal(build?.checks[0]?.status, "cancelled");
  assert.equal(build?.checks[0]?.exitCode, null);
  assert.deepEqual(build?.checks[0]?.executedArgv, [
    "./gradlew",
    "--no-daemon",
    "clean",
    "build",
  ]);
  assert.equal(build?.checks[0]?.logs.length, 1);
  for (const stage of result.stages.slice(2)) {
    assert.equal(stage.status, "unavailable");
    assert.ok(stage.checks.every((check) => !check.checked));
  }
  const stored = manifest.checks.find((check) => check.id === "build");
  assert.equal(stored?.executed, true);
  assert.equal(stored?.status, "cancelled");
  assert.equal(stored?.exitCode, null);
  assert.equal(stored?.logs.length, 1);
});
