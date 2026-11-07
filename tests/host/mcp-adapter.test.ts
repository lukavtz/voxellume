import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  InMemoryTransport,
  type McpServer,
} from "@modelcontextprotocol/server";

import type { CoreOperations } from "../../src/core/operations.ts";
import {
  domainFailure,
  domainSuccess,
  serializeDomainResult,
  type DomainResult,
} from "../../src/core/results.ts";
import { createMcpServer } from "../../src/adapters/mcp/server.ts";

const TOOL_NAMES = [
  "minecraft_assets_validate",
  "minecraft_project_inspect",
  "minecraft_project_scaffold",
  "minecraft_project_verify",
  "minecraft_target_resolve",
] as const;

type ToolName = (typeof TOOL_NAMES)[number];

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: JsonRpcError;
}

interface ToolCallResult {
  content: [{ type: "text"; text: string }];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

const target = {
  edition: "java",
  minecraftVersion: "1.21.1",
  loader: "fabric",
} as const;

const requests: Record<ToolName, Record<string, unknown>> = {
  minecraft_target_resolve: { ...target },
  minecraft_project_inspect: { projectRoot: "/work/project" },
  minecraft_project_scaffold: {
    destination: "/work/staging/project",
    target,
    mod: {
      modId: "ruby_blade",
      namespace: "ruby_blade",
      javaPackage: "dev.example.ruby_blade",
      name: "Ruby Blade",
      version: "1.0.0",
      description: "Adds a ruby blade",
      authors: ["Tester"],
      license: "MIT",
    },
    loaders: ["fabric"],
  },
  minecraft_assets_validate: {
    modId: "ruby_blade",
    namespace: "ruby_blade",
    metadataFile: "fabric.mod.json",
    target,
    files: { "fabric.mod.json": "{}" },
    registry: [{ kind: "item", id: "ruby_blade:ruby_blade" }],
    animations: [{ texture: "ruby_blade.png", frameCount: 2 }],
    requiredLangKeys: ["item.ruby_blade.ruby_blade"],
    datagen: [
      {
        path: "data/ruby_blade/recipe/ruby_blade.json",
        expectedSha256: "0".repeat(64),
      },
    ],
  },
  minecraft_project_verify: {
    projectRoot: "/work/project",
    target,
    modSpec: { schemaVersion: "mod-spec-1.0.0" },
    profile: "static",
    identity: {
      transactionId: "transaction-1",
      baseProjectSha256: "1".repeat(64),
      modSpecSha256: "2".repeat(64),
      targetPackSha256: "3".repeat(64),
      finalTreeSha256: "4".repeat(64),
    },
  },
};

interface RecordedCall {
  name: ToolName;
  request: unknown;
  signal: AbortSignal | undefined;
}

function recordingOperations(
  resultFor: (name: ToolName) => DomainResult<unknown>,
  calls: RecordedCall[],
): CoreOperations {
  const record = async (
    name: ToolName,
    request: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<DomainResult<unknown>> => {
    calls.push({ name, request, signal: options?.signal });
    return resultFor(name);
  };
  return {
    resolveTarget: (request: unknown, options?: { signal?: AbortSignal }) =>
      record("minecraft_target_resolve", request, options),
    inspectProject: (request: unknown, options?: { signal?: AbortSignal }) =>
      record("minecraft_project_inspect", request, options),
    scaffoldProject: (request: unknown, options?: { signal?: AbortSignal }) =>
      record("minecraft_project_scaffold", request, options),
    validateAssets: (request: unknown, options?: { signal?: AbortSignal }) =>
      record("minecraft_assets_validate", request, options),
    verifyProject: (request: unknown, options?: { signal?: AbortSignal }) =>
      record("minecraft_project_verify", request, options),
  } as unknown as CoreOperations;
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
      clientInfo: { name: "mcp-adapter-test", version: "1.0.0" },
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

  async notify(method: string, params: Record<string, unknown>): Promise<void> {
    await this.transport.send({ jsonrpc: "2.0", method, params });
  }

  async close(): Promise<void> {
    await this.transport.close();
    await this.server.close();
  }
}

async function connect(
  resultFor: (name: ToolName) => DomainResult<unknown> = (name) =>
    domainSuccess({ operation: name }),
): Promise<{ client: InMemoryClient; calls: RecordedCall[] }> {
  const calls: RecordedCall[] = [];
  const client = await InMemoryClient.connect(
    recordingOperations(resultFor, calls),
  );
  return { client, calls };
}

function assertToolValidationError(message: JsonRpcMessage): void {
  assert.equal(message.error, undefined);
  const result = message.result as unknown as ToolCallResult;
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
}

async function callTool(
  client: InMemoryClient,
  name: ToolName,
  args: unknown,
): Promise<ToolCallResult> {
  const message = await client.request("tools/call", { name, arguments: args });
  assert.equal(message.error, undefined, JSON.stringify(message.error));
  return message.result as unknown as ToolCallResult;
}

test("MCP advertises exactly five strict operation-specific tools", async () => {
  const { client } = await connect();
  try {
    const response = await client.request("tools/list", {});
    assert.equal(response.error, undefined);
    const listed = response.result as unknown as {
      tools: Array<Record<string, unknown>>;
    };
    const tools = listed.tools;
    assert.deepEqual(tools.map((tool) => tool.name).sort(), TOOL_NAMES);
    for (const tool of tools) {
      const schema = tool.inputSchema as {
        type: string;
        additionalProperties: boolean;
      };
      assert.equal(schema.type, "object");
      assert.equal(schema.additionalProperties, false);
    }
    const resolve = tools.find(
      (tool) => tool.name === "minecraft_target_resolve",
    );
    const resolveSchema = resolve?.inputSchema as {
      properties: { edition: { const: string } };
      required: string[];
    };
    assert.equal(resolveSchema.properties.edition.const, "java");
    assert.deepEqual(resolveSchema.required.sort(), [
      "edition",
      "loader",
      "minecraftVersion",
    ]);
  } finally {
    await client.close();
  }
});

test("strict schemas reject malformed and unknown input before core dispatch", async () => {
  const { client, calls } = await connect();
  try {
    const malformed: Array<[ToolName, unknown]> = [
      ["minecraft_target_resolve", { ...target, unexpected: true }],
      ["minecraft_project_inspect", {}],
      [
        "minecraft_project_scaffold",
        {
          ...(requests.minecraft_project_scaffold as Record<string, unknown>),
          mod: { unexpected: true },
        },
      ],
      [
        "minecraft_assets_validate",
        {
          ...(requests.minecraft_assets_validate as Record<string, unknown>),
          registry: [{ kind: "unknown", id: "ruby_blade:ruby_blade" }],
        },
      ],
      [
        "minecraft_project_verify",
        {
          ...(requests.minecraft_project_verify as Record<string, unknown>),
          profile: "nearest",
        },
      ],
    ];
    for (const [name, input] of malformed) {
      assertToolValidationError(
        await client.request("tools/call", { name, arguments: input }),
      );
    }
    assert.deepEqual(calls, []);
  } finally {
    await client.close();
  }
});

test("maxToolInputElements rejects oversized input before core dispatch", async () => {
  const { client, calls } = await connect();
  try {
    const response = await client.request("tools/call", {
      name: "minecraft_target_resolve",
      arguments: {
        ...target,
        oversized: Array.from({ length: 5000 }, (_, index) => index),
      },
    });
    assertToolValidationError(response);
    const result = response.result as unknown as ToolCallResult;
    assert.match(result.content[0].text, /maximum of 4096 elements/);
    assert.deepEqual(calls, []);
  } finally {
    await client.close();
  }
});

test("results over 256 KiB become one stable sanitized output_too_large result", async () => {
  const { client } = await connect(() =>
    domainSuccess({ payload: "secret".repeat(50_000) }),
  );
  try {
    const result = await callTool(
      client,
      "minecraft_target_resolve",
      requests.minecraft_target_resolve,
    );
    const expected = domainFailure({
      code: "output_too_large",
      detail: "Serialized DomainResult exceeds 256 KiB",
      retryable: false,
    });
    assert.ok(Buffer.byteLength(result.content[0].text, "utf8") <= 256 * 1024);
    assert.equal(result.content[0].text, serializeDomainResult(expected));
    assert.deepEqual(result.structuredContent, expected);
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /secret/);
  } finally {
    await client.close();
  }
});

test("request cancellation aborts the exact operation signal", async () => {
  const calls: RecordedCall[] = [];
  const pending = Promise.withResolvers<DomainResult<unknown>>();
  const called = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const operations = recordingOperations(() => domainSuccess(null), calls);
  operations.resolveTarget = (async (_request, options) => {
    calls.push({
      name: "minecraft_target_resolve",
      request: _request,
      signal: options?.signal,
    });
    options?.signal?.addEventListener("abort", () => aborted.resolve(), {
      once: true,
    });
    called.resolve();
    return pending.promise;
  }) as CoreOperations["resolveTarget"];
  const client = await InMemoryClient.connect(operations);
  try {
    void client.request("tools/call", {
      name: "minecraft_target_resolve",
      arguments: requests.minecraft_target_resolve,
    });
    await called.promise;
    assert.equal(calls.length, 1);
    await client.notify("notifications/cancelled", {
      requestId: 2,
      reason: "test cancellation",
    });
    await aborted.promise;
    assert.equal(calls[0]?.signal?.aborted, true);
    pending.resolve(
      domainFailure({
        code: "cancelled",
        detail: "Cancelled",
        retryable: true,
      }),
    );
  } finally {
    await client.close();
  }
});

test("real stdio serves initialize, list, real-core call, and exits cleanly on disconnect", async (context) => {
  const cwd = await mkdtemp(join(tmpdir(), "voxellume-mcp-stdio-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  const serverPath = fileURLToPath(
    new URL("../../src/adapters/mcp/server.ts", import.meta.url),
  );
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", serverPath],
    {
      cwd,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  context.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const pending = new Map<number, (message: JsonRpcMessage) => void>();
  let buffered = "";
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    while (buffered.includes("\n")) {
      const newline = buffered.indexOf("\n");
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      const message = JSON.parse(line) as JsonRpcMessage;
      if (message.id !== undefined) pending.get(message.id)?.(message);
    }
  });
  const request = async (
    id: number,
    method: string,
    params?: unknown,
  ): Promise<JsonRpcMessage> => {
    const { promise, resolve } = Promise.withResolvers<JsonRpcMessage>();
    pending.set(id, resolve);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return promise;
  };

  const initialized = await request(1, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "stdio-test", version: "1.0.0" },
  });
  assert.equal(initialized.error, undefined);
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  const listed = await request(2, "tools/list", {});
  const listedResult = listed.result as unknown as {
    tools: Array<{ name: string }>;
  };
  const listedTools = listedResult.tools;
  assert.deepEqual(listedTools.map((tool) => tool.name).sort(), TOOL_NAMES);
  const called = await request(3, "tools/call", {
    name: "minecraft_target_resolve",
    arguments: target,
  });
  const callResult = called.result as unknown as ToolCallResult;
  const structuredContent = callResult.structuredContent;
  assert.equal(structuredContent?.schemaVersion, "domain-result-1.0.0");
  assert.equal(structuredContent?.status, "ok");
  const value = structuredContent?.value as {
    status: string;
    code: string;
    requested: unknown;
  };
  assert.equal(value.status, "unsupported");
  assert.equal(value.code, "unsupported_target");
  assert.deepEqual(value.requested, target);
  assert.equal(callResult.isError, false);

  child.stdin.end();
  const [code, signal] = (await once(child, "exit")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  assert.equal(code, 0, stderr);
  assert.equal(signal, null);
  assert.equal(stderr, "");
  assert.equal(buffered.trim(), "");
  assert.doesNotMatch(stdout, /^(?!.*"jsonrpc":"2\.0").+$/m);
});
