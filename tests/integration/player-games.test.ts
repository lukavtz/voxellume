import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createPlayerGamesClient,
  PLAYER_GAMES_CREDIT_WARNING,
  PlayerGamesError,
  type PlayerGamesToolName,
} from "../../src/core/integrations/player-games.ts";

const accessToken = "pg-access-token-secret";
const refreshToken = "pg-refresh-token-secret";
const rotatedAccessToken = "pg-rotated-access-token-secret";
const rotatedRefreshToken = "pg-rotated-refresh-token-secret";
const MCP_ENDPOINT_FOR_TEST = "https://mcp.player.games";

const toolNames: readonly PlayerGamesToolName[] = [
  "browse_community_mods",
  "list_my_mods",
  "get_mod_details",
  "check_generation_status",
  "get_download_url",
  "get_my_credits",
  "generate_mod",
  "iterate_mod",
];

function tools() {
  return toolNames.map((name) => ({
    name,
    description: `Fixture ${name}`,
    inputSchema:
      name === "generate_mod" || name === "iterate_mod"
        ? {
            type: "object",
            additionalProperties: false,
            required: ["prompt"],
            properties: { prompt: { type: "string", minLength: 1 } },
          }
        : name === "browse_community_mods"
          ? {
              type: "object",
              additionalProperties: false,
              properties: { query: { type: "string" } },
            }
          : { type: "object", additionalProperties: false },
  }));
}

interface CapturedCall {
  readonly url: string;
  readonly init?: RequestInit;
  readonly rpc?: {
    readonly method?: unknown;
    readonly params?: unknown;
  };
  readonly form?: URLSearchParams;
}

interface FixtureOptions {
  readonly tools?: unknown;
  readonly tokenResponse?: (form: URLSearchParams, count: number) => Response;
  readonly toolResponse?: (rpc: {
    method?: unknown;
    params?: unknown;
  }) => unknown;
  readonly openBrowser?: (url: string) => void | Promise<void>;
}

interface PlayerGamesFixture {
  readonly calls: CapturedCall[];
  readonly fetch: typeof fetch;
  readonly authorizationUrl: URL | undefined;
  readonly openBrowser: (url: string) => Promise<void>;
}

