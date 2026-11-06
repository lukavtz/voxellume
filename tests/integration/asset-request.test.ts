import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { PNG } from "pngjs";

import { requestAsset } from "../../src/core/assets/asset-request.ts";

const pixelImage = new PNG({ width: 1, height: 1 });
pixelImage.data.set([0, 255, 0, 255]);
const pixel = PNG.sync.write(pixelImage);
const workflow = {
  "1": {
    class_type: "VAELoader",
    inputs: { vae_name: "pixel-art.safetensors" },
  },
  "2": {
    class_type: "SaveImage",
    inputs: { filename_prefix: "voxellume-test", images: ["1", 0] },
  },
  "3": {
    class_type: "CLIPTextEncode",
    inputs: {
      text: "unreviewed prompt",
      image: "unreviewed-reference",
      token: "comfy-secret-never-in-manifest",
    },
  },
  "4": {
    class_type: "KSampler",
    inputs: { seed: -1, width: 0, height: 0 },
  },
};
const workflowBindings = {
  prompt: ["3", "inputs", "text"],
  seed: ["4", "inputs", "seed"],
  referenceImage: ["3", "inputs", "image"],
} as const;
const workflowSha256 = createHash("sha256")
  .update(JSON.stringify(workflow))
  .digest("hex");

interface FakeComfyOptions {
  image?: Buffer;
  historyBody?: string;
  redirect?: string;
  redirectPrompt?: boolean;
  redirectHistory?: boolean;
  holdHistory?: boolean;
  holdImage?: boolean;
}

interface FakeComfy {
  requests: Array<{
    method: string | undefined;
    url: string | undefined;
    body?: unknown;
  }>;
  historyRequested: Promise<void>;
  imageRequested: Promise<void>;
  close: () => Promise<void>;
}

async function fakeComfy(
  t: TestContext,
  options: FakeComfyOptions = {},
): Promise<FakeComfy> {
  const requests: FakeComfy["requests"] = [];
  const pending = new Set<ServerResponse>();
  const historyGate = Promise.withResolvers<void>();
  const historyRequested = historyGate.promise;
  const markHistoryRequested = historyGate.resolve;
  const imageGate = Promise.withResolvers<void>();
  const imageRequested = imageGate.promise;
  const markImageRequested = imageGate.resolve;
  const server: Server = createServer((request, response) => {
    response.setHeader("connection", "close");
    pending.add(response);
    response.on("close", () => pending.delete(response));
    if (request.method === "POST" && request.url === "/prompt") {
      if (options.redirectPrompt) {
        requests.push({ method: request.method, url: request.url });
        response.writeHead(302, { location: "/prompt-redirected" });
        response.end();
        return;
      }
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as unknown;
        requests.push({ method: request.method, url: request.url, body });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ prompt_id: "comfy-ruby-1729", number: 1 }),
        );
      });
      return;
    }
    if (
      request.method === "GET" &&
      request.url === "/history/comfy-ruby-1729"
    ) {
      requests.push({ method: request.method, url: request.url });
      markHistoryRequested();
      if (options.redirectHistory) {
        response.writeHead(302, { location: "/history-redirected" });
        response.end();
        return;
      }
      if (options.holdHistory) return;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        options.historyBody ??
          JSON.stringify({
            "comfy-ruby-1729": {
              status: { completed: true },
              outputs: {
                "2": {
                  images: [
                    {
                      filename: "ruby.png",
                      subfolder: "textures",
                      type: "output",
                    },
                  ],
                },
              },
            },
          }),
      );
      return;
    }
    if (
      request.method === "GET" &&
      request.url === "/view?filename=ruby.png&subfolder=textures&type=output"
    ) {
      requests.push({ method: request.method, url: request.url });
      markImageRequested();
      if (options.holdImage) return;
      if (options.redirect !== undefined) {
        response.writeHead(302, { location: options.redirect });
        response.end();
      } else {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(options.image ?? pixel);
      }
      return;
    }
    response.writeHead(404).end();
  });
  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(8188, "127.0.0.1", () => {
    server.off("error", listening.reject);
    listening.resolve();
  });
  await listening.promise;
  const address = server.address() as AddressInfo;
  assert.equal(address.port, 8188);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const response of pending) response.destroy();
    server.closeAllConnections();
    const closing = Promise.withResolvers<void>();
    server.close((error) =>
      error === undefined ? closing.resolve() : closing.reject(error),
    );
    await closing.promise;
  };
  t.after(close);
  return { requests, historyRequested, imageRequested, close };
}

function comfyRequest() {
  return {
    provider: "comfyui" as const,
    model: "reviewed-pixel-workflow-r3",
    prompt: "16x16 ruby blade, crisp pixel art",
    seed: 1729,
    input: {},
    styleGuide: "approved-style-board-r3",
    referenceImage: {
      bytes: pixel,
      sha256: createHash("sha256").update(pixel).digest("hex"),
    },
    workflow,
  };
}

