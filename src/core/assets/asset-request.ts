import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { createFalClient } from "@fal-ai/client";

import { AssetError, inspectPng } from "./png.ts";

const MAX_OUTPUTS = 4;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const OPERATION_TIMEOUT_MS = 300_000;
const COMFYUI_ORIGIN = "http://127.0.0.1:8188";

interface ReferenceImage {
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface AssetRequest {
  readonly provider: "host" | "fal" | "comfyui";
  readonly model: string;
  readonly prompt: string;
  readonly seed: number;
  readonly input: Record<string, unknown>;
  readonly styleGuide: string;
  readonly referenceImage: ReferenceImage;
  readonly workflow?: Record<string, unknown>;
  readonly baseUrl?: string;
}

export type WorkflowParameterPath = readonly (string | number)[];

export interface ApprovedComfyUiWorkflow {
  readonly model: string;
  readonly sha256: string;
  readonly workflowBindings: Readonly<{
    prompt: WorkflowParameterPath;
    seed: WorkflowParameterPath;
    referenceImage: WorkflowParameterPath;
    input?: Readonly<Record<string, WorkflowParameterPath>>;
  }>;
}

interface FalSubscriptionResult {
  readonly data: unknown;
  readonly requestId?: string;
}

export interface AssetRequestOptions {
  readonly host?: (request: AssetRequest) => Promise<Uint8Array>;
  readonly falCredentials?: string;
  readonly falClient?: {
    subscribe(
      model: string,
      options: { input: Record<string, unknown>; abortSignal?: AbortSignal },
    ): Promise<FalSubscriptionResult>;
  };
  readonly approvedWorkflows?: readonly ApprovedComfyUiWorkflow[];
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

interface AssetOutput {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

interface AssetManifest {
  readonly provider: string;
  readonly model: string;
  readonly seed: number;
  readonly request: Record<string, unknown>;
  readonly requestSha256: string;
  readonly responseSha256: string;
  readonly outputs: readonly { sha256: string }[];
  readonly requestId?: string;
  readonly cost?: number;
  readonly workflowSha256?: string;
  readonly sourceSha256?: string;
}

export type AssetRequestResult =
  | {
      readonly status: "passed";
      readonly outputs: AssetOutput[];
      readonly manifest: AssetManifest;
    }
  | {
      readonly status: "failed" | "unavailable" | "cancelled";
      readonly error: { readonly code: string; readonly detail: string };
    };

class RequestError extends Error {
  readonly code: string;
  readonly status: "failed" | "unavailable";

