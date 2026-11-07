#!/usr/bin/env node

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import {
  serveStdio,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";

import type {
  CoreOperations,
  ScaffoldProjectOperationRequest,
} from "../../core/operations.ts";
import {
  domainFailure,
  serializeDomainResult,
  type DomainResult,
} from "../../core/results.ts";
import type { TargetRequest } from "../../core/targets/resolve-target.ts";
import { createHostCoreOperations } from "../shared.ts";

const MAX_RESULT_BYTES = 256 * 1024;
const MAX_TOOL_INPUT_ELEMENTS = 4096;

const nonempty = z.string().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);

const targetSchema = z
  .strictObject({
    edition: z.literal("java"),
    minecraftVersion: nonempty,
    loader: z.enum(["fabric", "neoforge", "forge", "quilt"]),
    targetPackId: nonempty.optional(),
  })
  .transform(({ targetPackId, ...target }): TargetRequest => ({
    ...target,
    ...(targetPackId === undefined ? {} : { targetPackId }),
  }));

const modSchema = z.strictObject({
  modId: identifier,
  namespace: identifier,
  javaPackage: nonempty,
  name: nonempty,
  version: nonempty,
  description: nonempty,
  authors: z.array(nonempty).min(1),
  license: nonempty,
});

const inspectSchema = z.strictObject({ projectRoot: nonempty });
const scaffoldSchema = z
  .strictObject({
    destination: nonempty,
    target: targetSchema,
    mod: modSchema,
    loaders: z
      .array(z.enum(["fabric", "neoforge", "forge", "quilt"]))
      .optional(),
  })
  .transform(({ loaders, ...request }): ScaffoldProjectOperationRequest => ({
    ...request,
    ...(loaders === undefined ? {} : { loaders }),
  }));
const assetsSchema = z.strictObject({
  modId: identifier,
  namespace: identifier,
  metadataFile: nonempty,
  target: targetSchema,
  files: z.record(z.string(), z.string()),
  registry: z.array(
    z.strictObject({
      kind: z.enum([
        "item",
        "block",
        "sound_event",
        "configured_feature",
        "placed_feature",
      ]),
      id: nonempty,
    }),
  ),
  animations: z.array(
    z.strictObject({ texture: nonempty, frameCount: z.number().int() }),
  ),
  requiredLangKeys: z.array(z.string()),
  datagen: z.array(z.strictObject({ path: nonempty, expectedSha256: sha256 })),
});
const verifySchema = z.strictObject({
  projectRoot: nonempty,
  target: targetSchema,
  modSpec: z.unknown().refine((value) => value !== undefined, "Required"),
  profile: z.enum([
    "static",
    "build",
    "server",
    "gameTest",
    "client",
    "visual",
    "release",
    "full",
  ]),
  identity: z.strictObject({
    transactionId: nonempty,
    baseProjectSha256: sha256,
    modSpecSha256: sha256,
    targetPackSha256: sha256,
    finalTreeSha256: sha256,
  }),
});

function toolResult(result: DomainResult<unknown>) {
  let output = result;
  let text = serializeDomainResult(output);
  if (Buffer.byteLength(text, "utf8") > MAX_RESULT_BYTES) {
    output = domainFailure({
      code: "output_too_large",
      detail: "Serialized DomainResult exceeds 256 KiB",
      retryable: false,
    });
    text = serializeDomainResult(output);
  }
  const structuredContent = output as unknown as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
    isError: output.status === "error",
  };
}

export function createMcpServer(operations: CoreOperations): McpServer {
  const server = new McpServer(
    { name: "voxellume", version: "0.1.0" },
    { maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS },
  );

  server.registerTool(
    "minecraft_target_resolve",
    {
      description: "Resolve an exact Minecraft Java target pack.",
      inputSchema: targetSchema,
    },
    async (request, ctx) =>
      toolResult(
        await operations.resolveTarget(request, {
          signal: ctx.mcpReq.signal,
        }),
      ),
  );
  server.registerTool(
    "minecraft_project_inspect",
    {
      description: "Inspect an existing authorized Minecraft mod project.",
      inputSchema: inspectSchema,
    },
    async (request, ctx) =>
      toolResult(
        await operations.inspectProject(request, {
          signal: ctx.mcpReq.signal,
        }),
      ),
  );
  server.registerTool(
    "minecraft_project_scaffold",
    {
      description:
        "Scaffold an exact supported target into transaction staging.",
      inputSchema: scaffoldSchema,
    },
    async (request, ctx) =>
      toolResult(
        await operations.scaffoldProject(request, {
          signal: ctx.mcpReq.signal,
        }),
      ),
  );
  server.registerTool(
    "minecraft_assets_validate",
    {
      description: "Validate target-local mod metadata and assets.",
      inputSchema: assetsSchema,
    },
    async (request, ctx) =>
      toolResult(
        await operations.validateAssets(request, {
          signal: ctx.mcpReq.signal,
        }),
      ),
  );
  server.registerTool(
    "minecraft_project_verify",
    {
      description: "Run staged evidence-backed project verification.",
      inputSchema: verifySchema,
    },
    async (request, ctx) =>
      toolResult(
        await operations.verifyProject(request, {
          signal: ctx.mcpReq.signal,
        }),
      ),
  );

  return server;
}

export function startMcpServer(operations: CoreOperations): StdioServerHandle {
  return serveStdio(() => createMcpServer(operations));
}

function runCli(): void {
  const authorizedProjectRoot = process.cwd();
  const handle = startMcpServer(
    createHostCoreOperations({
      catalogRoot: fileURLToPath(
        new URL("../../../target-packs/", import.meta.url),
      ),
      authorizedProjectRoot,
      transactionStagingRoot: join(
        authorizedProjectRoot,
        ".voxellume",
        "staging",
      ),
    }),
  );
  let closing: Promise<void> | undefined;
  const close = (): void => {
    closing ??= handle.close().catch((error: unknown) => {
      console.error("Failed to close Voxellume MCP stdio server", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (import.meta.main) {
  runCli();
}
