import { randomBytes, createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

const MCP_ENDPOINT = "https://mcp.player.games";
const PROTECTED_RESOURCE_METADATA =
  "https://mcp.player.games/.well-known/oauth-protected-resource";
const AUTHORIZATION_SERVER_METADATA =
  "https://www.player.games/.well-known/oauth-authorization-server";
const AUTHORIZATION_SERVER_ORIGIN = "https://www.player.games";
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const PAID_TOOLS: Readonly<Record<string, true>> = {
  generate_mod: true,
  iterate_mod: true,
};

export const PLAYER_GAMES_CREDIT_WARNING =
  "This paid Player Games operation will use credits. Approval applies to this call only.";

export const PLAYER_GAMES_TOOL_NAMES = [
  "browse_community_mods",
  "list_my_mods",
  "get_mod_details",
  "check_generation_status",
  "get_download_url",
  "get_my_credits",
  "generate_mod",
  "iterate_mod",
] as const;

export type PlayerGamesToolName = (typeof PLAYER_GAMES_TOOL_NAMES)[number];
export type PlayerGamesPaidToolName = "generate_mod" | "iterate_mod";

export interface PlayerGamesTool {
  readonly name: PlayerGamesToolName;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface PlayerGamesPaidApproval {
  readonly tool: PlayerGamesPaidToolName;
  readonly warning: typeof PLAYER_GAMES_CREDIT_WARNING;
}

export interface PlayerGamesCallOptions {
  readonly signal?: AbortSignal;
  readonly approvePaidCall?: (
    approval: PlayerGamesPaidApproval,
  ) => boolean | Promise<boolean>;
}

export interface PlayerGamesClientOptions {
  readonly fetch?: typeof fetch;
  readonly openBrowser: (url: string) => void | Promise<void>;
  readonly now?: () => number;
}

export interface PlayerGamesClient {
  connect(options?: {
    readonly signal?: AbortSignal;
  }): Promise<readonly PlayerGamesTool[]>;
  listTools(options?: {
    readonly signal?: AbortSignal;
  }): Promise<readonly PlayerGamesTool[]>;
  callTool(
    name: PlayerGamesToolName,
    args: Readonly<Record<string, unknown>>,
    options?: PlayerGamesCallOptions,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export type PlayerGamesErrorCode =
  | "cancelled"
  | "request_timeout"
  | "request_too_large"
  | "response_too_large"
  | "transport_unavailable"
  | "http_error"
  | "invalid_response"
  | "invalid_oauth_metadata"
  | "oauth_registration_failed"
  | "oauth_browser_failed"
  | "oauth_callback_failed"
  | "oauth_state_mismatch"
  | "oauth_token_failed"
  | "authentication_required"
  | "unsupported_tool"
  | "invalid_tool_schema"
  | "invalid_arguments"
  | "paid_approval_required"
  | "paid_approval_failed"
  | "paid_call_denied"
  | "tool_failed";

const ERROR_MESSAGES: Readonly<Record<PlayerGamesErrorCode, string>> = {
  cancelled: "Player Games operation was cancelled.",
  request_timeout: "Player Games request timed out.",
  request_too_large: "Player Games request exceeds 256 KiB.",
  response_too_large: "Player Games response exceeds 256 KiB.",
  transport_unavailable: "Player Games is unavailable.",
  http_error: "Player Games returned an HTTP error.",
  invalid_response: "Player Games returned an invalid response.",
  invalid_oauth_metadata: "Player Games OAuth metadata is invalid.",
  oauth_registration_failed: "Player Games OAuth client registration failed.",
  oauth_browser_failed: "Player Games browser authorization failed.",
  oauth_callback_failed: "Player Games OAuth callback failed.",
  oauth_state_mismatch: "Player Games OAuth callback state did not match.",
  oauth_token_failed: "Player Games OAuth token exchange failed.",
  authentication_required: "Player Games browser authorization is required.",
  unsupported_tool: "Player Games did not advertise this tool.",
  invalid_tool_schema: "Player Games advertised an invalid tool schema.",
  invalid_arguments:
    "Arguments do not match the runtime Player Games tool schema.",
  paid_approval_required:
    "This paid Player Games call requires per-call approval.",
  paid_approval_failed: "Player Games paid-call approval failed.",
  paid_call_denied: "This paid Player Games call was denied.",
  tool_failed: "Player Games tool call failed.",
};

export class PlayerGamesError extends Error {
  readonly code: PlayerGamesErrorCode;

  constructor(code: PlayerGamesErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "PlayerGamesError";
    this.code = code;
  }
}

class HttpError extends PlayerGamesError {
  readonly status: number;

  constructor(status: number) {
    super("http_error");
    this.status = status;
  }
}

class OAuthTokenRejectedError extends PlayerGamesError {
  constructor() {
    super("oauth_token_failed");
  }
}

interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt: number;
}

interface RegisteredClient {
  readonly clientId: string;
  readonly clientSecret?: string;
}

interface OAuthMetadata {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string;
}

interface RuntimeTool extends PlayerGamesTool {
  readonly validate: ValidateFunction;
}

interface CallbackListener {
  readonly redirectUri: string;
  readonly callback: Promise<URL>;
  readonly close: () => Promise<void>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PlayerGamesError("cancelled");
}

async function raceWithSignal<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return operation;
  throwIfCancelled(signal);
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const cleanup = () => signal.removeEventListener("abort", abort);
  const abort = () => {
    cleanup();
    reject(new PlayerGamesError("cancelled"));
  };
  signal.addEventListener("abort", abort, { once: true });
  operation.then(
    (value) => {
      cleanup();
      resolve(value);
    },
    (error: unknown) => {
      cleanup();
      reject(
        error instanceof PlayerGamesError
          ? error
          : new PlayerGamesError("transport_unavailable"),
      );
    },
  );
  return promise;
}

async function readBoundedResponse(
  response: Response,
  signal: AbortSignal,
): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new PlayerGamesError("response_too_large");
  }
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await raceWithSignal(reader.read(), signal);
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new PlayerGamesError("response_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (signal.aborted) throw signal.reason;
    throw error;
  }
  return Buffer.concat(chunks, length);
}

