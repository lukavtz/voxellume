import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod";

import registerOmpExtension from "../../src/adapters/omp/index.ts";
import { createHostCoreOperations } from "../../src/adapters/shared.ts";
import type { DomainResult } from "../../src/core/results.ts";

interface ToolRegistration {
  name: string;
  approval?: "read" | "write" | "exec";
  parameters: unknown;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ): Promise<{
    content: { type: string; text: string }[];
    details: unknown;
  }>;
}

function fakePi(cwd = "/unused") {
  const tools: ToolRegistration[] = [];
  const pi = {
    cwd,
    zod: z,
    registerTool(tool: ToolRegistration) {
      tools.push(tool);
    },
    exec() {
      throw new Error("OMP adapter must not execute host processes");
    },
  };
  return {
    pi: pi as unknown as ExtensionAPI & { cwd: string },
    tools,
  };
}

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
  version: "1.2.3",
  description: "Ruby tools.",
  authors: ["Voxellume Tests"],
  license: "MIT",
};

const verifyRequest = {
  projectRoot: "/authorized/project",
  target,
  modSpec: { schemaVersion: "mod-spec-1.0.0" },
  profile: "build" as const,
  identity: {
    transactionId: "transaction-1",
    baseProjectSha256: "0".repeat(64),
    modSpecSha256: "1".repeat(64),
    targetPackSha256: "2".repeat(64),
    finalTreeSha256: "3".repeat(64),
  },
};

test("default extension registration performs no filesystem or process action", () => {
  const cwd = join(tmpdir(), `voxellume-omp-no-io-${crypto.randomUUID()}`);
  const { pi, tools } = fakePi(cwd);

  registerOmpExtension(pi);

  assert.equal(tools.length, 5);
  assert.equal(existsSync(cwd), false);
  assert.equal(existsSync(join(cwd, ".voxellume", "staging")), false);
});

async function authorizedFixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "voxellume-omp-paths-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  const stagingRoot = join(projectRoot, ".voxellume", "staging");
  const outside = join(root, "outside");
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(stagingRoot, { recursive: true }),
    mkdir(outside),
  ]);
  const operations = createHostCoreOperations({
    catalogRoot: fileURLToPath(
      new URL("../../fixtures/target-packs/valid/", import.meta.url),
    ),
    authorizedProjectRoot: projectRoot,
    transactionStagingRoot: stagingRoot,
    verification: {
      isolationRoot: join(root, "isolation"),
      evidenceRoot: join(root, "evidence"),
      agentWritableRoots: [stagingRoot],
      policy: { environment: {}, secretValues: [] },
    },
  });
  return { operations, projectRoot, stagingRoot, outside };
}

function assertDomainError(result: DomainResult<unknown>): void {
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "unauthorized_root");
}

test("inspection accepts only existing real paths inside the authorized project", async (t) => {
  const { operations, projectRoot, outside } = await authorizedFixture(t);

  const inspected = await operations.inspectProject({ projectRoot });
  assert.equal(inspected.status, "ok");
  await mkdir(join(projectRoot, "nested"));
  const relative = await operations.inspectProject({ projectRoot: "nested" });
  assert.equal(relative.status, "ok");

  assertDomainError(await operations.inspectProject({ projectRoot: outside }));
  assertDomainError(
    await operations.inspectProject({
      projectRoot: join(projectRoot, "missing"),
    }),
  );

  await symlink(outside, join(projectRoot, "escape"), "dir");
  assertDomainError(
    await operations.inspectProject({
      projectRoot: join(projectRoot, "escape"),
    }),
  );
  assertDomainError(
    await operations.verifyProject({
      ...verifyRequest,
      projectRoot: outside,
    }),
  );
});

test("scaffolding cannot use the canonical project or a staging symlink escape", async (t) => {
  const { operations, projectRoot, stagingRoot, outside } =
    await authorizedFixture(t);

  assertDomainError(
    await operations.scaffoldProject({ destination: projectRoot, target, mod }),
  );
  assert.deepEqual(await readdir(projectRoot), [".voxellume"]);

  await symlink(outside, join(stagingRoot, "escape"), "dir");
  assertDomainError(
    await operations.scaffoldProject({
      destination: join(stagingRoot, "escape"),
      target,
      mod,
    }),
  );
  assert.deepEqual(await readdir(outside), []);
});

test("scaffolding rejects a staging-parent symlink before any outside mutation", async (t) => {
  const { operations, projectRoot, outside } = await authorizedFixture(t);
  await rm(join(projectRoot, ".voxellume"), { recursive: true });
  await symlink(outside, join(projectRoot, ".voxellume"), "dir");

  assertDomainError(
    await operations.scaffoldProject({
      destination: join(projectRoot, ".voxellume", "staging", "escape"),
      target,
      mod,
    }),
  );
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await readdir(projectRoot), [".voxellume"]);
});
