import assert from "node:assert/strict";
import { setImmediate as immediate } from "node:timers/promises";
import test from "node:test";

import {
  createMCreatorClient,
  MCreatorError,
  type MCreatorClient,
} from "../../src/core/integrations/mcreator.ts";

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    name: { type: "string" },
    settings: {
      type: "object",
      properties: { enabled: { type: "boolean" } },
      required: ["enabled"],
      additionalProperties: false,
    },
  },
  required: ["name", "settings"],
  additionalProperties: false,
};

interface CapturedRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly signal?: AbortSignal;
  readonly body?: {
    readonly id?: number;
    readonly method?: string;
    readonly params?: {
      readonly name?: string;
      readonly arguments?: Record<string, unknown>;
      readonly protocolVersion?: string;
    };
  };
}

interface Fixture {
  readonly client: MCreatorClient;
  readonly requests: CapturedRequest[];
  readonly toolRequests: CapturedRequest[];
}

interface FixtureOptions {
  readonly initialize?: (
    request: CapturedRequest,
  ) => Response | Promise<Response>;
  readonly initialized?: (
    request: CapturedRequest,
  ) => Response | Promise<Response>;
}

type ToolReply =
  | { readonly value: unknown }
  | { readonly text: string }
  | { readonly error: string }
  | { readonly response: Response };

function initializeResponse(request: CapturedRequest): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: request.body?.id,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "MCreator", version: "fixture" },
      },
    },
    { headers: { "mcp-session-id": "fixture-session" } },
  );
}

function fixture(
  reply: (
    name: string,
    args: Record<string, unknown>,
    request: CapturedRequest,
  ) => ToolReply | Promise<ToolReply>,
  options: FixtureOptions = {},
): Fixture {
  const requests: CapturedRequest[] = [];
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as NonNullable<CapturedRequest["body"]>)
        : undefined;
    const captured: CapturedRequest = {
      url: String(input),
      headers: new Headers(init?.headers),
      ...(init?.signal == null ? {} : { signal: init.signal }),
      ...(body === undefined ? {} : { body }),
    };
    requests.push(captured);
    if (body?.method === "initialize") {
      assert.equal(body.params?.protocolVersion, "2025-11-25");
      return options.initialize?.(captured) ?? initializeResponse(captured);
    }
    if (body?.method === "notifications/initialized") {
      return (
        options.initialized?.(captured) ?? new Response(null, { status: 202 })
      );
    }
    assert.equal(body?.method, "tools/call");
    assert.equal(captured.headers.get("mcp-session-id"), "fixture-session");
    const answer = await reply(
      body.params?.name ?? "",
      body.params?.arguments ?? {},
      captured,
    );
    if ("response" in answer) return answer.response;
    const isError = "error" in answer;
    const text = isError
      ? answer.error
      : "text" in answer
        ? answer.text
        : JSON.stringify(answer.value);
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        content: [{ type: "text", text }],
        ...(isError ? { isError: true } : { isError: false }),
      },
    });
  }) as typeof fetch;
  const client = createMCreatorClient({ fetch: fetcher });
  return {
    client,
    requests,
    get toolRequests() {
      return requests.filter(
        (request) => request.body?.method === "tools/call",
      );
    },
  };
}

function success(value: unknown): ToolReply {
  return { value };
}

function text(value: string): ToolReply {
  return { text: value };
}

async function failure(
  operation: Promise<unknown>,
  code: string,
): Promise<MCreatorError> {
  const error = await operation.then(
    () => assert.fail(`expected ${code}`),
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof MCreatorError, String(error));
  assert.equal(error.code, code);
  return error;
}

function toolSequence(requests: readonly CapturedRequest[]): unknown[] {
  return requests.map((request) => request.body?.params?.name);
}

