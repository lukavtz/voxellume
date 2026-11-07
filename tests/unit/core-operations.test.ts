import assert from "node:assert/strict";
import {
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { runVerificationProcess } from "../../src/core/execution/process.ts";
import { acquireHeldProjectLock } from "../../src/core/execution/process/project-lock.ts";
import {
  createCoreOperations,
  type CoreOperationsOptions,
} from "../../src/core/operations.ts";
import { canonicalModSpecHash } from "../../src/core/spec/mod-spec.ts";
import type { DomainError, DomainResult } from "../../src/core/results.ts";
import { readEvidence } from "../../src/core/verification/evidence.ts";
import type { VerificationStageContext } from "../../src/core/verification/verify-project.ts";

const fixtureRoot = new URL("../../fixtures/", import.meta.url);
const templateRoot = new URL(
  "../../target-packs/java/fabric/1.21.1/templates/",
  import.meta.url,
);
const target = {
  edition: "java",
  minecraftVersion: "1.21.1",
  loader: "fabric",
} as const;
const mod = {
  modId: "ruby_tools",
  namespace: "ruby_tools",
  javaPackage: "dev.voxellume.ruby_tools",
  name: "Ruby Tools",
  version: "1.0.0",
  description: "Ruby tools.",
  authors: ["Voxellume Tests"],
  license: "MIT",
};
const hash = "a".repeat(64);

interface TestWorkspace {
  root: string;
  catalogRoot: string;
  packRoot: string;
  projectRoot: string;
  isolationRoot: string;
  evidenceRoot: string;
}

async function makeWritableTree(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) await makeWritableTree(child);
    await chmod(child, entry.isDirectory() ? 0o755 : 0o644);
  }
  await chmod(path, 0o755);
}

async function workspace(t: test.TestContext): Promise<TestWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-core-operations-"));
  t.after(async () => {
    await makeWritableTree(root);
    await rm(root, { recursive: true, force: true });
  });
  const catalogRoot = join(root, "catalog");
  const packRoot = join(catalogRoot, "java", "fabric", "1.21.1");
  await mkdir(packRoot, { recursive: true });
  await Promise.all(
    ["target.json", "docs.json", "verification.json"].map((name) =>
      cp(
        new URL(`target-packs/valid/java/fabric/1.21.1/${name}`, fixtureRoot),
        join(packRoot, name),
      ),
    ),
  );
  await cp(templateRoot, join(packRoot, "templates"), { recursive: true });
  const projectRoot = join(root, "project");
  const isolationRoot = join(root, "isolation");
  const evidenceRoot = join(root, "evidence");
  await Promise.all(
    [projectRoot, isolationRoot, evidenceRoot].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  );
  return {
    root,
    catalogRoot,
    packRoot,
    projectRoot,
    isolationRoot,
    evidenceRoot,
  };
}

function options(
  paths: TestWorkspace,
  overrides: {
    [K in keyof CoreOperationsOptions]?: CoreOperationsOptions[K] | undefined;
  } = {},
): CoreOperationsOptions {
  const verification = Object.hasOwn(overrides, "verification")
    ? overrides.verification
    : {
        isolationRoot: paths.isolationRoot,
        evidenceRoot: paths.evidenceRoot,
        agentWritableRoots: [paths.projectRoot],
        policy: { environment: {}, secretValues: [] },
      };
  return {
    catalogRoot: overrides.catalogRoot ?? paths.catalogRoot,
    authorizePath: overrides.authorizePath ?? ((path) => path),
    ...(verification === undefined ? {} : { verification }),
  };
}

function expectError(result: DomainResult<unknown>, code: string): DomainError {
  assert.equal(result.status, "error");
  assert.ok("error" in result);
  assert.equal(result.error.code, code);
  return result.error;
}

async function staticVerificationRequest(
  paths: TestWorkspace,
  transactionId: string,
  projectRoot = paths.projectRoot,
) {
  const spec = JSON.parse(
    await readFile(new URL("mod-spec/valid.json", fixtureRoot), "utf8"),
  ) as Record<string, unknown>;
  const pack = JSON.parse(
    await readFile(join(paths.packRoot, "target.json"), "utf8"),
  ) as { packSha256: string };
  return {
    projectRoot,
    target,
    modSpec: spec,
    profile: "static" as const,
    identity: {
      transactionId,
      baseProjectSha256: hash,
      modSpecSha256: canonicalModSpecHash(spec),
      targetPackSha256: pack.packSha256,
      finalTreeSha256: hash,
    },
  };
}

