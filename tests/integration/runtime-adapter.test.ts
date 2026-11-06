import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  grantAuthorizedRoot,
  releaseAuthorizedRoot,
  type AuthorizedRoot,
} from "../../src/core/execution/paths.ts";
import {
  createLoopbackRuntimeTransport,
  createRuntimeAdapter,
  type RuntimeAdapter,
  type RuntimeTarget,
  type RuntimeTransport,
} from "../../src/core/verification/runtime-adapter.ts";

const token = "runtime-fixture-secret";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

interface CapturedRequest {
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
  readonly rpc: {
    readonly method?: unknown;
    readonly params?: {
      readonly name?: unknown;
      readonly arguments?: unknown;
    };
  };
}

type FixtureResponse =
  | { readonly kind: "result"; readonly value: unknown }
  | { readonly kind: "http"; readonly status: number; readonly body: string }
  | { readonly kind: "image"; readonly bytes: Buffer };

async function protocolFixture(
  t: TestContext,
  respond: (request: CapturedRequest) => FixtureResponse,
) {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const rpc = JSON.parse(body) as CapturedRequest["rpc"];
      const captured = { headers: request.headers, body, rpc };
      requests.push(captured);
      const reply = respond(captured);
      if (reply.kind === "http") {
        response.writeHead(reply.status, {
          "content-type": "application/json",
        });
        response.end(reply.body);
        return;
      }
      const content =
        reply.kind === "image"
          ? [
              {
                type: "image",
                mimeType: "image/png",
                data: reply.bytes.toString("base64"),
              },
            ]
          : [{ type: "text", text: JSON.stringify(reply.value) }];
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { content, isError: false },
        }),
      );
    });
  });
  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    requests,
  };
}

function target(
  minecraftVersion: string,
  loader: RuntimeTarget["loader"] = "fabric",
): RuntimeTarget {
  return { minecraftVersion, loader };
}

function adapterFor(
  runtimeTarget: RuntimeTarget,
  endpoint: string,
  roots?: { scenarios?: AuthorizedRoot; screenshots?: AuthorizedRoot },
): RuntimeAdapter {
  const result = createRuntimeAdapter({
    target: runtimeTarget,
    enabledAdapters: [
      runtimeTarget.minecraftVersion === "26.3"
        ? "modlens"
        : runtimeTarget.minecraftVersion === "26.2"
          ? "rogal"
          : "arclight",
    ],
    transport: createLoopbackRuntimeTransport({ endpoint, token }),
    ...(roots === undefined ? {} : { roots }),
  });
  assert.equal(result.status, "available");
  if (result.status !== "available") throw new Error("unreachable");
  return result.adapter;
}

async function authorizedRoots(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "voxellume-runtime-adapter-"));
  const scenarioDirectory = join(directory, "scenarios");
  const screenshotDirectory = join(directory, "screenshots");
  await Promise.all([
    mkdir(join(scenarioDirectory, "smoke"), { recursive: true }),
    mkdir(screenshotDirectory, { recursive: true }),
  ]);
  const scenarios = await grantAuthorizedRoot({
    path: scenarioDirectory,
    kind: "project",
  });
  const screenshots = await grantAuthorizedRoot({
    path: screenshotDirectory,
    kind: "transactionStaging",
    transactionId: "tx-runtime-adapter",
  });
  t.after(async () => {
    await releaseAuthorizedRoot(scenarios);
    await releaseAuthorizedRoot(screenshots);
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, scenarios, screenshots, screenshotDirectory };
}

function toolCall(request: CapturedRequest | undefined) {
  assert.ok(request !== undefined);
  assert.equal(request.rpc.method, "tools/call");
  return {
    name: request.rpc.params?.name,
    arguments: request.rpc.params?.arguments,
  };
}

function errorCode(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "code" in error) {
    return error.code;
  }
  return undefined;
}

