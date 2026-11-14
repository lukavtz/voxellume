import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import { serializeToolResult } from "../../core/results.ts";
import type { AssetsCheckRequest } from "../../core/tools/assets-check.ts";
import { TASK_IDS, type RunRequest } from "../../core/tools/run.ts";
import type { ScaffoldRequest } from "../../core/tools/scaffold.ts";
import type { TargetInfoRequest } from "../../core/tools/target-info.ts";
import { createVoxellumeTools } from "../shared.ts";

const EXTRA_ARGS = ["--offline", "--info", "--stacktrace"] as const;

/** Register the four Voxellume tools on an OMP extension API. */
export function registerOmpTools(pi: ExtensionAPI): void {
  const z = pi.zod;
  const tools = createVoxellumeTools(process.cwd());

  const modSchema = z.object({
    modId: z.string(),
    javaPackage: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string(),
    authors: z.array(z.string()).min(1),
    license: z.string(),
  });

  pi.registerTool({
    name: "minecraft_target_info",
    label: "Minecraft target info",
    description:
      "List pinned Minecraft Java targets (loader, versions, JDK, template) and the plugin's tools.",
    approval: "read",
    parameters: z.object({
      id: z.string().optional(),
      minecraft: z.string().optional(),
      loader: z.string().optional(),
    }),
    async execute(_callId, params) {
      // The host validated `parameters` against the schema above.
      const result = await tools.targetInfo(params as TargetInfoRequest);
      return { content: [{ type: "text", text: serializeToolResult(result) }] };
    },
  });

  pi.registerTool({
    name: "minecraft_project_scaffold",
    label: "Minecraft project scaffold",
    description:
      "Copy the pinned Fabric template into a new project and rewrite its package, mod id, name, version, and license.",
    approval: "exec",
    parameters: z.object({
      destination: z.string(),
      pinId: z.string().optional(),
      mod: modSchema,
    }),
    async execute(_callId, params) {
      // The host validated `parameters` against the schema above.
      const result = await tools.scaffold(params as ScaffoldRequest);
      return { content: [{ type: "text", text: serializeToolResult(result) }] };
    },
  });

  pi.registerTool({
    name: "minecraft_run",
    label: "Minecraft run",
    description:
      "Run one allowlisted Gradle task (build, runServer, runClient, runGametest, …) in a scaffolded project and report the observed exit code, log path, and log tail.",
    approval: "exec",
    parameters: z.object({
      projectRoot: z.string(),
      task: z.enum(TASK_IDS),
      extraArgs: z.array(z.enum(EXTRA_ARGS)).optional(),
      timeoutSeconds: z.number().int().min(1).max(3600).optional(),
      stopOnLog: z.string().max(200).optional(),
    }),
    async execute(_callId, params, signal) {
      // The host validated `parameters` against the schema above.
      const result = await tools.run(params as RunRequest, signal);
      return { content: [{ type: "text", text: serializeToolResult(result) }] };
    },
  });

  pi.registerTool({
    name: "minecraft_assets_check",
    label: "Minecraft assets check",
    description:
      "Validate textures, model texture references, lang key/placeholder parity, and screenshot diffs inside a project.",
    approval: "read",
    parameters: z.object({
      projectRoot: z.string(),
      textures: z.array(z.string()).optional(),
      models: z.array(z.string()).optional(),
      lang: z
        .object({
          baseline: z.string(),
          compare: z.array(z.string()),
          requiredKeys: z.array(z.string()).optional(),
        })
        .optional(),
      diff: z
        .object({
          baseline: z.string(),
          baselineSha256: z.string(),
          capture: z.string(),
          threshold: z.number().min(0).max(1),
          maxDifferentPixels: z.number().int().min(0),
        })
        .optional(),
    }),
    async execute(_callId, params) {
      // The host validated `parameters` against the schema above.
      const result = await tools.checkAssets(params as AssetsCheckRequest);
      return { content: [{ type: "text", text: serializeToolResult(result) }] };
    },
  });
}

export default function registerOmpExtension(pi: ExtensionAPI): void {
  registerOmpTools(pi);
}
