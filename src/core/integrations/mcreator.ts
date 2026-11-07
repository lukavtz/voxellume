import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema, ValidateFunction } from "ajv";

export const MCREATOR_REVISION = "31747bc416d222a66193445c87f3f2416b344ca6";
export const MCREATOR_PROTOCOL_VERSION = "2025-11-25";
export const MCREATOR_DEFAULT_ENDPOINT = "http://127.0.0.1:3025/mcp";

const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 65_000;
const ACTIONS: Record<string, true> = {
  READ: true,
  ADD: true,
  REPLACE: true,
  PATCH: true,
  REMOVE: true,
  LOCK_CODE: true,
  UNLOCK_CODE: true,
};
const WORKSPACE_QUERIES: Record<string, true> = {
  WORKSPACE_SETTINGS: true,
  MOD_ELEMENTS: true,
  SUPPORTED_MOD_ELEMENT_TYPES: true,
  MOD_VARIABLES: true,
  VARIABLE_TYPES: true,
  MOD_TAGS: true,
  BLOCKS: true,
  BLOCKS_AND_ITEMS: true,
  BLOCKS_AND_ITEMS_AND_TAGS: true,
  PROCEDURES: true,
  BLOCK_TEXTURES: true,
  ITEM_TEXTURES: true,
  ENTITY_TEXTURES: true,
  EFFECT_TEXTURES: true,
  PARTICLE_TEXTURES: true,
  SCREEN_TEXTURES: true,
  ARMOR_TEXTURES: true,
  OTHER_TEXTURES: true,
  MODELS_JSON: true,
  MODELS_JAVA: true,
  MODELS_OBJ: true,
  MODELS_BEDROCK: true,
};

const ERROR_DETAILS = {
  loopback_required: "MCreator requires a literal loopback HTTP MCP endpoint",
  invalid_options: "MCreator client options are invalid",
  invalid_request: "MCreator request arguments are invalid",
  invalid_element_type: "MCreator element type is invalid",
  invalid_element_name: "MCreator element names must be CamelCase",
  request_too_large: "MCreator request exceeds 256 KiB",
  response_too_large: "MCreator response exceeds 256 KiB",
  cancelled: "MCreator request was cancelled",
  timed_out: "MCreator request timed out",
  http_error: "MCreator HTTP request failed",
  transport_unavailable: "MCreator is unavailable",
  invalid_response: "MCreator returned an invalid response",
  jsonrpc_error: "MCreator returned a JSON-RPC error",
  tool_failed: "MCreator rejected the tool request",
  invalid_schema: "MCreator returned an invalid element schema",
  schema_validation_failed:
    "Mod element definition does not match the fetched schema",
  locked_element: "Locked element definitions cannot be patched",
} as const;

export type MCreatorErrorCode = keyof typeof ERROR_DETAILS;

export class MCreatorError extends Error {
  readonly code: MCreatorErrorCode;

  constructor(code: MCreatorErrorCode) {
    super(ERROR_DETAILS[code]);
    this.name = "MCreatorError";
    this.code = code;
  }
}

export interface MCreatorCallOptions {
  readonly signal?: AbortSignal;
}

