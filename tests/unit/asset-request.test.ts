import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PNG } from "pngjs";

import { requestAsset } from "../../src/core/assets/asset-request.ts";

const credential = "fal-test-secret-that-must-never-leak";
const pixelImage = new PNG({ width: 1, height: 1 });
pixelImage.data.set([255, 0, 0, 255]);
const pixel = PNG.sync.write(pixelImage);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function request(provider: "host" | "fal" | "comfyui") {
  return {
    provider,
    model: provider === "fal" ? "fal-ai/flux-pro/v1.1-ultra" : "ruby-pixel-v1",
    prompt: "16x16 ruby blade, crisp pixel art",
    seed: 1729,
    input: {
      width: 1,
      height: 1,
      negative_prompt: "blurry",
      apiKey: credential,
    },
    styleGuide: "approved-style-board-r3",
    referenceImage: { bytes: pixel, sha256: sha256(pixel) },
  };
}

function success(result: unknown) {
  const observed = result as { status: string };
  assert.equal(observed.status, "passed");
  return result as {
    status: "passed";
    outputs: Array<{
      bytes: Buffer;
      sha256: string;
      width: number;
      height: number;
    }>;
    manifest: {
      provider: string;
      model: string;
      request: Record<string, unknown>;
      requestSha256: string;
      responseSha256: string;
      seed: number;
      requestId?: string;
      cost?: number;
      outputs: Array<{ sha256: string }>;
    };
  };
}

async function failure(
  operation: Promise<unknown>,
  status: "failed" | "unavailable" | "cancelled",
  code: string,
) {
  const result = (await operation) as {
    status: string;
    error?: { code: string; detail: string };
  };
  assert.equal(result.status, status, JSON.stringify(result));
  assert.equal(result.error?.code, code, JSON.stringify(result));
  assert.ok(result.error!.detail.length > 0);
  assert.equal("outputs" in result, false);
  return result;
}

test("rejects malformed common requests before invoking a provider", async () => {
  let calls = 0;
  const host = async () => {
    calls += 1;
    return pixel;
  };
  const malformed = [
    { ...request("host"), provider: "unknown" },
    { ...request("host"), model: "" },
    { ...request("host"), prompt: "  " },
    { ...request("host"), seed: 1.5 },
    { ...request("host"), seed: Number.NaN },
    { ...request("host"), input: null },
    { ...request("host"), styleGuide: "" },
    {
      ...request("host"),
      referenceImage: { bytes: pixel, sha256: "0".repeat(64) },
    },
  ];

  for (const candidate of malformed) {
    await failure(
      requestAsset(candidate as never, { host }),
      "failed",
      "invalid_request",
    );
  }
  assert.equal(calls, 0);
});

test("reports unavailable prerequisites instead of selecting a fallback provider", async () => {
  await failure(
    requestAsset(request("host")),
    "unavailable",
    "host_provider_unavailable",
  );
  await failure(
    requestAsset(request("fal")),
    "unavailable",
    "fal_provider_unavailable",
  );
  await failure(
    requestAsset(request("fal"), {
      falClient: { subscribe: async () => ({ data: {}, requestId: "x" }) },
    }),
    "unavailable",
    "fal_credentials_unavailable",
  );
  await failure(
    requestAsset({
      ...request("comfyui"),
      workflow: {},
      approvedWorkflowSha256: [],
    } as never),
    "unavailable",
    "comfyui_workflow_unapproved",
  );
});