function passedStaticCheck() {
  return {
    id: "static-check",
    requested: true,
    checked: true,
    status: "passed" as const,
    requestedArgv: ["internal:static"],
    executedArgv: ["internal:static"],
    exitCode: 0,
    subject: {
      class: "source" as const,
      sourceSha256: hash,
      exportSha256: hash,
    },
    logs: [],
  };
}

test("factory is lazy, resolves the exact catalog pack, and never authorizes target resolution", async (t) => {
  const paths = await workspace(t);
  let authorizationCalls = 0;
  const operations = createCoreOperations(
    options(paths, {
      authorizePath: () => {
        authorizationCalls += 1;
        throw new Error("resolution must not authorize paths");
      },
    }),
  );
  const result = await operations.resolveTarget({
    ...target,
    targetPackId: "java-fabric-1.21.1-r1",
  });
  assert.equal(result.status, "ok");
  assert.ok("value" in result);
  assert.equal(result.value.status, "resolved");
  assert.equal(result.value.target.id, "java-fabric-1.21.1-r1");
  assert.equal(authorizationCalls, 0);

  await rm(paths.catalogRoot, { recursive: true });
  const cached = await operations.resolveTarget(target);
  assert.equal(cached.status, "ok");
});

test("loaded target packs are deeply frozen across every core operation", async (t) => {
  const paths = await workspace(t);
  let verifiedPackSha256: string | undefined;
  const operations = createCoreOperations(
    options(paths, {
      verification: {
        isolationRoot: paths.isolationRoot,
        evidenceRoot: paths.evidenceRoot,
        agentWritableRoots: [paths.projectRoot],
        policy: { environment: {}, secretValues: [] },
        stageExecutor: async (context) => {
          verifiedPackSha256 = context.target.packSha256;
          return { checks: [passedStaticCheck()] };
        },
      },
    }),
  );

  const resolved = await operations.resolveTarget(target);
  assert.equal(resolved.status, "ok");
  assert.ok("value" in resolved);
  assert.equal(resolved.value.status, "resolved");
  const pack = resolved.value.target;
  const originalSha256 = pack.packSha256;
  const mutable = pack as {
    status: string;
    packSha256: string;
    minecraft: { releaseJsonSha256: string };
    verification: { capabilities: { build: boolean } };
  };
  assert.throws(() => {
    mutable.status = "unsupported";
  }, TypeError);
  assert.throws(() => {
    mutable.packSha256 = "b".repeat(64);
  }, TypeError);
  assert.throws(() => {
    mutable.minecraft.releaseJsonSha256 = "b".repeat(64);
  }, TypeError);
  assert.throws(() => {
    mutable.verification.capabilities.build = false;
  }, TypeError);

  const resolvedAgain = await operations.resolveTarget(target);
  assert.equal(resolvedAgain.status, "ok");
  assert.ok("value" in resolvedAgain);
  assert.equal(resolvedAgain.value.status, "resolved");
  assert.equal(resolvedAgain.value.target.status, "supported");
  assert.equal(resolvedAgain.value.target.packSha256, originalSha256);
  assert.equal(
    resolvedAgain.value.target.verification.capabilities.build,
    true,
  );

  const scaffolded = await operations.scaffoldProject({
    destination: paths.projectRoot,
    target,
    mod,
  });
  assert.equal(scaffolded.status, "ok");
  assert.ok("value" in scaffolded);
  assert.equal(scaffolded.value.status, "scaffolded");

  const inspected = await operations.inspectProject({
    projectRoot: paths.projectRoot,
  });
  assert.equal(inspected.status, "ok");
  assert.ok("value" in inspected);
  assert.equal(inspected.value.target?.pack?.status, "supported");
  assert.equal(inspected.value.target?.pack?.packSha256, originalSha256);
  assert.ok(Object.isFrozen(inspected.value.target?.pack));

  const verified = await operations.verifyProject(
    await staticVerificationRequest(paths, "frozen-pack"),
  );
  assert.equal(verified.status, "ok");
  assert.ok("value" in verified);
  assert.equal(verified.value.status, "passed");
  assert.equal(verifiedPackSha256, originalSha256);
});