export interface MCreatorClientOptions {
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

interface InitializationState {
  readonly controller: AbortController;
  waiters: number;
  completed: boolean;
  promise: Promise<void>;
}

export type MCreatorWorkspaceQueryType =
  | "WORKSPACE_SETTINGS"
  | "MOD_ELEMENTS"
  | "SUPPORTED_MOD_ELEMENT_TYPES"
  | "MOD_VARIABLES"
  | "VARIABLE_TYPES"
  | "MOD_TAGS"
  | "BLOCKS"
  | "BLOCKS_AND_ITEMS"
  | "BLOCKS_AND_ITEMS_AND_TAGS"
  | "PROCEDURES"
  | "BLOCK_TEXTURES"
  | "ITEM_TEXTURES"
  | "ENTITY_TEXTURES"
  | "EFFECT_TEXTURES"
  | "PARTICLE_TEXTURES"
  | "SCREEN_TEXTURES"
  | "ARMOR_TEXTURES"
  | "OTHER_TEXTURES"
  | "MODELS_JSON"
  | "MODELS_JAVA"
  | "MODELS_OBJ"
  | "MODELS_BEDROCK";

export interface MCreatorWorkspaceQuery {
  readonly type: MCreatorWorkspaceQueryType;
  readonly filter?: string;
}

export type MCreatorDatalistQuery =
  | {
      readonly type: "GET_LIST_TYPES";
      readonly filter?: string;
    }
  | {
      readonly type: "GET_LIST_ENTRIES";
      readonly listName: string;
      readonly filter?: string;
    };

interface MCreatorElementIdentity {
  readonly elementName: string;
}

interface MCreatorElementMutation extends MCreatorElementIdentity {
  readonly elementType: string;
  readonly elementJSONDefinition: Record<string, unknown>;
}

export type MCreatorModElementDefinitionRequest =
  | (MCreatorElementIdentity & {
      readonly actionType: "READ" | "REMOVE" | "LOCK_CODE" | "UNLOCK_CODE";
    })
  | (MCreatorElementMutation & { readonly actionType: "ADD" | "REPLACE" })
  | (MCreatorElementMutation & { readonly actionType: "PATCH" });

export type MCreatorBuildResult =
  | {
      readonly finished: true;
      readonly result: number;
      readonly gradleOutput: string;
    }
  | {
      readonly finished: false;
      readonly message: string;
    };

export interface MCreatorGradleStatus {
  readonly running: boolean;
  readonly gradleSetupTaskRunning: boolean;
}

export interface MCreatorReadConsoleOptions extends MCreatorCallOptions {
  readonly lastNCharsToRead?: number;
}

export type MCreatorRunDirRequest =
  | {
      readonly actionType: "SEARCH";
      readonly query?: string;
    }
  | {
      readonly actionType: "READ";
      readonly path: string;
      readonly lastNCharsToRead?: number;
    };

export interface MCreatorClient {
  getModElementSchema(
    elementType: string,
    options?: MCreatorCallOptions,
  ): Promise<Record<string, unknown>>;
  queryWorkspace(
    query: MCreatorWorkspaceQuery,
    options?: MCreatorCallOptions,
  ): Promise<unknown>;
  datalistEntries(
    query: MCreatorDatalistQuery,
    options?: MCreatorCallOptions,
  ): Promise<unknown[]>;
  modElementDefinition(
    request: MCreatorModElementDefinitionRequest,
    options?: MCreatorCallOptions,
  ): Promise<unknown>;
  buildAndWait(options?: MCreatorCallOptions): Promise<MCreatorBuildResult>;
  isGradleRunning(options?: MCreatorCallOptions): Promise<MCreatorGradleStatus>;
  readConsole(options?: MCreatorReadConsoleOptions): Promise<string>;
  runDirFiles(
    request: MCreatorRunDirRequest,
    options?: MCreatorCallOptions,
  ): Promise<string[] | string>;
}

async function raceAbort<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) throw new MCreatorError("cancelled");
  const aborted = Promise.withResolvers<never>();
  const onAbort = () => aborted.reject(new MCreatorError("cancelled"));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([operation, aborted.promise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function boundedBody(
  response: Response,
  signal: AbortSignal,
): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new MCreatorError("response_too_large");
  }
  if (response.body === null) {
    const bytes = Buffer.from(await raceAbort(response.arrayBuffer(), signal));
    if (bytes.byteLength > MAX_RESPONSE_BYTES)
      throw new MCreatorError("response_too_large");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new MCreatorError("response_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

function jsonText(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new MCreatorError("invalid_response");
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  try {
    const encoded = JSON.stringify(value);
    if (
      encoded === undefined ||
      Buffer.byteLength(encoded) > MAX_RESPONSE_BYTES
    )
      throw new MCreatorError("request_too_large");
    const parsed = JSON.parse(encoded) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new MCreatorError("invalid_request");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof MCreatorError) throw error;
    throw new MCreatorError("invalid_request");
  }
}

function mergePatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged = structuredClone(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key];
      continue;
    }
    const existing = merged[key];
    const next =
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof existing === "object" &&
      existing !== null &&
      !Array.isArray(existing)
        ? mergePatch(
            existing as Record<string, unknown>,
            value as Record<string, unknown>,
          )
        : structuredClone(value);
    Object.defineProperty(merged, key, {
      value: next,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }
  return merged;
}

function schemaValidator(schema: Record<string, unknown>): ValidateFunction {
  try {
    if (schema.$async === true) throw new Error("async schema");
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      validateFormats: false,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false,
    });
    if (!ajv.validateSchema(schema)) throw new Error("invalid schema");
    return ajv.compile(schema as AnySchema);
  } catch {
    throw new MCreatorError("invalid_schema");
  }
}

