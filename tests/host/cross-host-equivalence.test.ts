import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import {
  InMemoryTransport,
  type McpServer,
} from "@modelcontextprotocol/server";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod";

import {
  registerDshAdapter,
  type DshContext,
} from "../../src/adapters/dsh/index.ts";
import { createMcpServer } from "../../src/adapters/mcp/server.ts";
import { registerOmpTools } from "../../src/adapters/omp/index.ts";
import { createHostCoreOperations } from "../../src/adapters/shared.ts";
import type { CoreOperations } from "../../src/core/operations.ts";
import {
  serializeDomainResult,
  type DomainResult,
  type JsonValue,
} from "../../src/core/results.ts";
import { createRealCoreFixture, mod, target } from "./real-core.ts";

interface OmpTool {
  name: string;
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

interface JsonRpcMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ToolCallResult {
  content: [{ type: "text"; text: string }];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

class InMemoryClient {
  private nextId = 0;
  private readonly pending = new Map<
    number,
    (message: JsonRpcMessage) => void
  >();

  private readonly transport: InMemoryTransport;
  private readonly server: McpServer;

  private constructor(transport: InMemoryTransport, server: McpServer) {
    this.transport = transport;
    this.server = server;
    transport.onmessage = (message) => {
      const response = message as JsonRpcMessage;
      if (response.id === undefined) return;
      this.pending.get(response.id)?.(response);
      this.pending.delete(response.id);
    };
  }

  static async connect(operations: CoreOperations): Promise<InMemoryClient> {
    const server = createMcpServer(operations);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new InMemoryClient(clientTransport, server);
    await server.connect(serverTransport);
    await client.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "real-core-host-test", version: "1.0.0" },
    });
    await clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    return client;
  }

  async request(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<JsonRpcMessage> {
    const id = ++this.nextId;
    const { promise, resolve } = Promise.withResolvers<JsonRpcMessage>();
    this.pending.set(id, resolve);
    await this.transport.send({
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    });
    return promise;
  }

  async call(name: string, args: unknown): Promise<ToolCallResult> {
    const message = await this.request("tools/call", {
      name,
      arguments: args,
    });
    assert.equal(message.error, undefined, JSON.stringify(message.error));
    return message.result as unknown as ToolCallResult;
  }

  async close(): Promise<void> {
    await this.transport.close();
    await this.server.close();
  }
}

interface Hosts {
  ompTools: Map<string, OmpTool>;
  dshTools: Map<string, ToolDefinition>;
  mcp: InMemoryClient;
}

async function registerHosts(
  t: TestContext,
  operations: CoreOperations,
): Promise<Hosts> {
  const ompTools = new Map<string, OmpTool>();
  const pi = {
    zod: z,
    registerTool(tool: OmpTool) {
      ompTools.set(tool.name, tool);
    },
  } as unknown as ExtensionAPI;
  registerOmpTools(pi, operations);

  const dshTools = new Map<string, ToolDefinition>();
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        dshTools.set(definition.name, definition);
        return () => dshTools.delete(definition.name);
      },
    },
    systemPrompt: {
      section() {
        return () => {};
      },
    },
    jobs: {
      start() {
        throw new Error("No managed jobs are used by these operations");
      },
    },
  } as unknown as DshContext;
  registerDshAdapter(ctx, operations, "SHARED PROCEDURES");

  const mcp = await InMemoryClient.connect(operations);
  t.after(() => mcp.close());
  return { ompTools, dshTools, mcp };
}

function execution(): ToolRunContext {
  return {
    callId: "real-core-call",
    rootCallId: "real-core-call",
    name: "voxellume-test",
    arguments: {},
    token: Symbol("call"),
    signal: new AbortController().signal,
    deferContext() {},
    concludeTurn() {},
  } as unknown as ToolRunContext;
}

async function assertHostEquivalence(
  hosts: Hosts,
  name: string,
  request: unknown,
  expected: DomainResult<unknown>,
  host?: "omp" | "dsh" | "mcp",
): Promise<void> {
  if (host === undefined || host === "omp") {
    const omp = hosts.ompTools.get(name);
    assert.ok(omp, `missing OMP ${name}`);
    const ompResult = await omp.execute(
      "real-core-call",
      request,
      new AbortController().signal,
      undefined,
      {},
    );
    assert.deepEqual(ompResult.details, expected);
    assert.deepEqual(ompResult.content, [
      { type: "text", text: serializeDomainResult(expected) },
    ]);
  }

  if (host === undefined || host === "dsh") {
    const dsh = hosts.dshTools.get(name);
    assert.ok(dsh, `missing DSH ${name}`);
    const dshResult = await dsh.execute(request, execution());
    assert.deepEqual(dshResult, expected);
    assert.deepEqual(
      dsh.output.render(request, dshResult as unknown as JsonValue),
      [{ type: "text", text: serializeDomainResult(expected) }],
    );
  }

  if (host === undefined || host === "mcp") {
    const mcpResult = await hosts.mcp.call(name, request);
    assert.deepEqual(mcpResult.structuredContent, expected);
    assert.equal(mcpResult.content[0].text, serializeDomainResult(expected));
    assert.equal(mcpResult.isError, expected.status === "error");
  }
}