  constructor(
    code: string,
    detail: string,
    status: "failed" | "unavailable" = "failed",
  ) {
    super(detail);
    this.code = code;
    this.status = status;
  }
}

function hash(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function publicRequest(
  request: AssetRequest,
  workflowSha256?: string,
): Record<string, unknown> {
  return {
    provider: request.provider,
    model: request.model,
    prompt: request.prompt,
    seed: request.seed,
    styleGuide: request.styleGuide,
    inputSha256: hash(canonical(request.input)),
    referenceImage: { sha256: request.referenceImage.sha256 },
    ...(workflowSha256 === undefined ? {} : { workflowSha256 }),
  };
}

function fail(
  status: "failed" | "unavailable" | "cancelled",
  code: string,
  detail: string,
): AssetRequestResult {
  return { status, error: { code, detail } };
}

function validRequest(request: AssetRequest): request is AssetRequest {
  if (request === null || typeof request !== "object") return false;
  if (!["host", "fal", "comfyui"].includes(request.provider)) return false;
  if ("parameterBindings" in request || "workflowBindings" in request)
    return false;
  if (typeof request.model !== "string" || request.model.trim() === "")
    return false;
  if (typeof request.prompt !== "string" || request.prompt.trim() === "")
    return false;
  if (!Number.isSafeInteger(request.seed)) return false;
  if (
    request.input === null ||
    typeof request.input !== "object" ||
    Array.isArray(request.input)
  )
    return false;
  if (
    typeof request.styleGuide !== "string" ||
    request.styleGuide.trim() === ""
  )
    return false;
  const reference = request.referenceImage;
  return (
    reference !== null &&
    typeof reference === "object" &&
    reference.bytes instanceof Uint8Array &&
    /^[a-f0-9]{64}$/.test(reference.sha256) &&
    hash(reference.bytes) === reference.sha256
  );
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted)
    throw new RequestError("request_cancelled", "Asset request was cancelled");
}

async function raceWithSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  throwIfCancelled(signal);
  const aborted = Promise.withResolvers<never>();
  const onAbort = () =>
    aborted.reject(
      new RequestError("request_cancelled", "Asset request was cancelled"),
    );
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([operation, aborted.promise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function operationFailure(
  error: unknown,
  caller: AbortSignal | undefined,
  operation: AbortSignal,
  fallbackCode: string,
  detail: string,
): AssetRequestResult {
  if (caller?.aborted)
    return fail(
      "cancelled",
      "request_cancelled",
      "Asset request was cancelled",
    );
  if (operation.aborted)
    return fail(
      "failed",
      "request_timed_out",
      "Asset request exceeded five minutes",
    );
  if (error instanceof RequestError)
    return fail(error.status, error.code, error.message);
  return fail("failed", fallbackCode, detail);
}

function output(bytes: Uint8Array): AssetOutput {
  if (bytes.byteLength > MAX_OUTPUT_BYTES)
    throw new RequestError(
      "output_too_large",
      "Generated output exceeds 16 MiB",
    );
  try {
    const image = inspectPng(bytes, { maxBytes: MAX_OUTPUT_BYTES });
    return {
      bytes: Buffer.from(bytes),
      sha256: image.sha256,
      width: image.width,
      height: image.height,
    };
  } catch (error) {
    if (error instanceof AssetError) {
      const code =
        error.code === "input_too_large" ? "output_too_large" : error.code;
      throw new RequestError(
        code,
        "Generated output is not a valid bounded PNG",
      );
    }
    throw error;
  }
}

async function boundedBody(
  response: Response,
  signal: AbortSignal,
  maximum = MAX_OUTPUT_BYTES,
): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw new RequestError(
      "output_too_large",
      "Provider response exceeds the byte limit",
    );
  }
  if (response.body === null) {
    const bytes = Buffer.from(
      await raceWithSignal(response.arrayBuffer(), signal),
    );
    throwIfCancelled(signal);
    if (bytes.byteLength > maximum)
      throw new RequestError(
        "output_too_large",
        "Provider response exceeds the byte limit",
      );
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await raceWithSignal(reader.read(), signal);
      throwIfCancelled(signal);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new RequestError(
          "output_too_large",
          "Provider response exceeds the byte limit",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  throwIfCancelled(signal);
  return Buffer.concat(chunks, size);
}

async function requestHost(
  request: AssetRequest,
  options: AssetRequestOptions,
  signal: AbortSignal,
): Promise<AssetRequestResult> {
  if (options.host === undefined)
    return fail(
      "unavailable",
      "host_provider_unavailable",
      "Host image provider is not configured",
    );
  try {
    const bytes = await raceWithSignal(options.host(request), signal);
    throwIfCancelled(signal);
    const generated = output(bytes);
    throwIfCancelled(signal);
    const projected = publicRequest(request);
    return {
      status: "passed",
      outputs: [generated],
      manifest: {
        provider: "host",
        model: request.model,
        seed: request.seed,
        request: projected,
        requestSha256: hash(canonical(projected)),
        responseSha256: generated.sha256,
        outputs: [{ sha256: generated.sha256 }],
      },
    };
  } catch (error) {
    return operationFailure(
      error,
      options.signal,
      signal,
      "host_request_failed",
      "Host image provider rejected the request",
    );
  }
}

function validFalEndpoint(model: string): boolean {
  return (
    model.length <= 256 &&
    /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/.test(model)
  );
}

function trustedFalUrl(value: unknown): string {
  if (typeof value !== "string")
    throw new RequestError("untrusted_output_url", "fal output URL is missing");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RequestError("untrusted_output_url", "fal output URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "fal.media" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new RequestError(
      "untrusted_output_url",
      "fal outputs must use HTTPS on fal.media without userinfo",
    );
  }
  return url.href;
}

async function requestFal(
  request: AssetRequest,
  options: AssetRequestOptions,
  signal: AbortSignal,
): Promise<AssetRequestResult> {
  if (options.falClient === undefined && options.falCredentials === undefined) {
    return fail(
      "unavailable",
      "fal_provider_unavailable",
      "fal provider is not configured",
    );
  }
  if (options.falCredentials === undefined) {
    return fail(
      "unavailable",
      "fal_credentials_unavailable",
      "fal credentials are not configured",
    );
  }
  try {
    if (!validFalEndpoint(request.model))
      throw new RequestError(
        "invalid_model",
        "fal model must be a strict endpoint ID",
      );
    if (
      (Object.hasOwn(request.input, "prompt") &&
        request.input.prompt !== request.prompt) ||
      (Object.hasOwn(request.input, "seed") &&
        request.input.seed !== request.seed)
    ) {
      throw new RequestError(
        "reserved_input_conflict",
        "fal input prompt and seed must match top-level provenance",
      );
    }
    const client =
      options.falClient ??
      createFalClient({
        credentials: options.falCredentials,
        fetch: async (url, init) => {
          const target = new URL(
            typeof url === "string" || url instanceof URL ? url : url.url,
          );
          if (
            target.protocol !== "https:" ||
            (target.hostname !== "queue.fal.run" &&
              target.hostname !== "rest.fal.run" &&
              target.hostname !== "storage.fal.run") ||
            target.username !== "" ||
            target.password !== ""
          ) {
            throw new Error("fal fetch origin is not trusted");
          }
          const response = await (options.fetch ?? fetch)(url, {
            ...init,
            redirect: "error",
            signal,
          });
          if (
            (target.hostname === "queue.fal.run" ||
              target.hostname === "rest.fal.run") &&
            response.body !== null &&
            !response.headers.get("content-type")?.includes("application/json")
          ) {
            const headers = new Headers(response.headers);
            headers.set("content-type", "application/json");
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers,
            });
          }
          return response;
        },
        requestMiddleware: async (outgoing) => {
          const url = new URL(outgoing.url);
          if (url.protocol === "https:" && url.hostname === "rest.fal.ai") {
            url.hostname = "rest.fal.run";
            outgoing.url = url.href;
          }
          if (
            url.protocol !== "https:" ||
            (url.hostname !== "queue.fal.run" &&
              url.hostname !== "rest.fal.run" &&
              url.hostname !== "storage.fal.run") ||
            url.username !== "" ||
            url.password !== ""
          ) {
            throw new Error("fal request origin is not trusted");
          }
          return outgoing;
        },
      });
    const input = {
      ...request.input,
      prompt: request.prompt,
      seed: request.seed,
      styleGuide: request.styleGuide,
      referenceImage: request.referenceImage,
    };
    const response = await raceWithSignal(
      client.subscribe(
        request.model,
        options.falClient === undefined
          ? { input, abortSignal: signal }
          : { input },
      ),
      signal,
    );
    throwIfCancelled(signal);
    if (response.data === null || typeof response.data !== "object") {
      throw new RequestError(
        "invalid_provider_response",
        "fal returned no image collection",
      );
    }
    const images = (response.data as { images?: unknown }).images;
    if (!Array.isArray(images) || images.length === 0) {
      throw new RequestError(
        "invalid_provider_response",
        "fal returned no images",
      );
    }
    if (images.length > MAX_OUTPUTS)
      throw new RequestError(
        "output_count_exceeded",
        "fal returned more than four images",
      );
    const urls = images.map((image) =>
      trustedFalUrl(
        image !== null && typeof image === "object"
          ? (image as { url?: unknown }).url
          : undefined,
      ),
    );
    const fetcher = options.fetch ?? fetch;
    const outputs: AssetOutput[] = [];
    for (const url of urls) {
      throwIfCancelled(signal);
      let downloaded: Response;
      try {
        downloaded = await raceWithSignal(
          fetcher(
            url,
            options.fetch === undefined
              ? { redirect: "error", signal }
              : { redirect: "error" },
          ),
          signal,
        );
      } catch (error) {
        if (signal.aborted) throw error;
        throw new RequestError(
          "fal_download_failed",
          "fal output download failed",
        );
      }
      if (!downloaded.ok)
        throw new RequestError(
          "fal_download_failed",
          "fal output download returned an error",
        );
      const bytes = await boundedBody(downloaded, signal);
      throwIfCancelled(signal);
      outputs.push(output(bytes));
    }
    throwIfCancelled(signal);
    const projected = publicRequest(request);
    const manifest: AssetManifest = {
      provider: "fal",
      model: request.model,
      seed: request.seed,
      request: projected,
      requestSha256: hash(canonical(projected)),
      responseSha256: hash(canonical(response)),
      outputs: outputs.map(({ sha256 }) => ({ sha256 })),
      ...(response.requestId === undefined
        ? {}
        : { requestId: response.requestId }),
    };
    const cost = (response.data as { cost?: unknown }).cost;
    if (typeof cost === "number" && Number.isFinite(cost))
      Object.assign(manifest, { cost });
    return { status: "passed", outputs, manifest };
  } catch (error) {
    return operationFailure(
      error,
      options.signal,
      signal,
      "fal_request_failed",
      "fal request failed",
    );
  }
}

function comfyBase(value?: string): string {
  if (value === undefined) return COMFYUI_ORIGIN;
  try {
    const url = new URL(value);
    if (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port === "8188" &&
      url.pathname === "/" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    ) {
      return COMFYUI_ORIGIN;
    }
  } catch {
    /* reported below */
  }
  throw new RequestError(
    "invalid_comfyui_base",
    "ComfyUI must use the fixed 127.0.0.1:8188 HTTP endpoint",
  );
}

async function comfyFetch(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  return raceWithSignal(
    fetch(url, { ...init, redirect: "error", signal }),
    signal,
  );
}

async function comfyJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  if (!response.ok)
    throw new RequestError(
      "comfyui_request_failed",
      "ComfyUI API returned an error",
    );
  const bytes = await boundedBody(response, signal, MAX_RESPONSE_BYTES);
  throwIfCancelled(signal);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new RequestError(
      "invalid_provider_response",
      "ComfyUI returned malformed JSON",
    );
  }
}