function comfyOptions(
  approvedWorkflowSha256 = workflowSha256,
  overrides: Record<string, unknown> = {},
) {
  return {
    approvedWorkflows: [
      {
        model: "reviewed-pixel-workflow-r3",
        sha256: approvedWorkflowSha256,
        workflowBindings,
        ...overrides,
      },
    ],
  };
}

async function expectFailure(
  operation: Promise<unknown>,
  code: string,
  status: "failed" | "unavailable" | "cancelled" = "failed",
) {
  const result = (await operation) as {
    status: string;
    error?: { code: string; detail: string };
  };
  assert.equal(result.status, status, JSON.stringify(result));
  assert.equal(result.error?.code, code, JSON.stringify(result));
  return result;
}

test("ComfyUI executes the reviewed workflow over the fixed loopback API and records provenance", async (t) => {
  const server = await fakeComfy(t);
  const input = comfyRequest();
  const rawResult = await requestAsset(input, comfyOptions());
  const observed = rawResult as { status: string };
  assert.equal(observed.status, "passed");
  const result = rawResult as {
    outputs: Array<{
      bytes: Buffer;
      sha256: string;
      width: number;
      height: number;
    }>;
    manifest: {
      provider: string;
      model: string;
      seed: number;
      requestId: string;
      requestSha256: string;
      responseSha256: string;
      workflowSha256: string;
      sourceSha256: string;
      request: Record<string, unknown>;
    };
  };

  assert.deepEqual(result.outputs[0]!.bytes, pixel);
  assert.equal(
    result.outputs[0]!.sha256,
    createHash("sha256").update(pixel).digest("hex"),
  );
  assert.equal(result.outputs[0]!.width, 1);
  assert.equal(result.outputs[0]!.height, 1);
  assert.equal(result.manifest.provider, "comfyui");
  assert.equal(result.manifest.model, input.model);
  assert.equal(result.manifest.seed, 1729);
  assert.equal(result.manifest.requestId, "comfy-ruby-1729");
  assert.match(result.manifest.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(result.manifest.responseSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.manifest.workflowSha256, workflowSha256);
  assert.notEqual(result.manifest.sourceSha256, workflowSha256);
  assert.equal(result.manifest.request.styleGuide, input.styleGuide);
  assert.match(String(result.manifest.request.inputSha256), /^[a-f0-9]{64}$/);
  assert.deepEqual(result.manifest.request.referenceImage, {
    sha256: input.referenceImage.sha256,
  });
  assert.equal("input" in result.manifest.request, false);
  assert.equal("workflow" in result.manifest.request, false);
  assert.equal("approvedWorkflowSha256" in result.manifest.request, false);
  assert.equal(
    JSON.stringify(result.manifest).includes("comfy-secret-never-in-manifest"),
    false,
  );

  const prompt = server.requests.find((entry) => entry.url === "/prompt");
  const promptBody = prompt?.body;
  assert.ok(promptBody !== null && typeof promptBody === "object");
  assert.ok(
    "prompt" in promptBody &&
      "client_id" in promptBody &&
      "prompt_id" in promptBody,
  );
  assert.deepEqual(promptBody.prompt, {
    ...workflow,
    "3": {
      ...workflow["3"],
      inputs: {
        ...workflow["3"].inputs,
        text: `${input.prompt}\n\nStyle: ${input.styleGuide}`,
        image: { type: "Buffer", data: Array.from(input.referenceImage.bytes) },
      },
    },
    "4": {
      ...workflow["4"],
      inputs: { ...workflow["4"].inputs, seed: input.seed },
    },
  });
  assert.equal(
    result.manifest.sourceSha256,
    createHash("sha256")
      .update(JSON.stringify(promptBody.prompt))
      .digest("hex"),
  );
  const clientId = promptBody.client_id;
  assert.ok(typeof clientId === "string");
  assert.ok(clientId.length > 0);
  assert.equal(promptBody.prompt_id, "comfy-ruby-1729");
  assert.ok(
    server.requests.some((entry) => entry.url === "/history/comfy-ruby-1729"),
  );
  assert.ok(
    server.requests.some(
      (entry) =>
        entry.url === "/view?filename=ruby.png&subfolder=textures&type=output",
    ),
  );
});

test("ComfyUI enforces workflow identity and explicit input/reference bindings", async (t) => {
  const server = await fakeComfy(t);
  await expectFailure(
    requestAsset(
      {
        ...comfyRequest(),
        model: "unreviewed-workflow",
      },
      comfyOptions(),
    ),
    "workflow_not_approved",
  );
  await expectFailure(
    requestAsset(
      {
        ...comfyRequest(),
        input: { width: 16, height: 32 },
      },
      comfyOptions(),
    ),
    "unbound_workflow_input",
  );
  await expectFailure(
    requestAsset(
      comfyRequest(),
      comfyOptions(workflowSha256, {
        workflowBindings: {
          prompt: workflowBindings.prompt,
          seed: workflowBindings.seed,
        },
      }),
    ),
    "reference_image_unbound",
  );
  assert.equal(server.requests.length, 0);

  const bound = await requestAsset(
    {
      ...comfyRequest(),
      input: { width: 16, height: 32 },
    },
    comfyOptions(workflowSha256, {
      workflowBindings: {
        ...workflowBindings,
        input: {
          width: ["4", "inputs", "width"],
          height: ["4", "inputs", "height"],
        },
      },
    }),
  );
  const observed = bound as { status: string };
  assert.equal(
    observed.status,
    "passed",
    JSON.stringify({ bound, requests: server.requests }),
  );
  const prompt = server.requests.find((entry) => entry.url === "/prompt");
  const promptBody = prompt?.body;
  assert.ok(
    promptBody !== null &&
      typeof promptBody === "object" &&
      "prompt" in promptBody,
  );
  const submitted = JSON.stringify(promptBody.prompt);
  assert.ok(submitted.includes('"width":16'));
  assert.ok(submitted.includes('"height":32'));
});

test("ComfyUI refuses an unapproved or non-canonical workflow digest before network activity", async (t) => {
  const server = await fakeComfy(t);
  await expectFailure(
    requestAsset(comfyRequest(), comfyOptions("0".repeat(64))),
    "workflow_not_approved",
  );
  await expectFailure(
    requestAsset(comfyRequest(), comfyOptions(workflowSha256.toUpperCase())),
    "workflow_not_approved",
  );
  await expectFailure(
    requestAsset({
      ...comfyRequest(),
      approvedWorkflowSha256: [workflowSha256],
    } as never),
    "comfyui_workflow_unapproved",
    "unavailable",
  );
  assert.equal(server.requests.length, 0);
});

test("ComfyUI rejects remote bases and remote workflow URLs", async () => {
  await expectFailure(
    requestAsset(
      {
        ...comfyRequest(),
        baseUrl: "http://example.com:8188",
      } as never,
      comfyOptions(),
    ),
    "invalid_comfyui_base",
  );
  await expectFailure(
    requestAsset(
      {
        ...comfyRequest(),
        workflow: "https://example.com/workflow.json",
      } as never,
      comfyOptions(),
    ),
    "invalid_workflow",
  );
});

test("ComfyUI fails closed on redirects, oversized output, and malformed history", async (t) => {
  const redirecting = await fakeComfy(t, { redirect: "/redirected-image" });
  await expectFailure(
    requestAsset(comfyRequest(), comfyOptions()),
    "redirect_forbidden",
  );
  await redirecting.close();

  const oversized = await fakeComfy(t, {
    image: Buffer.alloc(16 * 1024 * 1024 + 1),
  });
  await expectFailure(
    requestAsset(comfyRequest(), comfyOptions()),
    "output_too_large",
  );
  await oversized.close();

  const malformed = await fakeComfy(t, {
    historyBody: JSON.stringify({
      "comfy-ruby-1729": { status: { completed: true } },
    }),
  });
  await expectFailure(
    requestAsset(comfyRequest(), comfyOptions()),
    "invalid_history",
  );
  await malformed.close();
});

test("ComfyUI rejects invalid PNG output", async (t) => {
  await fakeComfy(t, { image: Buffer.from("not a png") });
  await expectFailure(
    requestAsset(comfyRequest(), comfyOptions()),
    "invalid_png",
  );
});

test("ComfyUI cancellation stops polling and returns cancelled", async (t) => {
  const server = await fakeComfy(t, { holdHistory: true });
  const abort = new AbortController();
  const operation = requestAsset(comfyRequest(), {
    ...comfyOptions(),
    signal: abort.signal,
  });
  await server.historyRequested;
  abort.abort();
  await expectFailure(operation, "request_cancelled", "cancelled");
});

test("ComfyUI rejects prompt and history redirects instead of following them", async (t) => {
  const promptRedirect = await fakeComfy(t, { redirectPrompt: true });
  await expectFailure(
    requestAsset(comfyRequest(), comfyOptions()),
    "redirect_forbidden",
  );
  await promptRedirect.close();

  const historyRedirect = await fakeComfy(t, { redirectHistory: true });
  await expectFailure(
    requestAsset(comfyRequest(), comfyOptions()),
    "redirect_forbidden",
  );
  await historyRedirect.close();
});

test("ComfyUI cancellation during the final download cannot return success", async (t) => {
  const server = await fakeComfy(t, { holdImage: true });
  const abort = new AbortController();
  const operation = requestAsset(comfyRequest(), {
    ...comfyOptions(),
    signal: abort.signal,
  });
  await server.imageRequested;
  abort.abort();
  await expectFailure(operation, "request_cancelled", "cancelled");
});