test("MCreator initializes protocol 2025-11-25 on literal loopback without Origin", async () => {
  const server = fixture((name) => {
    assert.equal(name, "get_mod_element_schema");
    return success(schema);
  });

  assert.deepEqual(await server.client.getModElementSchema("item"), schema);
  assert.equal(server.requests[0]?.url, "http://127.0.0.1:3025/mcp");
  assert.deepEqual(
    server.requests.map((request) => request.body?.method),
    ["initialize", "notifications/initialized", "tools/call"],
  );
  for (const request of server.requests) {
    assert.equal(request.headers.get("origin"), null);
    assert.equal(request.headers.get("mcp-protocol-version"), "2025-11-25");
  }
});

test("ADD and REPLACE fetch and validate a fresh schema before mutation", async () => {
  const calls: string[] = [];
  const server = fixture((name, args) => {
    calls.push(`${name}:${String(args.actionType ?? "")}`);
    if (name === "get_mod_element_schema") return success(schema);
    return success({ result: "Element changed" });
  });
  const definition = { name: "Ruby", settings: { enabled: true } };

  await server.client.modElementDefinition({
    actionType: "ADD",
    elementName: "RubyBlade",
    elementType: "item",
    elementJSONDefinition: definition,
  });
  await server.client.modElementDefinition({
    actionType: "REPLACE",
    elementName: "RubyBlade",
    elementType: "item",
    elementJSONDefinition: { ...definition, name: "Ruby updated" },
  });

  assert.deepEqual(toolSequence(server.toolRequests), [
    "get_mod_element_schema",
    "mod_element_definition",
    "get_mod_element_schema",
    "mod_element_definition",
  ]);
});

test("ADD dispatches the pre-await request snapshot after caller mutation", async () => {
  const schemaRequested = Promise.withResolvers<void>();
  const releaseSchema = Promise.withResolvers<void>();
  const server = fixture(async (name) => {
    if (name === "get_mod_element_schema") {
      schemaRequested.resolve();
      await releaseSchema.promise;
      return success(schema);
    }
    return success({ result: "Element added" });
  });
  const request = {
    actionType: "ADD" as const,
    elementName: "RubyBlade",
    elementType: "item",
    elementJSONDefinition: {
      name: "Ruby",
      settings: { enabled: true },
    } as Record<string, unknown>,
  };

  const pending = server.client.modElementDefinition(request);
  await schemaRequested.promise;
  request.elementName = "ChangedAfterValidation";
  request.elementType = "block";
  request.elementJSONDefinition = { name: "changed after validation" };
  releaseSchema.resolve();
  await pending;

  const mutation = server.toolRequests.find(
    (entry) =>
      entry.body?.params?.arguments?.actionType === "ADD" &&
      entry.body.params.name === "mod_element_definition",
  );
  assert.deepEqual(mutation?.body?.params?.arguments, {
    actionType: "ADD",
    elementName: "RubyBlade",
    elementType: "item",
    elementJSONDefinition: {
      name: "Ruby",
      settings: { enabled: true },
    },
  });
});

test("PATCH read and dispatch use one pre-await request snapshot", async () => {
  const readRequested = Promise.withResolvers<void>();
  const releaseRead = Promise.withResolvers<void>();
  const server = fixture(async (name, args) => {
    if (name === "get_mod_element_schema") return success(schema);
    if (args.actionType === "READ") {
      readRequested.resolve();
      await releaseRead.promise;
      return success({
        elementJSONDefinition: {
          name: "Ruby",
          settings: { enabled: true },
        },
        codeLocked: false,
      });
    }
    return success({ result: "Element patched" });
  });
  const request = {
    actionType: "PATCH" as const,
    elementName: "RubyBlade",
    elementType: "item",
    elementJSONDefinition: {
      settings: { enabled: false },
    } as Record<string, unknown>,
  };

  const pending = server.client.modElementDefinition(request);
  await readRequested.promise;
  request.elementName = "ChangedDuringRead";
  request.elementType = "block";
  request.elementJSONDefinition = { settings: { enabled: true } };
  releaseRead.resolve();
  await pending;

  assert.equal(
    server.toolRequests[1]?.body?.params?.arguments?.elementName,
    "RubyBlade",
  );
  assert.deepEqual(server.toolRequests[2]?.body?.params?.arguments, {
    actionType: "PATCH",
    elementName: "RubyBlade",
    elementType: "item",
    elementJSONDefinition: { settings: { enabled: false } },
  });
});