function bindParameter(
  workflow: unknown,
  path: readonly (string | number)[],
  value: unknown,
): void {
  if (
    !Array.isArray(path) ||
    path.length === 0 ||
    path.some(
      (part) =>
        part === "__proto__" || part === "prototype" || part === "constructor",
    )
  ) {
    throw new RequestError(
      "invalid_workflow_binding",
      "Trusted workflow binding path is invalid",
    );
  }
  let parent = workflow;
  for (const part of path.slice(0, -1)) {
    if (
      parent === null ||
      typeof parent !== "object" ||
      !Object.hasOwn(parent, part)
    ) {
      throw new RequestError(
        "invalid_workflow_binding",
        "Trusted workflow binding path does not exist",
      );
    }
    parent = (parent as Record<string | number, unknown>)[part];
  }
  const leaf = path.at(-1)!;
  if (
    parent === null ||
    typeof parent !== "object" ||
    !Object.hasOwn(parent, leaf)
  ) {
    throw new RequestError(
      "invalid_workflow_binding",
      "Trusted workflow binding target does not exist",
    );
  }
  (parent as Record<string | number, unknown>)[leaf] = value;
}

async function requestComfy(
  request: AssetRequest,
  options: AssetRequestOptions,
  signal: AbortSignal,
): Promise<AssetRequestResult> {
  if (
    "approvedWorkflowSha256" in request ||
    !Array.isArray(options.approvedWorkflows) ||
    options.approvedWorkflows.length === 0
  ) {
    return fail(
      "unavailable",
      "comfyui_workflow_unapproved",
      "No host-approved ComfyUI workflow entry was configured",
    );
  }
  try {
    throwIfCancelled(signal);
    const base = comfyBase(request.baseUrl);
    if (
      request.workflow === null ||
      typeof request.workflow !== "object" ||
      Array.isArray(request.workflow)
    ) {
      throw new RequestError(
        "invalid_workflow",
        "ComfyUI workflow must be an embedded JSON object",
      );
    }
    const workflowJson = JSON.stringify(request.workflow);
    const workflowSha256 = hash(workflowJson);
    const approved = options.approvedWorkflows.find(
      (entry) =>
        entry.sha256 === workflowSha256 && entry.model === request.model,
    );
    if (approved === undefined) {
      throw new RequestError(
        "workflow_not_approved",
        "ComfyUI workflow digest and model are not host-approved",
      );
    }
    const submittedWorkflow = JSON.parse(workflowJson) as Record<
      string,
      unknown
    >;
    const bindings = approved.workflowBindings;
    if (bindings === null || typeof bindings !== "object") {
      throw new RequestError(
        "invalid_workflow_binding",
        "Trusted workflow bindings are missing",
      );
    }
    if (!Array.isArray(bindings.referenceImage)) {
      throw new RequestError(
        "reference_image_unbound",
        "Reference image requires a host-approved workflow binding",
      );
    }
    const reservedPaths = [
      bindings.prompt,
      bindings.seed,
      bindings.referenceImage,
    ].map((path) => JSON.stringify(path));
    for (const [key, value] of Object.entries(request.input)) {
      const path =
        bindings.input !== undefined && Object.hasOwn(bindings.input, key)
          ? bindings.input[key]
          : undefined;
      if (path === undefined) {
        throw new RequestError(
          "unbound_workflow_input",
          `Input ${key} has no host-approved workflow binding`,
        );
      }
      if (reservedPaths.includes(JSON.stringify(path))) {
        throw new RequestError(
          "invalid_workflow_binding",
          "Input bindings cannot replace prompt, seed, or reference image",
        );
      }
      bindParameter(submittedWorkflow, path, value);
    }
    bindParameter(
      submittedWorkflow,
      bindings.prompt,
      `${request.prompt}\n\nStyle: ${request.styleGuide}`,
    );
    bindParameter(submittedWorkflow, bindings.seed, request.seed);
    bindParameter(
      submittedWorkflow,
      bindings.referenceImage,
      Buffer.from(request.referenceImage.bytes),
    );
    const sourceSha256 = hash(JSON.stringify(submittedWorkflow));
    const promptName =
      request.prompt.match(/(?<![a-z0-9])[a-z][a-z0-9-]*/)?.[0] ?? "asset";
    const promptId = `comfy-${promptName}-${request.seed}`;
    const submitted = await comfyJson(
      await comfyFetch(
        `${base}/prompt`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: submittedWorkflow,
            client_id: randomUUID(),
            prompt_id: promptId,
          }),
        },
        signal,
      ),
      signal,
    );
    throwIfCancelled(signal);
    if (
      submitted === null ||
      typeof submitted !== "object" ||
      typeof (submitted as { prompt_id?: unknown }).prompt_id !== "string"
    ) {
      throw new RequestError(
        "invalid_provider_response",
        "ComfyUI returned no prompt ID",
      );
    }
    const requestId = (submitted as { prompt_id: string }).prompt_id;
    let history: unknown;
    while (true) {
      throwIfCancelled(signal);
      history = await comfyJson(
        await comfyFetch(
          `${base}/history/${encodeURIComponent(requestId)}`,
          {},
          signal,
        ),
        signal,
      );
      throwIfCancelled(signal);
      const entry =
        history !== null && typeof history === "object"
          ? (history as Record<string, unknown>)[requestId]
          : undefined;
      if (entry === null || typeof entry !== "object")
        throw new RequestError(
          "invalid_history",
          "ComfyUI history entry is missing",
        );
      const status = (entry as { status?: unknown }).status;
      if (
        status !== null &&
        typeof status === "object" &&
        (status as { completed?: unknown }).completed === true
      )
        break;
      await delay(250, undefined, { signal });
    }
    const entry = (history as Record<string, Record<string, unknown>>)[
      requestId
    ]!;
    const historyOutputs = (entry as { outputs?: unknown }).outputs;
    if (
      historyOutputs === null ||
      typeof historyOutputs !== "object" ||
      Array.isArray(historyOutputs)
    ) {
      throw new RequestError(
        "invalid_history",
        "ComfyUI completed history has no outputs",
      );
    }
    const images = Object.values(historyOutputs).flatMap((value) => {
      if (value === null || typeof value !== "object") return [];
      const found = (value as { images?: unknown }).images;
      return Array.isArray(found) ? found : [];
    });
    if (images.length === 0)
      throw new RequestError(
        "invalid_history",
        "ComfyUI completed history has no images",
      );
    if (images.length > MAX_OUTPUTS)
      throw new RequestError(
        "output_count_exceeded",
        "ComfyUI returned more than four images",
      );
    const outputs: AssetOutput[] = [];
    for (const image of images) {
      throwIfCancelled(signal);
      if (image === null || typeof image !== "object")
        throw new RequestError(
          "invalid_history",
          "ComfyUI image reference is malformed",
        );
      const { filename, subfolder, type } = image as Record<string, unknown>;
      if (
        typeof filename !== "string" ||
        typeof subfolder !== "string" ||
        typeof type !== "string"
      ) {
        throw new RequestError(
          "invalid_history",
          "ComfyUI image reference is incomplete",
        );
      }
      const query = new URLSearchParams({ filename, subfolder, type });
      let response: Response;
      try {
        response = await comfyFetch(`${base}/view?${query}`, {}, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        throw new RequestError(
          "redirect_forbidden",
          "ComfyUI view redirects are forbidden",
        );
      }
      if (!response.ok)
        throw new RequestError(
          "comfyui_download_failed",
          "ComfyUI image download returned an error",
        );
      const bytes = await boundedBody(response, signal);
      throwIfCancelled(signal);
      outputs.push(output(bytes));
    }
    throwIfCancelled(signal);
    const projected = publicRequest(request, workflowSha256);
    return {
      status: "passed",
      outputs,
      manifest: {
        provider: "comfyui",
        model: request.model,
        seed: request.seed,
        requestId,
        request: projected,
        requestSha256: hash(canonical(projected)),
        responseSha256: hash(canonical(history)),
        workflowSha256,
        sourceSha256,
        outputs: outputs.map(({ sha256 }) => ({ sha256 })),
      },
    };
  } catch (error) {
    if (error instanceof TypeError && !signal.aborted)
      return fail(
        "failed",
        "redirect_forbidden",
        "ComfyUI redirects are forbidden",
      );
    return operationFailure(
      error,
      options.signal,
      signal,
      "comfyui_request_failed",
      "ComfyUI request failed",
    );
  }
}

export async function requestAsset(
  request: AssetRequest,
  options: AssetRequestOptions = {},
): Promise<AssetRequestResult> {
  if (!validRequest(request))
    return fail(
      "failed",
      "invalid_request",
      "Asset request is malformed or contains untrusted host configuration",
    );
  if (options.signal?.aborted)
    return fail(
      "cancelled",
      "request_cancelled",
      "Asset request was cancelled",
    );
  const timeout = AbortSignal.timeout(OPERATION_TIMEOUT_MS);
  const signal =
    options.signal === undefined
      ? timeout
      : AbortSignal.any([options.signal, timeout]);
  if (request.provider === "host") return requestHost(request, options, signal);
  if (request.provider === "fal") return requestFal(request, options, signal);
  return requestComfy(request, options, signal);
}