test("real core resolves an explicit target identically through OMP, DSH, and MCP", async (t) => {
  const fixture = await createRealCoreFixture(t);
  const hosts = await registerHosts(t, fixture.operations);
  const request = { ...target, targetPackId: "java-fabric-1.21.1-r1" };
  const direct = await fixture.operations.resolveTarget(request);

  assert.equal(direct.status, "ok");
  assert.ok(direct.status === "ok" && direct.value.status === "resolved");
  assert.equal(direct.value.target.id, "java-fabric-1.21.1-r1");
  await assertHostEquivalence(
    hosts,
    "minecraft_target_resolve",
    request,
    direct,
  );
});

test("unknown exact versions are outer-ok unsupported results on every host", async (t) => {
  const fixture = await createRealCoreFixture(t);
  const hosts = await registerHosts(t, fixture.operations);
  const request = { ...target, minecraftVersion: "1.21.2" };
  const direct = await fixture.operations.resolveTarget(request);

  assert.equal(direct.status, "ok");
  assert.ok(direct.status === "ok" && direct.value.status === "unsupported");
  assert.equal(direct.value.code, "unsupported_target");
  await assertHostEquivalence(
    hosts,
    "minecraft_target_resolve",
    request,
    direct,
  );
});

test("an unavailable catalog is a genuine outer error on every host", async (t) => {
  const fixture = await createRealCoreFixture(t);
  const operations = createHostCoreOperations({
    catalogRoot: join(fixture.root, "missing-catalog"),
    authorizedProjectRoot: fixture.projectRoot,
    transactionStagingRoot: fixture.stagingRoot,
  });
  const hosts = await registerHosts(t, operations);
  const direct = await operations.resolveTarget(target);

  assert.equal(direct.status, "error");
  assert.ok(direct.status === "error");
  assert.equal(direct.error.code, "catalog_unavailable");
  await assertHostEquivalence(
    hosts,
    "minecraft_target_resolve",
    target,
    direct,
  );
});

async function assertGoldenScaffold(destination: string): Promise<void> {
  assert.equal(
    await readFile(join(destination, "settings.gradle"), "utf8"),
    `pluginManagement {
	repositories {
		maven {
			name = 'Fabric'
			url = 'https://maven.fabricmc.net/'
		}
		mavenCentral()
		gradlePluginPortal()
	}
}

// Should match your ruby_tools
rootProject.name = 'ruby_tools'
`,
  );
  const metadata = JSON.parse(
    await readFile(
      join(destination, "src/main/resources/fabric.mod.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  assert.equal(metadata.id, "ruby_tools");
  assert.equal(metadata.version, "1.2.3");
  assert.equal(metadata.name, "Ruby Tools");
  assert.deepEqual(metadata.authors, ["Voxellume Tests"]);
  assert.equal(metadata.license, "MIT");
  assert.equal(metadata.icon, "assets/ruby_tools/icon.png");
  const java = await readFile(
    join(destination, "src/main/java/dev/voxellume/ruby_tools/RubyTools.java"),
    "utf8",
  );
  assert.match(java, /package dev\.voxellume\.ruby_tools;/);
  assert.match(java, /public class RubyTools implements ModInitializer/);
  assert.match(java, /MOD_ID = "ruby_tools"/);
}

test("real scaffolding succeeds through every public host with initially missing roots", async (t) => {
  const fixture = await createRealCoreFixture(t, { templates: true });
  assert.equal(existsSync(fixture.stagingRoot), false);
  const hosts = await registerHosts(t, fixture.operations);
  const destinations = Object.fromEntries(
    ["direct", "omp", "dsh", "mcp"].map((host) => [
      host,
      join(fixture.stagingRoot, `${host}-project`),
    ]),
  ) as Record<"direct" | "omp" | "dsh" | "mcp", string>;
  for (const destination of Object.values(destinations)) {
    assert.equal(existsSync(destination), false);
  }

  const direct = await fixture.operations.scaffoldProject({
    destination: destinations.direct,
    target: { ...target, targetPackId: "java-fabric-1.21.1-r1" },
    mod,
  });
  assert.equal(direct.status, "ok", JSON.stringify(direct));
  assert.ok(direct.status === "ok" && direct.value.status === "scaffolded");
  assert.ok(direct.value.createdPaths.includes("voxellume.mod.json"));
  assert.deepEqual(direct.value.modSpec.metadata, {
    name: mod.name,
    version: mod.version,
    description: mod.description,
    authors: mod.authors,
    license: mod.license,
  });
  assert.equal(direct.value.modSpec.targetPackId, "java-fabric-1.21.1-r1");
  assert.equal(direct.value.modSpec.targetPackRevision, 1);

  for (const host of ["omp", "dsh", "mcp"] as const) {
    await assertHostEquivalence(
      hosts,
      "minecraft_project_scaffold",
      {
        destination: destinations[host],
        target: { ...target, targetPackId: "java-fabric-1.21.1-r1" },
        mod,
        loaders: ["fabric"],
      },
      direct,
      host,
    );
  }
  for (const destination of Object.values(destinations)) {
    await assertGoldenScaffold(destination);
    const persistedSpec = JSON.parse(
      await readFile(join(destination, "voxellume.mod.json"), "utf8"),
    ) as unknown;
    assert.deepEqual(persistedSpec, direct.value.modSpec);
  }
});