test("host callback receives the complete request and returns validated PNG provenance", async () => {
  const input = request("host");
  let received: unknown;
  const result = success(
    await requestAsset(input, {
      host: async (value) => {
        received = value;
        return pixel;
      },
    }),
  );

  assert.deepEqual(received, input);
  assert.equal(result.outputs.length, 1);
  assert.deepEqual(result.outputs[0]!.bytes, pixel);
  assert.equal(result.outputs[0]!.sha256, sha256(pixel));
  assert.equal(result.outputs[0]!.width, 1);
  assert.equal(result.outputs[0]!.height, 1);
  assert.equal(result.manifest.provider, "host");
  assert.equal(result.manifest.model, input.model);
  assert.equal(result.manifest.seed, input.seed);
  assert.deepEqual(result.manifest.request, {
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    seed: input.seed,
    styleGuide: input.styleGuide,
    inputSha256: sha256(
      Buffer.from(
        JSON.stringify({
          apiKey: credential,
          height: 1,
          negative_prompt: "blurry",
          width: 1,
        }),
      ),
    ),
    referenceImage: { sha256: input.referenceImage.sha256 },
  });
  assert.equal("input" in result.manifest.request, false);
  assert.equal("workflow" in result.manifest.request, false);
  assert.equal(JSON.stringify(result).includes(credential), false);
  assert.match(result.manifest.requestSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.manifest.responseSha256, sha256(pixel));
  assert.deepEqual(result.manifest.outputs, [{ sha256: sha256(pixel) }]);
});

test("host failures and malformed outputs are bounded and sanitized", async () => {
  const secretFailure = await failure(
    requestAsset(request("host"), {
      host: async () => {
        throw new Error(`provider rejected ${credential}`);
      },
    }),
    "failed",
    "host_request_failed",
  );
  assert.equal(JSON.stringify(secretFailure).includes(credential), false);

  await failure(
    requestAsset(request("host"), {
      host: async () => Buffer.from("not a png"),
    }),
    "failed",
    "invalid_png",
  );
  await failure(
    requestAsset(request("host"), {
      host: async () => Buffer.alloc(16 * 1024 * 1024 + 1),
    }),
    "failed",
    "output_too_large",
  );
});