test("PATCH validates the merged definition and never mutates after a schema failure", async () => {
  const server = fixture((name, args) => {
    if (name === "get_mod_element_schema") return success(schema);
    if (args.actionType === "READ") {
      return success({
        elementJSONDefinition: {
          name: "Ruby",
          settings: { enabled: true },
        },
        codeLocked: false,
      });
    }
    return success({ result: "Element patched" });
  });

  await server.client.modElementDefinition({
    actionType: "PATCH",
    elementName: "RubyBlade",
    elementType: "item",
    elementJSONDefinition: { settings: { enabled: false } },
  });
  assert.deepEqual(toolSequence(server.toolRequests), [
    "get_mod_element_schema",
    "mod_element_definition",
    "mod_element_definition",
  ]);
  assert.equal(
    server.toolRequests[1]?.body?.params?.arguments?.actionType,
    "READ",
  );
  assert.equal(
    server.toolRequests[2]?.body?.params?.arguments?.actionType,
    "PATCH",
  );

  const before = server.toolRequests.length;
  await failure(
    server.client.modElementDefinition({
      actionType: "PATCH",
      elementName: "RubyBlade",
      elementType: "item",
      elementJSONDefinition: { name: null },
    }),
    "schema_validation_failed",
  );
  assert.deepEqual(toolSequence(server.toolRequests.slice(before)), [
    "get_mod_element_schema",
    "mod_element_definition",
  ]);
});

test("invalid element types, names, and full definitions fail before mutation", async () => {
  const server = fixture((name) => {
    if (name === "get_mod_element_schema") return success(schema);
    return success({ result: "unexpected" });
  });
  await failure(
    server.client.getModElementSchema("ITEM!"),
    "invalid_element_type",
  );
  await failure(
    server.client.modElementDefinition({
      actionType: "ADD",
      elementName: "ruby blade",
      elementType: "item",
      elementJSONDefinition: {},
    }),
    "invalid_element_name",
  );
  assert.equal(server.requests.length, 0);

  await failure(
    server.client.modElementDefinition({
      actionType: "ADD",
      elementName: "RubyBlade",
      elementType: "item",
      elementJSONDefinition: { name: 42 },
    }),
    "schema_validation_failed",
  );
  assert.deepEqual(toolSequence(server.toolRequests), [
    "get_mod_element_schema",
  ]);
});

test("async schemas cannot bypass validation or dispatch invalid input", async () => {
  const server = fixture((name) => {
    if (name === "get_mod_element_schema") {
      return success({ ...schema, $async: true });
    }
    return success({ result: "unexpected mutation" });
  });

  await failure(
    server.client.modElementDefinition({
      actionType: "ADD",
      elementName: "RubyBlade",
      elementType: "item",
      elementJSONDefinition: { name: 42 },
    }),
    "invalid_schema",
  );
  await immediate();
  assert.deepEqual(toolSequence(server.toolRequests), [
    "get_mod_element_schema",
  ]);
});

test("locked elements and generated files remain governed only by MCreator APIs", async () => {
  const secret = "/private/token/mcreator-secret";
  const server = fixture((name, args) => {
    if (name === "get_mod_element_schema") return success(schema);
    assert.equal(name, "mod_element_definition");
    assert.equal(args.actionType, "REPLACE");
    return { error: `Element code is locked; edit ${secret}` };
  });

  const error = await failure(
    server.client.modElementDefinition({
      actionType: "REPLACE",
      elementName: "RubyBlade",
      elementType: "item",
      elementJSONDefinition: {
        name: "Ruby",
        settings: { enabled: true },
      },
    }),
    "tool_failed",
  );
  assert.doesNotMatch(error.message, /private|mcreator-secret|locked/i);
  assert.deepEqual(toolSequence(server.toolRequests), [
    "get_mod_element_schema",
    "mod_element_definition",
  ]);
  assert.equal("projectFileEdit" in server.client, false);
  assert.equal("project_file_edit" in server.client, false);
  assert.equal("runClient" in server.client, false);
  assert.equal("run_client" in server.client, false);
});

