import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import type {
  SourceArtifactIdentity,
  SourceCandidate,
  SourceCandidateContext,
  SourceCandidateRequest,
  SourceTarget,
} from "./source-facade.ts";

export const ADHI_CANDIDATE_REVISION =
  "552489550c9d652dbfacee67df6f6b816fe12034";
const ADHI_ENTRYPOINT_SHA256 =
  "f9931d9bae2300c9560c2cb39488ff15a6ac5236f37dbfca23732fa4661999c2";
const ADHI_PACKAGE_SHA256 =
  "520efc6fd016b3d6d9c8a77eb35ab50af9b5e02a8a6be59ff7b9df4eba0e80cf";

const RESPONSE_BYTES = 256 * 1024;
const FRAME_HEADER_BYTES = 8 * 1024;
const PROCESS_LOG_BYTES = 1024 * 1024;
const ARTIFACT_BYTES = 512 * 1024 * 1024;
const SOURCE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const STARTUP_TIMEOUT_MS = 15_000;
const REQUIRED_TOOLS = [
  "resolve-artifact",
  "find-class",
  "get-class-members",
  "find-mapping",
  "get-class-source",
  "search-class-source",
] as const;

type JsonRecord = Record<string, unknown>;
type CandidateErrorCode =
  "not_found" | "unsupported" | "unavailable" | "cancelled";

export interface AdhiCandidateOptions {
  readonly revision: string;
  readonly artifactRoot: string;
  readonly derivedCacheRoot: string;
  readonly network?: "offline" | "online";
  readonly vineflowerJarPath?: string | undefined;
  readonly tinyRemapperJarPath?: string | undefined;
  readonly versionManifestUrl?: string | undefined;
  readonly requestTimeoutMs?: number;
  readonly responseBytes?: number;
  readonly entryPoint?: string;
  readonly allowFixtureEntryPoint?: boolean;
}

export interface AdhiCandidate extends SourceCandidate {
  readonly pid: number;
}

interface ResolvedArtifact {
  readonly identity: SourceArtifactIdentity;
  readonly upstreamId: string;
  readonly target: SourceTarget;
  readonly path: string;
}

interface PendingRequest {
  readonly maxBytes: number;
  readonly resolve: (value: JsonRecord) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
  detachAbort: () => void;
}

