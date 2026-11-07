import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defineTool,
  type ToolDefinition,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";

import type {
  ValidateAssetsOperationRequest,
  CoreOperations,
} from "../../core/operations.ts";
import {
  domainFailure,
  serializeDomainResult,
  type DomainResult,
  type JsonValue,
} from "../../core/results.ts";
import { createHostCoreOperations } from "../shared.ts";

export const name = "voxellume";
export const inject = ["tools", "jobs", "systemPrompt"];

const loaders = ["fabric", "neoforge", "forge", "quilt"] as const;
const profiles = [
  "static",
  "build",
  "server",
  "gameTest",
  "client",
  "visual",
  "release",
  "full",
] as const;
const registryKinds = [
  "item",
  "block",
  "sound_event",
  "configured_feature",
  "placed_feature",
] as const;

const targetFields = {
  edition: { type: "string", const: "java", required: true },
  minecraftVersion: { type: "string", required: true },
  loader: { type: "string", enum: loaders, required: true },
  targetPackId: { type: "string" },
} as const;

const targetSchema = {
  type: "object",
  properties: targetFields,
  additionalProperties: false,
  required: true,
} as const;

const output = {
  schema: { type: "json" },
  render: (_args: unknown, value: JsonValue) => [
    {
      type: "text" as const,
      text: serializeDomainResult(value as unknown as DomainResult<unknown>),
    },
  ],
} as const;

export interface DshJobOutcome {
  status: "completed" | "killed" | "failed";
  detail?: string;
  result?: string;
}

export interface DshJobHooks {
  cancel(reason?: string): void;
  done: Promise<DshJobOutcome>;
}

export interface DshJobSpec {
  kind: string;
  label: string;
  owner?: string;
  toolCall: { callId: string; rootCallId: string };
  outputLimitBytes: number;
  run(job: {
    append(
      text: string,
      options?: { channel?: "stdout" | "stderr" | "log" },
    ): void;
    updateProgress(line: string): void;
  }): DshJobHooks;
}

export interface DshContext {
  tools: {
    register(definition: ToolDefinition): () => void;
  };
  systemPrompt: {
    section(section: {
      name: string;
      order: number;
      text: string;
      interpolate: false;
    }): () => void;
  };
  jobs?: {
    start(spec: DshJobSpec): string;
  };
}

function asJsonValue(result: DomainResult<unknown>): JsonValue {
  return result as unknown as JsonValue;
}

function unavailableJobs(): DomainResult<never> {
  return domainFailure({
    code: "unavailable",
    detail: "DSH jobs are unavailable for managed verification",
    retryable: false,
  });
}

async function executeVerification(
  ctx: DshContext,
  operations: CoreOperations,
  request: Parameters<CoreOperations["verifyProject"]>[0],
  exec: ToolRunContext,
): Promise<JsonValue> {
  if (!ctx.jobs) return asJsonValue(unavailableJobs());

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(exec.signal.reason);
  let hooks: DshJobHooks | undefined;
  let result: DomainResult<unknown> | undefined;

  try {
    exec.signal.addEventListener("abort", forwardAbort, { once: true });
    if (exec.signal.aborted) forwardAbort();
    ctx.jobs.start({
      kind: "voxellume",
      label: "Minecraft project verification",
      ...(exec.agent === undefined ? {} : { owner: exec.agent.id }),
      toolCall: { callId: exec.callId, rootCallId: exec.rootCallId },
      outputLimitBytes: 256 * 1024,
      run() {
        const done = (async (): Promise<DshJobOutcome> => {
          try {
            result = await operations.verifyProject(request, {
              signal: controller.signal,
            });
            return {
              status: controller.signal.aborted ? "killed" : "completed",
              result: serializeDomainResult(result),
            };
          } catch {
            result = domainFailure({
              code: "internal_error",
              detail: "Verification execution failed",
              retryable: false,
            });
            return {
              status: "failed",
              detail: "Verification execution failed",
            };
          } finally {
            exec.signal.removeEventListener("abort", forwardAbort);
          }
        })();
        hooks = {
          cancel(reason) {
            if (!controller.signal.aborted) controller.abort(reason);
          },
          done,
        };
        return hooks;
      },
    });
  } catch {
    controller.abort("Unable to start managed verification");
    if (hooks) await hooks.done;
    exec.signal.removeEventListener("abort", forwardAbort);
    return asJsonValue(unavailableJobs());
  }

  if (!hooks) {
    exec.signal.removeEventListener("abort", forwardAbort);
    return asJsonValue(unavailableJobs());
  }
  await hooks.done;
  return asJsonValue(
    result ??
      domainFailure({
        code: "internal_error",
        detail: "Managed verification returned no result",
        retryable: false,
      }),
  );
}