test("build background state, Gradle status, console, and run files stay truthful", async () => {
  const server = fixture((name, args) => {
    if (name === "build" && args.actionType === "BUILD_AND_WAIT") {
      return success({
        finished: false,
        message: "Build continues in the background",
      });
    }
    if (name === "build" && args.actionType === "IS_GRADLE_RUNNING") {
      return success({ running: true, gradleSetupTaskRunning: false });
    }
    if (name === "read_console") return text("BUILD RUNNING\nsecret-free log");
    if (name === "run_dir_files" && args.actionType === "SEARCH") {
      return success(["run/logs/latest.log"]);
    }
    if (name === "run_dir_files" && args.actionType === "READ") {
      return text("latest.log tail");
    }
    throw new Error("unexpected fixture call");
  });

  assert.deepEqual(await server.client.buildAndWait(), {
    finished: false,
    message: "Build continues in the background",
  });
  assert.deepEqual(await server.client.isGradleRunning(), {
    running: true,
    gradleSetupTaskRunning: false,
  });
  assert.equal(
    await server.client.readConsole({ lastNCharsToRead: 200 }),
    "BUILD RUNNING\nsecret-free log",
  );
  assert.deepEqual(await server.client.runDirFiles({ actionType: "SEARCH" }), [
    "run/logs/latest.log",
  ]);
  assert.equal(
    await server.client.runDirFiles({
      actionType: "READ",
      path: "run/logs/latest.log",
      lastNCharsToRead: 100,
    }),
    "latest.log tail",
  );
});

test("workspace and datalist methods pass runtime selectors without local catalogs", async () => {
  const server = fixture((name, args) => {
    if (name === "query_workspace") {
      assert.deepEqual(args, { type: "MOD_ELEMENTS", filter: "Ruby" });
      return success([{ registryName: "RubyBlade", type: "item" }]);
    }
    assert.equal(name, "datalist_entries");
    assert.deepEqual(args, {
      type: "GET_LIST_ENTRIES",
      listName: "gamemodes",
    });
    return success(["SURVIVAL", "CREATIVE"]);
  });

  assert.deepEqual(
    await server.client.queryWorkspace({
      type: "MOD_ELEMENTS",
      filter: "Ruby",
    }),
    [{ registryName: "RubyBlade", type: "item" }],
  );
  assert.deepEqual(
    await server.client.datalistEntries({
      type: "GET_LIST_ENTRIES",
      listName: "gamemodes",
    }),
    ["SURVIVAL", "CREATIVE"],
  );
});

test("remote, non-literal, credentialed, and non-HTTP endpoints fail closed", async () => {
  const fetcher = (() =>
    assert.fail("network must not be used")) as typeof fetch;
  for (const endpoint of [
    "http://example.com:3025/mcp",
    "http://localhost:3025/mcp",
    "http://127.0.0.1.evil.example:3025/mcp",
    "https://127.0.0.1:3025/mcp",
    "http://user:password@127.0.0.1:3025/mcp",
    "http://127.0.0.1:3025/mcp?target=remote",
  ]) {
    assert.throws(
      () => createMCreatorClient({ endpoint, fetch: fetcher }),
      (error: unknown) =>
        error instanceof MCreatorError && error.code === "loopback_required",
    );
  }
});

