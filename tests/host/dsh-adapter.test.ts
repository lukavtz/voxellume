import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";

import type { CoreOperations } from "../../src/core/operations.ts";
import {
  domainFailure,
  domainSuccess,
  type DomainResult,
  type JsonValue,
} from "../../src/core/results.ts";
import {
  apply,
  inject,
  name,
  registerDshAdapter,
  type DshContext,
  type DshJobSpec,
} from "../../src/adapters/dsh/index.ts";

const toolNames = [
  "minecraft_target_resolve",
  "minecraft_project_inspect",
  "minecraft_project_scaffold",
  "minecraft_assets_validate",
  "minecraft_project_verify",
] as const;

const target = {
  edition: "java",
  minecraftVersion: "1.21.1",
  loader: "fabric",
} as const;

const verifyRequest = {
  projectRoot: "/project",
  target,
  modSpec: { schemaVersion: "mod-spec-1.0.0" },
  profile: "build",
  identity: {
    transactionId: "transaction-1",
    baseProjectSha256: "a".repeat(64),
    modSpecSha256: "b".repeat(64),
    targetPackSha256: "c".repeat(64),
    finalTreeSha256: "d".repeat(64),
  },
} as const;

interface FakeHost {
  ctx: DshContext;
  tools: Map<string, ToolDefinition>;
  sections: { name: string; text: string }[];
  jobSpecs: DshJobSpec[];
}

function fakeHost(withJobs = true): FakeHost {
  const tools = new Map<string, ToolDefinition>();
  const sections: { name: string; text: string }[] = [];
  const jobSpecs: DshJobSpec[] = [];
  const ctx: DshContext = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    systemPrompt: {
      section(section) {
        assert.equal(typeof section.text, "string");
        sections.push({ name: section.name, text: section.text });
        return () => {};
      },
    },
    ...(withJobs
      ? {
          jobs: {
            start(spec) {
              jobSpecs.push(spec);
              spec.run({ append() {}, updateProgress() {} });
              return "voxellume-test-job";
            },
          },
        }
      : {}),
  };
  return { ctx, tools, sections, jobSpecs };
}

function execution(signal = new AbortController().signal): ToolRunContext {
  return {
    callId: "call-1",
    rootCallId: "call-1",
    name: "voxellume-test",
    arguments: {},
    token: Symbol("call"),
    signal,
    deferContext() {},
    concludeTurn() {},
  } as unknown as ToolRunContext;
}