test("catalog failures are sanitized and a failed lazy load can retry", async (t) => {
  const paths = await workspace(t);
  const catalogRoot = join(paths.root, "missing-secret-catalog");
  const operations = createCoreOperations(options(paths, { catalogRoot }));
  const failed = await operations.resolveTarget(target);
  const error = expectError(failed, "catalog_unavailable");
  assert.equal(error.detail, "Target catalog is unavailable.");
  assert.equal(
    JSON.stringify(failed).includes("missing-secret-catalog"),
    false,
  );

  await cp(paths.catalogRoot, catalogRoot, { recursive: true });
  const retried = await operations.resolveTarget(target);
  assert.equal(retried.status, "ok");
});

test("inspection and scaffolding delegate with authorized paths and the selected pack", async (t) => {
  const paths = await workspace(t);
  const calls: Array<{ path: string; usage: string }> = [];
  const destination = join(paths.root, "generated");
  await mkdir(destination);
  const operations = createCoreOperations(
    options(paths, {
      authorizePath: (path, usage) => {
        calls.push({ path, usage });
        return path;
      },
    }),
  );
  const inspected = await operations.inspectProject({
    projectRoot: paths.projectRoot,
  });
  assert.equal(inspected.status, "ok");
  assert.ok("value" in inspected);
  assert.equal(inspected.value.status, "inspected");

  const scaffolded = await operations.scaffoldProject({
    destination,
    target,
    mod,
  });
  assert.equal(scaffolded.status, "ok");
  assert.ok("value" in scaffolded);
  assert.equal(scaffolded.value.status, "scaffolded");
  assert.equal(scaffolded.value.modSpec.targetPackId, "java-fabric-1.21.1-r1");
  assert.deepEqual(calls, [
    { path: paths.projectRoot, usage: "inspect" },
    { path: destination, usage: "scaffold" },
  ]);
});

test("caller mutation after invocation cannot alter scaffold or asset requests", async (t) => {
  const paths = await workspace(t);
  const destination = join(paths.root, "generated");
  await mkdir(destination);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const operations = createCoreOperations(
    options(paths, {
      authorizePath: async (path, usage) => {
        if (usage === "scaffold") {
          started.resolve();
          await release.promise;
        }
        return path;
      },
    }),
  );
  const mutableMod = { ...mod, name: "Original name" };
  const pending = operations.scaffoldProject({
    destination,
    target,
    mod: mutableMod,
  });
  await started.promise;
  mutableMod.name = "Mutated name";
  release.resolve();
  const scaffolded = await pending;
  assert.equal(scaffolded.status, "ok");
  assert.ok("value" in scaffolded);
  assert.equal(scaffolded.value.status, "scaffolded");
  assert.equal(scaffolded.value.modSpec.metadata.name, "Original name");

  const files: Record<string, string> = {};
  const validation = operations.validateAssets({
    target,
    modId: "ruby_tools",
    namespace: "ruby_tools",
    metadataFile: "fabric.mod.json",
    files,
    registry: [],
    animations: [],
    requiredLangKeys: [],
    datagen: [],
  });
  files["fabric.mod.json"] = "{}";
  const result = await validation;
  assert.equal(result.status, "ok");
  assert.ok("value" in result);
  assert.equal(result.value.status, "invalid");
  assert.ok(
    result.value.issues.some((issue) => issue.code === "missing_mod_metadata"),
  );
});

test("asset validation uses resolved pack formats and preserves invalid domain outcomes", async (t) => {
  const paths = await workspace(t);
  const operations = createCoreOperations(options(paths));
  const result = await operations.validateAssets({
    target,
    modId: "ruby_tools",
    namespace: "ruby_tools",
    metadataFile: "fabric.mod.json",
    files: {},
    registry: [],
    animations: [],
    requiredLangKeys: [],
    datagen: [],
  });
  assert.equal(result.status, "ok");
  assert.ok("value" in result);
  assert.equal(result.value.status, "invalid");
  assert.ok(
    result.value.issues.some(
      (issue) =>
        issue.code === "missing_mod_metadata" &&
        issue.path === "fabric.mod.json",
    ),
  );
});