test("rogal maps commands, real ticks, and input to its pinned MCP tools with bearer auth and no Origin", async (t) => {
  const fixture = await protocolFixture(t, (request) => {
    const name = request.rpc.params?.name;
    if (name === "execute_commands") {
      return {
        kind: "result",
        value: { success: true, result: 1000, error: null, messages: [] },
      };
    }
    return { kind: "result", value: { ok: true } };
  });
  const adapter = adapterFor(target("26.2"), fixture.endpoint);

  const command = await adapter.command({
    sessionId: "rogal-session",
    command: "time set day",
  });
  assert.equal(command.status, "passed");
  assert.deepEqual(toolCall(fixture.requests[0]), {
    name: "execute_commands",
    arguments: { commands: ["time set day"], wait_ticks: 1 },
  });
  assert.equal(fixture.requests[0]?.headers.authorization, `Bearer ${token}`);
  assert.equal(fixture.requests[0]?.headers.origin, undefined);

  const settled = await adapter.settle({
    sessionId: "rogal-session",
    ticks: 20,
  });
  assert.equal(settled.status, "passed");
  assert.deepEqual(toolCall(fixture.requests[1]), {
    name: "advance_ticks",
    arguments: { ticks: 20 },
  });

  const input = await adapter.input({
    sessionId: "rogal-session",
    action: { kind: "key", key: "W", action: "tap" },
  });
  assert.equal(input.status, "passed");
  assert.deepEqual(toolCall(fixture.requests[2]), {
    name: "press_key",
    arguments: { key: "W", action: "tap" },
  });
});

test("rogal command success is derived from the game result, never HTTP 200", async (t) => {
  const fixture = await protocolFixture(t, () => ({
    kind: "result",
    value: { success: false, result: 0, error: null, errorType: null },
  }));
  const adapter = adapterFor(target("26.2"), fixture.endpoint);
  const result = await adapter.command({
    sessionId: "rogal-session",
    command: "execute if block ~ ~ ~ bedrock run say no",
  });

  assert.deepEqual(result, {
    status: "failed",
    code: "command_failed",
    adapter: "rogal",
    operation: "command",
  });
});

test("Arclight maps world, input, assertion, command, and synchronization without claiming client waits are server ticks", async (t) => {
  const fixture = await protocolFixture(t, (request) => {
    if (request.rpc.params?.name === "mc.world.join") {
      return {
        kind: "result",
        value: { status: "joining", created: true, name: "isolated-world" },
      };
    }
    if (request.rpc.params?.name === "mc.condition.wait") {
      return {
        kind: "result",
        value: { condition: "client.inWorld == true", matched: true },
      };
    }
    return { kind: "result", value: { status: "ok" } };
  });
  const adapter = adapterFor(target("1.21.1"), fixture.endpoint);

  const world = await adapter.worldCreate({
    sessionId: "arclight-session",
    name: "isolated-world",
    seed: "424242",
    isolated: true,
  });
  assert.equal(world.status, "passed");
  assert.deepEqual(toolCall(fixture.requests[0]), {
    name: "mc.world.join",
    arguments: {
      name: "isolated-world",
      seed: "424242",
      isolated: true,
    },
  });

  await adapter.input({
    sessionId: "arclight-session",
    action: { kind: "key", key: "W", action: "tap" },
  });
  assert.deepEqual(toolCall(fixture.requests[1]), {
    name: "mc.keyboard.press",
    arguments: { key: "W" },
  });

  const assertion = await adapter.assert({
    sessionId: "arclight-session",
    condition: "client.inWorld == true",
    timeoutMs: 1_000,
  });
  assert.equal(assertion.status, "passed");
  assert.deepEqual(toolCall(fixture.requests[2]), {
    name: "mc.condition.wait",
    arguments: { condition: "client.inWorld == true", timeoutMs: 1_000 },
  });

  await adapter.command({
    sessionId: "arclight-session",
    command: "time set day",
  });
  assert.deepEqual(toolCall(fixture.requests[3]), {
    name: "mc.command.run",
    arguments: { command: "time set day" },
  });

  await adapter.settle({ sessionId: "arclight-session", synchronize: true });
  assert.deepEqual(toolCall(fixture.requests[4]), {
    name: "mc.server.sync",
    arguments: {},
  });

  const beforeTicks = fixture.requests.length;
  const ticks = await adapter.settle({
    sessionId: "arclight-session",
    ticks: 20,
  });
  assert.equal(ticks.status, "unsupported");
  assert.equal(fixture.requests.length, beforeTicks);
  assert.ok(
    fixture.requests.every(
      (request) =>
        request.rpc.params?.name !== "server.command" &&
        request.rpc.params?.name !== "schematic.paste" &&
        request.rpc.params?.name !== "mc.server.call",
    ),
  );
});

