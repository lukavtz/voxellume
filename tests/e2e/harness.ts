import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod";

import {
  registerDshAdapter,
  type DshContext,
} from "../../src/adapters/dsh/index.ts";
import { registerOmpTools } from "../../src/adapters/omp/index.ts";
import { createHostCoreOperations } from "../../src/adapters/shared.ts";
import type { CoreOperations } from "../../src/core/operations.ts";
import type { DomainResult } from "../../src/core/results.ts";

export type HostName = "omp" | "dsh";

export interface AcceptanceCriterion {
  readonly id: string;
  readonly check: string;
  readonly expected: string;
}

export interface BenchmarkTarget {
  readonly edition: "java";
  readonly minecraftVersion: string;
  readonly loader: "fabric" | "neoforge" | "forge" | "quilt";
  readonly targetPackId?: string;
}

export interface BenchmarkScenario {
  readonly id: string;
  readonly revision: number;
  readonly mod: {
    readonly modId: string;
    readonly name: string;
    readonly description: string;
  };
  readonly request: string;
  readonly target?: BenchmarkTarget;
  readonly delivery?: string[];
  readonly acceptance: readonly AcceptanceCriterion[];
}

export interface BenchmarkDocument {
  readonly schemaVersion: "voxellume-e2e-benchmarks-1.0.0";
  readonly benchmarkVersion: "1.0.0";
  readonly execution: {
    readonly modelIndependent: "required";
    readonly modelBacked: "optional";
  };
  readonly target: BenchmarkTarget;
  readonly modDefaults: {
    readonly namespace: string;
    readonly javaPackage: string;
    readonly version: string;
    readonly authors: readonly string[];
    readonly license: string;
  };
  readonly scenarios: readonly BenchmarkScenario[];
}

export interface AcceptanceOutcome {
  readonly id: string;
  readonly status: "passed" | "blocked";
  readonly detail: string;
}

export interface ScenarioReport {
  readonly benchmarkVersion: "1.0.0";
  readonly scenarioRevision: number;
  readonly scenarioId: string;
  readonly host: HostName;
  readonly outcome: "passed" | "blocked";
  readonly blocker: string | null;
  readonly acceptance: readonly AcceptanceOutcome[];
  readonly delivery?: readonly {
    readonly step: string;
    readonly status: "unsupported" | "blocked";
  }[];
  readonly metrics: {
    readonly falseSuccessCount: 0;
    readonly cleanBuild: "not-run";
    readonly runtime: "not-run";
    readonly visual: "not-run";
    readonly repairAttempts: 0;
    readonly humanInterventions: 0;
    readonly outputBytes: number;
    readonly wallClockMs: number;
    readonly cache: "not-applicable";
  };
}

export interface ProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export async function runProcess(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
  },
): Promise<ProcessResult> {
  const { promise, resolve } = Promise.withResolvers<ProcessResult>();
  execFile(
    command,
    [...args],
    {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      timeout: options.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    },
    (error, stdout, stderr) => {
      const failure = error as
        | (Error & {
            code?: number | string;
            signal?: NodeJS.Signals;
          })
        | null;
      resolve({
        code:
          failure === null
            ? 0
            : typeof failure.code === "number"
              ? failure.code
              : null,
        signal: failure?.signal ?? null,
        stdout,
        stderr:
          failure !== null && stderr.length === 0 ? failure.message : stderr,
      });
    },
  );
  return promise;
}

export async function loadBenchmarks(): Promise<BenchmarkDocument> {
  return JSON.parse(
    await readFile(new URL("benchmarks/v1.json", import.meta.url), "utf8"),
  ) as BenchmarkDocument;
}

interface OmpTool {
  readonly name: string;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ): Promise<{ readonly details: unknown }>;
}

interface HostTools {
  readonly omp: ReadonlyMap<string, OmpTool>;
  readonly dsh: ReadonlyMap<string, ToolDefinition>;
}

function registerHosts(operations: CoreOperations): HostTools {
  const omp = new Map<string, OmpTool>();
  const pi = {
    zod: z,
    registerTool(tool: OmpTool) {
      omp.set(tool.name, tool);
    },
  } as unknown as ExtensionAPI;
  registerOmpTools(pi, operations);

  const dsh = new Map<string, ToolDefinition>();
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        dsh.set(definition.name, definition);
        return () => dsh.delete(definition.name);
      },
    },
    systemPrompt: {
      section() {
        return () => {};
      },
    },
  } as unknown as DshContext;
  registerDshAdapter(ctx, operations, "SHARED PROCEDURES");
  return { omp, dsh };
}

function dshExecution(): ToolRunContext {
  return {
    callId: "e2e-call",
    rootCallId: "e2e-call",
    name: "voxellume-e2e",
    arguments: {},
    token: Symbol("e2e"),
    signal: new AbortController().signal,
    deferContext() {},
    concludeTurn() {},
  } as unknown as ToolRunContext;
}

