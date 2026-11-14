import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { defineTool } from "@deepseek-ai/dsh-tools";

import { packageRoot } from "../../core/root.ts";
import { serializeToolResult, type ToolResult } from "../../core/results.ts";
import type { AssetsCheckRequest } from "../../core/tools/assets-check.ts";
import type { RunRequest } from "../../core/tools/run.ts";
import type { ScaffoldRequest } from "../../core/tools/scaffold.ts";
import type { TargetInfoRequest } from "../../core/tools/target-info.ts";
import { createVoxellumeTools } from "../shared.ts";

export const name = "voxellume";
export const inject = ["tools", "systemPrompt"] as const;

const SECTION_NAME = "voxellume-procedures";
const SECTION_ORDER = 4000;

interface ToolRegistry {
  register(definition: ReturnType<typeof defineTool>): () => void;
}

interface PromptRegistry {
  section(section: {
    name: string;
    order: number;
    text: string;
    interpolate?: boolean;
  }): () => void;
}

export interface DshContext {
  readonly tools: ToolRegistry;
  readonly systemPrompt: PromptRegistry;
}

type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { readonly [key: string]: Json };

/** Envelope as lossless JSON, for hosts that hand tools a JSON value. */
function envelopeJson(result: ToolResult<unknown>): Json {
  return JSON.parse(serializeToolResult(result)) as Json;
}

const output = {
  schema: { type: "json" as const },
  render(_args: unknown, value: unknown) {
    return [{ type: "text" as const, text: JSON.stringify(value) }];
  },
};

const modParameters = {
  modId: { type: "string" as const, required: true as const },
  javaPackage: { type: "string" as const, required: true as const },
  name: { type: "string" as const, required: true as const },
  version: { type: "string" as const, required: true as const },
  description: { type: "string" as const, required: true as const },
  authors: {
    type: "array" as const,
    items: { type: "string" as const },
    required: true as const,
  },
  license: { type: "string" as const, required: true as const },
};

function defineTools(tools: ReturnType<typeof createVoxellumeTools>) {
  return [
    defineTool({
      name: "minecraft_target_info",
      description:
        "List pinned Minecraft Java targets (loader, versions, JDK, template) and the plugin's tools.",
      parameters: {
        id: { type: "string" },
        minecraft: { type: "string" },
        loader: { type: "string" },
      },
      output,
      isConcurrencySafe: () => true,
      async execute(args) {
        // The host validated `parameters` against the schema above.
        return envelopeJson(await tools.targetInfo(args as TargetInfoRequest));
      },
    }),
    defineTool({
      name: "minecraft_project_scaffold",
      description:
        "Copy the pinned Fabric template into a new project and rewrite its package, mod id, name, version, and license.",
      parameters: {
        destination: { type: "string", required: true },
        pinId: { type: "string" },
        mod: {
          type: "object",
          additionalProperties: false,
          properties: modParameters,
          required: true,
        },
      },
      output,
      async execute(args) {
        return envelopeJson(await tools.scaffold(args as ScaffoldRequest));
      },
    }),
    defineTool({
      name: "minecraft_run",
      description:
        "Run one allowlisted Gradle task (build, runServer, runClient, runGametest, …) in a scaffolded project and report the observed exit code, log path, and log tail.",
      parameters: {
        projectRoot: { type: "string", required: true },
        task: {
          type: "string",
          enum: [
            "build",
            "clean",
            "test",
            "runServer",
            "runClient",
            "runGametest",
            "genSources",
          ],
          required: true,
        },
        extraArgs: {
          type: "array",
          items: { type: "string", enum: ["--offline", "--info", "--stacktrace"] },
        },
        timeoutSeconds: { type: "integer" },
        stopOnLog: { type: "string" },
      },
      output,
      async execute(args, exec) {
        return envelopeJson(
          await tools.run(args as RunRequest, exec.signal),
        );
      },
    }),
    defineTool({
      name: "minecraft_assets_check",
      description:
        "Validate textures, model texture references, lang key/placeholder parity, and screenshot diffs inside a project.",
      parameters: {
        projectRoot: { type: "string", required: true },
        textures: { type: "array", items: { type: "string" } },
        models: { type: "array", items: { type: "string" } },
        lang: {
          type: "object",
          additionalProperties: false,
          properties: {
            baseline: { type: "string", required: true },
            compare: {
              type: "array",
              items: { type: "string" },
              required: true,
            },
            requiredKeys: { type: "array", items: { type: "string" } },
          },
        },
        diff: {
          type: "object",
          additionalProperties: false,
          properties: {
            baseline: { type: "string", required: true },
            baselineSha256: { type: "string", required: true },
            capture: { type: "string", required: true },
            threshold: { type: "number", required: true },
            maxDifferentPixels: { type: "integer", required: true },
          },
        },
      },
      output,
      isConcurrencySafe: () => true,
      async execute(args) {
        return envelopeJson(await tools.checkAssets(args as AssetsCheckRequest));
      },
    }),
  ];
}

/** Concatenate every shipped skill body into one prompt section. */
async function procedures(): Promise<string> {
  const skillsRoot = join(packageRoot(), "skills");
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const bodies: string[] = [];
  for (const skill of names) {
    bodies.push((await readFile(join(skillsRoot, skill, "SKILL.md"), "utf8")).trim());
  }
  return bodies.join("\n\n---\n\n");
}

export async function apply(ctx: DshContext): Promise<void> {
  const tools = createVoxellumeTools(process.cwd());
  for (const definition of defineTools(tools)) ctx.tools.register(definition);
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: await procedures(),
    interpolate: false,
  });
}