function fakeOperations(
  results: Record<(typeof toolNames)[number], DomainResult<JsonValue>>,
  calls: { name: string; request: unknown; signal?: AbortSignal }[] = [],
): CoreOperations {
  const invoke = async (
    name: (typeof toolNames)[number],
    request: unknown,
    options?: { signal?: AbortSignal },
  ) => {
    calls.push({
      name,
      request,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    return results[name];
  };
  return {
    resolveTarget: (request, options) =>
      invoke("minecraft_target_resolve", request, options),
    inspectProject: (request, options) =>
      invoke("minecraft_project_inspect", request, options),
    scaffoldProject: (request, options) =>
      invoke("minecraft_project_scaffold", request, options),
    validateAssets: (request, options) =>
      invoke("minecraft_assets_validate", request, options),
    verifyProject: (request, options) =>
      invoke("minecraft_project_verify", request, options),
  } as CoreOperations;
}

function requiredTool(
  host: FakeHost,
  name: (typeof toolNames)[number],
): ToolDefinition {
  const tool = host.tools.get(name);
  assert.ok(tool, `missing ${name}`);
  return tool;
}

test("registers five operation-specific tools and one shared prompt section", () => {
  const host = fakeHost();
  const operations = fakeOperations({
    minecraft_target_resolve: domainSuccess({ operation: "resolve" }),
    minecraft_project_inspect: domainSuccess({ operation: "inspect" }),
    minecraft_project_scaffold: domainSuccess({ operation: "scaffold" }),
    minecraft_assets_validate: domainSuccess({ operation: "assets" }),
    minecraft_project_verify: domainSuccess({ operation: "verify" }),
  });

  registerDshAdapter(host.ctx, operations, "SHARED PROCEDURES");

  assert.deepEqual([...host.tools.keys()], toolNames);
  assert.deepEqual(host.sections, [
    { name: "voxellume:procedures", text: "SHARED PROCEDURES" },
  ]);
  assert.deepEqual(
    Object.keys(
      requiredTool(host, "minecraft_target_resolve").parameters.properties ??
        {},
    ),
    ["edition", "minecraftVersion", "loader", "targetPackId"],
  );
  assert.deepEqual(
    Object.keys(
      requiredTool(host, "minecraft_project_verify").parameters.properties ??
        {},
    ),
    ["projectRoot", "target", "modSpec", "profile", "identity"],
  );
  for (const toolName of toolNames) {
    assert.deepEqual(requiredTool(host, toolName).output.schema, {});
  }
});

test("verification awaits its managed job and returns the same result without detached work", async () => {
  let finish!: (result: DomainResult<JsonValue>) => void;
  let active = 0;
  let settled = false;
  const expected = domainSuccess({ operation: "managed verify" });
  const operations = fakeOperations({
    minecraft_target_resolve: domainSuccess(null),
    minecraft_project_inspect: domainSuccess(null),
    minecraft_project_scaffold: domainSuccess(null),
    minecraft_assets_validate: domainSuccess(null),
    minecraft_project_verify: expected,
  });
  operations.verifyProject = async (_request, options) => {
    active += 1;
    assert.equal(options?.signal?.aborted, false);
    return new Promise<DomainResult<JsonValue>>((resolve) => {
      finish = (result) => {
        active -= 1;
        settled = true;
        resolve(result);
      };
    }) as never;
  };
  const host = fakeHost();
  registerDshAdapter(host.ctx, operations, "PROCEDURES");

  let returned = false;
  const pending = requiredTool(host, "minecraft_project_verify")
    .execute(verifyRequest, execution())
    .then((result) => {
      returned = true;
      return result;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.jobSpecs.length, 1);
  assert.equal(host.jobSpecs[0]?.kind, "voxellume");
  assert.equal(returned, false);
  assert.equal(active, 1);

  finish(expected);
  assert.strictEqual(await pending, expected);
  assert.equal(returned, true);
  assert.equal(settled, true);
  assert.equal(active, 0);
});

test("verification cancellation reaches core and managed job completion is still awaited", async () => {
  const cancelled = domainFailure({
    code: "cancelled",
    detail: "Verification cancelled",
    retryable: false,
  });
  let cleanupFinished = false;
  const host = fakeHost();
  const operations = fakeOperations({
    minecraft_target_resolve: domainSuccess(null),
    minecraft_project_inspect: domainSuccess(null),
    minecraft_project_scaffold: domainSuccess(null),
    minecraft_assets_validate: domainSuccess(null),
    minecraft_project_verify: cancelled,
  });
  operations.verifyProject = async (_request, options) =>
    new Promise((resolve) => {
      options?.signal?.addEventListener(
        "abort",
        () => {
          setImmediate(() => {
            cleanupFinished = true;
            resolve(cancelled as never);
          });
        },
        { once: true },
      );
    });
  registerDshAdapter(host.ctx, operations, "PROCEDURES");
  const controller = new AbortController();
  const pending = requiredTool(host, "minecraft_project_verify").execute(
    verifyRequest,
    execution(controller.signal),
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort("stop");
  assert.strictEqual(await pending, cancelled);
  assert.equal(cleanupFinished, true);
});

test("verification reports unavailable when jobs are absent and never executes directly", async () => {
  let called = false;
  const host = fakeHost(false);
  const operations = fakeOperations({
    minecraft_target_resolve: domainSuccess(null),
    minecraft_project_inspect: domainSuccess(null),
    minecraft_project_scaffold: domainSuccess(null),
    minecraft_assets_validate: domainSuccess(null),
    minecraft_project_verify: domainSuccess(null),
  });
  operations.verifyProject = async () => {
    called = true;
    return domainSuccess(null) as never;
  };
  registerDshAdapter(host.ctx, operations, "PROCEDURES");

  const result = await requiredTool(host, "minecraft_project_verify").execute(
    verifyRequest,
    execution(),
  );
  assert.deepEqual(result, {
    schemaVersion: "domain-result-1.0.0",
    status: "error",
    error: {
      code: "unavailable",
      detail: "DSH jobs are unavailable for managed verification",
      retryable: false,
    },
    evidence: [],
  });
  assert.equal(called, false);
});

test("default apply loads every shared skill and declares host services", async () => {
  const host = fakeHost();
  await apply(host.ctx);
  assert.equal(name, "voxellume");
  assert.deepEqual(inject, ["tools", "jobs", "systemPrompt"]);
  assert.equal(host.tools.size, 5);
  assert.equal(host.sections.length, 1);
  const skillNames = (
    await readdir(new URL("../../skills/", import.meta.url), {
      withFileTypes: true,
    })
  )
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("minecraft-"),
    )
    .map((entry) => entry.name)
    .sort();
  assert.ok(skillNames.length >= 14);
  for (const skillName of skillNames) {
    const markdown = await readFile(
      new URL(`../../skills/${skillName}/SKILL.md`, import.meta.url),
      "utf8",
    );
    assert.ok(host.sections[0]?.text.includes(markdown));
  }
});