test("verification uses host roots, policy, executor, exact ModSpec, and pack identity", async (t) => {
  const paths = await workspace(t);
  const spec = JSON.parse(
    await readFile(new URL("mod-spec/valid.json", fixtureRoot), "utf8"),
  ) as Record<string, unknown>;
  const pack = JSON.parse(
    await readFile(join(paths.packRoot, "target.json"), "utf8"),
  ) as { packSha256: string };
  let context: VerificationStageContext | undefined;
  const operations = createCoreOperations(
    options(paths, {
      verification: {
        isolationRoot: paths.isolationRoot,
        evidenceRoot: paths.evidenceRoot,
        agentWritableRoots: [paths.projectRoot],
        policy: { environment: { host: "fixed" }, secretValues: [] },
        stageExecutor: async (received) => {
          context = received;
          return {
            checks: [
              {
                id: "static-check",
                requested: true,
                checked: true,
                status: "passed",
                requestedArgv: ["internal:static"],
                executedArgv: ["internal:static"],
                exitCode: 0,
                subject: {
                  class: "source",
                  sourceSha256: hash,
                  exportSha256: hash,
                },
                logs: [],
              },
            ],
          };
        },
      },
    }),
  );
  const identity = {
    transactionId: "core-operation-test",
    baseProjectSha256: hash,
    modSpecSha256: canonicalModSpecHash(spec),
    targetPackSha256: pack.packSha256,
    finalTreeSha256: hash,
  };
  const result = await operations.verifyProject({
    projectRoot: paths.projectRoot,
    target,
    modSpec: spec,
    profile: "static",
    identity,
  });
  assert.equal(result.status, "ok");
  assert.ok("value" in result);
  assert.equal(result.value.status, "passed");
  assert.equal(context?.target.id, "java-fabric-1.21.1-r1");
  assert.equal(context?.target.packSha256, pack.packSha256);
  assert.equal(context?.modSpec.targetPackRevision, 1);
  assert.deepEqual(context?.roots, {
    projectRoot: paths.projectRoot,
    isolationRoot: paths.isolationRoot,
    evidenceRoot: paths.evidenceRoot,
    agentWritableRoots: [paths.projectRoot],
  });
  assert.deepEqual(context?.policy.environment, { host: "fixed" });
});

test("whole verification holds one lock across stages, process execution, and evidence finalization", async (t) => {
  const paths = await workspace(t);
  await writeFile(
    join(paths.projectRoot, "gradlew"),
    `#!${process.execPath}\nrequire("node:fs").writeFileSync("process-ran", "yes");`,
  );
  await chmod(join(paths.projectRoot, "gradlew"), 0o755);
  const stages: string[] = [];
  const operations = createCoreOperations(
    options(paths, {
      verification: {
        isolationRoot: paths.isolationRoot,
        evidenceRoot: paths.evidenceRoot,
        agentWritableRoots: [paths.projectRoot],
        policy: { environment: {}, secretValues: [] },
        stageExecutor: async (context) => {
          stages.push(context.stage);
          if (context.stage === "static") {
            return { checks: [passedStaticCheck()] };
          }
          assert.ok(context.projectLock);
          const processResult = await runVerificationProcess({
            transactionId: context.identity.transactionId,
            projectRoot: context.roots.projectRoot,
            isolationRoot: context.roots.isolationRoot,
            verification: context.target.verification,
            capability: "build",
            projectLock: context.projectLock,
            backend: "host",
            allowHostExecution: true,
            containerRuntime: "node",
          });
          assert.equal(
            processResult.status,
            "passed",
            processResult.error?.detail ?? "",
          );
          return {
            checks: [
              {
                ...passedStaticCheck(),
                id: "build-check",
                requestedArgv: [
                  ...context.target.verification.checks.build!.argv,
                ],
                executedArgv: processResult.executed!.argv,
                exitCode: processResult.exitCode,
              },
            ],
          };
        },
      },
    }),
  );
  const request = await staticVerificationRequest(paths, "held-verify");
  const result = await operations.verifyProject({
    ...request,
    profile: "build",
  });
  assert.equal(result.status, "ok");
  assert.ok("value" in result);
  assert.ok("evidence" in result.value);
  assert.equal(result.value.status, "passed", result.value.error.detail);
  assert.deepEqual(stages, ["static", "build"]);
  assert.equal(
    await readFile(join(paths.projectRoot, "process-ran"), "utf8"),
    "yes",
  );
  const evidence = await readEvidence({
    evidenceRoot: paths.evidenceRoot,
    transactionId: "held-verify",
  });
  assert.equal(evidence.checks.length, 2);

  const next = await acquireHeldProjectLock(
    paths.projectRoot,
    AbortSignal.timeout(100),
  );
  assert.ok(
    next,
    "CoreOperations must release only after evidence is readable",
  );
  next.release();
});