test("fal uses subscribe and an injected fetch with HTTPS-only output downloads", async () => {
  const calls: Array<{ model: string; options: Record<string, unknown> }> = [];
  const downloads: Array<{ url: string; init: RequestInit | undefined }> = [];
  const result = success(
    await requestAsset(request("fal"), {
      falCredentials: credential,
      falClient: {
        subscribe: async (model: string, options: Record<string, unknown>) => {
          calls.push({ model, options });
          return {
            data: {
              images: [{ url: "https://fal.media/files/ruby.png" }],
              cost: 0.04,
            },
            requestId: "req-ruby-1729",
          };
        },
      },
      fetch: async (url, init) => {
        downloads.push({ url: String(url), init });
        return new Response(new Uint8Array(pixel), { status: 200 });
      },
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.model, "fal-ai/flux-pro/v1.1-ultra");
  assert.deepEqual(calls[0]!.options.input, {
    prompt: request("fal").prompt,
    seed: 1729,
    width: 1,
    height: 1,
    negative_prompt: "blurry",
    apiKey: credential,
    styleGuide: "approved-style-board-r3",
    referenceImage: request("fal").referenceImage,
  });
  assert.deepEqual(downloads, [
    {
      url: "https://fal.media/files/ruby.png",
      init: { redirect: "error" },
    },
  ]);
  assert.equal(result.manifest.requestId, "req-ruby-1729");
  assert.equal(result.manifest.cost, 0.04);
  assert.equal(result.outputs[0]!.sha256, sha256(pixel));
  assert.match(result.manifest.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(result.manifest.responseSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.manifest.request.styleGuide, "approved-style-board-r3");
  assert.deepEqual(result.manifest.request.referenceImage, {
    sha256: request("fal").referenceImage.sha256,
  });
  assert.match(String(result.manifest.request.inputSha256), /^[a-f0-9]{64}$/);
  assert.equal("input" in result.manifest.request, false);
  assert.equal("workflow" in result.manifest.request, false);
  assert.equal("approvedWorkflowSha256" in result.manifest.request, false);
  assert.equal(JSON.stringify(result).includes(credential), false);
});

test("fal rejects untrusted output URLs before fetching them", async () => {
  let fetches = 0;
  const injectedFetch = async () => {
    fetches += 1;
    return new Response(new Uint8Array(pixel));
  };
  for (const url of [
    "http://fal.media/files/ruby.png",
    "https://evil.example/files/ruby.png",
    "https://fal.media.evil.example/files/ruby.png",
    "https://user:password@fal.media/files/ruby.png",
    "file:///tmp/ruby.png",
  ]) {
    await failure(
      requestAsset(request("fal"), {
        falCredentials: credential,
        falClient: {
          subscribe: async () => ({
            data: { images: [{ url }] },
            requestId: "req-untrusted",
          }),
        },
        fetch: injectedFetch,
      }),
      "failed",
      "untrusted_output_url",
    );
  }
  assert.equal(fetches, 0);
});

test("fal bounds output count and bytes and validates downloaded PNGs", async () => {
  const images = Array.from({ length: 5 }, (_, index) => ({
    url: `https://fal.media/files/${index}.png`,
  }));
  let fetches = 0;
  await failure(
    requestAsset(request("fal"), {
      falCredentials: credential,
      falClient: {
        subscribe: async () => ({ data: { images }, requestId: "req-count" }),
      },
      fetch: async () => {
        fetches += 1;
        return new Response(new Uint8Array(pixel));
      },
    }),
    "failed",
    "output_count_exceeded",
  );
  assert.equal(fetches, 0);

  for (const [body, code] of [
    [Buffer.alloc(16 * 1024 * 1024 + 1), "output_too_large"],
    [Buffer.from("not a png"), "invalid_png"],
  ] as const) {
    await failure(
      requestAsset(request("fal"), {
        falCredentials: credential,
        falClient: {
          subscribe: async () => ({
            data: { images: [{ url: "https://fal.media/files/ruby.png" }] },
            requestId: "req-output",
          }),
        },
        fetch: async () => new Response(new Uint8Array(body)),
      }),
      "failed",
      code,
    );
  }
});

test("fal errors never disclose credentials through result details", async () => {
  const result = await failure(
    requestAsset(request("fal"), {
      falCredentials: credential,
      falClient: {
        subscribe: async () => {
          throw new Error(`HTTP 401 for ${credential}`);
        },
      },
      fetch: async () => {
        throw new Error("must not fetch");
      },
    }),
    "failed",
    "fal_request_failed",
  );
  assert.equal(JSON.stringify(result).includes(credential), false);
});

test("fal rejects URL-shaped model identifiers before subscribing", async () => {
  let subscriptions = 0;
  for (const model of [
    "https://attackerfal.run",
    "https://attackerfal.run/fal-ai/flux-pro",
    "http://fal-ai/flux-pro/v1.1-ultra",
    "//attackerfal.run/model",
  ]) {
    await failure(
      requestAsset(
        { ...request("fal"), model },
        {
          falCredentials: credential,
          falClient: {
            subscribe: async () => {
              subscriptions += 1;
              return { data: { images: [] }, requestId: "must-not-run" };
            },
          },
        },
      ),
      "failed",
      "invalid_model",
    );
  }
  assert.equal(subscriptions, 0);
});

test("fal reserved input cannot diverge from top-level prompt or seed", async () => {
  let subscriptions = 0;
  for (const input of [
    { ...request("fal").input, prompt: "attacker-controlled prompt" },
    { ...request("fal").input, seed: 31337 },
    {
      ...request("fal").input,
      prompt: "attacker-controlled prompt",
      seed: 31337,
    },
  ]) {
    await failure(
      requestAsset(
        { ...request("fal"), input },
        {
          falCredentials: credential,
          falClient: {
            subscribe: async () => {
              subscriptions += 1;
              return { data: { images: [] }, requestId: "must-not-run" };
            },
          },
        },
      ),
      "failed",
      "reserved_input_conflict",
    );
  }
  assert.equal(subscriptions, 0);
});

test("every provider has one overall 300 second deadline", async (t) => {
  const deadline = new AbortController();
  let requestedMilliseconds = 0;
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    requestedMilliseconds = milliseconds;
    return deadline.signal;
  });
  const operation = requestAsset(request("host"), {
    host: () => new Promise<Uint8Array>(() => {}),
  });
  assert.equal(requestedMilliseconds, 300_000);
  deadline.abort();
  await failure(operation, "failed", "request_timed_out");
});

type FalStage =
  | "storage-initiate"
  | "storage"
  | "subscribe"
  | "status"
  | "result"
  | "output"
  | "attacker";

function officialFalFetch(redirectStage?: FalStage) {
  const calls: Array<{ stage: FalStage; init: RequestInit | undefined }> = [];
  const attackerPayloads: unknown[] = [];
  const injectedFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input));
    const stage: FalStage =
      url.hostname === "attacker.invalid"
        ? "attacker"
        : url.hostname === "rest.fal.run"
          ? "storage-initiate"
          : url.hostname === "storage.fal.run"
            ? "storage"
            : url.hostname === "fal.media"
              ? "output"
              : url.pathname.endsWith("/status")
                ? "status"
                : url.pathname.endsWith("/requests/req-config")
                  ? "result"
                  : "subscribe";
    calls.push({ stage, init });
    if (stage === "attacker") {
      attackerPayloads.push(init?.body);
      return new Response("{}", { status: 200 });
    }
    if (stage === redirectStage) {
      if (init?.redirect === "error") throw new TypeError("redirect blocked");
      calls.push({ stage: "attacker", init });
      attackerPayloads.push(init?.body);
      return new Response("{}", { status: 200 });
    }
    if (stage === "storage-initiate") {
      return new Response(
        JSON.stringify({
          upload_url: "https://storage.fal.run/upload/reference",
          file_url: "https://fal.media/files/reference.png",
        }),
        { status: 200 },
      );
    }
    if (stage === "storage") return new Response(null, { status: 200 });
    if (stage === "subscribe") {
      return new Response(JSON.stringify({ request_id: "req-config" }), {
        status: 200,
      });
    }
    if (stage === "status") {
      return new Response(JSON.stringify({ status: "COMPLETED" }), {
        status: 200,
      });
    }
    if (stage === "result") {
      return new Response(
        JSON.stringify({
          images: [{ url: "https://fal.media/files/ruby.png" }],
        }),
        { status: 200 },
      );
    }
    return new Response(new Uint8Array(pixel), { status: 200 });
  };
  return {
    calls,
    attackerPayloads,
    injectedFetch: injectedFetch as typeof fetch,
  };
}

