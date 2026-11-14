import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { z } from "zod";

import registerOmpExtension from "../../src/adapters/omp/index.ts";

interface RegisteredTool {
  name: string;
  approval?: string;
  description: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

function fakeHost(): {
  tools: RegisteredTool[];
  host: Record<string, unknown>;
} {
  const tools: RegisteredTool[] = [];
  return {
    tools,
    host: {
      zod: z,
      registerTool: (tool: RegisteredTool) => {
        tools.push(tool);
      },
    },
  };
}

test("OMP extension registers the four plugin tools with approvals", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "voxellume-omp-"));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  const { tools, host } = fakeHost();
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    registerOmpExtension(host as never);
  } finally {
    process.chdir(previous);
  }
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "minecraft_target_info",
      "minecraft_project_scaffold",
      "minecraft_run",
      "minecraft_assets_check",
    ],
  );
  assert.deepEqual(
    tools.map((tool) => tool.approval),
    ["read", "exec", "exec", "read"],
  );
  for (const tool of tools) assert.ok(tool.description.length > 20);

  const info = tools[0]!;
  const result = await info.execute("call-1", {
    minecraft: "1.21.1",
    loader: "fabric",
  });
  const text = result.content[0]?.text ?? "";
  assert.ok(text.includes('"status":"ok"'));
  assert.ok(text.includes("java-fabric-1.21.1"));
});