test("same-project verify calls serialize their stage executors", async (t) => {
  const paths = await workspace(t);
  let active = 0;
  let maximumActive = 0;
  const operations = createCoreOperations(
    options(paths, {
      verification: {
        isolationRoot: paths.isolationRoot,
        evidenceRoot: paths.evidenceRoot,
        agentWritableRoots: [paths.projectRoot],
        policy: { environment: {}, secretValues: [] },
        stageExecutor: async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await delay(40);
          active -= 1;
          return { checks: [passedStaticCheck()] };
        },
      },
    }),
  );
  const [first, second] = await Promise.all([
    operations.verifyProject(
      await staticVerificationRequest(paths, "verify-1"),
    ),
    operations.verifyProject(
      await staticVerificationRequest(paths, "verify-2"),
    ),
  ]);
  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");
  assert.equal(maximumActive, 1);
});

test("scaffold and verify serialize across real and symlink project aliases", async (t) => {
  const paths = await workspace(t);
  const alias = join(paths.root, "project-alias");
  await symlink(paths.projectRoot, alias, "dir");
  const stageStarted = Promise.withResolvers<void>();
  const finishStage = Promise.withResolvers<void>();
  const operations = createCoreOperations(
    options(paths, {
      verification: {
        isolationRoot: paths.isolationRoot,
        evidenceRoot: paths.evidenceRoot,
        agentWritableRoots: [paths.projectRoot],
        policy: { environment: {}, secretValues: [] },
        stageExecutor: async () => {
          stageStarted.resolve();
          await finishStage.promise;
          return { checks: [passedStaticCheck()] };
        },
      },
    }),
  );
  const verifying = operations.verifyProject(
    await staticVerificationRequest(paths, "alias-verify", alias),
  );
  await stageStarted.promise;
  let scaffoldSettled = false;
  const scaffolding = operations
    .scaffoldProject({ destination: paths.projectRoot, target, mod })
    .then((result) => {
      scaffoldSettled = true;
      return result;
    });
  await delay(50);
  assert.equal(scaffoldSettled, false);
  finishStage.resolve();
  const [verified, scaffolded] = await Promise.all([verifying, scaffolding]);
  assert.equal(verified.status, "ok");
  assert.equal(scaffolded.status, "ok");
});

test("verification without host verification configuration is unavailable", async (t) => {
  const paths = await workspace(t);
  const operations = createCoreOperations(
    options(paths, { verification: undefined }),
  );
  const result = await operations.verifyProject({
    projectRoot: paths.projectRoot,
    target,
    modSpec: {},
    profile: "static",
    identity: {
      transactionId: "unavailable",
      baseProjectSha256: hash,
      modSpecSha256: hash,
      targetPackSha256: hash,
      finalTreeSha256: hash,
    },
  });
  expectError(result, "unavailable");
});

test("ModSpec target and identity hash mismatches fail before verification", async (t) => {
  const paths = await workspace(t);
  let executions = 0;
  const operations = createCoreOperations(
    options(paths, {
      verification: {
        isolationRoot: paths.isolationRoot,
        evidenceRoot: paths.evidenceRoot,
        agentWritableRoots: [],
        policy: { environment: {}, secretValues: [] },
        stageExecutor: async () => {
          executions += 1;
          return { checks: [] };
        },
      },
    }),
  );
  const spec = JSON.parse(
    await readFile(new URL("mod-spec/valid.json", fixtureRoot), "utf8"),
  ) as Record<string, unknown>;
  const pack = JSON.parse(
    await readFile(join(paths.packRoot, "target.json"), "utf8"),
  ) as { packSha256: string };
  const base = {
    projectRoot: paths.projectRoot,
    target,
    modSpec: spec,
    profile: "static" as const,
    identity: {
      transactionId: "mismatch",
      baseProjectSha256: hash,
      modSpecSha256: canonicalModSpecHash(spec),
      targetPackSha256: pack.packSha256,
      finalTreeSha256: hash,
    },
  };
  expectError(
    await operations.verifyProject({
      ...base,
      identity: { ...base.identity, modSpecSha256: "b".repeat(64) },
    }),
    "invalid_arguments",
  );
  expectError(
    await operations.verifyProject({
      ...base,
      identity: { ...base.identity, targetPackSha256: hash },
    }),
    "invalid_arguments",
  );
  expectError(
    await operations.verifyProject({
      ...base,
      modSpec: { ...spec, targetPackRevision: 2 },
    }),
    "invalid_arguments",
  );
  expectError(
    await operations.verifyProject({
      ...base,
      modSpec: { ...spec, targetPackId: "java-forge-1.21.1-r1" },
    }),
    "invalid_arguments",
  );
  assert.equal(executions, 0);
});