async function invoke(
  tools: HostTools,
  host: HostName,
  name: string,
  request: unknown,
): Promise<DomainResult<unknown>> {
  if (host === "omp") {
    const tool = tools.omp.get(name);
    assert.ok(tool, `OMP did not register ${name}`);
    const result = await tool.execute(
      "e2e-call",
      request,
      new AbortController().signal,
      undefined,
      {},
    );
    return result.details as DomainResult<unknown>;
  }
  const tool = tools.dsh.get(name);
  assert.ok(tool, `DSH did not register ${name}`);
  return (await tool.execute(request, dshExecution())) as DomainResult<unknown>;
}

async function writeFixture(
  root: string,
  path: string,
  contents: string,
): Promise<void> {
  const destination = join(root, ...path.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

async function seedExistingProject(root: string): Promise<void> {
  await writeFixture(
    root,
    "build.gradle",
    `plugins { id 'net.fabricmc.fabric-loom-remap' version '1.20.0-alpha.19' }
dependencies { modImplementation 'net.fabricmc:fabric-loader:0.20.1' }
`,
  );
  await writeFixture(root, "gradle.properties", "minecraft_version=1.21.1\n");
  await writeFixture(
    root,
    "src/main/resources/fabric.mod.json",
    `${JSON.stringify({ id: "ruby_tools", version: "1.0.0", depends: { minecraft: "1.21.1" } }, null, 2)}\n`,
  );
  await writeFixture(
    root,
    "src/main/java/example/UserOwned.java",
    "package example; public final class UserOwned {}\n",
  );
  await writeFixture(root, "USER_NOTES.txt", "keep this user work unchanged\n");
}

async function seedFailureProject(root: string): Promise<void> {
  await writeFixture(
    root,
    "build.gradle",
    "plugins { id 'net.fabricmc.fabric-loom-remap'\n",
  );
  await writeFixture(root, "gradle.properties", "minecraft_version=1.21.1\n");
  await writeFixture(
    root,
    "src/main/java/example/IntentionalSourceFailure.java",
    "package example; final class IntentionalSourceFailure { MissingType value; }\n",
  );
  await writeFixture(
    root,
    "src/main/resources/assets/benchmarks/models/item/broken.json",
    '{"parent":"benchmarks:item/missing"}\n',
  );
  await writeFixture(
    root,
    "src/test/java/example/IntentionalTestFailure.java",
    "package example; final class IntentionalTestFailure { { throw new AssertionError(); } }\n",
  );
}

async function listFiles(root: string, current = ""): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(join(root, current), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

async function snapshotFiles(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const path of await listFiles(root)) {
    snapshot[path] = createHash("sha256")
      .update(await readFile(join(root, ...path.split("/"))))
      .digest("hex");
  }
  return snapshot;
}

interface UnsupportedHostValue {
  readonly status: "unsupported";
  readonly code: string;
  readonly requested: unknown;
  readonly reason: { readonly code: string; readonly detail: string };
}

function unsupportedValue(result: DomainResult<unknown>): UnsupportedHostValue {
  assert.equal(result.status, "ok", JSON.stringify(result));
  const value = result.value as {
    readonly status: string;
    readonly code?: string;
    readonly requested?: unknown;
    readonly reason?: { readonly code: string; readonly detail: string };
  };
  assert.equal(value.status, "unsupported", JSON.stringify(result));
  assert.equal(value.code, "unsupported_target", JSON.stringify(result));
  assert.ok(value.reason, JSON.stringify(result));
  return value as UnsupportedHostValue;
}

interface InspectedHostValue {
  readonly status: "inspected";
  readonly target: {
    readonly coordinates: unknown;
    readonly pack: { readonly status: string } | null;
  } | null;
  readonly modMetadata: { readonly modId: string } | null;
  readonly diagnostics: readonly { readonly code: string }[];
}

function inspectedValue(result: DomainResult<unknown>): InspectedHostValue {
  assert.equal(result.status, "ok", JSON.stringify(result));
  const value = result.value as { readonly status: string };
  assert.equal(value.status, "inspected", JSON.stringify(result));
  return result.value as InspectedHostValue;
}

export async function runModelIndependentScenario(
  t: TestContext,
  host: HostName,
  scenario: BenchmarkScenario,
): Promise<ScenarioReport> {
  const started = performance.now();
  const benchmarks = await loadBenchmarks();
  const target = scenario.target ?? benchmarks.target;
  const root = await mkdtemp(join(tmpdir(), `voxellume-e2e-${scenario.id}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "disposable-project");
  const stagingRoot = join(projectRoot, ".voxellume", "staging");
  await mkdir(projectRoot);

  if (scenario.id === "existing-project")
    await seedExistingProject(projectRoot);
  if (scenario.id === "failure-recovery") await seedFailureProject(projectRoot);
  if (scenario.id === "full-delivery") {
    const initialized = await runProcess(
      "git",
      ["init", "--quiet", "--initial-branch=main"],
      { cwd: projectRoot, env: process.env, timeoutMs: 15_000 },
    );
    assert.equal(initialized.code, 0, initialized.stderr);
  }
  const before = await snapshotFiles(projectRoot);

  const operations = createHostCoreOperations({
    catalogRoot: fileURLToPath(new URL("../../target-packs/", import.meta.url)),
    authorizedProjectRoot: projectRoot,
    transactionStagingRoot: stagingRoot,
  });
  const tools = registerHosts(operations);
  let outputBytes = 0;
  const measure = (result: DomainResult<unknown>): void => {
    outputBytes += Buffer.byteLength(JSON.stringify(result));
  };

  const resolved = await invoke(
    tools,
    host,
    "minecraft_target_resolve",
    target,
  );
  measure(resolved);
  const unsupported = unsupportedValue(resolved);
  assert.deepEqual(unsupported.requested, target);

  if (
    scenario.id === "existing-project" ||
    scenario.id === "failure-recovery"
  ) {
    const inspected = await invoke(tools, host, "minecraft_project_inspect", {
      projectRoot,
    });
    measure(inspected);
    const inspection = inspectedValue(inspected);
    if (scenario.id === "existing-project") {
      assert.equal(inspection.target?.pack?.status, "candidate");
      assert.equal(inspection.modMetadata?.modId, "ruby_tools");
    } else {
      assert.ok(
        inspection.diagnostics.some(
          (diagnostic) => diagnostic.code === "build_file_malformed",
        ),
      );
    }
  }

  const destination = join(stagingRoot, `${host}-${scenario.id}`);
  const scaffold = await invoke(tools, host, "minecraft_project_scaffold", {
    destination,
    target,
    mod: {
      ...benchmarks.modDefaults,
      modId: scenario.mod.modId,
      namespace: scenario.mod.modId,
      javaPackage: `dev.voxellume.${scenario.mod.modId}`,
      name: scenario.mod.name,
      description: scenario.mod.description,
    },
  });
  measure(scaffold);
  unsupportedValue(scaffold);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(await listFiles(stagingRoot), []);
  assert.deepEqual(await snapshotFiles(projectRoot), before);

  if (scenario.id === "unsupported-target") {
    assert.deepEqual(await listFiles(projectRoot), []);
  }

  let delivery: ScenarioReport["delivery"];
  if (scenario.id === "full-delivery") {
    const [head, status, remotes] = await Promise.all([
      runProcess("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: projectRoot,
        env: process.env,
        timeoutMs: 15_000,
      }),
      runProcess("git", ["status", "--porcelain"], {
        cwd: projectRoot,
        env: process.env,
        timeoutMs: 15_000,
      }),
      runProcess("git", ["remote"], {
        cwd: projectRoot,
        env: process.env,
        timeoutMs: 15_000,
      }),
    ]);
    assert.notEqual(head.code, 0, "delivery created an unexpected commit");
    assert.equal(status.stdout, "");
    assert.equal(remotes.stdout, "");
    delivery = [
      { step: "create", status: "unsupported" },
      { step: "verify", status: "blocked" },
      { step: "document", status: "blocked" },
      { step: "commit", status: "blocked" },
      { step: "push", status: "blocked" },
      { step: "pull-request", status: "blocked" },
    ];
  }

  const blocker = `Exact target is unsupported (${unsupported.reason.code}); dependent acceptance checks were not executed.`;
  const acceptance = scenario.acceptance.map((criterion) => {
    if (scenario.id === "unsupported-target") {
      return {
        id: criterion.id,
        status: "passed" as const,
        detail:
          criterion.id === "zero-success-artifacts"
            ? "No project or staging files, commit, remote, or delivery artifact was created."
            : "The real host result retained the requested coordinates and returned unsupported_target.",
      };
    }
    return {
      id: criterion.id,
      status: "blocked" as const,
      detail: blocker,
    };
  });

  return {
    benchmarkVersion: "1.0.0",
    scenarioRevision: scenario.revision,
    scenarioId: scenario.id,
    host,
    outcome: scenario.id === "unsupported-target" ? "passed" : "blocked",
    blocker: scenario.id === "unsupported-target" ? null : blocker,
    acceptance,
    ...(delivery === undefined ? {} : { delivery }),
    metrics: {
      falseSuccessCount: 0,
      cleanBuild: "not-run",
      runtime: "not-run",
      visual: "not-run",
      repairAttempts: 0,
      humanInterventions: 0,
      outputBytes,
      wallClockMs: performance.now() - started,
      cache: "not-applicable",
    },
  };
}