function parseResponse(bytes: Buffer, contentType: string | null): unknown {
  const text = bytes.toString("utf8");
  try {
    if (!contentType?.toLowerCase().includes("text/event-stream")) {
      return JSON.parse(text) as unknown;
    }
    const events: unknown[] = [];
    let dataLines: string[] = [];
    const flushEvent = () => {
      if (dataLines.length === 0) return;
      const data = dataLines.join("\n");
      dataLines = [];
      if (data !== "" && data !== "[DONE]") {
        events.push(JSON.parse(data) as unknown);
      }
    };
    for (const line of text.split(/\r?\n/)) {
      if (line === "") {
        flushEvent();
      } else if (line === "data") {
        dataLines.push("");
      } else if (line.startsWith("data:")) {
        const data = line.slice(5);
        dataLines.push(data.startsWith(" ") ? data.slice(1) : data);
      }
    }
    flushEvent();
    return events;
  } catch {
    throw new PlayerGamesError("invalid_response");
  }
}

function trustedEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      (url.origin !== AUTHORIZATION_SERVER_ORIGIN &&
        url.origin !== MCP_ENDPOINT)
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret !== "") redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

function redactResult(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value))
    return value.map((entry) => redactResult(entry, secrets));
  const source = record(value);
  if (source === undefined) return value;
  return Object.fromEntries(
    Object.entries(source).map(([key, entry]) => [
      redactString(key, secrets),
      redactResult(entry, secrets),
    ]),
  );
}

async function startCallbackListener(state: string): Promise<CallbackListener> {
  const settled = Promise.withResolvers<URL>();
  void settled.promise.catch(() => undefined);
  const server: Server = createServer((request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405).end("Method not allowed");
      return;
    }
    const callback = new URL(request.url ?? "/", "http://127.0.0.1");
    if (callback.pathname !== "/callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    if (callback.searchParams.get("state") !== state) {
      response.writeHead(400).end("Authorization failed");
      settled.reject(new PlayerGamesError("oauth_state_mismatch"));
      return;
    }
    if (callback.searchParams.has("error")) {
      response.writeHead(400).end("Authorization failed");
      settled.reject(new PlayerGamesError("oauth_callback_failed"));
      return;
    }
    if (callback.searchParams.get("code")?.trim()) {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("Player Games authorization received. Return to Voxellume.");
      settled.resolve(callback);
      return;
    }
    response.writeHead(400).end("Authorization failed");
    settled.reject(new PlayerGamesError("oauth_callback_failed"));
  });
  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = server.address();
  if (address === null || typeof address !== "object") {
    server.close();
    throw new PlayerGamesError("oauth_callback_failed");
  }
  return {
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    callback: settled.promise,
    close: async () => {
      if (!server.listening) return;
      const closed = Promise.withResolvers<void>();
      server.closeAllConnections();
      server.close(() => closed.resolve());
      await closed.promise;
    },
  };
}