function fixture(options: FixtureOptions = {}): PlayerGamesFixture {
  const calls: CapturedCall[] = [];
  let authorizationUrl: URL | undefined;
  let tokenCount = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const body = typeof init?.body === "string" ? init.body : "";
    const captured: CapturedCall = {
      url,
      ...(init === undefined ? {} : { init }),
    };
    calls.push(captured);

    if (
      url === "https://mcp.player.games/.well-known/oauth-protected-resource"
    ) {
      return json({
        resource: "https://mcp.player.games",
        authorization_servers: ["https://www.player.games"],
      });
    }
    if (
      url === "https://www.player.games/.well-known/oauth-authorization-server"
    ) {
      return json({
        issuer: "https://www.player.games",
        authorization_endpoint: "https://www.player.games/authorize",
        token_endpoint: "https://www.player.games/token",
        registration_endpoint: "https://www.player.games/register",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url === "https://www.player.games/register") {
      return json({ client_id: "voxellume-test-client" });
    }
    if (url === "https://www.player.games/token") {
      const form = new URLSearchParams(body);
      Object.assign(captured, { form });
      tokenCount += 1;
      if (options.tokenResponse !== undefined) {
        return options.tokenResponse(form, tokenCount);
      }
      return json({
        access_token: tokenCount === 1 ? accessToken : rotatedAccessToken,
        refresh_token: tokenCount === 1 ? refreshToken : rotatedRefreshToken,
        token_type: "Bearer",
        expires_in: 60,
      });
    }
    if (url === "https://mcp.player.games") {
      const rpc = JSON.parse(body) as CapturedCall["rpc"];
      Object.assign(captured, { rpc });
      if (rpc?.method === "tools/list") {
        return json({
          jsonrpc: "2.0",
          id: 1,
          result: { tools: options.tools ?? tools() },
        });
      }
      if (rpc?.method === "tools/call") {
        return json({
          jsonrpc: "2.0",
          id: 2,
          result: options.toolResponse?.(rpc) ?? {
            content: [{ type: "text", text: "ok" }],
            isError: false,
          },
        });
      }
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  };

  return {
    calls,
    fetch: fetcher,
    get authorizationUrl() {
      return authorizationUrl;
    },
    openBrowser: async (url: string) => {
      authorizationUrl = new URL(url);
      if (options.openBrowser !== undefined) {
        await options.openBrowser(url);
        return;
      }
      const callback = new URL(
        authorizationUrl.searchParams.get("redirect_uri")!,
      );
      callback.searchParams.set("code", "fixture-authorization-code");
      callback.searchParams.set(
        "state",
        authorizationUrl.searchParams.get("state")!,
      );
      const response = await globalThis.fetch(callback);
      assert.equal(response.status, 200);
      await response.text();
    },
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function expectCode(operation: Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof PlayerGamesError);
    assert.equal(error.code, code);
    for (const secret of [
      accessToken,
      refreshToken,
      rotatedAccessToken,
      rotatedRefreshToken,
    ]) {
      assert.equal(String(error).includes(secret), false);
    }
    return true;
  });
}

async function connected(overrides: FixtureOptions = {}) {
  const fake = fixture(overrides);
  const client = createPlayerGamesClient({
    fetch: fake.fetch,
    openBrowser: fake.openBrowser,
  });
  const remoteTools = await client.connect();
  return { fake, client, remoteTools };
}

function callsFor(fake: PlayerGamesFixture, method: string) {
  return fake.calls.filter((call) => call.rpc?.method === method);
}

test("OAuth uses both official metadata documents, DCR, PKCE S256, state, and a loopback callback", async () => {
  const { fake, client, remoteTools } = await connected();
  try {
    assert.deepEqual(
      fake.calls.slice(0, 3).map((call) => call.url),
      [
        "https://mcp.player.games/.well-known/oauth-protected-resource",
        "https://www.player.games/.well-known/oauth-authorization-server",
        "https://www.player.games/register",
      ],
    );
    const registration = JSON.parse(String(fake.calls[2]?.init?.body)) as {
      redirect_uris?: string[];
      token_endpoint_auth_method?: string;
    };
    const callback = new URL(registration.redirect_uris?.[0] ?? "");
    assert.equal(callback.protocol, "http:");
    assert.equal(callback.hostname, "127.0.0.1");
    assert.equal(registration.token_endpoint_auth_method, "none");

    const authorization = fake.authorizationUrl!;
    assert.equal(authorization.origin, "https://www.player.games");
    assert.equal(authorization.searchParams.get("response_type"), "code");
    assert.equal(
      authorization.searchParams.get("client_id"),
      "voxellume-test-client",
    );
    assert.equal(
      authorization.searchParams.get("code_challenge_method"),
      "S256",
    );
    assert.equal(
      authorization.searchParams.get("resource"),
      "https://mcp.player.games",
    );
    assert.ok((authorization.searchParams.get("state") ?? "").length >= 32);

    const tokenCall = fake.calls.find((call) => call.form !== undefined);
    assert.equal(tokenCall?.form?.get("grant_type"), "authorization_code");
    assert.equal(tokenCall?.form?.get("code"), "fixture-authorization-code");
    assert.equal(tokenCall?.form?.get("redirect_uri"), callback.toString());
    const verifier = tokenCall?.form?.get("code_verifier") ?? "";
    assert.ok(verifier.length >= 43);
    assert.equal(
      createHash("sha256").update(verifier).digest("base64url"),
      authorization.searchParams.get("code_challenge"),
    );

    assert.equal(remoteTools.length, 8);
    assert.equal(callsFor(fake, "tools/list").length, 1);
    assert.equal(
      new Headers(callsFor(fake, "tools/list")[0]?.init?.headers).get(
        "authorization",
      ),
      `Bearer ${accessToken}`,
    );
  } finally {
    await client.close();
  }
});

test("OAuth rejects callback state mismatch before token exchange", async () => {
  const fake = fixture({
    openBrowser: async (url) => {
      const authorization = new URL(url);
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      callback.searchParams.set("code", "fixture-authorization-code");
      callback.searchParams.set("state", "wrong-state");
      await globalThis.fetch(callback);
    },
  });
  const client = createPlayerGamesClient({
    fetch: fake.fetch,
    openBrowser: fake.openBrowser,
  });
  try {
    await expectCode(client.connect(), "oauth_state_mismatch");
    assert.equal(
      fake.calls.some((call) => call.form !== undefined),
      false,
    );
  } finally {
    await client.close();
  }
});

test("runtime tools/list schemas gate arguments and free calls need no approval", async () => {
  const { fake, client, remoteTools } = await connected();
  try {
    const browse = remoteTools.find(
      (tool) => tool.name === "browse_community_mods",
    );
    assert.deepEqual(browse?.inputSchema, tools()[0]?.inputSchema);
    const result = await client.callTool("browse_community_mods", {
      query: "ruby",
    });
    assert.deepEqual(result, {
      content: [{ type: "text", text: "ok" }],
      isError: false,
    });
    const call = callsFor(fake, "tools/call")[0]!;
    assert.deepEqual(call.rpc?.params, {
      name: "browse_community_mods",
      arguments: { query: "ruby" },
    });
    assert.equal(
      new Headers(call.init?.headers).get("authorization"),
      `Bearer ${accessToken}`,
    );
  } finally {
    await client.close();
  }
});

test("schema rejection occurs before paid approval or network dispatch", async () => {
  const { fake, client } = await connected();
  try {
    let approvals = 0;
    await expectCode(
      client.callTool(
        "generate_mod",
        { prompt: 42 },
        {
          approvePaidCall: () => {
            approvals += 1;
            return true;
          },
        },
      ),
      "invalid_arguments",
    );
    assert.equal(approvals, 0);
    assert.equal(callsFor(fake, "tools/call").length, 0);
    await expectCode(
      client.callTool("browse_community_mods", { invented: true }),
      "invalid_arguments",
    );
  } finally {
    await client.close();
  }
});

test("paid denial sends nothing and approval is required independently for every paid call", async () => {
  const { fake, client } = await connected();
  try {
    const warnings: unknown[] = [];
    await expectCode(
      client.callTool(
        "generate_mod",
        { prompt: "ruby blade" },
        {
          approvePaidCall: (approval) => {
            warnings.push(approval);
            return false;
          },
        },
      ),
      "paid_call_denied",
    );
    assert.deepEqual(warnings, [
      {
        tool: "generate_mod",
        warning:
          "This paid Player Games operation will use credits. Approval applies to this call only.",
      },
    ]);
    assert.equal(
      PLAYER_GAMES_CREDIT_WARNING,
      "This paid Player Games operation will use credits. Approval applies to this call only.",
    );
    assert.equal(callsFor(fake, "tools/call").length, 0);

    await client.callTool(
      "generate_mod",
      { prompt: "ruby blade" },
      { approvePaidCall: () => true },
    );
    assert.equal(callsFor(fake, "tools/call").length, 1);
    await expectCode(
      client.callTool("iterate_mod", { prompt: "make it purple" }),
      "paid_approval_required",
    );
    assert.equal(callsFor(fake, "tools/call").length, 1);
  } finally {
    await client.close();
  }
});

test("download results remain untrusted data and are never fetched or executed", async () => {
  const download =
    "https://untrusted.invalid/archive.jar?access_token=not-a-client-token";
  const { fake, client } = await connected({
    toolResponse: () => ({
      content: [{ type: "text", text: download }],
      isError: false,
    }),
  });
  try {
    const result = await client.callTool("get_download_url", {});
    assert.deepEqual(result, {
      content: [{ type: "text", text: download }],
      isError: false,
    });
    assert.equal(
      fake.calls.some((call) =>
        call.url.startsWith("https://untrusted.invalid"),
      ),
      false,
    );
  } finally {
    await client.close();
  }
});

test("expired access tokens use the in-memory refresh token and rotated secrets stay private", async () => {
  let now = 1_000;
  const fake = fixture();
  const client = createPlayerGamesClient({
    fetch: fake.fetch,
    openBrowser: fake.openBrowser,
    now: () => now,
  });
  try {
    await client.connect();
    now += 61_000;
    await client.callTool("get_my_credits", {});
    const tokenCalls = fake.calls.filter((call) => call.form !== undefined);
    assert.equal(tokenCalls.length, 2);
    assert.equal(tokenCalls[1]?.form?.get("grant_type"), "refresh_token");
    assert.equal(tokenCalls[1]?.form?.get("refresh_token"), refreshToken);
    assert.equal(
      new Headers(callsFor(fake, "tools/call")[0]?.init?.headers).get(
        "authorization",
      ),
      `Bearer ${rotatedAccessToken}`,
    );
    const serialized = JSON.stringify(client);
    for (const secret of [
      accessToken,
      refreshToken,
      rotatedAccessToken,
      rotatedRefreshToken,
    ]) {
      assert.equal(serialized.includes(secret), false);
    }
  } finally {
    await client.close();
  }
});

test("transport, OAuth, tool, and approval errors never contain token material", async () => {
  const { client: connectedClient } = await connected();
  try {
    const secrets = `${accessToken} ${refreshToken}`;
    const failing = createPlayerGamesClient({
      fetch: async () => {
        throw new Error(`failed with ${secrets}`);
      },
      openBrowser: () => {},
    });
    await expectCode(failing.connect(), "transport_unavailable");
    await failing.close();

    await expectCode(
      connectedClient.callTool(
        "generate_mod",
        { prompt: "ruby blade" },
        {
          approvePaidCall: () => {
            throw new Error(secrets);
          },
        },
      ),
      "paid_approval_failed",
    );
  } finally {
    await connectedClient.close();
  }

  const fake = fixture({
    toolResponse: () => {
      throw new Error(`${accessToken} ${refreshToken}`);
    },
  });
  const client = createPlayerGamesClient({
    fetch: fake.fetch,
    openBrowser: fake.openBrowser,
  });
  try {
    await client.connect();
    await expectCode(
      client.callTool("get_my_credits", {}),
      "transport_unavailable",
    );
  } finally {
    await client.close();
  }
});

test("SSE joins multiline data fields within one JSON-RPC event", async () => {
  const fake = fixture();
  const client = createPlayerGamesClient({
    fetch: async (input, init) => {
      if (String(input) === "https://mcp.player.games") {
        return new Response(
          'event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":1,\ndata: "result":{"tools":[]}}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      return fake.fetch(input, init);
    },
    openBrowser: fake.openBrowser,
  });
  try {
    assert.deepEqual(await client.connect(), []);
  } finally {
    await client.close();
  }
});

test("declared and streamed responses above 256 KiB fail closed", async () => {
  const oversized = "x".repeat(256 * 1024 + 1);
  const declared = fixture();
  const declaredClient = createPlayerGamesClient({
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith("oauth-protected-resource")) {
        return new Response(oversized, {
          headers: { "content-length": String(oversized.length) },
        });
      }
      return declared.fetch(input, init);
    },
    openBrowser: declared.openBrowser,
  });
  try {
    await expectCode(declaredClient.connect(), "response_too_large");
  } finally {
    await declaredClient.close();
  }

  const streamed = fixture({
    tools: [],
  });
  const streamedClient = createPlayerGamesClient({
    fetch: async (input, init) => {
      if (String(input) === "https://mcp.player.games") {
        const rpc = JSON.parse(String(init?.body)) as { method?: string };
        if (rpc.method === "tools/list") {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('{"jsonrpc":"2.0"'),
                );
                controller.enqueue(new TextEncoder().encode(oversized));
                controller.close();
              },
            }),
          );
        }
      }
      return streamed.fetch(input, init);
    },
    openBrowser: streamed.openBrowser,
  });
  try {
    await expectCode(streamedClient.connect(), "response_too_large");
  } finally {
    await streamedClient.close();
  }
});