export function registerDshAdapter(
  ctx: DshContext,
  operations: CoreOperations,
  procedures: string,
): void {
  ctx.tools.register(
    defineTool({
      name: "minecraft_target_resolve",
      description: "Resolve an exact Minecraft loader and release target pack.",
      parameters: targetFields,
      output,
      async execute(args, exec) {
        return asJsonValue(
          await operations.resolveTarget(args, { signal: exec.signal }),
        );
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "minecraft_project_inspect",
      description:
        "Inspect an existing Minecraft mod project without modifying it.",
      parameters: { projectRoot: { type: "string", required: true } },
      output,
      async execute(args, exec) {
        return asJsonValue(
          await operations.inspectProject(args, { signal: exec.signal }),
        );
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "minecraft_project_scaffold",
      description:
        "Scaffold a mod in the host-authorized transaction staging root.",
      parameters: {
        destination: { type: "string", required: true },
        target: targetSchema,
        mod: {
          type: "object",
          additionalProperties: false,
          required: true,
          properties: {
            modId: { type: "string", required: true },
            namespace: { type: "string", required: true },
            javaPackage: { type: "string", required: true },
            name: { type: "string", required: true },
            version: { type: "string", required: true },
            description: { type: "string", required: true },
            authors: {
              type: "array",
              items: { type: "string" },
              required: true,
            },
            license: { type: "string", required: true },
          },
        },
        loaders: {
          type: "array",
          items: { type: "string", enum: loaders },
        },
      },
      output,
      async execute(args, exec) {
        return asJsonValue(
          await operations.scaffoldProject(args, { signal: exec.signal }),
        );
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "minecraft_assets_validate",
      description:
        "Validate mod metadata, assets, resources, and cross-file references.",
      parameters: {
        target: targetSchema,
        modId: { type: "string", required: true },
        namespace: { type: "string", required: true },
        metadataFile: { type: "string", required: true },
        files: {
          type: "object",
          properties: {},
          additionalProperties: true,
          required: true,
        },
        registry: {
          type: "array",
          required: true,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", enum: registryKinds, required: true },
              id: { type: "string", required: true },
            },
          },
        },
        animations: {
          type: "array",
          required: true,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              texture: { type: "string", required: true },
              frameCount: { type: "integer", required: true },
            },
          },
        },
        requiredLangKeys: {
          type: "array",
          items: { type: "string" },
          required: true,
        },
        datagen: {
          type: "array",
          required: true,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: { type: "string", required: true },
              expectedSha256: { type: "string", required: true },
            },
          },
        },
      },
      output,
      async execute(args, exec) {
        return asJsonValue(
          await operations.validateAssets(
            args as unknown as ValidateAssetsOperationRequest,
            {
              signal: exec.signal,
            },
          ),
        );
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "minecraft_project_verify",
      description:
        "Run staged Minecraft project verification as one managed job.",
      parameters: {
        projectRoot: { type: "string", required: true },
        target: targetSchema,
        modSpec: { type: "json", required: true },
        profile: { type: "string", enum: profiles, required: true },
        identity: {
          type: "object",
          additionalProperties: false,
          required: true,
          properties: {
            transactionId: { type: "string", required: true },
            baseProjectSha256: { type: "string", required: true },
            modSpecSha256: { type: "string", required: true },
            targetPackSha256: { type: "string", required: true },
            finalTreeSha256: { type: "string", required: true },
          },
        },
      },
      output,
      execute(args, exec) {
        return executeVerification(ctx, operations, args, exec);
      },
    }),
  );

  ctx.systemPrompt.section({
    name: "voxellume:procedures",
    order: 4000,
    text: procedures,
    interpolate: false,
  });
}

export async function apply(ctx: DshContext): Promise<void> {
  const skillsRoot = fileURLToPath(
    new URL("../../../skills/", import.meta.url),
  );
  const skillNames = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("minecraft-"),
    )
    .map((entry) => entry.name)
    .sort();
  const procedures = (
    await Promise.all(
      skillNames.map((skillName) =>
        readFile(join(skillsRoot, skillName, "SKILL.md"), "utf8"),
      ),
    )
  ).join("\n\n");
  const authorizedProjectRoot = process.cwd();
  const operations = createHostCoreOperations({
    catalogRoot: fileURLToPath(
      new URL("../../../target-packs/", import.meta.url),
    ),
    authorizedProjectRoot,
    transactionStagingRoot: join(
      authorizedProjectRoot,
      ".voxellume",
      "staging",
    ),
  });
  registerDshAdapter(ctx, operations, procedures);
}