function validName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Za-z0-9]*$/.test(value);
}

function validType(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]*$/.test(value);
}

function validTailLength(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) &&
      (value as number) >= 0 &&
      (value as number) <= MAX_RESPONSE_BYTES)
  );
}

/**
 * Client for MCreator's unauthenticated, privileged loopback server at the
 * pinned revision. No server tool exists here: MCreator owns server startup.
 */
export function createMCreatorClient(
  options: MCreatorClientOptions = {},
): MCreatorClient {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint ?? MCREATOR_DEFAULT_ENDPOINT);
  } catch {
    throw new MCreatorError("loopback_required");
  }
  if (
    endpoint.protocol !== "http:" ||
    (endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "[::1]") ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.pathname !== "/mcp" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new MCreatorError("loopback_required");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new MCreatorError("invalid_options");

  const fetcher = options.fetch ?? fetch;
  const endpointValue = endpoint.toString();
  let nextId = 0;
  let sessionId: string | undefined;
  let initialization: InitializationState | undefined;

  async function post(
    method: string,
    params: Record<string, unknown> | undefined,
    callOptions?: MCreatorCallOptions,
    notification = false,
  ): Promise<unknown> {
    const id = notification ? undefined : ++nextId;
    let body: string;
    try {
      body = JSON.stringify({
        jsonrpc: "2.0",
        ...(id === undefined ? {} : { id }),
        method,
        ...(params === undefined ? {} : { params }),
      });
    } catch {
      throw new MCreatorError("invalid_request");
    }
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES)
      throw new MCreatorError("request_too_large");

    const controller = new AbortController();
    const callerSignal = callOptions?.signal;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort();
    callerSignal?.addEventListener("abort", abort, { once: true });
    if (callerSignal?.aborted) abort();

    try {
      const response = await raceAbort(
        fetcher(endpointValue, {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            "mcp-protocol-version": MCREATOR_PROTOCOL_VERSION,
            ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
          },
          body,
          redirect: "error",
          signal: controller.signal,
        }),
        controller.signal,
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new MCreatorError("http_error");
      }
      const bytes = await boundedBody(response, controller.signal);
      if (notification) {
        if (bytes.byteLength !== 0) throw new MCreatorError("invalid_response");
        return undefined;
      }

      let decoded: string;
      try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new MCreatorError("invalid_response");
      }
      const envelope = jsonText(decoded);
      if (
        typeof envelope !== "object" ||
        envelope === null ||
        Array.isArray(envelope)
      ) {
        throw new MCreatorError("invalid_response");
      }
      const reply = envelope as Record<string, unknown>;
      if (reply.jsonrpc !== "2.0" || reply.id !== id)
        throw new MCreatorError("invalid_response");
      if ("error" in reply) {
        const rpcError = reply.error;
        if (
          typeof rpcError !== "object" ||
          rpcError === null ||
          Array.isArray(rpcError)
        ) {
          throw new MCreatorError("invalid_response");
        }
        const errorObject = rpcError as Record<string, unknown>;
        if (
          typeof errorObject.code !== "number" ||
          typeof errorObject.message !== "string"
        ) {
          throw new MCreatorError("invalid_response");
        }
        throw new MCreatorError("jsonrpc_error");
      }
      if (!("result" in reply)) throw new MCreatorError("invalid_response");

      if (method === "initialize") {
        const returnedSession = response.headers.get("mcp-session-id");
        if (returnedSession !== null) {
          if (returnedSession.trim() === "" || returnedSession.length > 256)
            throw new MCreatorError("invalid_response");
          sessionId = returnedSession;
        }
      }
      return reply.result;
    } catch (error) {
      if (callerSignal?.aborted) throw new MCreatorError("cancelled");
      if (timedOut) throw new MCreatorError("timed_out");
      if (error instanceof MCreatorError) throw error;
      throw new MCreatorError("transport_unavailable");
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abort);
    }
  }

  async function initialize(signal: AbortSignal): Promise<void> {
    const result = await post(
      "initialize",
      {
        protocolVersion: MCREATOR_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "voxellume", version: "0.1.0" },
      },
      { signal },
    );
    if (
      typeof result !== "object" ||
      result === null ||
      Array.isArray(result)
    ) {
      sessionId = undefined;
      throw new MCreatorError("invalid_response");
    }
    const initialized = result as Record<string, unknown>;
    const capabilities = initialized.capabilities;
    const serverInfo = initialized.serverInfo;
    if (
      initialized.protocolVersion !== MCREATOR_PROTOCOL_VERSION ||
      typeof capabilities !== "object" ||
      capabilities === null ||
      Array.isArray(capabilities) ||
      typeof serverInfo !== "object" ||
      serverInfo === null ||
      Array.isArray(serverInfo) ||
      typeof (serverInfo as Record<string, unknown>).name !== "string" ||
      typeof (serverInfo as Record<string, unknown>).version !== "string"
    ) {
      sessionId = undefined;
      throw new MCreatorError("invalid_response");
    }
    await post("notifications/initialized", undefined, { signal }, true);
  }

  async function ensureInitialized(signal: AbortSignal | undefined) {
    if (signal?.aborted) throw new MCreatorError("cancelled");
    if (
      initialization === undefined ||
      (initialization.controller.signal.aborted && !initialization.completed)
    ) {
      const controller = new AbortController();
      const state: InitializationState = {
        controller,
        waiters: 0,
        completed: false,
        promise: initialize(controller.signal),
      };
      initialization = state;
      sessionId = undefined;
      state.promise = state.promise.then(
        () => {
          state.completed = true;
        },
        (error: unknown) => {
          if (initialization === state) {
            initialization = undefined;
            sessionId = undefined;
          }
          throw error;
        },
      );
    }
    const state = initialization;
    if (state.completed) return;

    state.waiters += 1;
    try {
      if (signal === undefined) {
        await state.promise;
      } else {
        await raceAbort(state.promise, signal);
      }
    } finally {
      state.waiters -= 1;
      if (state.waiters === 0 && !state.completed) state.controller.abort();
    }
  }

  async function callTool(
    name: string,
    args: Record<string, unknown>,
    callOptions?: MCreatorCallOptions,
  ): Promise<string> {
    await ensureInitialized(callOptions?.signal);
    const result = await post(
      "tools/call",
      { name, arguments: args },
      callOptions,
    );
    if (typeof result !== "object" || result === null || Array.isArray(result))
      throw new MCreatorError("invalid_response");
    const toolResult = result as Record<string, unknown>;
    const content = toolResult.content;
    if (
      !Array.isArray(content) ||
      content.length !== 1 ||
      (toolResult.isError !== undefined &&
        typeof toolResult.isError !== "boolean")
    ) {
      throw new MCreatorError("invalid_response");
    }
    const item = content[0] as unknown;
    if (typeof item !== "object" || item === null || Array.isArray(item))
      throw new MCreatorError("invalid_response");
    const textContent = item as Record<string, unknown>;
    if (textContent.type !== "text" || typeof textContent.text !== "string")
      throw new MCreatorError("invalid_response");
    if (toolResult.isError === true) throw new MCreatorError("tool_failed");
    return textContent.text;
  }

  async function getModElementSchema(
    elementType: string,
    callOptions?: MCreatorCallOptions,
  ): Promise<Record<string, unknown>> {
    if (!validType(elementType))
      throw new MCreatorError("invalid_element_type");
    const result = jsonText(
      await callTool("get_mod_element_schema", { elementType }, callOptions),
    );
    if (typeof result !== "object" || result === null || Array.isArray(result))
      throw new MCreatorError("invalid_response");
    return result as Record<string, unknown>;
  }

  async function modElementDefinition(
    request: MCreatorModElementDefinitionRequest,
    callOptions?: MCreatorCallOptions,
  ): Promise<unknown> {
    if (
      typeof request !== "object" ||
      request === null ||
      Array.isArray(request) ||
      typeof request.actionType !== "string" ||
      ACTIONS[request.actionType] !== true
    ) {
      throw new MCreatorError("invalid_request");
    }
    if (!validName(request.elementName))
      throw new MCreatorError("invalid_element_name");

    const action = request.actionType;
    const elementName = request.elementName;
    const args: Record<string, unknown> = {
      actionType: action,
      elementName,
    };
    if (action === "ADD" || action === "REPLACE" || action === "PATCH") {
      const elementType = request.elementType;
      const definition = jsonObject(request.elementJSONDefinition);
      if (!validType(elementType))
        throw new MCreatorError("invalid_element_type");
      if (action === "PATCH" && Object.keys(definition).length === 0)
        throw new MCreatorError("invalid_request");

      const schema = await getModElementSchema(elementType, callOptions);
      const validate = schemaValidator(schema);
      let candidate = definition;
      if (action === "PATCH") {
        const currentText = await callTool(
          "mod_element_definition",
          { actionType: "READ", elementName },
          callOptions,
        );
        const current = jsonText(currentText);
        if (
          typeof current !== "object" ||
          current === null ||
          Array.isArray(current)
        ) {
          throw new MCreatorError("invalid_response");
        }
        const currentElement = current as Record<string, unknown>;
        const currentDefinition = currentElement.elementJSONDefinition;
        if (
          typeof currentElement.codeLocked !== "boolean" ||
          typeof currentDefinition !== "object" ||
          currentDefinition === null ||
          Array.isArray(currentDefinition)
        ) {
          throw new MCreatorError("invalid_response");
        }
        if (currentElement.codeLocked)
          throw new MCreatorError("locked_element");
        candidate = mergePatch(
          currentDefinition as Record<string, unknown>,
          definition,
        );
      }
      if (!validate(candidate))
        throw new MCreatorError("schema_validation_failed");
      args.elementType = elementType;
      args.elementJSONDefinition = definition;
    }

    const result = await callTool("mod_element_definition", args, callOptions);
    if (
      action === "REMOVE" ||
      action === "LOCK_CODE" ||
      action === "UNLOCK_CODE"
    )
      return result;
    const parsed = jsonText(result);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new MCreatorError("invalid_response");
    return parsed;
  }

  return {
    getModElementSchema,

    async queryWorkspace(query, callOptions) {
      if (
        typeof query !== "object" ||
        query === null ||
        Array.isArray(query) ||
        WORKSPACE_QUERIES[query.type] !== true
      ) {
        throw new MCreatorError("invalid_request");
      }
      if (query.filter !== undefined && typeof query.filter !== "string")
        throw new MCreatorError("invalid_request");
      const result = jsonText(
        await callTool(
          "query_workspace",
          {
            type: query.type,
            ...(query.filter === undefined ? {} : { filter: query.filter }),
          },
          callOptions,
        ),
      );
      if (typeof result !== "object" || result === null)
        throw new MCreatorError("invalid_response");
      return result;
    },

    async datalistEntries(query, callOptions) {
      if (
        typeof query !== "object" ||
        query === null ||
        Array.isArray(query) ||
        (query.type !== "GET_LIST_TYPES" &&
          query.type !== "GET_LIST_ENTRIES") ||
        (query.filter !== undefined && typeof query.filter !== "string")
      ) {
        throw new MCreatorError("invalid_request");
      }
      if (
        query.type === "GET_LIST_ENTRIES" &&
        (typeof query.listName !== "string" || query.listName.trim() === "")
      ) {
        throw new MCreatorError("invalid_request");
      }
      const result = jsonText(
        await callTool(
          "datalist_entries",
          {
            type: query.type,
            ...(query.type === "GET_LIST_TYPES"
              ? {}
              : { listName: query.listName }),
            ...(query.filter === undefined ? {} : { filter: query.filter }),
          },
          callOptions,
        ),
      );
      if (!Array.isArray(result)) throw new MCreatorError("invalid_response");
      return result;
    },

    modElementDefinition,

    async buildAndWait(callOptions) {
      const result = jsonText(
        await callTool("build", { actionType: "BUILD_AND_WAIT" }, callOptions),
      );
      if (
        typeof result !== "object" ||
        result === null ||
        Array.isArray(result)
      )
        throw new MCreatorError("invalid_response");
      const build = result as Record<string, unknown>;
      if (typeof build.finished !== "boolean")
        throw new MCreatorError("invalid_response");
      if (build.finished) {
        if (
          typeof build.result !== "number" ||
          !Number.isFinite(build.result) ||
          typeof build.gradleOutput !== "string"
        ) {
          throw new MCreatorError("invalid_response");
        }
        return {
          finished: true,
          result: build.result,
          gradleOutput: build.gradleOutput,
        };
      }
      if (typeof build.message !== "string")
        throw new MCreatorError("invalid_response");
      return { finished: false, message: build.message };
    },

    async isGradleRunning(callOptions) {
      const result = jsonText(
        await callTool(
          "build",
          { actionType: "IS_GRADLE_RUNNING" },
          callOptions,
        ),
      );
      if (
        typeof result !== "object" ||
        result === null ||
        Array.isArray(result)
      )
        throw new MCreatorError("invalid_response");
      const status = result as Record<string, unknown>;
      if (
        typeof status.running !== "boolean" ||
        typeof status.gradleSetupTaskRunning !== "boolean"
      ) {
        throw new MCreatorError("invalid_response");
      }
      return {
        running: status.running,
        gradleSetupTaskRunning: status.gradleSetupTaskRunning,
      };
    },

    async readConsole(callOptions) {
      if (!validTailLength(callOptions?.lastNCharsToRead))
        throw new MCreatorError("invalid_request");
      return callTool(
        "read_console",
        callOptions?.lastNCharsToRead === undefined
          ? {}
          : { lastNCharsToRead: callOptions.lastNCharsToRead },
        callOptions,
      );
    },

    async runDirFiles(request, callOptions) {
      if (
        typeof request !== "object" ||
        request === null ||
        Array.isArray(request) ||
        (request.actionType !== "SEARCH" && request.actionType !== "READ")
      ) {
        throw new MCreatorError("invalid_request");
      }
      if (request.actionType === "SEARCH") {
        if (request.query !== undefined && typeof request.query !== "string")
          throw new MCreatorError("invalid_request");
        const result = jsonText(
          await callTool(
            "run_dir_files",
            {
              actionType: "SEARCH",
              ...(request.query === undefined ? {} : { query: request.query }),
            },
            callOptions,
          ),
        );
        if (
          !Array.isArray(result) ||
          result.some((entry) => typeof entry !== "string")
        ) {
          throw new MCreatorError("invalid_response");
        }
        return result;
      }
      if (
        typeof request.path !== "string" ||
        request.path.trim() === "" ||
        !validTailLength(request.lastNCharsToRead)
      ) {
        throw new MCreatorError("invalid_request");
      }
      return callTool(
        "run_dir_files",
        {
          actionType: "READ",
          path: request.path,
          ...(request.lastNCharsToRead === undefined
            ? {}
            : { lastNCharsToRead: request.lastNCharsToRead }),
        },
        callOptions,
      );
    },
  };
}