function falRequestWithUpload() {
  return {
    ...request("fal"),
    input: {
      attachment: new Blob([new Uint8Array(pixel)], { type: "image/png" }),
    },
  };
}

test("official fal config fetch forces redirect error for queue, result, and storage requests", async (t) => {
  const fake = officialFalFetch();
  t.mock.method(globalThis, "fetch", fake.injectedFetch);
  const rawResult = await requestAsset(falRequestWithUpload(), {
    falCredentials: credential,
    fetch: fake.injectedFetch,
  });
  const observed = rawResult as { status: string };
  assert.equal(
    observed.status,
    "passed",
    JSON.stringify({ rawResult, calls: fake.calls }),
  );
  const result = success(rawResult);
  assert.equal(result.outputs.length, 1);
  assert.deepEqual(
    fake.calls.map(({ stage }) => stage),
    ["storage-initiate", "storage", "subscribe", "status", "result", "output"],
  );
  assert.ok(fake.calls.every(({ init }) => init?.redirect === "error"));
  assert.deepEqual(fake.attackerPayloads, []);
});

test("a simulated fal subscribe redirect fails without forwarding the payload", async (t) => {
  const fake = officialFalFetch("subscribe");
  t.mock.method(globalThis, "fetch", fake.injectedFetch);
  const result = await requestAsset(request("fal"), {
    falCredentials: credential,
    fetch: fake.injectedFetch,
  });
  assert.notEqual((result as { status: string }).status, "passed");
  assert.deepEqual(fake.attackerPayloads, []);
  assert.equal(
    fake.calls.some(({ stage }) => stage === "attacker"),
    false,
  );
});