test("cancellation interrupts OAuth callback wait and an in-flight tool call", async () => {
  const controller = new AbortController();
  const oauth = fixture({
    openBrowser: () => controller.abort(),
  });
  const oauthClient = createPlayerGamesClient({
    fetch: oauth.fetch,
    openBrowser: oauth.openBrowser,
  });
  try {
    await expectCode(
      oauthClient.connect({ signal: controller.signal }),
      "cancelled",
    );
  } finally {
    await oauthClient.close();
  }

  const pending = fixture();
  const pendingController = new AbortController();
  const client = createPlayerGamesClient({
    fetch: async (input, init) => {
      if (String(input) === "https://mcp.player.games") {
        const rpc = JSON.parse(String(init?.body)) as { method?: string };
        if (rpc.method === "tools/call") {
          const pendingResponse = Promise.withResolvers<Response>();
          init?.signal?.addEventListener(
            "abort",
            () => pendingResponse.reject(init.signal?.reason),
            { once: true },
          );
          return pendingResponse.promise;
        }
      }
      return pending.fetch(input, init);
    },
    openBrowser: pending.openBrowser,
  });
  try {
    await client.connect();
    const call = client.callTool(
      "get_my_credits",
      {},
      { signal: pendingController.signal },
    );
    pendingController.abort();
    await expectCode(call, "cancelled");
  } finally {
    await client.close();
  }
});