test("strict request validation rejects unknown fields, malformed values, and host overrides", async (t) => {
  const paths = await workspace(t);
  const operations = createCoreOperations(options(paths)) as unknown as Record<
    | "resolveTarget"
    | "inspectProject"
    | "scaffoldProject"
    | "validateAssets"
    | "verifyProject",
    (request: unknown) => Promise<DomainResult<unknown>>
  >;
  const invalidRequests: Array<() => Promise<DomainResult<unknown>>> = [
    () => operations.resolveTarget(null),
    () => operations.resolveTarget({ ...target, nearest: true }),
    () => operations.resolveTarget({ ...target, loader: "FABRIC" }),
    () => operations.resolveTarget({ ...target, minecraftVersion: "latest" }),
    () =>
      operations.inspectProject({
        projectRoot: paths.projectRoot,
        targetPackId: "other",
      }),
    () =>
      operations.scaffoldProject({
        destination: paths.projectRoot,
        target,
        mod,
        targetPack: {},
      }),
    () =>
      operations.scaffoldProject({
        destination: paths.projectRoot,
        target,
        mod,
        loaders: ["fabric", "fabric"],
      }),
    () =>
      operations.scaffoldProject({
        destination: paths.projectRoot,
        target,
        mod: { ...mod, modId: "Bad" },
      }),
    () =>
      operations.validateAssets({
        target,
        targetPack: { resourcePackFormat: 999 },
      }),
    () =>
      operations.verifyProject({
        projectRoot: paths.projectRoot,
        target,
        modSpec: {},
        profile: "latest",
        identity: {},
        isolationRoot: "/tmp/model-controlled",
        policy: { environment: {}, secretValues: [] },
      }),
    () =>
      operations.verifyProject({
        projectRoot: paths.projectRoot,
        target,
        modSpec: {},
        profile: "static",
        identity: { transactionId: "bad", baseProjectSha256: "not-a-hash" },
      }),
  ];
  for (const request of invalidRequests) {
    expectError(await request(), "invalid_arguments");
  }
});

test("authorizer and internal failures never expose thrown secrets", async (t) => {
  const paths = await workspace(t);
  const denied = createCoreOperations(
    options(paths, {
      authorizePath: () => {
        throw new Error("secret-denied-path");
      },
    }),
  );
  const deniedResult = await denied.inspectProject({
    projectRoot: paths.projectRoot,
  });
  const deniedError = expectError(deniedResult, "unauthorized_root");
  assert.equal(deniedError.detail, "Path authorization failed.");
  assert.equal(
    JSON.stringify(deniedResult).includes("secret-denied-path"),
    false,
  );

  const broken = createCoreOperations(options(paths));
  await rm(paths.projectRoot, { recursive: true });
  await writeFile(paths.projectRoot, "not a directory");
  const internal = await broken.inspectProject({
    projectRoot: paths.projectRoot,
  });
  const internalError = expectError(internal, "internal_error");
  assert.equal(internalError.detail, "The operation could not be completed.");
});

test("cancellation is stable before and after host asynchronous calls", async (t) => {
  const paths = await workspace(t);
  const before = new AbortController();
  before.abort();
  const operations = createCoreOperations(options(paths));
  const cancelled = await operations.verifyProject(
    {
      projectRoot: paths.projectRoot,
      target,
      modSpec: {},
      profile: "static",
      identity: {
        transactionId: "cancelled",
        baseProjectSha256: hash,
        modSpecSha256: hash,
        targetPackSha256: hash,
        finalTreeSha256: hash,
      },
    },
    { signal: before.signal },
  );
  const cancelledError = expectError(cancelled, "cancelled");
  assert.equal(cancelledError.detail, "Operation was cancelled.");

  const during = new AbortController();
  const authorizing = createCoreOperations(
    options(paths, {
      authorizePath: async (path) => {
        during.abort();
        return path;
      },
    }),
  );
  const afterAuthorization = await authorizing.verifyProject(
    {
      projectRoot: paths.projectRoot,
      target,
      modSpec: {},
      profile: "static",
      identity: {
        transactionId: "cancelled-after-authorization",
        baseProjectSha256: hash,
        modSpecSha256: hash,
        targetPackSha256: hash,
        finalTreeSha256: hash,
      },
    },
    { signal: during.signal },
  );
  expectError(afterAuthorization, "cancelled");
});