function candidateError(code: CandidateErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function stringField(
  value: JsonRecord | undefined,
  key: string,
): string | undefined {
  const field = value?.[key];
  return typeof field === "string" ? field : undefined;
}

function requiredString(value: string | undefined, field: string): string {
  if (value === undefined || value.length === 0) {
    throw candidateError("unsupported", `${field} is required`);
  }
  return value;
}

function isVanillaArtifact(request: SourceCandidateRequest): boolean {
  return (
    request.artifact?.coordinates === "net.minecraft:client" ||
    request.artifact?.coordinates === "net.minecraft:server"
  );
}

function upstreamMapping(request: SourceCandidateRequest): string {
  const kind = request.target.mappings.kind;
  if (kind === "none") return "obfuscated";
  if (kind === "parchment-layer") {
    return request.className?.startsWith("net.minecraft.")
      ? "mojang"
      : "obfuscated";
  }
  if (kind === "mojang") {
    return isVanillaArtifact(request) ||
      request.className?.startsWith("net.minecraft.")
      ? "mojang"
      : "obfuscated";
  }
  throw candidateError("unsupported", `Adhi does not provide ${kind} mappings`);
}

function validateExactMapping(target: SourceTarget): void {
  const { kind, version } = target.mappings;
  if (kind === "none" && version === undefined) return;
  if (kind === "mojang" && version === target.minecraftVersion) return;
  if (kind === "parchment-layer" && version !== undefined) return;
  throw candidateError(
    "unsupported",
    `Adhi cannot pin exact ${kind} mapping version ${version ?? "missing"}`,
  );
}

function sourceOperationTarget(upstreamId: string): JsonRecord {
  return { target: { kind: "artifact", artifactId: upstreamId } };
}

function upstreamErrorCode(value: unknown): string | undefined {
  const envelope = asRecord(value);
  const problem = asRecord(envelope?.error);
  return stringField(problem, "code");
}

function mapUpstreamError(value: unknown): Error {
  const code = upstreamErrorCode(value) ?? "ERR_INTERNAL";
  if (
    code === "ERR_CLASS_NOT_FOUND" ||
    code === "ERR_SOURCE_NOT_FOUND" ||
    code === "ERR_FILE_NOT_FOUND" ||
    code === "ERR_JAR_NOT_FOUND" ||
    code === "ERR_VERSION_NOT_FOUND"
  ) {
    return candidateError("not_found", code);
  }
  if (
    code === "ERR_INVALID_INPUT" ||
    code === "ERR_MAPPING_UNAVAILABLE" ||
    code === "ERR_MAPPING_NOT_APPLIED" ||
    code === "ERR_NAMESPACE_MISMATCH" ||
    code === "ERR_DECOMPILE_DISABLED"
  ) {
    return candidateError("unsupported", code);
  }
  return candidateError("unavailable", code);
}

class StdioAdhiCandidate implements AdhiCandidate {
  readonly id = "adhi";
  readonly revision = ADHI_CANDIDATE_REVISION;
  readonly pid: number;

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly artifactRoot: string;
  private readonly requestTimeoutMs: number;
  private readonly responseBytes: number;
  private readonly offline: boolean;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly artifacts = new Map<string, ResolvedArtifact>();
  private readonly exited: Promise<void>;
  private nextId = 1;
  private input = Buffer.alloc(0);
  private stderrBytes = 0;
  private disposed = false;
  private disposePromise: Promise<void> | undefined;

  constructor(
    child: ChildProcessWithoutNullStreams,
    artifactRoot: string,
    requestTimeoutMs: number,
    responseBytes: number,
    offline: boolean,
  ) {
    this.child = child;
    this.artifactRoot = artifactRoot;
    this.requestTimeoutMs = requestTimeoutMs;
    this.responseBytes = responseBytes;
    this.offline = offline;
    if (child.pid === undefined)
      throw new Error("Adhi upstream PID unavailable");
    this.pid = child.pid;
    const exit = Promise.withResolvers<void>();
    child.once("exit", () => {
      this.disposed = true;
      this.failPending(candidateError("unavailable", "Adhi upstream exited"));
      exit.resolve();
    });
    child.once("error", () => {
      this.disposed = true;
      this.failPending(candidateError("unavailable", "Adhi upstream failed"));
      exit.resolve();
    });
    this.exited = exit.promise;
    child.stderr.on("data", (chunk: Buffer) => {
      if (process.env.VOXELLUME_ADHI_DEBUG === "1")
        console.error(chunk.toString());
      this.stderrBytes = Math.min(
        PROCESS_LOG_BYTES + 1,
        this.stderrBytes + chunk.byteLength,
      );
      if (this.stderrBytes > PROCESS_LOG_BYTES) {
        this.failPending(
          candidateError("unavailable", "Adhi process log limit exceeded"),
        );
        this.kill();
      }
    });
    void this.readResponses();
  }

  async initialize(): Promise<void> {
    await this.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "voxellume", version: "0.1.0" },
      },
      this.responseBytes,
      STARTUP_TIMEOUT_MS,
    );
    this.write({ jsonrpc: "2.0", method: "notifications/initialized" });
    const listed = await this.request(
      "tools/list",
      {},
      this.responseBytes,
      STARTUP_TIMEOUT_MS,
    );
    const tools = listed.tools;
    const names = new Set(
      Array.isArray(tools)
        ? tools
            .map((tool) => stringField(asRecord(tool), "name"))
            .filter(Boolean)
        : [],
    );
    for (const tool of REQUIRED_TOOLS) {
      if (!names.has(tool)) {
        throw candidateError("unavailable", `Adhi tool missing: ${tool}`);
      }
    }
  }

  async invoke(
    request: SourceCandidateRequest,
    context: SourceCandidateContext,
  ): Promise<unknown> {
    if (this.disposed)
      throw candidateError("unavailable", "Adhi upstream is closed");
    if (context.offline && !this.offline) {
      throw candidateError(
        "unsupported",
        "offline request requires an offline candidate",
      );
    }
    validateExactMapping(request.target);
    if (
      request.operation !== "resolve_artifact" &&
      (request.target.loader === "neoforge" ||
        request.target.loader === "forge") &&
      request.className?.startsWith("net.minecraft.")
    ) {
      throw candidateError(
        "unsupported",
        "verified patched loader sources are unavailable",
      );
    }
    const requestedMapping = request.mapping ?? request.target.mappings.kind;
    if (requestedMapping !== request.target.mappings.kind) {
      throw candidateError(
        "unsupported",
        "requested mapping differs from exact target mapping",
      );
    }
    const signal = context.signal;
    if (signal?.aborted) {
      this.kill();
      throw candidateError("cancelled", "cancelled");
    }
    const onAbort = (): void => this.kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      switch (request.operation) {
        case "resolve_artifact": {
          const artifact = await this.resolveArtifact(request, context.signal);
          return {
            artifactId: request.artifactId,
            coordinates: artifact.identity.coordinates,
            version: artifact.identity.version,
            sha256: artifact.identity.sha256,
            target: artifact.target,
          };
        }
        case "find_class": {
          const artifact = await this.resolveArtifact(request, signal);
          const className = requiredString(request.className, "className");
          const name = await this.findClassName(
            request,
            artifact,
            className,
            signal,
          );
          return {
            name,
            artifactId: request.artifactId,
            artifactSha256: artifact.identity.sha256,
          };
        }
        case "get_members": {
          const artifact = await this.resolveArtifact(request, context.signal);
          return this.getMembers(request, artifact, context.signal);
        }
        case "map_symbol": {
          const symbol = requiredString(request.symbol, "symbol");
          const mapping = requestedMapping;
          const artifact = await this.resolveArtifact(request, signal);
          if (
            mapping === "none" ||
            mapping === "parchment-layer" ||
            (mapping === "mojang" &&
              request.target.minecraftVersion.startsWith("26."))
          ) {
            const separator = symbol.lastIndexOf("#");
            if (separator === -1) {
              await this.findClassName(request, artifact, symbol, signal);
            } else {
              const owner = symbol.slice(0, separator);
              const selector = symbol.slice(separator + 1);
              const descriptorStart = selector.indexOf("(");
              const memberName =
                descriptorStart === -1
                  ? selector
                  : selector.slice(0, descriptorStart);
              const descriptor =
                descriptorStart === -1
                  ? undefined
                  : selector.slice(descriptorStart);
              if (owner.length === 0 || memberName.length === 0) {
                throw candidateError(
                  "unsupported",
                  "member symbol must use owner#name[descriptor]",
                );
              }
              const { members } = await this.getMembers(
                { ...request, className: owner },
                artifact,
                signal,
              );
              if (
                !members.some(
                  (member) =>
                    stringField(member, "name") === memberName &&
                    (descriptor === undefined ||
                      stringField(member, "descriptor") === descriptor),
                )
              ) {
                throw candidateError("not_found", "member not found");
              }
            }
            return { from: symbol, to: symbol, mapping };
          }
          if (symbol.includes("#")) {
            throw candidateError(
              "unsupported",
              "member mapping requires an exact member-aware provider",
            );
          }
          const output = await this.callTool(
            "find-mapping",
            {
              version: request.target.minecraftVersion,
              kind: "class",
              name: symbol,
              sourceMapping:
                requestedMapping === "parchment-layer"
                  ? "mojang"
                  : requestedMapping,
              targetMapping: "obfuscated",
              nameMode: "fqcn",
            },
            signal,
          );
          if (output.status === "not_found") {
            throw candidateError("not_found", "mapping not found");
          }
          if (output.status !== "resolved") {
            throw candidateError(
              "unsupported",
              stringField(output, "status") ?? "mapping unavailable",
            );
          }
          const resolved = asRecord(output.resolvedSymbol);
          const to = stringField(resolved, "name");
          if (to === undefined)
            throw candidateError(
              "unavailable",
              "mapping response lacked a symbol",
            );
          return { from: symbol, to, mapping };
        }
        case "read_source": {
          const artifact = await this.resolveArtifact(request, context.signal);
          const className = requiredString(request.className, "className");
          const output = await this.callTool(
            "get-class-source",
            {
              className,
              ...sourceOperationTarget(artifact.upstreamId),
              mapping: upstreamMapping(request),
              mode: "full",
              maxChars: SOURCE_BYTES,
              allowDecompile: true,
              strictVersion: true,
              preferProjectVersion: false,
              detail: "standard",
            },
            context.signal,
          );
          const source = stringField(output, "sourceText");
          if (source === undefined)
            throw candidateError("unavailable", "source response lacked text");
          if (output.truncated === true || output.charsTruncated === true) {
            throw candidateError(
              "unavailable",
              "source response was truncated",
            );
          }
          return {
            className: stringField(output, "className") ?? className,
            source,
          };
        }
        case "search_source": {
          const artifact = await this.resolveArtifact(request, context.signal);
          const query = requiredString(request.query, "query");
          const output = await this.callTool(
            "search-class-source",
            {
              query,
              ...sourceOperationTarget(artifact.upstreamId),
              intent: "text",
              match: "contains",
              queryMode: "literal",
              limit: 20,
              detail: "standard",
            },
            context.signal,
          );
          if (
            output.truncated === true ||
            output.nextCursor !== undefined ||
            (Array.isArray(output.warnings) &&
              output.warnings.some(
                (warning) =>
                  typeof warning === "string" &&
                  /incomplete|truncat|limit/i.test(warning),
              ))
          ) {
            throw candidateError("unavailable", "source search was incomplete");
          }
          const hits = Array.isArray(output.hits) ? output.hits : [];
          return {
            matches: hits.flatMap((hit) => {
              const record = asRecord(hit);
              const filePath = stringField(record, "filePath");
              const line = record?.line;
              const contextText = stringField(record, "context");
              if (
                filePath === undefined ||
                typeof line !== "number" ||
                contextText === undefined
              ) {
                return [];
              }
              const text = contextText
                .split("\n")
                .find((candidate) => candidate.includes(query));
              if (text === undefined) return [];
              return [
                {
                  className: filePath
                    .replace(/\.java$/, "")
                    .replaceAll("/", "."),
                  line,
                  text,
                },
              ];
            }),
          };
        }
        case "diff_classes": {
          const left = await this.resolveArtifact(request, context.signal);
          const rightId = requiredString(
            request.rightArtifactId,
            "rightArtifactId",
          );
          const rightRequest: SourceCandidateRequest = {
            ...request,
            target: request.rightTarget ?? request.target,
            artifactId: rightId,
            artifact: request.rightArtifact,
          };
          const right = await this.resolveArtifactById(
            rightId,
            rightRequest,
            context.signal,
          );
          const [leftMembers, rightMembers] = await Promise.all([
            this.getMembers(request, left, context.signal),
            this.getMembers(rightRequest, right, context.signal),
          ]);
          return {
            left: request.className,
            right: request.className,
            ...diffMembers(leftMembers.members, rightMembers.members),
          };
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  dispose(): Promise<void> {
    this.disposePromise ??= (async () => {
      this.disposed = true;
      this.failPending(candidateError("cancelled", "Adhi candidate disposed"));
      this.kill();
      this.child.stdin.end();
      await this.exited;
      this.child.stdout.destroy();
      this.child.stderr.destroy();
    })();
    return this.disposePromise;
  }

  private async findClassName(
    request: SourceCandidateRequest,
    artifact: ResolvedArtifact,
    className: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const output = await this.callTool(
      "find-class",
      {
        className,
        ...sourceOperationTarget(artifact.upstreamId),
        limit: 20,
      },
      signal,
    );
    const matches = Array.isArray(output.matches) ? output.matches : [];
    const names = matches
      .map((match) => stringField(asRecord(match), "qualifiedName"))
      .filter((name): name is string => name !== undefined);
    const exact = names.find((candidate) => candidate === className);
    if (exact !== undefined) return exact;
    if (!className.includes(".") && names.length === 1)
      return names[0] as string;
    if (names.length > 1)
      throw candidateError("unsupported", "class name is ambiguous");
    throw candidateError("not_found", "class not found");
  }

  private async getMembers(
    request: SourceCandidateRequest,
    artifact: ResolvedArtifact,
    signal: AbortSignal | undefined,
  ): Promise<{ className: string; members: JsonRecord[] }> {
    const className = requiredString(request.className, "className");
    const output = await this.callTool(
      "get-class-members",
      {
        className,
        ...sourceOperationTarget(artifact.upstreamId),
        mapping: upstreamMapping(request),
        allowDecompile: true,
        strictVersion: true,
        preferProjectVersion: false,
        access: "all",
        includeSynthetic: true,
        includeInherited: false,
        includeDescriptors: true,
        projection: "full",
        maxMembers: 5000,
        detail: "full",
      },
      signal,
    );
    if (
      output.status === "members_unavailable" ||
      output.status === "partial"
    ) {
      throw candidateError(
        "unavailable",
        "complete member extraction unavailable",
      );
    }
    if (output.truncated === true || output.nextCursor !== undefined) {
      throw candidateError("unavailable", "class members were truncated");
    }
    const block = asRecord(output.members);
    const members: JsonRecord[] = [];
    for (const kind of ["constructor", "field", "method"] as const) {
      const entries = block?.[`${kind}s`];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const member = asRecord(entry);
        const name = stringField(member, "name");
        const descriptor = stringField(member, "jvmDescriptor");
        if (name === undefined || descriptor === undefined) continue;
        members.push({
          kind,
          name,
          descriptor,
          ...(stringField(member, "javaSignature") === undefined
            ? {}
            : { javaSignature: stringField(member, "javaSignature") }),
        });
      }
    }
    return {
      className: stringField(output, "className") ?? className,
      members,
    };
  }

  private async resolveArtifactById(
    artifactId: string,
    request: SourceCandidateRequest,
    signal: AbortSignal | undefined,
  ): Promise<ResolvedArtifact> {
    this.checkAbort(signal);
    const identity = request.rightArtifact;
    if (identity === undefined)
      throw candidateError("unsupported", "exact right artifact is required");
    return this.resolveArtifact(
      { ...request, artifactId, artifact: identity },
      signal,
    );
  }

  private async resolveArtifact(
    request: SourceCandidateRequest,
    signal: AbortSignal | undefined,
  ): Promise<ResolvedArtifact> {
    this.checkAbort(signal);
    const artifactId = requiredString(request.artifactId, "artifactId");
    const identity = request.artifact;
    if (identity === undefined)
      throw candidateError("unsupported", "exact artifact is required");
    const key = JSON.stringify([
      artifactId,
      identity.coordinates,
      identity.version,
      identity.sha256,
      request.target.minecraftVersion,
      request.target.loader,
      request.target.mappings.kind,
      request.target.mappings.version,
    ]);
    const cached = this.artifacts.get(key);
    if (cached !== undefined) {
      this.checkAbort(signal);
      return cached;
    }
    const path = await this.findArtifactPath(
      artifactId,
      identity.sha256,
      signal,
    );
    this.checkAbort(signal);
    const remapVanilla =
      request.target.mappings.kind === "mojang" &&
      isVanillaArtifact(request) &&
      !request.target.minecraftVersion.startsWith("26.");
    const output = await this.callTool(
      "resolve-artifact",
      {
        target: remapVanilla
          ? { kind: "version", value: request.target.minecraftVersion }
          : { kind: "jar", value: path },
        mapping: remapVanilla ? "mojang" : "obfuscated",
        allowDecompile: true,
        strictVersion: true,
        preferProjectVersion: false,
        detail: "standard",
      },
      signal,
    );
    const upstreamId = stringField(output, "artifactId");
    if (upstreamId === undefined) {
      throw candidateError("unavailable", "artifact response lacked an ID");
    }
    const binaryJarPath = stringField(output, "binaryJarPath");
    if (
      binaryJarPath === undefined ||
      (await stat(binaryJarPath)).size > ARTIFACT_BYTES
    ) {
      throw candidateError(
        "unavailable",
        "resolved binary artifact is missing or oversized",
      );
    }
    this.checkAbort(signal);
    const binaryBytes = await readFile(binaryJarPath);
    this.checkAbort(signal);
    if (
      createHash("sha256").update(binaryBytes).digest("hex") !== identity.sha256
    ) {
      throw candidateError(
        "unavailable",
        "resolved binary artifact SHA-256 mismatch",
      );
    }
    if (output.origin === "local-jar" && output.isDecompiled === false) {
      throw candidateError(
        "unsupported",
        "unverified sibling source JAR is forbidden",
      );
    }
    const resolved = {
      identity,
      upstreamId,
      path,
      target: {
        ...request.target,
        mappings: { ...request.target.mappings },
      },
    };
    this.artifacts.set(key, resolved);
    return resolved;
  }

  private async findArtifactPath(
    artifactId: string,
    sha256: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    this.checkAbort(signal);
    const entries = await readdir(this.artifactRoot, { withFileTypes: true });
    this.checkAbort(signal);
    for (const entry of entries) {
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".jar") ||
        entry.name.endsWith("-sources.jar")
      ) {
        continue;
      }
      if (sha256 === undefined && entry.name !== `${artifactId}.jar`) continue;
      const path = join(this.artifactRoot, entry.name);
      this.checkAbort(signal);
      const info = await stat(path);
      this.checkAbort(signal);
      if (info.size > ARTIFACT_BYTES) continue;
      if (sha256 === undefined) return path;
      this.checkAbort(signal);
      const bytes = await readFile(path);
      this.checkAbort(signal);
      if (createHash("sha256").update(bytes).digest("hex") === sha256)
        return path;
    }
    throw candidateError(
      "not_found",
      `local artifact not found: ${artifactId}`,
    );
  }

  private checkAbort(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      this.kill();
      throw candidateError("cancelled", "cancelled");
    }
  }

  private async callTool(
    name: string,
    args: JsonRecord,
    signal: AbortSignal | undefined,
  ): Promise<JsonRecord> {
    this.checkAbort(signal);
    const response = await this.request(
      "tools/call",
      { name, arguments: args },
      this.responseBytes,
      this.requestTimeoutMs,
      signal,
    );
    this.checkAbort(signal);
    const result = asRecord(response);
    const structured = asRecord(result?.structuredContent);
    const text = Array.isArray(result?.content)
      ? result.content
          .map((item) => stringField(asRecord(item), "text"))
          .find((item) => item !== undefined)
      : undefined;
    let envelope = structured;
    if (envelope === undefined && text !== undefined) {
      try {
        envelope = asRecord(JSON.parse(text));
      } catch {
        throw candidateError(
          "unavailable",
          "Adhi returned malformed tool content",
        );
      }
    }
    if (result?.isError === true || envelope?.error !== undefined) {
      if (process.env.VOXELLUME_ADHI_DEBUG === "1") {
        console.error(JSON.stringify(envelope));
      }
      throw mapUpstreamError(envelope);
    }
    const output = asRecord(envelope?.result);
    if (output === undefined)
      throw candidateError("unavailable", "Adhi tool result missing");
    return output;
  }

  private request(
    method: string,
    params: JsonRecord,
    maxBytes: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<JsonRecord> {
    if (this.disposed)
      return Promise.reject(
        candidateError("unavailable", "Adhi upstream is closed"),
      );
    if (signal?.aborted)
      return Promise.reject(candidateError("cancelled", "cancelled"));
    const id = this.nextId++;
    const deferred = Promise.withResolvers<JsonRecord>();
    const pending: PendingRequest = {
      maxBytes,
      resolve: deferred.resolve,
      reject: deferred.reject,
      timer: setTimeout(() => {
        this.pending.delete(id);
        deferred.reject(
          candidateError("unavailable", `Adhi request timed out: ${method}`),
        );
        this.kill();
      }, timeoutMs),
      detachAbort: () => {},
    };
    this.pending.set(id, pending);
    if (signal !== undefined) {
      const onAbort = (): void => {
        if (!this.pending.has(id)) return;
        this.write({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: id, reason: "cancelled" },
        });
        this.pending.delete(id);
        deferred.reject(candidateError("cancelled", "cancelled"));
        this.kill();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      pending.detachAbort = () => signal.removeEventListener("abort", onAbort);
    }
    try {
      this.write({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.detachAbort();
      throw error;
    }
    return deferred.promise.finally(() => {
      clearTimeout(pending.timer);
      pending.detachAbort();
      this.pending.delete(id);
    });
  }

  private write(message: JsonRecord): void {
    if (this.child.stdin.destroyed || this.child.stdin.writableEnded) {
      throw candidateError("unavailable", "Adhi stdin is closed");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async readResponses(): Promise<void> {
    try {
      for await (const chunk of this.child.stdout) {
        if (process.env.VOXELLUME_ADHI_DEBUG === "1")
          console.log(chunk.toString());
        this.input = Buffer.concat([this.input, chunk]);
        for (;;) {
          const frame = this.nextFrame();
          if (frame === undefined) break;
          if (frame.byteLength === 0) continue;
          this.handleFrame(frame);
        }
      }
    } catch (error) {
      this.disposed = true;
      this.failPending(
        error instanceof Error
          ? error
          : candidateError("unavailable", "Adhi stdout failed"),
      );
      this.kill();
    }
  }

  private nextFrame(): Buffer | undefined {
    if (this.input.byteLength === 0) return undefined;
    if (this.input.subarray(0, 15).toString("ascii") === "Content-Length:") {
      const headerEnd = this.input.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        if (this.input.byteLength > FRAME_HEADER_BYTES) {
          throw candidateError("unavailable", "Adhi response header too large");
        }
        return undefined;
      }
      if (headerEnd > FRAME_HEADER_BYTES) {
        throw candidateError("unavailable", "Adhi response header too large");
      }
      const header = this.input.subarray(0, headerEnd).toString("ascii");
      const match = /^Content-Length:\s*(\d+)$/im.exec(header);
      if (match?.[1] === undefined)
        throw candidateError("unavailable", "invalid Content-Length");
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length > this.responseBytes) {
        throw candidateError("unavailable", "Adhi response frame too large");
      }
      const end = headerEnd + 4 + length;
      if (this.input.byteLength < end) return undefined;
      const frame = this.input.subarray(headerEnd + 4, end);
      this.input = this.input.subarray(end);
      return frame;
    }
    const newline = this.input.indexOf("\n");
    if (newline === -1) {
      if (this.input.byteLength > this.responseBytes) {
        throw candidateError("unavailable", "Adhi response line too large");
      }
      return undefined;
    }
    if (newline > this.responseBytes) {
      throw candidateError("unavailable", "Adhi response line too large");
    }
    const frame = this.input.subarray(0, newline);
    this.input = this.input.subarray(newline + 1);
    return frame;
  }

  private handleFrame(frame: Buffer): void {
    if (frame.byteLength > this.responseBytes) {
      this.failPending(
        candidateError("unavailable", "Adhi response limit exceeded"),
      );
      this.kill();
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.toString("utf8"));
    } catch {
      this.failPending(
        candidateError("unavailable", "Adhi returned malformed JSON-RPC"),
      );
      this.kill();
      return;
    }
    const message = asRecord(parsed);
    const id = message?.id;
    if (typeof id !== "number") return;
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.detachAbort();
    if (frame.byteLength > pending.maxBytes) {
      pending.reject(
        candidateError("unavailable", "Adhi response limit exceeded"),
      );
      this.kill();
      return;
    }
    if (message?.error !== undefined) {
      pending.reject(mapUpstreamError(message.error));
      return;
    }
    const result = asRecord(message?.result);
    if (result === undefined) {
      pending.reject(
        candidateError("unavailable", "Adhi JSON-RPC result missing"),
      );
      return;
    }
    pending.resolve(result);
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.detachAbort();
      pending.reject(error);
    }
    this.pending.clear();
  }

  private kill(): void {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    if (process.platform !== "win32") {
      try {
        process.kill(-this.pid, "SIGKILL");
        return;
      } catch {
        // Fall through when the process already exited or has no separate group.
      }
    }
    this.child.kill("SIGKILL");
  }
}