test("closing clears in-memory authorization and runtime schemas without persistence", async () => {
  const { fake, client } = await connected();
  await client.close();
  await expectCode(
    client.callTool("get_my_credits", {}),
    "authentication_required",
  );
  assert.equal(fake.calls.filter((call) => call.form !== undefined).length, 1);
  assert.equal(JSON.stringify(client).includes(accessToken), false);
  assert.equal(JSON.stringify(client).includes(refreshToken), false);
});

test("paid approval cannot mutate the validated arguments before dispatch", async () => {
  const { fake, client } = await connected();
  const args = { prompt: "original vertical slice" };
  try {
    await client.callTool("generate_mod", args, {
      approvePaidCall: async () => {
        args.prompt = "mutated after validation";
        return true;
      },
    });
    assert.deepEqual(callsFor(fake, "tools/call")[0]?.rpc?.params, {
      name: "generate_mod",
      arguments: { prompt: "original vertical slice" },
    });
  } finally {
    await client.close();
  }
});

test("asynchronous AJV schemas are rejected instead of treating Promise validation as success", async () => {
  const asyncTools = tools().map((tool) =>
    tool.name === "get_my_credits"
      ? {
          ...tool,
          inputSchema: { $async: true, type: "object" },
        }
      : tool,
  );
  const fake = fixture({ tools: asyncTools });
  const client = createPlayerGamesClient({
    fetch: fake.fetch,
    openBrowser: fake.openBrowser,
  });
  try {
    await expectCode(client.connect(), "invalid_tool_schema");
    assert.equal(callsFor(fake, "tools/call").length, 0);
  } finally {
    await client.close();
  }
});