class Client implements PlayerGamesClient {
  readonly #fetch: typeof fetch;
  readonly #openBrowser: (url: string) => void | Promise<void>;
  readonly #now: () => number;
  readonly #tools = new Map<PlayerGamesToolName, RuntimeTool>();
  #client: RegisteredClient | undefined;
  #oauth: OAuthMetadata | undefined;
  #tokens: TokenSet | undefined;
  #rpcId = 0;
  #callbackClose: (() => Promise<void>) | undefined;

  constructor(options: PlayerGamesClientOptions) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#openBrowser = options.openBrowser;
    this.#now = options.now ?? Date.now;
  }

  async connect(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<readonly PlayerGamesTool[]> {
    throwIfCancelled(options.signal);
    this.#tools.clear();
    this.#tokens = undefined;
    let listener: CallbackListener | undefined;
    try {
      this.#oauth = await this.#discoverOAuth(options.signal);
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(64).toString("base64url");
      listener = await startCallbackListener(state);
      this.#callbackClose = listener.close;
      this.#client = await this.#register(listener.redirectUri, options.signal);
      const authorization = new URL(this.#oauth.authorizationEndpoint);
      authorization.searchParams.set("response_type", "code");
      authorization.searchParams.set("client_id", this.#client.clientId);
      authorization.searchParams.set("redirect_uri", listener.redirectUri);
      authorization.searchParams.set("state", state);
      authorization.searchParams.set(
        "code_challenge",
        createHash("sha256").update(verifier).digest("base64url"),
      );
      authorization.searchParams.set("code_challenge_method", "S256");
      authorization.searchParams.set("resource", MCP_ENDPOINT);
      try {
        await raceWithSignal(
          Promise.resolve().then(() =>
            this.#openBrowser(authorization.toString()),
          ),
          options.signal,
        );
      } catch (error) {
        if (error instanceof PlayerGamesError) throw error;
        throw new PlayerGamesError("oauth_browser_failed");
      }
      const callback = await raceWithSignal(listener.callback, options.signal);
      const code = callback.searchParams.get("code");
      if (code === null) throw new PlayerGamesError("oauth_callback_failed");
      this.#tokens = await this.#exchangeToken(
        code,
        verifier,
        listener.redirectUri,
        options.signal,
      );
      await listener.close();
      this.#callbackClose = undefined;
      listener = undefined;
      return await this.listTools(options);
    } catch (error) {
      if (error instanceof PlayerGamesError) throw error;
      if (options.signal?.aborted) throw new PlayerGamesError("cancelled");
      throw new PlayerGamesError("oauth_callback_failed");
    } finally {
      if (listener !== undefined) await listener.close();
      if (this.#callbackClose !== undefined) {
        await this.#callbackClose();
        this.#callbackClose = undefined;
      }
    }
  }

  async listTools(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<readonly PlayerGamesTool[]> {
    const operationSecrets = new Set(this.#secrets());
    const result = record(
      await this.#rpc("tools/list", {}, options.signal, operationSecrets),
    );
    if (result === undefined || !Array.isArray(result.tools)) {
      throw new PlayerGamesError("invalid_response");
    }
    const discovered = new Map<PlayerGamesToolName, RuntimeTool>();
    for (const candidate of result.tools) {
      const value = record(candidate);
      if (value === undefined || typeof value.name !== "string") {
        throw new PlayerGamesError("invalid_tool_schema");
      }
      if (!(PLAYER_GAMES_TOOL_NAMES as readonly string[]).includes(value.name))
        continue;
      const name = value.name as PlayerGamesToolName;
      const inputSchema = record(value.inputSchema);
      if (
        inputSchema === undefined ||
        inputSchema.$async === true ||
        discovered.has(name)
      ) {
        throw new PlayerGamesError("invalid_tool_schema");
      }
      let validate: ValidateFunction;
      try {
        validate = new Ajv2020({
          allErrors: true,
          strict: false,
          coerceTypes: false,
          useDefaults: false,
          removeAdditional: false,
        }).compile(inputSchema);
      } catch {
        throw new PlayerGamesError("invalid_tool_schema");
      }
      discovered.set(name, {
        name,
        ...(typeof value.description === "string"
          ? { description: value.description }
          : {}),
        inputSchema: structuredClone(inputSchema),
        validate,
      });
    }
    this.#tools.clear();
    for (const [name, tool] of discovered) this.#tools.set(name, tool);
    return [...discovered.values()].map((tool) =>
      redactResult(
        {
          name: tool.name,
          ...(tool.description === undefined
            ? {}
            : { description: tool.description }),
          inputSchema: tool.inputSchema,
        },
        [...operationSecrets, ...this.#secrets()],
      ),
    ) as PlayerGamesTool[];
  }

  async callTool(
    name: PlayerGamesToolName,
    args: Readonly<Record<string, unknown>>,
    options: PlayerGamesCallOptions = {},
  ): Promise<unknown> {
    throwIfCancelled(options.signal);
    const operationSecrets = new Set(this.#secrets());
    if (this.#tokens === undefined)
      throw new PlayerGamesError("authentication_required");
    let argumentSnapshot: Record<string, unknown>;
    try {
      const serialized = JSON.stringify(args);
      if (serialized === undefined)
        throw new PlayerGamesError("invalid_arguments");
      const snapshot = record(JSON.parse(serialized) as unknown);
      if (snapshot === undefined)
        throw new PlayerGamesError("invalid_arguments");
      argumentSnapshot = snapshot;
    } catch {
      throw new PlayerGamesError("invalid_arguments");
    }
    const tool = this.#tools.get(name);
    if (tool === undefined) throw new PlayerGamesError("unsupported_tool");
    if (!tool.validate(argumentSnapshot))
      throw new PlayerGamesError("invalid_arguments");
    if (PAID_TOOLS[name] === true) {
      if (options.approvePaidCall === undefined) {
        throw new PlayerGamesError("paid_approval_required");
      }
      let approved: boolean;
      try {
        approved = await raceWithSignal(
          Promise.resolve().then(() =>
            options.approvePaidCall!({
              tool: name as PlayerGamesPaidToolName,
              warning: PLAYER_GAMES_CREDIT_WARNING,
            }),
          ),
          options.signal,
        );
      } catch (error) {
        if (error instanceof PlayerGamesError && error.code === "cancelled")
          throw error;
        throw new PlayerGamesError("paid_approval_failed");
      }
      if (approved !== true) throw new PlayerGamesError("paid_call_denied");
    }
    throwIfCancelled(options.signal);
    const result = record(
      await this.#rpc(
        "tools/call",
        { name, arguments: argumentSnapshot },
        options.signal,
        operationSecrets,
      ),
    );
    if (
      result === undefined ||
      !Array.isArray(result.content) ||
      !result.content.every((candidate) => {
        const content = record(candidate);
        return (
          content !== undefined &&
          typeof content.type === "string" &&
          content.type !== ""
        );
      }) ||
      ("isError" in result && typeof result.isError !== "boolean")
    ) {
      throw new PlayerGamesError("invalid_response");
    }
    if (result.isError === true) throw new PlayerGamesError("tool_failed");
    return redactResult(result, [...operationSecrets, ...this.#secrets()]);
  }

  async close(): Promise<void> {
    this.#tools.clear();
    this.#tokens = undefined;
    this.#client = undefined;
    this.#oauth = undefined;
    if (this.#callbackClose !== undefined) {
      await this.#callbackClose();
      this.#callbackClose = undefined;
    }
  }

  #secrets(): string[] {
    return [
      this.#tokens?.accessToken,
      this.#tokens?.refreshToken,
      this.#client?.clientSecret,
    ].filter((secret): secret is string => typeof secret === "string");
  }

  async #requestJson(
    url: string,
    init: RequestInit,
    externalSignal?: AbortSignal,
  ): Promise<unknown> {
    throwIfCancelled(externalSignal);
    const controller = new AbortController();
    const abort = () => controller.abort(new PlayerGamesError("cancelled"));
    externalSignal?.addEventListener("abort", abort, { once: true });
    if (externalSignal?.aborted) abort();
    const timer = setTimeout(
      () => controller.abort(new PlayerGamesError("request_timeout")),
      REQUEST_TIMEOUT_MS,
    );
    timer.unref();
    try {
      const response = await raceWithSignal(
        this.#fetch(url, {
          ...init,
          redirect: "error",
          signal: controller.signal,
        }),
        controller.signal,
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(response.status);
      }
      const bytes = await readBoundedResponse(response, controller.signal);
      throwIfCancelled(externalSignal);
      return parseResponse(bytes, response.headers.get("content-type"));
    } catch (error) {
      if (externalSignal?.aborted) throw new PlayerGamesError("cancelled");
      if (controller.signal.aborted) {
        const reason: unknown = controller.signal.reason;
        if (reason instanceof PlayerGamesError) throw reason;
        throw new PlayerGamesError("cancelled");
      }
      if (error instanceof PlayerGamesError) throw error;
      throw new PlayerGamesError("transport_unavailable");
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  async #discoverOAuth(signal?: AbortSignal): Promise<OAuthMetadata> {
    const protectedResource = record(
      await this.#requestJson(PROTECTED_RESOURCE_METADATA, {}, signal),
    );
    if (
      protectedResource === undefined ||
      protectedResource.resource !== MCP_ENDPOINT ||
      !Array.isArray(protectedResource.authorization_servers) ||
      !protectedResource.authorization_servers.some((value) => {
        if (typeof value !== "string") return false;
        try {
          return new URL(value).origin === AUTHORIZATION_SERVER_ORIGIN;
        } catch {
          return false;
        }
      })
    ) {
      throw new PlayerGamesError("invalid_oauth_metadata");
    }
    const metadata = record(
      await this.#requestJson(AUTHORIZATION_SERVER_METADATA, {}, signal),
    );
    if (metadata === undefined)
      throw new PlayerGamesError("invalid_oauth_metadata");
    let issuer: string | undefined;
    try {
      issuer =
        typeof metadata.issuer === "string"
          ? new URL(metadata.issuer).origin
          : undefined;
    } catch {
      issuer = undefined;
    }
    const authorizationEndpoint = trustedEndpoint(
      metadata.authorization_endpoint,
    );
    const tokenEndpoint = trustedEndpoint(metadata.token_endpoint);
    const registrationEndpoint = trustedEndpoint(
      metadata.registration_endpoint,
    );
    if (
      issuer !== AUTHORIZATION_SERVER_ORIGIN ||
      authorizationEndpoint === undefined ||
      tokenEndpoint === undefined ||
      registrationEndpoint === undefined ||
      !Array.isArray(metadata.response_types_supported) ||
      !metadata.response_types_supported.includes("code") ||
      !Array.isArray(metadata.grant_types_supported) ||
      !metadata.grant_types_supported.includes("authorization_code") ||
      !metadata.grant_types_supported.includes("refresh_token") ||
      !Array.isArray(metadata.code_challenge_methods_supported) ||
      !metadata.code_challenge_methods_supported.includes("S256")
    ) {
      throw new PlayerGamesError("invalid_oauth_metadata");
    }
    return { authorizationEndpoint, tokenEndpoint, registrationEndpoint };
  }

  async #register(
    redirectUri: string,
    signal?: AbortSignal,
  ): Promise<RegisteredClient> {
    if (this.#oauth === undefined)
      throw new PlayerGamesError("invalid_oauth_metadata");
    let response: unknown;
    try {
      response = await this.#requestJson(
        this.#oauth.registrationEndpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            client_name: "Voxellume",
            redirect_uris: [redirectUri],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          }),
        },
        signal,
      );
    } catch (error) {
      if (error instanceof PlayerGamesError && error.code === "cancelled")
        throw error;
      if (error instanceof PlayerGamesError && error.code === "request_timeout")
        throw error;
      if (
        error instanceof PlayerGamesError &&
        error.code === "response_too_large"
      )
        throw error;
      throw new PlayerGamesError("oauth_registration_failed");
    }
    const client = record(response);
    if (
      client === undefined ||
      typeof client.client_id !== "string" ||
      client.client_id === ""
    ) {
      throw new PlayerGamesError("oauth_registration_failed");
    }
    return {
      clientId: client.client_id,
      ...(typeof client.client_secret === "string" &&
      client.client_secret !== ""
        ? { clientSecret: client.client_secret }
        : {}),
    };
  }

  async #exchangeToken(
    code: string,
    verifier: string,
    redirectUri: string,
    signal?: AbortSignal,
  ): Promise<TokenSet> {
    if (this.#client === undefined)
      throw new PlayerGamesError("oauth_registration_failed");
    return this.#tokenRequest(
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: this.#client.clientId,
        code_verifier: verifier,
      },
      signal,
    );
  }

  async #tokenRequest(
    values: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<TokenSet> {
    if (this.#oauth === undefined)
      throw new PlayerGamesError("invalid_oauth_metadata");
    const body = new URLSearchParams(values);
    if (this.#client?.clientSecret !== undefined) {
      body.set("client_secret", this.#client.clientSecret);
    }
    let response: unknown;
    try {
      response = await this.#requestJson(
        this.#oauth.tokenEndpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body: body.toString(),
        },
        signal,
      );
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 400 || error.status === 401) {
          throw new OAuthTokenRejectedError();
        }
        throw error;
      }
      if (error instanceof PlayerGamesError) {
        if (
          error.code === "cancelled" ||
          error.code === "request_timeout" ||
          error.code === "response_too_large" ||
          error.code === "transport_unavailable"
        ) {
          throw error;
        }
      }
      throw new PlayerGamesError("oauth_token_failed");
    }
    const token = record(response);
    if (
      token === undefined ||
      typeof token.access_token !== "string" ||
      token.access_token === "" ||
      (token.token_type !== undefined &&
        (typeof token.token_type !== "string" ||
          token.token_type.toLowerCase() !== "bearer")) ||
      (token.refresh_token !== undefined &&
        typeof token.refresh_token !== "string") ||
      (token.expires_in !== undefined &&
        (typeof token.expires_in !== "number" ||
          !Number.isFinite(token.expires_in)))
    ) {
      throw new PlayerGamesError("oauth_token_failed");
    }
    return {
      accessToken: token.access_token,
      ...(typeof token.refresh_token === "string" && token.refresh_token !== ""
        ? { refreshToken: token.refresh_token }
        : {}),
      expiresAt:
        typeof token.expires_in === "number"
          ? this.#now() + Math.max(0, token.expires_in) * 1000
          : Number.POSITIVE_INFINITY,
    };
  }

  async #accessToken(
    signal: AbortSignal | undefined,
    operationSecrets: Set<string>,
  ): Promise<string> {
    if (this.#tokens !== undefined && this.#now() < this.#tokens.expiresAt) {
      operationSecrets.add(this.#tokens.accessToken);
      return this.#tokens.accessToken;
    }
    const refreshSource = this.#tokens;
    const refreshToken = refreshSource?.refreshToken;
    if (refreshToken === undefined || this.#client === undefined) {
      throw new PlayerGamesError("authentication_required");
    }
    try {
      const refreshed = await this.#tokenRequest(
        {
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: this.#client.clientId,
        },
        signal,
      );
      operationSecrets.add(refreshed.accessToken);
      if (refreshed.refreshToken !== undefined) {
        operationSecrets.add(refreshed.refreshToken);
      }
      const nextTokens = {
        ...refreshed,
        ...(refreshed.refreshToken === undefined ? { refreshToken } : {}),
      };
      if (this.#tokens === refreshSource) this.#tokens = nextTokens;
      return refreshed.accessToken;
    } catch (error) {
      if (
        error instanceof OAuthTokenRejectedError &&
        this.#tokens === refreshSource
      ) {
        this.#tokens = undefined;
      }
      throw error;
    }
  }

  async #rpc(
    method: "tools/list" | "tools/call",
    params: unknown,
    signal: AbortSignal | undefined,
    operationSecrets: Set<string>,
  ): Promise<unknown> {
    const id = ++this.#rpcId;
    let body: string;
    try {
      body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    } catch {
      throw new PlayerGamesError("invalid_arguments");
    }
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
      throw new PlayerGamesError("request_too_large");
    }
    const accessToken = await this.#accessToken(signal, operationSecrets);
    operationSecrets.add(accessToken);
    const payload = await this.#requestJson(
      MCP_ENDPOINT,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body,
      },
      signal,
    );
    const envelopes = Array.isArray(payload) ? payload : [payload];
    const envelope = envelopes
      .map(record)
      .find((candidate) => candidate?.id === id);
    if (envelope === undefined || envelope.jsonrpc !== "2.0") {
      throw new PlayerGamesError("invalid_response");
    }
    if ("error" in envelope || !("result" in envelope)) {
      throw new PlayerGamesError("tool_failed");
    }
    return envelope.result;
  }
}

export function createPlayerGamesClient(
  options: PlayerGamesClientOptions,
): PlayerGamesClient {
  return new Client(options);
}