test("scenario execution is contained beneath its authorized root", async (t) => {
  const roots = await authorizedRoots(t);
  await writeFile(
    join(roots.scenarios.realPath, "smoke", "safe.json"),
    JSON.stringify({
      name: "safe",
      steps: [
        {
          id: "state",
          tool: "mc.condition.wait",
          args: { condition: "client.inWorld == true" },
        },
      ],
    }),
  );
  const fixture = await protocolFixture(t, () => ({
    kind: "result",
    value: { status: "passed", failed: 0 },
  }));
  const adapter = adapterFor(target("1.21.1"), fixture.endpoint, roots);

  const result = await adapter.assert({
    sessionId: "arclight-session",
    scenarioPath: "smoke",
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(toolCall(fixture.requests[0]), {
    name: "mc.scenario.batch.run",
    arguments: { directory: join(roots.scenarios.realPath, "smoke") },
  });

  for (const scenarioPath of ["../outside", "/tmp/outside"]) {
    const denied = await adapter.assert({
      sessionId: "arclight-session",
      scenarioPath,
    });
    assert.deepEqual(denied, {
      status: "unsupported",
      code: "path_escape",
      adapter: "arclight",
      operation: "assert",
    });
  }
  assert.equal(fixture.requests.length, 1);
});

test("scenario files recursively reject every command and schematic paste variant", async (t) => {
  const tools = [
    "mc.command.run",
    "mc.server.command.run",
    "server.command.run",
    "mc.server.command",
    "server.command",
    "schematic.paste",
    "mc.schematic.paste",
  ];
  for (const tool of tools) {
    await t.test(tool, async (t) => {
      const roots = await authorizedRoots(t);
      await writeFile(
        join(roots.scenarios.realPath, "smoke", "denied.json"),
        JSON.stringify({
          name: "denied",
          steps: [
            {
              id: "outer",
              tool: "mc.client.state",
              args: { nested: [{ deeper: { tool } }] },
            },
          ],
        }),
      );
      const fixture = await protocolFixture(t, () => {
        throw new Error("denied scenario reached transport");
      });
      const adapter = adapterFor(target("1.21.1"), fixture.endpoint, roots);
      const result = await adapter.assert({
        sessionId: "arclight-session",
        scenarioPath: "smoke",
      });

      assert.deepEqual(result, {
        status: "unsupported",
        code: "scenario_tool_not_allowed",
        adapter: "arclight",
        operation: "assert",
      });
      assert.equal(fixture.requests.length, 0);
    });
  }
});

test("screenshots are newly created regular files beneath an authorized root and enforce byte limits", async (t) => {
  const roots = await authorizedRoots(t);
  let captureCount = 0;
  const fixture = await protocolFixture(t, () => {
    captureCount += 1;
    const path = captureCount === 1 ? "scene.png" : "too-large.png";
    writeFileSync(join(roots.screenshotDirectory, path), png, { flag: "wx" });
    return { kind: "result", value: { path } };
  });
  const adapter = adapterFor(target("1.21.1"), fixture.endpoint, {
    screenshots: roots.screenshots,
  });

  const captured = await adapter.screenshot({
    sessionId: "arclight-session",
    path: "scene.png",
    maxBytes: png.byteLength,
  });
  assert.equal(captured.status, "passed");
  if (captured.status === "passed") {
    assert.equal(captured.value.path, "scene.png");
    assert.equal(captured.value.byteLength, png.byteLength);
    assert.equal(
      captured.value.sha256,
      createHash("sha256").update(png).digest("hex"),
    );
  }
  const output = join(roots.screenshotDirectory, "scene.png");
  const outputStat = await lstat(output);
  assert.equal(outputStat.isFile(), true);
  assert.equal(outputStat.isSymbolicLink(), false);
  assert.equal(outputStat.nlink, 1);
  assert.deepEqual(await readFile(output), png);

  const tooSmall = await adapter.screenshot({
    sessionId: "arclight-session",
    path: "too-large.png",
    maxBytes: png.byteLength - 1,
  });
  assert.deepEqual(tooSmall, {
    status: "failed",
    code: "screenshot_too_large",
    adapter: "arclight",
    operation: "screenshot",
  });

  for (const path of ["../outside.png", "/tmp/outside.png"]) {
    const denied = await adapter.screenshot({
      sessionId: "arclight-session",
      path,
      maxBytes: png.byteLength,
    });
    assert.deepEqual(denied, {
      status: "unsupported",
      code: "path_escape",
      adapter: "arclight",
      operation: "screenshot",
    });
  }
});

test("a preexisting screenshot is never accepted as new tool output", async (t) => {
  const roots = await authorizedRoots(t);
  await writeFile(join(roots.screenshotDirectory, "scene.png"), png);
  const fixture = await protocolFixture(t, () => {
    throw new Error("preexisting output reached the screenshot tool");
  });
  const adapter = adapterFor(target("1.21.1"), fixture.endpoint, {
    screenshots: roots.screenshots,
  });

  const result = await adapter.screenshot({
    sessionId: "arclight-session",
    path: "scene.png",
    maxBytes: png.byteLength,
  });
  assert.deepEqual(result, {
    status: "failed",
    code: "screenshot_output_exists",
    adapter: "arclight",
    operation: "screenshot",
  });
  assert.equal(fixture.requests.length, 0);
});

test("screenshot symlink escapes fail closed", async (t) => {
  const roots = await authorizedRoots(t);
  const outside = join(roots.directory, "outside.png");
  await writeFile(outside, png);
  await symlink(outside, join(roots.screenshotDirectory, "escape.png"));
  const fixture = await protocolFixture(t, () => ({
    kind: "result",
    value: { path: "escape.png" },
  }));
  const adapter = adapterFor(target("1.21.1"), fixture.endpoint, {
    screenshots: roots.screenshots,
  });

  const result = await adapter.screenshot({
    sessionId: "arclight-session",
    path: "escape.png",
    maxBytes: png.byteLength,
  });
  assert.deepEqual(result, {
    status: "unsupported",
    code: "path_escape",
    adapter: "arclight",
    operation: "screenshot",
  });
  assert.equal(fixture.requests.length, 0);
});

test("HTTP 200 success:false fails rogal input and settle", async (t) => {
  const fixture = await protocolFixture(t, () => ({
    kind: "result",
    value: { success: false, error: "game rejected operation" },
  }));
  const adapter = adapterFor(target("26.2"), fixture.endpoint);

  const input = await adapter.input({
    sessionId: "rogal-session",
    action: { kind: "key", key: "W", action: "tap" },
  });
  assert.deepEqual(input, {
    status: "failed",
    code: "input_failed",
    adapter: "rogal",
    operation: "input",
  });

  const settled = await adapter.settle({
    sessionId: "rogal-session",
    ticks: 2,
  });
  assert.deepEqual(settled, {
    status: "failed",
    code: "settle_failed",
    adapter: "rogal",
    operation: "settle",
  });
});

test("HTTP 200 success:false fails Voxellume world creation", async (t) => {
  const fixture = await protocolFixture(t, () => ({
    kind: "result",
    value: { success: false, error: "world already exists" },
  }));
  const selected = createRuntimeAdapter({
    target: target("1.21.10"),
    enabledAdapters: [],
    verificationMod: { installed: true },
    transport: createLoopbackRuntimeTransport({
      endpoint: fixture.endpoint,
      token,
    }),
  });
  assert.equal(selected.status, "available");
  if (selected.status !== "available") return;

  const result = await selected.adapter.worldCreate({
    sessionId: "voxellume-session",
    name: "isolated-world",
    seed: "424242",
    isolated: true,
  });
  assert.deepEqual(result, {
    status: "failed",
    code: "world_create_failed",
    adapter: "voxellume",
    operation: "worldCreate",
  });
});

test("key modifiers and hold ticks are fully mapped or explicitly unsupported", async (t) => {
  await t.test("rogal forwards modifiers and hold_ticks", async (t) => {
    const fixture = await protocolFixture(t, () => ({
      kind: "result",
      value: { success: true },
    }));
    const adapter = adapterFor(target("26.2"), fixture.endpoint);
    const result = await adapter.input({
      sessionId: "rogal-session",
      action: {
        kind: "key",
        key: "W",
        action: "hold",
        holdTicks: 7,
        modifiers: ["shift", "control"],
      },
    });

    assert.equal(result.status, "passed");
    assert.deepEqual(toolCall(fixture.requests[0]), {
      name: "press_key",
      arguments: {
        key: "W",
        action: "hold",
        hold_ticks: 7,
        modifiers: ["shift", "control"],
      },
    });
  });

  await t.test("Arclight never drops unmapped key fields", async (t) => {
    const fixture = await protocolFixture(t, () => ({
      kind: "result",
      value: { status: "pressed" },
    }));
    const adapter = adapterFor(target("1.21.1"), fixture.endpoint);
    const actions = [
      {
        kind: "key" as const,
        key: "W",
        action: "tap" as const,
        modifiers: ["shift"],
      },
      {
        kind: "key" as const,
        key: "W",
        action: "tap" as const,
        holdTicks: 7,
      },
      {
        kind: "key" as const,
        key: "W",
        action: "hold" as const,
        holdTicks: 7,
        modifiers: ["shift"],
      },
    ];

    for (const action of actions) {
      const result = await adapter.input({
        sessionId: "arclight-session",
        action,
      });
      assert.deepEqual(result, {
        status: "unsupported",
        code: "unsupported_operation",
        adapter: "arclight",
        operation: "input",
      });
    }
    assert.equal(fixture.requests.length, 0);
  });
});

test("cleanup rejects caller-supplied, current, untracked, and wildcard PIDs", async (t) => {
  const ownedPid = Number.MAX_SAFE_INTEGER - 1;
  const cases = [
    {
      name: "arbitrary caller extra",
      ownedPids: [ownedPid, Number.MAX_SAFE_INTEGER],
    },
    { name: "current process", ownedPids: [ownedPid, process.pid] },
    { name: "process group wildcard", ownedPids: [ownedPid, 0] },
    { name: "negative wildcard", ownedPids: [ownedPid, -1] },
    {
      name: "untracked replacement",
      ownedPids: [Number.MAX_SAFE_INTEGER],
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const tools: string[] = [];
      const transport: RuntimeTransport = {
        call: async (tool) => {
          tools.push(tool);
          if (tool === "runtime") {
            return { sessionId: "owned-session", pid: ownedPid };
          }
          return { success: true };
        },
      };
      const selected = createRuntimeAdapter({
        target: target("26.3"),
        enabledAdapters: ["modlens"],
        transport,
      });
      assert.equal(selected.status, "available");
      if (selected.status !== "available") return;
      const launched = await selected.adapter.launch({
        projectId: "owned-project",
        projectRoot: "/isolated/project",
        mode: "hidden",
      });
      assert.equal(launched.status, "passed");

      const result = await selected.adapter.cleanup({
        sessionId: "owned-session",
        ownedPids: fixture.ownedPids,
      });
      assert.deepEqual(result, {
        status: "failed",
        code: "unowned_pid",
        adapter: "modlens",
        operation: "cleanup",
      });
      assert.deepEqual(tools, ["runtime"]);
    });
  }
});

test("every transport operation receives the remaining approved ten-minute deadline", async (t) => {
  const roots = await authorizedRoots(t);
  const deadlineMs = Date.now() + 10 * 60 * 1000;
  const ownedPid = Number.MAX_SAFE_INTEGER - 1;
  const calls: {
    tool: string;
    timeoutMs?: number | undefined;
    signal?: AbortSignal | undefined;
  }[] = [];
  const transport: RuntimeTransport = {
    call: async (tool, _args, options) => {
      calls.push({
        tool,
        timeoutMs: options?.timeoutMs,
        signal: options?.signal,
      });
      if (tool === "voxellume.launch") {
        return { sessionId: "deadline-session", pid: ownedPid };
      }
      if (tool.includes("screenshot")) {
        return { kind: "image", data: png };
      }
      return { success: true };
    },
  };
  const selected = createRuntimeAdapter({
    target: target("1.21.10"),
    enabledAdapters: [],
    verificationMod: { installed: true },
    transport,
    roots: { screenshots: roots.screenshots },
  });
  assert.equal(selected.status, "available");
  if (selected.status !== "available") return;
  const adapter = selected.adapter;
  const sessionId = "deadline-session";

  const results = [
    await adapter.launch({
      projectId: "deadline-project",
      projectRoot: "/isolated/project",
      mode: "hidden",
      deadlineMs,
    }),
    await adapter.worldCreate({
      sessionId,
      name: "deadline-world",
      seed: "424242",
      isolated: true,
      deadlineMs,
    }),
    await adapter.settle({ sessionId, ticks: 2, deadlineMs }),
    await adapter.input({
      sessionId,
      action: { kind: "key", key: "W", action: "tap" },
      deadlineMs,
    }),
    await adapter.command({
      sessionId,
      command: "time set day",
      deadlineMs,
    }),
    await adapter.assert({
      sessionId,
      condition: "client.inWorld == true",
      deadlineMs,
    }),
    await adapter.screenshot({
      sessionId,
      path: "deadline.png",
      maxBytes: png.byteLength,
      deadlineMs,
    }),
  ];

  assert.deepEqual(
    results.map((result) => result.status),
    Array.from({ length: 7 }, () => "passed"),
  );
  assert.equal(calls.length, 7);
  assert.ok(calls[0]!.timeoutMs! > 10_000);
  for (const [index, call] of calls.entries()) {
    assert.ok(call.timeoutMs !== undefined, `${call.tool} omitted timeoutMs`);
    assert.ok(
      call.timeoutMs > 590_000,
      `${call.tool} did not receive ten-minute budget`,
    );
    assert.ok(
      call.timeoutMs <= 600_000,
      `${call.tool} exceeded approved budget`,
    );
    assert.ok(call.signal instanceof AbortSignal);
    if (index > 0) {
      assert.ok(
        call.timeoutMs <= calls[index - 1]!.timeoutMs!,
        `${call.tool} increased the remaining deadline`,
      );
    }
  }
});

test("ModLens cancellation also receives the remaining approved deadline", async () => {
  const deadlineMs = Date.now() + 10 * 60 * 1000;
  const timeouts: (number | undefined)[] = [];
  const transport: RuntimeTransport = {
    call: async (_tool, _args, options) => {
      timeouts.push(options?.timeoutMs);
      return { sessionId: "cancel-session", pid: 4_000_000_000, success: true };
    },
  };
  const selected = createRuntimeAdapter({
    target: target("26.3"),
    enabledAdapters: ["modlens"],
    transport,
  });
  assert.equal(selected.status, "available");
  if (selected.status !== "available") return;
  const launched = await selected.adapter.launch({
    projectId: "cancel-project",
    projectRoot: "/isolated/project",
    mode: "hidden",
    deadlineMs,
  });
  assert.equal(launched.status, "passed");

  const cancelled = await selected.adapter.cancel({
    sessionId: "cancel-session",
    ownedPids: [4_000_000_000],
    deadlineMs,
  });
  assert.equal(cancelled.status, "passed");
  assert.equal(timeouts.length, 2);
  assert.ok(timeouts[0]! > 590_000 && timeouts[0]! <= 600_000);
  assert.ok(timeouts[1]! > 590_000 && timeouts[1]! <= 600_000);
  assert.ok(timeouts[1]! <= timeouts[0]!);
});

test("transport requires a literal loopback URL and a nonempty bearer token", () => {
  for (const endpoint of [
    "http://localhost:8080/mcp",
    "http://0.0.0.0:8080/mcp",
    "http://2130706433:8080/mcp",
    "http://127.0.0.1.nip.io:8080/mcp",
    "http://example.com/mcp",
  ]) {
    assert.throws(
      () => createLoopbackRuntimeTransport({ endpoint, token }),
      (error) => {
        assert.equal(errorCode(error), "loopback_required");
        return true;
      },
    );
  }
  assert.throws(
    () =>
      createLoopbackRuntimeTransport({
        endpoint: "http://127.0.0.1:8080/mcp",
        token: "",
      }),
    (error) => {
      assert.equal(errorCode(error), "token_required");
      return true;
    },
  );
  assert.doesNotThrow(() =>
    createLoopbackRuntimeTransport({
      endpoint: "http://[::1]:8080/mcp",
      token,
    }),
  );
});

test("authentication failure is unavailable and never retried without credentials", async (t) => {
  const fixture = await protocolFixture(t, () => ({
    kind: "http",
    status: 401,
    body: JSON.stringify({ error: "unauthorized" }),
  }));
  const result = createRuntimeAdapter({
    target: target("1.21.1"),
    enabledAdapters: ["arclight"],
    transport: createLoopbackRuntimeTransport({
      endpoint: fixture.endpoint,
      token: "wrong-token",
    }),
  });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;

  const command = await result.adapter.command({
    sessionId: "arclight-session",
    command: "time set day",
  });
  assert.deepEqual(command, {
    status: "unavailable",
    code: "authentication_failed",
    adapter: "arclight",
    operation: "command",
  });
  assert.equal(fixture.requests.length, 1);
});

test("transport rejects requests and responses above 256 KiB", async (t) => {
  const fixture = await protocolFixture(t, () => ({
    kind: "result",
    value: { success: true, padding: "x".repeat(256 * 1024) },
  }));
  const adapter = adapterFor(target("26.2"), fixture.endpoint);

  const oversizedRequest = await adapter.command({
    sessionId: "rogal-session",
    command: "say ".concat("x".repeat(256 * 1024)),
  });
  assert.deepEqual(oversizedRequest, {
    status: "unavailable",
    code: "request_too_large",
    adapter: "rogal",
    operation: "command",
  });
  assert.equal(fixture.requests.length, 0);

  const oversizedResponse = await adapter.command({
    sessionId: "rogal-session",
    command: "time set day",
  });
  assert.deepEqual(oversizedResponse, {
    status: "unavailable",
    code: "response_too_large",
    adapter: "rogal",
    operation: "command",
  });
  assert.equal(fixture.requests.length, 1);
});