test("tool results require a valid content array and boolean isError", async (t) => {
  const cases = [
    {
      name: "literal true is a tool failure",
      result: { content: [], isError: true },
      code: "tool_failed",
    },
    {
      name: "non-boolean isError is malformed",
      result: { content: [], isError: "false" },
      code: "invalid_response",
    },
    {
      name: "missing content is malformed",
      result: { isError: false },
      code: "invalid_response",
    },
    {
      name: "malformed content entries are rejected",
      result: { content: [null], isError: false },
      code: "invalid_response",
    },
  ] as const;
  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async () => {
      const { client } = await connected({
        toolResponse: () => fixtureCase.result,
      });
      try {
        await expectCode(
          client.callTool("get_my_credits", {}),
          fixtureCase.code,
        );
      } finally {
        await client.close();
      }
    });
  }
});

test("cyclic and BigInt arguments fail before refresh or network dispatch", async () => {
  let now = 1_000;
  const relaxedTools = tools().map((tool) =>
    tool.name === "get_my_credits"
      ? { ...tool, inputSchema: { type: "object" } }
      : tool,
  );
  const fake = fixture({ tools: relaxedTools });
  const client = createPlayerGamesClient({
    fetch: fake.fetch,
    openBrowser: fake.openBrowser,
    now: () => now,
  });
  try {
    await client.connect();
    now += 61_000;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expectCode(
      client.callTool("get_my_credits", cyclic),
      "invalid_arguments",
    );
    await expectCode(
      client.callTool("get_my_credits", { value: 1n }),
      "invalid_arguments",
    );
    assert.equal(
      fake.calls.filter((call) => call.form !== undefined).length,
      1,
    );
    assert.equal(callsFor(fake, "tools/call").length, 0);
  } finally {
    await client.close();
  }
});

