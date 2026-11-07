import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import type { CoreOperations } from "../../core/operations.ts";
import {
  serializeDomainResult,
  type DomainResult,
} from "../../core/results.ts";
import { createHostCoreOperations } from "../shared.ts";

function operationOptions(signal: AbortSignal | undefined): {
  signal?: AbortSignal;
} {
  return signal === undefined ? {} : { signal };
}

function toolResult(result: DomainResult<unknown>) {
  return {
    content: [{ type: "text" as const, text: serializeDomainResult(result) }],
    details: result,
  };
}

export function registerOmpTools(
  pi: ExtensionAPI,
  operations: CoreOperations,
): void {
  const z = pi.zod;
  const targetSchema = () =>
    z
      .object({
        edition: z.literal("java"),
        minecraftVersion: z.string(),
        loader: z.string(),
        targetPackId: z.string().optional(),
      })
      .strict();

  pi.registerTool({
    name: "minecraft_target_resolve",
    label: "Resolve Minecraft Target",
    description: "Resolve an exact Minecraft Java target pack.",
    approval: "read",
    parameters: targetSchema(),
    async execute(_toolCallId, params, signal) {
      return toolResult(
        await operations.resolveTarget(params, operationOptions(signal)),
      );
    },
  });

  pi.registerTool({
    name: "minecraft_project_inspect",
    label: "Inspect Minecraft Project",
    description: "Inspect a Minecraft mod project without changing it.",
    approval: "read",
    parameters: z.object({ projectRoot: z.string() }).strict(),
    async execute(_toolCallId, params, signal) {
      return toolResult(
        await operations.inspectProject(params, operationOptions(signal)),
      );
    },
  });

  pi.registerTool({
    name: "minecraft_project_scaffold",
    label: "Scaffold Minecraft Project",
    description: "Scaffold a supported target into transaction staging.",
    approval: "write",
    parameters: z
      .object({
        destination: z.string(),
        target: targetSchema(),
        mod: z
          .object({
            modId: z.string(),
            namespace: z.string(),
            javaPackage: z.string(),
            name: z.string(),
            version: z.string(),
            description: z.string(),
            authors: z.array(z.string()),
            license: z.string(),
          })
          .strict(),
        loaders: z
          .array(z.enum(["fabric", "neoforge", "forge", "quilt"]))
          .optional(),
      })
      .strict(),
    async execute(_toolCallId, params, signal) {
      const { loaders, ...request } = params;
      return toolResult(
        await operations.scaffoldProject(
          {
            ...request,
            ...(loaders === undefined ? {} : { loaders }),
          },
          operationOptions(signal),
        ),
      );
    },
  });

  pi.registerTool({
    name: "minecraft_assets_validate",
    label: "Validate Minecraft Assets",
    description:
      "Validate Minecraft resources and their cross-file references.",
    approval: "read",
    parameters: z
      .object({
        modId: z.string(),
        namespace: z.string(),
        metadataFile: z.string(),
        target: targetSchema(),
        files: z.record(z.string(), z.string()),
        registry: z.array(
          z
            .object({
              kind: z.enum([
                "item",
                "block",
                "sound_event",
                "configured_feature",
                "placed_feature",
              ]),
              id: z.string(),
            })
            .strict(),
        ),
        animations: z.array(
          z.object({ texture: z.string(), frameCount: z.number() }).strict(),
        ),
        requiredLangKeys: z.array(z.string()),
        datagen: z.array(
          z.object({ path: z.string(), expectedSha256: z.string() }).strict(),
        ),
      })
      .strict(),
    async execute(_toolCallId, params, signal) {
      return toolResult(
        await operations.validateAssets(params, operationOptions(signal)),
      );
    },
  });

  pi.registerTool({
    name: "minecraft_project_verify",
    label: "Verify Minecraft Project",
    description: "Run the requested staged Minecraft verification profile.",
    approval: "exec",
    parameters: z
      .object({
        projectRoot: z.string(),
        target: targetSchema(),
        modSpec: z.unknown(),
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
        identity: z
          .object({
            transactionId: z.string(),
            baseProjectSha256: z.string(),
            modSpecSha256: z.string(),
            targetPackSha256: z.string(),
            finalTreeSha256: z.string(),
          })
          .strict(),
      })
      .strict(),
    async execute(_toolCallId, params, signal) {
      return toolResult(
        await operations.verifyProject(params, operationOptions(signal)),
      );
    },
  });
}

export default function registerOmpExtension(pi: ExtensionAPI): void {
  // OMP exposes cwd on ConcreteExtensionAPI but omits it from ExtensionAPI.
  const cwd = (pi as ExtensionAPI & { readonly cwd: string }).cwd;
  const operations = createHostCoreOperations({
    catalogRoot: fileURLToPath(
      new URL("../../../target-packs/", import.meta.url),
    ),
    authorizedProjectRoot: cwd,
    transactionStagingRoot: join(cwd, ".voxellume", "staging"),
  });
  registerOmpTools(pi, operations);
}