test("oversized and malformed responses are rejected without leaking payloads", async (t) => {
  const cases = [
    {
      code: "response_too_large",
      response: () => new Response("x".repeat(256 * 1024 + 1)),
    },
    {
      code: "invalid_response",
      response: () => new Response("not-json-secret"),
    },
    {
      code: "invalid_response",
      response: () => Response.json({ jsonrpc: "2.0", id: 999, result: {} }),
    },
  ];
  for (const item of cases) {
    await t.test(item.code, async () => {
      const server = fixture(() => ({ response: item.response() }));
      const error = await failure(
        server.client.getModElementSchema("item"),
        item.code,
      );
      assert.doesNotMatch(error.message, /not-json-secret|x{100}/);
    });
  }
});

test("JSON-RPC and tool failures use sanitized stable errors", async () => {
  const rpc = fixture((_name, _args, request) => ({
    response: Response.json({
      jsonrpc: "2.0",
      id: request.body?.id,
      error: { code: -32603, message: "secret-internal-path", data: "token" },
    }),
  }));
  const rpcError = await failure(
    rpc.client.getModElementSchema("item"),
    "jsonrpc_error",
  );
  assert.doesNotMatch(rpcError.message, /secret|token|32603/);

  const tool = fixture(() => ({ error: "secret-tool-detail" }));
  const toolError = await failure(
    tool.client.getModElementSchema("item"),
    "tool_failed",
  );
  assert.doesNotMatch(toolError.message, /secret-tool-detail/);
});

test("cancelling every waiter aborts initialization and invalidates late responses", async (t) => {
  for (const stage of ["initialize", "initialized"] as const) {
    await t.test(stage, async () => {
      const stageRequested = Promise.withResolvers<void>();
      const lateResponse = Promise.withResolvers<Response>();
      let heldRequest: CapturedRequest | undefined;
      const server = fixture(
        (name) => success(name === "get_mod_element_schema" ? schema : {}),
        {
          initialize(request) {
            if (stage === "initialize" && heldRequest === undefined) {
              heldRequest = request;
              stageRequested.resolve();
              return lateResponse.promise;
            }
            return initializeResponse(request);
          },
          initialized(request) {
            if (stage === "initialized" && heldRequest === undefined) {
              heldRequest = request;
              stageRequested.resolve();
              return lateResponse.promise;
            }
            return new Response(null, { status: 202 });
          },
        },
      );
      const controller = new AbortController();
      const pending = server.client.getModElementSchema("item", {
        signal: controller.signal,
      });
      await stageRequested.promise;
      assert.ok(heldRequest !== undefined);
      const abortedRequest: CapturedRequest = heldRequest;
      controller.abort();
      await failure(pending, "cancelled");
      const transportAborted = abortedRequest.signal?.aborted;

      lateResponse.resolve(
        stage === "initialize"
          ? initializeResponse(abortedRequest)
          : new Response(null, { status: 202 }),
      );
      await immediate();
      assert.equal(transportAborted, true);
      assert.equal(server.toolRequests.length, 0);
      assert.equal(
        server.requests.length,
        stage === "initialize" ? 1 : 2,
        "late initialization responses must not advance the old session",
      );

      assert.deepEqual(await server.client.getModElementSchema("item"), schema);
      assert.equal(
        server.requests.filter(
          (request) => request.body?.method === "initialize",
        ).length,
        2,
      );
      assert.equal(server.toolRequests.length, 1);
    });
  }
});

test("abort cancels an in-flight call and returns a sanitized cancellation", async () => {
  const started = Promise.withResolvers<void>();
  const server = fixture(async (_name, _args, request) => {
    started.resolve();
    const held = Promise.withResolvers<never>();
    const signal = request.signal;
    assert.ok(signal);
    if (signal.aborted) {
      held.reject(signal.reason);
    } else {
      signal.addEventListener("abort", () => held.reject(signal.reason), {
        once: true,
      });
    }
    await held.promise;
    return success(schema);
  });
  const controller = new AbortController();
  const pending = server.client.getModElementSchema("item", {
    signal: controller.signal,
  });
  await started.promise;
  controller.abort();
  await failure(pending, "cancelled");
});