test("callTool redacts operation secrets captured before close during flight", async () => {
  const fake = fixture();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const client = createPlayerGamesClient({
    fetch: async (input, init) => {
      if (String(input) === MCP_ENDPOINT_FOR_TEST) {
        const rpc = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
        };
        if (rpc.method === "tools/call") {
          started.resolve();
          await release.promise;
          return json({
            jsonrpc: "2.0",
            id: rpc.id,
            result: {
              content: [
                {
                  type: "text",
                  text: `${accessToken} ${refreshToken}`,
                },
              ],
              isError: false,
            },
          });
        }
      }
      return fake.fetch(input, init);
    },
    openBrowser: fake.openBrowser,
  });
  try {
    await client.connect();
    const call = client.callTool("get_my_credits", {});
    await started.promise;
    await client.close();
    release.resolve();
    const result = JSON.stringify(await call);
    assert.equal(result.includes(accessToken), false);
    assert.equal(result.includes(refreshToken), false);
    assert.equal(result.includes("[REDACTED]"), true);
  } finally {
    release.resolve();
    await client.close();
  }
});

test("listTools redacts operation secrets captured before close during flight", async () => {
  const fake = fixture();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let listings = 0;
  const client = createPlayerGamesClient({
    fetch: async (input, init) => {
      if (String(input) === MCP_ENDPOINT_FOR_TEST) {
        const rpc = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
        };
        if (rpc.method === "tools/list") {
          listings += 1;
          if (listings === 2) {
            started.resolve();
            await release.promise;
            return json({
              jsonrpc: "2.0",
              id: rpc.id,
              result: {
                tools: [
                  {
                    name: "get_my_credits",
                    description: `${accessToken} ${refreshToken}`,
                    inputSchema: { type: "object" },
                  },
                ],
              },
            });
          }
        }
      }
      return fake.fetch(input, init);
    },
    openBrowser: fake.openBrowser,
  });
  try {
    await client.connect();
    const listing = client.listTools();
    await started.promise;
    await client.close();
    release.resolve();
    const result = JSON.stringify(await listing);
    assert.equal(result.includes(accessToken), false);
    assert.equal(result.includes(refreshToken), false);
    assert.equal(result.includes("[REDACTED]"), true);
  } finally {
    release.resolve();
    await client.close();
  }
});

test("refresh cancellation preserves expired authorization so a later call can retry", async () => {
  let now = 1_000;
  const fake = fixture();
  const started = Promise.withResolvers<void>();
  const controller = new AbortController();
  let refreshAttempts = 0;
  const client = createPlayerGamesClient({
    fetch: async (input, init) => {
      if (String(input) === "https://www.player.games/token") {
        const form = new URLSearchParams(String(init?.body));
        if (form.get("grant_type") === "refresh_token") {
          refreshAttempts += 1;
          if (refreshAttempts === 1) {
            const pending = Promise.withResolvers<Response>();
            started.resolve();
            init?.signal?.addEventListener(
              "abort",
              () => pending.reject(init.signal?.reason),
              { once: true },
            );
            return pending.promise;
          }
        }
      }
      if (String(input) === MCP_ENDPOINT_FOR_TEST) {
        const rpc = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
        };
        if (rpc.method === "tools/call") {
          return json({
            jsonrpc: "2.0",
            id: rpc.id,
            result: { content: [], isError: false },
          });
        }
      }
      return fake.fetch(input, init);
    },
    openBrowser: fake.openBrowser,
    now: () => now,
  });
  try {
    await client.connect();
    now += 61_000;
    const cancelled = client.callTool(
      "get_my_credits",
      {},
      { signal: controller.signal },
    );
    await started.promise;
    controller.abort();
    await expectCode(cancelled, "cancelled");
    await client.callTool("get_my_credits", {});
    assert.equal(refreshAttempts, 2);
  } finally {
    await client.close();
  }
});