function diffMembers(
  left: readonly JsonRecord[],
  right: readonly JsonRecord[],
): { added: string[]; removed: string[]; changed: string[] } {
  const key = (member: JsonRecord): string =>
    `${stringField(member, "kind")}:${stringField(member, "name")}${stringField(member, "descriptor")}`;
  const leftBySignature = new Map(left.map((member) => [key(member), member]));
  const rightBySignature = new Map(
    right.map((member) => [key(member), member]),
  );
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [signature, member] of rightBySignature) {
    const previous = leftBySignature.get(signature);
    if (previous === undefined) added.push(signature);
    else if (
      stringField(previous, "javaSignature") !==
      stringField(member, "javaSignature")
    ) {
      changed.push(
        `${signature}:${stringField(previous, "javaSignature")}->${stringField(member, "javaSignature")}`,
      );
    }
  }
  for (const signature of leftBySignature.keys()) {
    if (!rightBySignature.has(signature)) removed.push(signature);
  }
  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed };
}

export async function createCandidate(
  options: AdhiCandidateOptions,
): Promise<AdhiCandidate> {
  if (process.platform === "win32") {
    throw candidateError(
      "unsupported",
      "Windows process cleanup is not qualified",
    );
  }
  if (options.revision !== ADHI_CANDIDATE_REVISION) {
    throw candidateError("unsupported", "Adhi revision mismatch");
  }
  if (
    options.network !== "online" &&
    options.versionManifestUrl !== undefined
  ) {
    const manifestUrl = new URL(options.versionManifestUrl);
    if (
      manifestUrl.protocol !== "http:" ||
      !["127.0.0.1", "[::1]"].includes(manifestUrl.hostname) ||
      manifestUrl.username.length > 0 ||
      manifestUrl.password.length > 0
    ) {
      throw candidateError(
        "unsupported",
        "offline version manifest must use literal loopback HTTP",
      );
    }
  }
  const responseBytes = options.responseBytes ?? RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(responseBytes) ||
    responseBytes <= 0 ||
    responseBytes > RESPONSE_BYTES
  ) {
    throw candidateError(
      "unsupported",
      "responseBytes must be between 1 and 262144",
    );
  }
  const require = createRequire(import.meta.url);
  const packageJsonPath =
    require.resolve("@adhisang/minecraft-modding-mcp/package.json");
  const packageEntryPoint =
    require.resolve("@adhisang/minecraft-modding-mcp/dist/cli.js");
  if (
    options.entryPoint !== undefined &&
    options.allowFixtureEntryPoint !== true
  ) {
    throw candidateError(
      "unsupported",
      "custom Adhi entrypoint is fixture-only",
    );
  }
  if (options.entryPoint === undefined) {
    const [packageBytes, entryPointBytes] = await Promise.all([
      readFile(packageJsonPath),
      readFile(packageEntryPoint),
    ]);
    if (
      createHash("sha256").update(packageBytes).digest("hex") !==
        ADHI_PACKAGE_SHA256 ||
      createHash("sha256").update(entryPointBytes).digest("hex") !==
        ADHI_ENTRYPOINT_SHA256
    ) {
      throw candidateError("unavailable", "Adhi package digest mismatch");
    }
  }
  const packageJson = asRecord(
    require("@adhisang/minecraft-modding-mcp/package.json"),
  );
  if (stringField(packageJson, "version") !== "8.1.0") {
    throw candidateError("unavailable", "Adhi package version mismatch");
  }
  const entryPoint = options.entryPoint ?? packageEntryPoint;
  const artifactRoot = await realpath(resolve(options.artifactRoot));
  const derivedCacheRoot = resolve(options.derivedCacheRoot);
  await mkdir(derivedCacheRoot, { recursive: true });
  const home = join(derivedCacheRoot, "home");
  const cache = join(derivedCacheRoot, "cache");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(cache, { recursive: true }),
    mkdir(join(derivedCacheRoot, "m2"), { recursive: true }),
  ]);
  const child = spawn(process.execPath, [entryPoint], {
    cwd: derivedCacheRoot,
    detached: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
      ...(process.env.JAVA_HOME === undefined
        ? {}
        : { JAVA_HOME: process.env.JAVA_HOME }),
      HOME: home,
      GRADLE_USER_HOME: join(derivedCacheRoot, "gradle"),
      NODE_ENV: "production",
      MCP_STDIO_WORKER_MODE: "1",
      MCP_CACHE_DIR: cache,
      MCP_SQLITE_PATH: join(cache, "source-cache.db"),
      MCP_LOCAL_M2: join(derivedCacheRoot, "m2"),
      ...(options.vineflowerJarPath !== undefined
        ? { MCP_VINEFLOWER_JAR_PATH: resolve(options.vineflowerJarPath) }
        : options.network === "online"
          ? {}
          : {
              MCP_VINEFLOWER_JAR_PATH: join(
                derivedCacheRoot,
                "offline-vineflower-unavailable.jar",
              ),
            }),
      ...(options.tinyRemapperJarPath !== undefined
        ? { MCP_TINY_REMAPPER_JAR_PATH: resolve(options.tinyRemapperJarPath) }
        : options.network === "online"
          ? {}
          : {
              MCP_TINY_REMAPPER_JAR_PATH: join(
                derivedCacheRoot,
                "offline-tiny-remapper-unavailable.jar",
              ),
            }),
      MCP_VERSION_MANIFEST_URL:
        options.versionManifestUrl ??
        (options.network === "online"
          ? "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
          : "http://127.0.0.1:9/version-manifest.json"),
      MCP_SOURCE_REPOS:
        options.network === "online"
          ? "https://repo.maven.apache.org/maven2/,https://maven.fabricmc.net,https://maven.minecraftforge.net,https://maven.neoforged.net/releases"
          : "http://127.0.0.1:9",
      MCP_FETCH_RETRIES: "0",
      ...(process.env.VOXELLUME_ADHI_DEBUG === "1"
        ? { MCP_SUPERVISOR_DEBUG: "1" }
        : {}),
      MCP_MAX_CONTENT_BYTES: String(SOURCE_BYTES),
      MCP_MAX_SEARCH_HITS: "20",
      MCP_MAX_CACHE_BYTES: String(2 * 1024 ** 3),
    },
  });
  const candidate = new StdioAdhiCandidate(
    child,
    artifactRoot,
    options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    responseBytes,
    options.network !== "online",
  );
  try {
    await candidate.initialize();
    return candidate;
  } catch (error) {
    await candidate.dispose();
    throw error;
  }
}