test("an older failed refresh cannot clear a newer successful token set", async () => {
  let now = 1_000;
  const fake = fixture();
  const firstStarted = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  const firstRefresh = Promise.withResolvers<Response>();
  const secondRefresh = Promise.withResolvers<Response>();
  const authorizations: string[] = [];
  let refreshAttempts = 0;
  const client = createPlayerGamesClient({
    fetch: async (input, init) => {
      if (String(input) === "https://www.player.games/token") {
        const form = new URLSearchParams(String(init?.body));
        if (form.get("grant_type") === "refresh_token") {
          refreshAttempts += 1;
          if (refreshAttempts === 1) {
            firstStarted.resolve();
            return firstRefresh.promise;
          }
          if (refreshAttempts === 2) {
            secondStarted.resolve();
            return secondRefresh.promise;
          }
        }
      }
      if (String(input) === MCP_ENDPOINT_FOR_TEST) {
        const rpc = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
        };
        if (rpc.method === "tools/call") {
          authorizations.push(
            new Headers(init?.headers).get("authorization") ?? "",
          );
          return json({
            jsonrpc: "2.0",
            id: rpc.id,
            result: { content: [], isError: false },
          });
        }
      }
      return fake.fetch(input, init);
    },
    openBrowser: fake.openBrowser,
    now: () => now,
  });
  try {
    await client.connect();
    now += 61_000;
    const first = client.callTool("get_my_credits", {});
    const second = client.callTool("list_my_mods", {});
    await Promise.all([firstStarted.promise, secondStarted.promise]);
    firstRefresh.resolve(
      json({
        access_token: "first-competing-access-token",
        token_type: "Bearer",
        expires_in: 60,
      }),
    );
    await first;
    secondRefresh.reject(new Error("transient network failure"));
    await expectCode(second, "transport_unavailable");
    await client.callTool("get_my_credits", {});
    assert.equal(refreshAttempts, 2);
    assert.deepEqual(authorizations, [
      "Bearer first-competing-access-token",
      "Bearer first-competing-access-token",
    ]);
  } finally {
    await client.close();
  }
});

test("an older successful refresh cannot overwrite newer tokens or leak its own token", async () => {
  let now = 1_000;
  const fake = fixture();
  const firstStarted = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  const firstRefresh = Promise.withResolvers<Response>();
  const secondRefresh = Promise.withResolvers<Response>();
  const firstToken = "first-successful-refresh-token";
  const secondToken = "older-successful-refresh-token";
  const authorizations: string[] = [];
  let refreshAttempts = 0;
  const client = createPlayerGamesClient({
    fetch: async (input, init) => {
      if (String(input) === "https://www.player.games/token") {
        const form = new URLSearchParams(String(init?.body));
        if (form.get("grant_type") === "refresh_token") {
          refreshAttempts += 1;
          if (refreshAttempts === 1) {
            firstStarted.resolve();
            return firstRefresh.promise;
          }
          if (refreshAttempts === 2) {
            secondStarted.resolve();
            return secondRefresh.promise;
          }
        }
      }
      if (String(input) === MCP_ENDPOINT_FOR_TEST) {
        const rpc = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
        };
        if (rpc.method === "tools/call") {
          const authorization =
            new Headers(init?.headers).get("authorization") ?? "";
          authorizations.push(authorization);
          return json({
            jsonrpc: "2.0",
            id: rpc.id,
            result: {
              content: [
                {
                  type: "text",
                  text: authorization,
                },
              ],
              isError: false,
            },
          });
        }
      }
      return fake.fetch(input, init);
    },
    openBrowser: fake.openBrowser,
    now: () => now,
  });
  try {
    await client.connect();
    now += 61_000;
    const first = client.callTool("get_my_credits", {});
    const second = client.callTool("list_my_mods", {});
    await Promise.all([firstStarted.promise, secondStarted.promise]);
    firstRefresh.resolve(
      json({ access_token: firstToken, token_type: "Bearer", expires_in: 60 }),
    );
    await first;
    secondRefresh.resolve(
      json({ access_token: secondToken, token_type: "Bearer", expires_in: 60 }),
    );
    const secondResult = JSON.stringify(await second);
    assert.equal(secondResult.includes(secondToken), false);
    await client.callTool("get_my_credits", {});
    assert.equal(refreshAttempts, 2);
    assert.equal(authorizations[2], `Bearer ${firstToken}`);
  } finally {
    await client.close();
  }
});
