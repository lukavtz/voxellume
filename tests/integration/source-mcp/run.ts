import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

import { strToU8, unzipSync, zipSync } from "fflate";

const execFileAsync = promisify(execFile);
const fixtureRoot = fileURLToPath(
  new URL("../../../fixtures/source-mcp/", import.meta.url),
);

export const candidateRevisions = {
  adhi: "552489550c9d652dbfacee67df6f6b816fe12034",
  modlens: "ba2020c226b51858d157bc943ed13f1c6b578514",
} as const;

export const usage =
  "node --experimental-strip-types tests/integration/source-mcp/run.ts " +
  "--candidate=adhi|modlens --revision=<full-sha> " +
  "--suite=matrix|security|perf-cold|perf-warm " +
  "--network=offline|online --derived-cache=empty|warm " +
  "[--warmup=5] [--samples=30] [--case=<case-id>]";

type CandidateId = keyof typeof candidateRevisions;
type Suite = "matrix" | "security" | "perf-cold" | "perf-warm";
type Network = "offline" | "online";
type DerivedCache = "empty" | "warm";
type Operation =
  | "resolve_artifact"
  | "find_class"
  | "get_members"
  | "map_symbol"
  | "read_source"
  | "search_source"
  | "diff_classes";

interface CliOptions {
  candidate: CandidateId;
  revision: string;
  suite: Suite;
  network: Network;
  derivedCache: DerivedCache;
  caseFilter?: string | undefined;
  warmup: number;
  samples: number;
}

interface Artifact {
  id: string;
  path: string;
  coordinates: string;
  version: string;
  sha256: string;
  url: string;
  root?: string;
}

interface MemberOracle {
  name: string;
  descriptor: string;
  binaryName: string;
  binaryDescriptor: string;
}

interface DiffOracle {
  leftArtifactId: string;
  rightArtifactId: string;
  className: string;
  leftBinaryName: string;
  rightBinaryName: string;
  added: string[];
  removed: string[];
  changed: string[];
}

interface Oracle {
  className: string;
  binaryName: string;
  oracleArtifactId: string;
  patchedFromVanilla?: boolean;
  nestedEntry?: string;
  nestedSha256?: string;
  member: MemberOracle;
  binarySourceSnippet?: string;
  sourceSnippet: string;
  search: {
    query: string;
    line: number;
    text: string;
    mappedText?: string;
  };
  mapping: {
    from: string;
    to: string;
    kind: string;
    artifactId?: string;
  };
  diff: DiffOracle;
}

interface Workspace {
  id: string;
  kind: "loader" | "vanilla" | "special";
  extendsWorkspaceId?: string;
  minecraftVersion: string;
  loader: string;
  targetPackId?: string;
  mappings: { kind: string; version?: string };
  artifactId: string;
  oracleId?: string;
  features: string[];
  className?: string;
  files: Record<string, string>;
}

interface MatrixCase {
  id: string;
  category: string;
  workspaceId: string;
  operation?: Operation;
  operations?: Operation[];
  expected: { status: string; code?: string };
}

interface TargetFixtures {
  schemaVersion: string;
  caseCount: number;
  operations: Operation[];
  workspaces: Workspace[];
  cases: MatrixCase[];
}

interface ArtifactFixtures {
  schemaVersion: string;
  cache: {
    rootEnv: string;
    defaultRoot: string;
    maximumDownloadBytes: number;
  };
  oracleTools: {
    javap: { executable: string; arguments: string[] };
    vineflower: {
      artifactId: string;
      version: string;
      arguments: string[];
    };
  };
  artifacts: Artifact[];
  oracles: Record<string, Oracle>;
  maliciousArtifacts: { id: string; kind: string; expectedCode: string }[];
}

interface SourceResult {
  status: string;
  operation?: string;
  code?: string;
  value?: unknown;
}

interface SourceRequest {
  operation: Operation;
  target: {
    minecraftVersion: string;
    loader: string;
    mappings: { kind: string; version?: string };
  };
  artifactId: string;
  artifact: { coordinates: string; version: string; sha256: string };
  className: string;
  symbol: string;
  query: string;
  workspaceId: string;
  workspacePath: string;
  mapping?: string;
  memberName?: string;
  rightArtifactId?: string;
  rightArtifact?: { coordinates: string; version: string; sha256: string };
  rightTarget?: SourceRequest["target"];
  runtimeArtifactId?: string;
  runtimeArtifact?: { coordinates: string; version: string; sha256: string };
  rightClassName?: string;
}

interface InvocationContext {
  offline: boolean;
  signal?: AbortSignal;
}

export interface BenchmarkDependencies {
  invoke?: (
    request: SourceRequest,
    context: InvocationContext,
  ) => Promise<SourceResult>;
  verifyOracle?: (
    operation: Operation,
    request: SourceRequest,
    oracle: Oracle | undefined,
  ) => Promise<void>;
}

interface OperationResult {
  operation: Operation;
  status: "passed" | "failed";
  cold: SourceResult;
  warm?: SourceResult;
  durationMs: number;
  errors: string[];
  falsePositives: number;
  patchedSourceFailures: number;
}

interface CaseResult {
  id: string;
  category: string;
  status: "passed" | "failed";
  operations: OperationResult[];
}

interface LoadedFixtures {
  targets: TargetFixtures;
  artifacts: ArtifactFixtures;
  artifactById: Map<string, Artifact>;
  workspaceById: Map<string, Workspace>;
}

const allOperations: Operation[] = [
  "resolve_artifact",
  "find_class",
  "get_members",
  "map_symbol",
  "read_source",
  "search_source",
  "diff_classes",
];

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "benchmark_failed";
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error
    ? `${error.message}: ${errorMessage(error.cause)}`
    : error.message;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw Object.assign(new Error(`${flag} requires a positive integer`), {
      code: "invalid_arguments",
    });
  }
  return parsed;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(argument);
    if (!match) {
      throw Object.assign(new Error(`invalid argument: ${argument}`), {
        code: "invalid_arguments",
      });
    }
    const key = match[1];
    if (key === undefined || values.has(key)) {
      throw Object.assign(new Error(`duplicate argument: ${argument}`), {
        code: "invalid_arguments",
      });
    }
    values.set(key, match[2] ?? "");
  }
  const allowed = new Set([
    "candidate",
    "revision",
    "suite",
    "network",
    "derived-cache",
    "case",
    "warmup",
    "samples",
  ]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) {
      throw Object.assign(new Error(`unknown argument: --${key}`), {
        code: "invalid_arguments",
      });
    }
  }
  const candidate = values.get("candidate") ?? "adhi";
  if (candidate !== "adhi" && candidate !== "modlens") {
    throw Object.assign(new Error("unknown candidate"), {
      code: "invalid_arguments",
    });
  }
  const revision = values.get("revision") ?? candidateRevisions[candidate];
  if (revision !== candidateRevisions[candidate]) {
    throw Object.assign(new Error("candidate revision does not match pin"), {
      code: "revision_mismatch",
    });
  }
  const suite = values.get("suite") ?? "matrix";
  if (!["matrix", "security", "perf-cold", "perf-warm"].includes(suite)) {
    throw Object.assign(new Error("unknown suite"), {
      code: "invalid_arguments",
    });
  }
  const network = values.get("network") ?? "offline";
  if (network !== "offline" && network !== "online") {
    throw Object.assign(new Error("unknown network mode"), {
      code: "invalid_arguments",
    });
  }
  const derivedCache = values.get("derived-cache") ?? "warm";
  if (derivedCache !== "empty" && derivedCache !== "warm") {
    throw Object.assign(new Error("unknown derived-cache mode"), {
      code: "invalid_arguments",
    });
  }
  return {
    candidate,
    revision,
    suite: suite as Suite,
    network,
    derivedCache,
    ...(values.has("case") ? { caseFilter: values.get("case") } : {}),
    warmup: positiveInteger(values.get("warmup") ?? "5", "--warmup"),
    samples: positiveInteger(values.get("samples") ?? "30", "--samples"),
  };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export function validateFixtures(
  targets: TargetFixtures,
  artifacts: ArtifactFixtures,
): void {
  if (targets.schemaVersion !== "source-mcp-targets-1.0.0") {
    throw new Error("unsupported target fixture schema");
  }
  if (artifacts.schemaVersion !== "source-mcp-artifacts-1.0.0") {
    throw new Error("unsupported artifact fixture schema");
  }
  if (targets.caseCount !== 68 || targets.cases.length !== 68) {
    throw new Error("source MCP matrix must contain exactly 68 cases");
  }
  if (new Set(targets.cases.map((entry) => entry.id)).size !== 68) {
    throw new Error("source MCP case IDs must be unique");
  }
  const loaders = targets.workspaces.filter((entry) => entry.kind === "loader");
  const vanilla = targets.workspaces.filter(
    (entry) => entry.kind === "vanilla",
  );
  const special = targets.workspaces.filter(
    (entry) => entry.kind === "special",
  );
  if (loaders.length !== 8 || vanilla.length !== 4 || special.length !== 8) {
    throw new Error("workspace counts must be 8 loader, 4 vanilla, 8 special");
  }
  const workspaceIds = new Set(targets.workspaces.map((entry) => entry.id));
  const artifactIds = new Set(artifacts.artifacts.map((entry) => entry.id));
  for (const workspace of targets.workspaces) {
    if (!artifactIds.has(workspace.artifactId)) {
      throw new Error(`${workspace.id} references an unknown artifact`);
    }
    if (
      workspace.oracleId !== undefined &&
      artifacts.oracles[workspace.oracleId] === undefined
    ) {
      throw new Error(`${workspace.id} references an unknown oracle`);
    }
    if (
      workspace.extendsWorkspaceId !== undefined &&
      !workspaceIds.has(workspace.extendsWorkspaceId)
    ) {
      throw new Error(`${workspace.id} references an unknown base workspace`);
    }
  }
  for (const entry of targets.cases) {
    if (!workspaceIds.has(entry.workspaceId)) {
      throw new Error(`${entry.id} references an unknown workspace`);
    }
    const operations = entry.operations ?? [entry.operation];
    if (
      operations.some(
        (operation) =>
          operation === undefined || !allOperations.includes(operation),
      )
    ) {
      throw new Error(`${entry.id} has an unsupported operation`);
    }
  }
  for (const artifact of artifacts.artifacts) {
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) {
      throw new Error(`${artifact.id} lacks an exact SHA-256`);
    }
    if (!artifact.url.startsWith("https://")) {
      throw new Error(`${artifact.id} lacks an HTTPS source`);
    }
  }
}

async function loadFixtures(): Promise<LoadedFixtures> {
  const targets = await readJson<TargetFixtures>(
    join(fixtureRoot, "targets.json"),
  );
  const artifacts = await readJson<ArtifactFixtures>(
    join(fixtureRoot, "artifacts.json"),
  );
  validateFixtures(targets, artifacts);
  return {
    targets,
    artifacts,
    artifactById: new Map(
      artifacts.artifacts.map((entry) => [entry.id, entry]),
    ),
    workspaceById: new Map(
      targets.workspaces.map((entry) => [entry.id, entry]),
    ),
  };
}

function mergedWorkspace(
  workspace: Workspace,
  workspaceById: Map<string, Workspace>,
): Workspace {
  if (workspace.extendsWorkspaceId === undefined) return workspace;
  const parent = workspaceById.get(workspace.extendsWorkspaceId);
  if (parent === undefined) throw new Error("workspace parent not found");
  const mergedParent = mergedWorkspace(parent, workspaceById);
  return {
    ...mergedParent,
    ...workspace,
    features: [...new Set([...mergedParent.features, ...workspace.features])],
    files: { ...mergedParent.files, ...workspace.files },
  };
}

async function materializeWorkspaces(
  root: string,
  fixtures: LoadedFixtures,
): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  for (const declared of fixtures.targets.workspaces) {
    const workspace = mergedWorkspace(declared, fixtures.workspaceById);
    const workspacePath = join(root, "workspaces", workspace.id);
    await mkdir(workspacePath, { recursive: true });
    for (const [relative, content] of Object.entries(workspace.files)) {
      if (
        relative.startsWith("/") ||
        relative.split("/").includes("..") ||
        relative.includes("\0")
      ) {
        throw new Error(`unsafe workspace fixture path: ${relative}`);
      }
      const destination = join(workspacePath, relative);
      await mkdir(join(destination, ".."), { recursive: true });
      await writeFile(destination, content, { flag: "wx" });
    }
    paths.set(workspace.id, workspacePath);
  }
  return paths;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function startVersionFixtureServer(
  artifactRoot: string,
  fixtures: LoadedFixtures,
): Promise<{ url: string; close: () => Promise<void> }> {
  const vanilla = [...fixtures.artifactById.values()].filter(
    (artifact) => artifact.coordinates === "net.minecraft:client",
  );
  const byVersion = new Map(
    vanilla.map((artifact) => [artifact.version, artifact]),
  );
  let base = "";
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname === "/version-manifest.json") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            latest: {
              release: vanilla.at(-1)?.version,
              snapshot: vanilla.at(-1)?.version,
            },
            versions: vanilla.map((artifact) => ({
              id: artifact.version,
              type: "release",
              url: `${base}/versions/${encodeURIComponent(artifact.version)}.json`,
              time: "2026-01-01T00:00:00+00:00",
              releaseTime: "2026-01-01T00:00:00+00:00",
              complianceLevel: 1,
            })),
          }),
        );
        return;
      }
      const versionMatch = /^\/versions\/([^/]+)\.json$/.exec(pathname);
      if (versionMatch?.[1] !== undefined) {
        const artifact = byVersion.get(decodeURIComponent(versionMatch[1]));
        if (artifact === undefined) {
          response.writeHead(404).end();
          return;
        }
        const clientPath = join(artifactRoot, artifact.path);
        const clientBytes = await readFile(clientPath);
        const mapping = [...fixtures.artifactById.values()].find(
          (candidate) =>
            candidate.coordinates === "net.minecraft:client:mappings@txt" &&
            candidate.version === artifact.version,
        );
        const downloads: Record<string, unknown> = {
          client: {
            url: `${base}/artifacts/${encodeURIComponent(artifact.path)}`,
            sha1: createHash("sha1").update(clientBytes).digest("hex"),
            size: clientBytes.byteLength,
          },
        };
        if (mapping !== undefined) {
          const mappingBytes = await readFile(join(artifactRoot, mapping.path));
          downloads.client_mappings = {
            url: `${base}/artifacts/${encodeURIComponent(mapping.path)}`,
            sha1: createHash("sha1").update(mappingBytes).digest("hex"),
            size: mappingBytes.byteLength,
          };
        }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ id: artifact.version, downloads }));
        return;
      }
      if (pathname.startsWith("/artifacts/")) {
        const artifactPath = decodeURIComponent(
          pathname.slice("/artifacts/".length),
        );
        const declared = [...fixtures.artifactById.values()].find(
          (candidate) => candidate.path === artifactPath,
        );
        if (declared === undefined || artifactPath !== declared.path) {
          response.writeHead(404).end();
          return;
        }
        response.setHeader("content-type", "application/octet-stream");
        response.end(await readFile(join(artifactRoot, declared.path)));
        return;
      }
      response.writeHead(404).end();
    } catch {
      response.writeHead(500).end();
    }
  });
  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
  return {
    url: `${base}/version-manifest.json`,
    close: () => {
      const closed = Promise.withResolvers<void>();
      server.close((error) =>
        error === undefined ? closed.resolve() : closed.reject(error),
      );
      return closed.promise;
    },
  };
}

async function ensureArtifact(
  artifact: Artifact,
  artifactRoot: string,
  network: Network,
  maximumDownloadBytes: number,
): Promise<string> {
  if (artifact.path.includes("..") || artifact.path.startsWith("/")) {
    throw new Error(`unsafe artifact path: ${artifact.path}`);
  }
  const path = join(artifactRoot, artifact.path);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    if (network === "offline") {
      throw Object.assign(
        new Error(`preseed required artifact in CI cache: ${artifact.id}`),
        { code: "artifact_unavailable" },
      );
    }
    let response = await fetch(artifact.url, {
      signal: AbortSignal.timeout(120_000),
      redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (
        location === null ||
        new URL(artifact.url).hostname !== "ldtteam.jfrog.io"
      ) {
        throw new Error(`unexpected redirect: ${artifact.id}`);
      }
      const target = new URL(location);
      if (
        target.protocol !== "https:" ||
        target.hostname !== "storage.googleapis.com"
      ) {
        throw new Error(`unexpected redirect: ${artifact.id}`);
      }
      response = await fetch(target, {
        signal: AbortSignal.timeout(120_000),
        redirect: "error",
      });
    }
    if (!response.ok) throw new Error(`download failed: ${artifact.id}`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > maximumDownloadBytes) {
      throw new Error(`download too large: ${artifact.id}`);
    }
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumDownloadBytes) {
      throw new Error(`download too large: ${artifact.id}`);
    }
    if (sha256(bytes) !== artifact.sha256) {
      throw new Error(`downloaded SHA-256 mismatch: ${artifact.id}`);
    }
    await mkdir(artifactRoot, { recursive: true });
    const temporary = `${path}.download-${process.pid}`;
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, path);
  }
  if (sha256(bytes) !== artifact.sha256) {
    throw new Error(`artifact SHA-256 mismatch: ${artifact.id}`);
  }
  return path;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface DeclaredZipEntry {
  name: string;
  data?: Uint8Array;
  declaredSize?: number;
}

function declaredStoredZip(entries: DeclaredZipEntry[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data ?? new Uint8Array());
    const declaredSize = entry.declaredSize ?? data.byteLength;
    const checksum = entry.declaredSize === undefined ? crc32(data) : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(declaredSize, 18);
    local.writeUInt32LE(declaredSize, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0x21, 12);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(declaredSize, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.byteLength + name.byteLength + data.byteLength;
  }
  const centralStart = offset;
  const centralBytes = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.byteLength, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...localParts, centralBytes, end]);
}

export interface GeneratedMaliciousArtifact extends Artifact {
  kind: string;
  expectedCode: string;
}

export async function materializeMaliciousArtifacts(
  root: string,
  fixtures: ArtifactFixtures,
): Promise<GeneratedMaliciousArtifact[]> {
  await mkdir(root, { recursive: true });
  const oversized = declaredStoredZip([
    { name: "Huge.class", declaredSize: 64 * 1024 * 1024 + 1 },
  ]);
  const bytes: Record<string, Uint8Array> = {
    traversal: zipSync({ "../outside.class": strToU8("escape") }),
    absolute: zipSync({ "/outside.class": strToU8("escape") }),
    "nested-oversize": zipSync({ "nested.jar": oversized }),
    "entry-oversize": oversized,
    "wrong-hash": zipSync({ "Wrong.class": strToU8("wrong") }),
  };
  const generated: GeneratedMaliciousArtifact[] = [];
  for (const fixture of fixtures.maliciousArtifacts) {
    const content = bytes[fixture.kind];
    if (content === undefined)
      throw new Error(`unknown malicious kind ${fixture.kind}`);
    const path = `${fixture.id}.jar`;
    await writeFile(join(root, path), content, { flag: "wx" });
    generated.push({
      id: fixture.id,
      kind: fixture.kind,
      expectedCode: fixture.expectedCode,
      path,
      root,
      coordinates: `voxellume.fixture:${fixture.kind}`,
      version: "1",
      sha256: fixture.kind === "wrong-hash" ? "0".repeat(64) : sha256(content),
      url: "https://fixtures.invalid/generated.jar",
    });
  }
  return generated;
}

function artifactRequest(artifact: Artifact) {
  return {
    coordinates: artifact.coordinates,
    version: artifact.version,
    sha256: artifact.sha256,
  };
}

function buildRequest(
  workspace: Workspace,
  operation: Operation,
  oracle: Oracle | undefined,
  workspacePath: string,
  artifactById: Map<string, Artifact>,
  workspaceById: Map<string, Workspace>,
): SourceRequest {
  const diff = oracle?.diff;
  const artifactId =
    operation === "diff_classes" && diff !== undefined
      ? diff.leftArtifactId
      : workspace.artifactId;
  const artifact = artifactById.get(artifactId);
  if (artifact === undefined) throw new Error(`unknown artifact ${artifactId}`);
  const request: SourceRequest = {
    operation,
    target: {
      minecraftVersion: workspace.minecraftVersion,
      loader: workspace.loader,
      mappings: { ...workspace.mappings },
    },
    artifactId,
    artifact: artifactRequest(artifact),
    className:
      operation === "diff_classes" && diff !== undefined
        ? diff.className
        : (workspace.className ??
          oracle?.className ??
          "voxellume.fixture.Missing26"),
    symbol: oracle?.mapping.from ?? "voxellume.fixture.Missing26",
    query: oracle?.search.query ?? "voxellume.fixture.Missing26",
    workspaceId: workspace.id,
    workspacePath,
  };
  if (operation === "map_symbol" && oracle !== undefined) {
    request.mapping = oracle.mapping.kind;
  }
  if (operation === "get_members" && oracle !== undefined) {
    request.memberName = oracle.member.name;
  }
  if (oracle?.patchedFromVanilla === true) {
    const runtime = artifactById.get(oracle.oracleArtifactId);
    if (runtime === undefined)
      throw new Error("unknown patched runtime artifact");
    request.runtimeArtifactId = runtime.id;
    request.runtimeArtifact = artifactRequest(runtime);
  }
  if (operation === "diff_classes" && diff !== undefined) {
    const right = artifactById.get(diff.rightArtifactId);
    if (right === undefined) throw new Error("unknown diff artifact");
    request.rightArtifactId = right.id;
    request.rightArtifact = artifactRequest(right);
    const rightWorkspace = [...workspaceById.values()].find(
      (candidate) => candidate.artifactId === right.id,
    );
    if (rightWorkspace !== undefined) {
      request.rightTarget = {
        minecraftVersion: rightWorkspace.minecraftVersion,
        loader: rightWorkspace.loader,
        mappings: { ...rightWorkspace.mappings },
      };
    }
    request.rightClassName = diff.className;
  }
  return request;
}

function valueRecord(result: SourceResult): Record<string, unknown> {
  return typeof result.value === "object" && result.value !== null
    ? (result.value as Record<string, unknown>)
    : {};
}

function compareResult(
  operation: Operation,
  result: SourceResult,
  expected: MatrixCase["expected"],
  oracle: Oracle | undefined,
  request: SourceRequest,
  artifactById: Map<string, Artifact>,
): string[] {
  const errors: string[] = [];
  if (result.status !== expected.status) {
    return [
      `expected ${expected.status}, received ${result.status}:${result.code ?? "no_code"}`,
    ];
  }
  if (expected.code !== undefined && result.code !== expected.code) {
    errors.push(
      `expected code ${expected.code}, received ${result.code ?? "none"}`,
    );
  }
  if (expected.status !== "ok") return errors;
  const value = valueRecord(result);
  if (operation === "resolve_artifact") {
    for (const field of ["coordinates", "version", "sha256"] as const) {
      if (value[field] !== request.artifact[field]) {
        errors.push(`artifact ${field} mismatch`);
      }
    }
    return errors;
  }
  if (oracle === undefined) return ["missing independent oracle"];
  if (operation === "find_class") {
    if (value.name !== oracle.className) errors.push("class name mismatch");
    const expectedArtifactSha256 =
      request.runtimeArtifact?.sha256 ?? request.artifact.sha256;
    if (value.artifactSha256 !== expectedArtifactSha256) {
      errors.push("class artifact identity mismatch");
    }
  } else if (operation === "get_members") {
    const members = Array.isArray(value.members) ? value.members : [];
    if (
      !members.some((member: unknown) => {
        const record =
          typeof member === "object" && member !== null
            ? (member as Record<string, unknown>)
            : {};
        return (
          record.name === oracle.member.name &&
          record.descriptor === oracle.member.descriptor
        );
      })
    ) {
      errors.push(`missing ${oracle.member.name}${oracle.member.descriptor}`);
    }
  } else if (operation === "map_symbol") {
    if (
      value.from !== oracle.mapping.from ||
      value.to !== oracle.mapping.to ||
      value.mapping !== oracle.mapping.kind
    ) {
      errors.push("mapping result mismatch");
    }
    if (
      request.target.minecraftVersion.startsWith("26.") &&
      /\b(yarn|intermediary)\b/i.test(JSON.stringify(value))
    ) {
      errors.push("fabricated 26.x mapping namespace");
    }
  } else if (operation === "read_source") {
    if (value.className !== oracle.className)
      errors.push("source class mismatch");
    if (
      typeof value.source !== "string" ||
      !value.source.includes(oracle.sourceSnippet)
    ) {
      errors.push("Vineflower source snippet mismatch");
    }
  } else if (operation === "search_source") {
    const matches = Array.isArray(value.matches) ? value.matches : [];
    const expectedText = oracle.search.mappedText ?? oracle.search.text;
    if (
      !matches.some((match: unknown) => {
        const record =
          typeof match === "object" && match !== null
            ? (match as Record<string, unknown>)
            : {};
        return (
          record.className === oracle.className &&
          record.line === oracle.search.line &&
          typeof record.text === "string" &&
          record.text.includes(expectedText)
        );
      })
    ) {
      errors.push("source search line mismatch");
    }
  } else if (operation === "diff_classes") {
    for (const field of ["added", "removed", "changed"] as const) {
      if (!isDeepStrictEqual(value[field], oracle.diff[field])) {
        errors.push(`class diff ${field} mismatch`);
      }
    }
    const left = artifactById.get(oracle.diff.leftArtifactId);
    const right = artifactById.get(oracle.diff.rightArtifactId);
    if (left === undefined || right === undefined) {
      errors.push("class diff artifact missing");
    }
  }
  return errors;
}

async function verifyWithIndependentTools(
  fixtures: LoadedFixtures,
  artifactRoot: string,
  oracleRoot: string,
  network: Network,
  operation: Operation,
  request: SourceRequest,
  oracle: Oracle | undefined,
  cache: Map<string, unknown>,
): Promise<void> {
  const artifactPath = async (id: string) => {
    const artifact = fixtures.artifactById.get(id);
    if (artifact === undefined)
      throw new Error(`unknown oracle artifact ${id}`);
    return ensureArtifact(
      artifact,
      artifactRoot,
      network,
      fixtures.artifacts.cache.maximumDownloadBytes,
    );
  };
  if (operation === "resolve_artifact") {
    await artifactPath(request.artifactId);
    return;
  }
  if (oracle === undefined) return;
  if (operation === "map_symbol") {
    if (oracle.mapping.kind === "none") {
      if (request.target.mappings.kind !== "none") {
        throw new Error("26.x target unexpectedly declares mappings");
      }
      return;
    }
    const mappingId = oracle.mapping.artifactId;
    if (mappingId === undefined)
      throw new Error("mapping oracle lacks artifact");
    const path = await artifactPath(mappingId);
    if (oracle.mapping.kind === "mojang") {
      const mappings = await readFile(path, "utf8");
      if (
        !mappings.includes(`${oracle.mapping.from} -> ${oracle.mapping.to}:`)
      ) {
        throw new Error("official mapping metadata mismatch");
      }
    }
    return;
  }
  if (operation === "diff_classes") {
    const key = `diff:${oracle.diff.leftArtifactId}:${oracle.diff.rightArtifactId}:${oracle.diff.className}`;
    if (!cache.has(key)) {
      const [leftPath, rightPath] = await Promise.all([
        artifactPath(oracle.diff.leftArtifactId),
        artifactPath(oracle.diff.rightArtifactId),
      ]);
      const [left, right] = await Promise.all([
        execFileAsync(
          "javap",
          ["-p", "-s", "-classpath", leftPath, oracle.diff.leftBinaryName],
          { encoding: "utf8", maxBuffer: 1024 * 1024 },
        ),
        execFileAsync(
          "javap",
          ["-p", "-s", "-classpath", rightPath, oracle.diff.rightBinaryName],
          { encoding: "utf8", maxBuffer: 1024 * 1024 },
        ),
      ]);
      if (
        oracle.diff.added.length === 0 &&
        oracle.diff.removed.length === 0 &&
        oracle.diff.changed.length === 0 &&
        left.stdout.replace(/^Compiled from.*$/m, "") !==
          right.stdout.replace(/^Compiled from.*$/m, "")
      ) {
        throw new Error("javap reports an unexpected class diff");
      }
      cache.set(key, true);
    }
    return;
  }

  const classJar = async (): Promise<string> => {
    const key = `jar:${oracle.oracleArtifactId}:${oracle.nestedEntry ?? ""}`;
    const cached = cache.get(key);
    if (typeof cached === "string") return cached;
    const path = await artifactPath(oracle.oracleArtifactId);
    if (oracle.nestedEntry === undefined) {
      cache.set(key, path);
      return path;
    }
    const outer = unzipSync(await readFile(path), {
      filter: (entry) => entry.name === oracle.nestedEntry,
    });
    const nested = outer[oracle.nestedEntry];
    if (nested === undefined || sha256(nested) !== oracle.nestedSha256) {
      throw new Error("nested artifact identity mismatch");
    }
    const nestedPath = join(
      oracleRoot,
      `${oracle.oracleArtifactId}-nested.jar`,
    );
    await writeFile(nestedPath, nested);
    cache.set(key, nestedPath);
    return nestedPath;
  };

  if (operation === "find_class" || operation === "get_members") {
    const output = await execFileAsync(
      "javap",
      ["-p", "-s", "-classpath", await classJar(), oracle.binaryName],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    if (operation === "get_members") {
      const lines = output.stdout.split("\n");
      const memberFound = lines.some(
        (line, index) =>
          line.trim() === `descriptor: ${oracle.member.binaryDescriptor}` &&
          index > 0 &&
          lines[index - 1]?.includes(oracle.member.binaryName) === true,
      );
      if (!memberFound) {
        throw new Error("javap member oracle mismatch");
      }
    }
    return;
  }
  if (operation !== "read_source" && operation !== "search_source") return;

  const sourceKey = `source:${oracle.oracleArtifactId}:${oracle.binaryName}`;
  let source = cache.get(sourceKey);
  if (typeof source !== "string") {
    const jarPath = await classJar();
    const jarBytes = unzipSync(await readFile(jarPath), {
      filter: (entry) =>
        entry.name === `${oracle.binaryName.replaceAll(".", "/")}.class`,
    });
    const classBytes =
      jarBytes[`${oracle.binaryName.replaceAll(".", "/")}.class`];
    if (classBytes === undefined)
      throw new Error("class entry missing from oracle JAR");
    const simpleName = oracle.binaryName.split(".").at(-1);
    if (simpleName === undefined) throw new Error("invalid binary class name");
    const work = join(oracleRoot, sha256(strToU8(sourceKey)));
    await mkdir(join(work, "out"), { recursive: true });
    const classPath = join(work, `${simpleName}.class`);
    await writeFile(classPath, classBytes);
    const vineflower = fixtures.artifactById.get(
      fixtures.artifacts.oracleTools.vineflower.artifactId,
    );
    if (vineflower === undefined) throw new Error("Vineflower pin missing");
    const vineflowerPath = await artifactPath(vineflower.id);
    await execFileAsync(
      "java",
      [
        "-jar",
        vineflowerPath,
        ...fixtures.artifacts.oracleTools.vineflower.arguments,
        classPath,
        join(work, "out"),
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    source = await readFile(join(work, "out", `${simpleName}.java`), "utf8");
    cache.set(sourceKey, source);
  }
  if (typeof source !== "string")
    throw new Error("source oracle was not materialized");
  if (!source.includes(oracle.binarySourceSnippet ?? oracle.sourceSnippet)) {
    throw new Error("pinned Vineflower source oracle mismatch");
  }
  if (operation === "search_source") {
    const line = source.split("\n")[oracle.search.line - 1];
    if (line === undefined || !line.includes(oracle.search.text)) {
      throw new Error("pinned Vineflower search oracle mismatch");
    }
  }
}

async function invokeAndCheck(
  fixtures: LoadedFixtures,
  workspace: Workspace,
  operation: Operation,
  workspacePath: string,
  invoke: NonNullable<BenchmarkDependencies["invoke"]>,
  verifyOracle: NonNullable<BenchmarkDependencies["verifyOracle"]>,
  network: Network,
  repeat: boolean,
): Promise<OperationResult> {
  const oracle =
    workspace.oracleId === undefined
      ? undefined
      : fixtures.artifacts.oracles[workspace.oracleId];
  const request = buildRequest(
    workspace,
    operation,
    oracle,
    workspacePath,
    fixtures.artifactById,
    fixtures.workspaceById,
  );
  const matrixCase: MatrixCase = {
    id: workspace.id,
    category: workspace.kind,
    workspaceId: workspace.id,
    operation,
    expected:
      workspace.id === "special-namespace-mismatch"
        ? { status: "not_found", code: "not_found" }
        : { status: "ok" },
  };
  const errors: string[] = [];
  try {
    await verifyOracle(operation, request, oracle);
  } catch (error) {
    errors.push(`independent oracle: ${errorMessage(error)}`);
  }
  const context = { offline: network === "offline" };
  const started = performance.now();
  const cold = await invoke(request, context);
  const durationMs = performance.now() - started;
  errors.push(
    ...compareResult(
      operation,
      cold,
      matrixCase.expected,
      oracle,
      request,
      fixtures.artifactById,
    ),
  );
  let warm: SourceResult | undefined;
  if (repeat) {
    warm = await invoke(request, context);
    if (!isDeepStrictEqual(cold, warm))
      errors.push("offline-warm result differs");
    errors.push(
      ...compareResult(
        operation,
        warm,
        matrixCase.expected,
        oracle,
        request,
        fixtures.artifactById,
      ).map((error) => `warm ${error}`),
    );
  }
  let falsePositives = 0;
  let patchedSourceFailures = 0;

  if (
    workspace.minecraftVersion.startsWith("26.") &&
    (operation === "find_class" || operation === "map_symbol")
  ) {
    const unknown = await invoke(
      {
        ...request,
        className: "voxellume.fixture.Missing26",
        symbol: "voxellume.fixture.Missing26",
      },
      context,
    );
    if (unknown.status !== "not_found") {
      falsePositives += 1;
      errors.push("unknown 26.x symbol did not return not_found");
    }
    if (operation === "map_symbol") {
      for (const mapping of ["yarn", "intermediary"]) {
        const fabricated = await invoke({ ...request, mapping }, context);
        if (fabricated.status !== "unsupported") {
          errors.push(`26.x accepted fabricated ${mapping} mapping`);
        }
      }
    }
  }

  if (operation === "read_source" && oracle?.patchedFromVanilla === true) {
    const vanillaArtifact = fixtures.artifactById.get(oracle.oracleArtifactId);
    if (vanillaArtifact === undefined) {
      errors.push("vanilla comparison artifact missing");
    } else {
      const vanilla = await invoke(
        {
          ...request,
          artifactId: vanillaArtifact.id,
          artifact: artifactRequest(vanillaArtifact),
        },
        context,
      );
      const loaderSource = valueRecord(cold).source;
      const vanillaSource = valueRecord(vanilla).source;
      if (
        vanilla.status !== "ok" ||
        typeof loaderSource !== "string" ||
        loaderSource === vanillaSource
      ) {
        patchedSourceFailures += 1;
        errors.push("patched loader source is not distinct from vanilla");
      }
    }
  }
  return {
    operation,
    status: errors.length === 0 ? "passed" : "failed",
    cold,
    ...(warm === undefined ? {} : { warm }),
    durationMs,
    errors,
    falsePositives,
    patchedSourceFailures,
  };
}

function categoryCounts(cases: MatrixCase[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of cases)
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
}

async function directoryBytes(path: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return 0;
    throw error;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(child);
    else if (entry.isFile()) total += (await readFile(child)).byteLength;
  }
  return total;
}

function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

export async function runBenchmark(
  options: CliOptions,
  dependencies: BenchmarkDependencies = {},
) {
  const fixtures = await loadFixtures();
  const temporaryRoot = await mkdtemp(join(tmpdir(), "voxellume-source-mcp-"));
  const artifactRoot =
    process.env[fixtures.artifacts.cache.rootEnv] ??
    resolve(fixtures.artifacts.cache.defaultRoot);
  const derivedRoot =
    options.derivedCache === "warm"
      ? (process.env.VOXELLUME_SOURCE_MCP_DERIVED_CACHE ??
        join(temporaryRoot, "derived"))
      : join(temporaryRoot, "empty-derived");
  const oracleRoot = join(temporaryRoot, "independent-oracles");
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(oracleRoot, { recursive: true });
  const workspacePaths = await materializeWorkspaces(temporaryRoot, fixtures);
  let dispose: (() => Promise<void>) | undefined;
  let closeVersionServer: (() => Promise<void>) | undefined;
  let candidateMetrics: (() => Promise<{ jvmRssBytes?: number }>) | undefined;
  let invoke = dependencies.invoke;
  const generatedMalicious: GeneratedMaliciousArtifact[] = [];
  try {
    if (options.suite === "security") {
      generatedMalicious.push(
        ...(await materializeMaliciousArtifacts(
          join(temporaryRoot, "malicious"),
          fixtures.artifacts,
        )),
      );
      for (const artifact of generatedMalicious) {
        fixtures.artifactById.set(artifact.id, artifact);
      }
    }
    if (invoke === undefined) {
      const candidateModuleUrl = new URL(
        `../../../src/core/sources/${options.candidate}-candidate.ts`,
        import.meta.url,
      ).href;
      // Runtime-selected optional pilots: static imports would load both candidates.
      let candidateModule: Record<string, unknown>;
      try {
        candidateModule = (await import(candidateModuleUrl)) as Record<
          string,
          unknown
        >;
      } catch (error) {
        throw Object.assign(
          new Error(
            `candidate adapter unavailable: ${options.candidate}: ${errorMessage(error)}`,
          ),
          { code: "candidate_adapter_unavailable", cause: error },
        );
      }
      const createCandidate = candidateModule.createCandidate;
      if (typeof createCandidate !== "function") {
        throw Object.assign(
          new Error("candidate lacks createCandidate export"),
          {
            code: "candidate_adapter_unavailable",
          },
        );
      }
      let versionManifestUrl: string | undefined;
      if (options.network === "offline") {
        const versionServer = await startVersionFixtureServer(
          artifactRoot,
          fixtures,
        );
        versionManifestUrl = versionServer.url;
        closeVersionServer = versionServer.close;
      }
      const vineflower = fixtures.artifactById.get(
        fixtures.artifacts.oracleTools.vineflower.artifactId,
      );
      if (vineflower === undefined)
        throw new Error("missing pinned Vineflower artifact");
      const candidate = await createCandidate({
        revision: options.revision,
        artifactRoot,
        derivedCacheRoot: derivedRoot,
        network: options.network,
        vineflowerJarPath: join(artifactRoot, vineflower.path),
        tinyRemapperJarPath: join(artifactRoot, "tiny-remapper-0.10.3-fat.jar"),
        versionManifestUrl,
      });
      if (typeof candidate.metrics === "function") {
        candidateMetrics = () => candidate.metrics();
      }
      for (const artifact of fixtures.artifactById.values()) {
        if (artifact.root === undefined) {
          await ensureArtifact(
            artifact,
            artifactRoot,
            options.network,
            fixtures.artifacts.cache.maximumDownloadBytes,
          );
        }
      }
      // Optional until the source facade is enabled; absence is a structured result.
      let facadeModule: Record<string, unknown>;
      try {
        facadeModule = (await import(
          new URL("../../../src/core/sources/source-facade.ts", import.meta.url)
            .href
        )) as Record<string, unknown>;
      } catch (error) {
        throw Object.assign(
          new Error(`source facade unavailable: ${errorMessage(error)}`),
          {
            code: "source_facade_unavailable",
            cause: error,
          },
        );
      }
      const createSourceFacade = facadeModule.createSourceFacade;
      if (typeof createSourceFacade !== "function") {
        throw Object.assign(new Error("source facade export missing"), {
          code: "source_facade_unavailable",
        });
      }
      const facade = await createSourceFacade({
        candidates: [candidate],
        artifacts: [...fixtures.artifactById.values()].map((artifact) => ({
          id: artifact.id,
          root: artifact.root ?? artifactRoot,
          path: artifact.path,
          coordinates: artifact.coordinates,
          version: artifact.version,
          sha256: artifact.sha256,
        })),
        limits: {
          artifactBytes: 512 * 1024 * 1024,
          archiveEntryBytes: 64 * 1024 * 1024,
          nestedEntryBytes: 64 * 1024 * 1024,
          responseBytes: 256 * 1024,
          sourceBytes: 64 * 1024,
          processLogBytes: 1024 * 1024,
        },
      });
      invoke = (request, context) =>
        facade.invoke(request, context) as Promise<SourceResult>;
      dispose = () => facade.dispose() as Promise<void>;
    }
    const verifiedInvoke = invoke;
    if (verifiedInvoke === undefined)
      throw new Error("benchmark invoker missing");
    const independentCache = new Map<string, unknown>();
    const verifyOracle =
      dependencies.verifyOracle ??
      ((
        operation: Operation,
        request: SourceRequest,
        oracle: Oracle | undefined,
      ) =>
        verifyWithIndependentTools(
          fixtures,
          artifactRoot,
          oracleRoot,
          options.network,
          operation,
          request,
          oracle,
          independentCache,
        ));

    if (options.suite === "security") {
      const cases: CaseResult[] = [];
      for (const artifact of generatedMalicious) {
        const workspace = mergedWorkspace(
          fixtures.workspaceById.get("fabric-1.21.1") as Workspace,
          fixtures.workspaceById,
        );
        const oracle = fixtures.artifacts.oracles[workspace.oracleId ?? ""];
        const base = buildRequest(
          workspace,
          "find_class",
          oracle,
          workspacePaths.get(workspace.id) ?? "",
          fixtures.artifactById,
          fixtures.workspaceById,
        );
        const result = await verifiedInvoke(
          {
            ...base,
            artifactId: artifact.id,
            artifact: artifactRequest(artifact),
          },
          { offline: options.network === "offline" },
        );
        const errors =
          result.status === "failed" && result.code === artifact.expectedCode
            ? []
            : [`expected failed:${artifact.expectedCode}`];
        cases.push({
          id: artifact.id,
          category: "malicious",
          status: errors.length === 0 ? "passed" : "failed",
          operations: [
            {
              operation: "find_class",
              status: errors.length === 0 ? "passed" : "failed",
              cold: result,
              durationMs: 0,
              errors,
              falsePositives: result.status === "ok" ? 1 : 0,
              patchedSourceFailures: 0,
            },
          ],
        });
      }
      const failed = cases.filter((entry) => entry.status === "failed").length;
      return {
        status: failed === 0 ? "passed" : "failed",
        suite: options.suite,
        candidate: options.candidate,
        revision: options.revision,
        network: options.network,
        total: cases.length,
        passed: cases.length - failed,
        failed,
        failedOperations: failed,
        falsePositives: cases.reduce(
          (sum, entry) =>
            sum +
            entry.operations.reduce(
              (inner, op) => inner + op.falsePositives,
              0,
            ),
          0,
        ),
        patchedSourceFailures: 0,
        cases,
      };
    }

    let selectedCases = fixtures.targets.cases;
    if (options.suite === "perf-cold") {
      selectedCases = selectedCases.filter(
        (entry) =>
          ["fabric-1.21.1", "fabric-26.3"].includes(entry.workspaceId) &&
          entry.operation !== undefined &&
          ["map_symbol", "read_source", "search_source"].includes(
            entry.operation,
          ),
      );
    } else if (options.suite === "perf-warm") {
      selectedCases = selectedCases.filter(
        (entry) =>
          entry.workspaceId === "fabric-26.3" && entry.operation !== undefined,
      );
    }
    if (options.caseFilter !== undefined) {
      selectedCases = selectedCases.filter(
        (entry) => entry.id === options.caseFilter,
      );
      if (selectedCases.length === 0)
        throw new Error(`unknown case: ${options.caseFilter}`);
    }

    const results: CaseResult[] = [];
    const durations: Partial<Record<Operation, number[]>> = {};
    if (options.suite === "perf-warm") {
      for (let index = 0; index < options.warmup; index += 1) {
        for (const entry of selectedCases) {
          const workspace = mergedWorkspace(
            fixtures.workspaceById.get(entry.workspaceId) as Workspace,
            fixtures.workspaceById,
          );
          await invokeAndCheck(
            fixtures,
            workspace,
            entry.operation as Operation,
            workspacePaths.get(workspace.id) ?? "",
            verifiedInvoke,
            verifyOracle,
            options.network,
            false,
          );
        }
      }
    }
    const repetitions = options.suite === "perf-warm" ? options.samples : 1;
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      for (const entry of selectedCases) {
        const workspace = mergedWorkspace(
          fixtures.workspaceById.get(entry.workspaceId) as Workspace,
          fixtures.workspaceById,
        );
        const operations = entry.operations ?? [entry.operation as Operation];
        const operationResults: OperationResult[] = [];
        for (const operation of operations) {
          const result = await invokeAndCheck(
            fixtures,
            workspace,
            operation,
            workspacePaths.get(workspace.id) ?? "",
            verifiedInvoke,
            verifyOracle,
            options.network,
            options.suite === "matrix",
          );
          operationResults.push(result);
          if (options.suite !== "matrix") {
            (durations[operation] ??= []).push(result.durationMs);
          }
        }
        if (options.suite !== "perf-warm" || repetition === 0) {
          results.push({
            id: entry.id,
            category: entry.category,
            status: operationResults.every((entry) => entry.status === "passed")
              ? "passed"
              : "failed",
            operations: operationResults,
          });
        } else if (
          operationResults.some((entry) => entry.status === "failed")
        ) {
          results[0]?.operations.push(...operationResults);
        }
      }
    }
    const failedOperations = results
      .flatMap((entry) => entry.operations)
      .filter((entry) => entry.status === "failed").length;
    const failedCases = results.filter(
      (entry) => entry.status === "failed",
    ).length;
    const thresholds: Partial<Record<Operation, number>> =
      options.suite === "perf-cold"
        ? { map_symbol: 30_000, read_source: 120_000, search_source: 180_000 }
        : {
            resolve_artifact: 750,
            find_class: 750,
            get_members: 750,
            map_symbol: 750,
            read_source: 750,
            search_source: 2_000,
            diff_classes: 5_000,
          };
    const performanceResults = Object.fromEntries(
      Object.entries(durations).map(([operation, values]) => {
        const p95 = percentile95(values ?? []);
        const limit = thresholds[operation as Operation];
        return [
          operation,
          {
            p95Ms: p95,
            limitMs: limit,
            passed: limit === undefined || p95 <= limit,
          },
        ];
      }),
    );
    const performanceFailed = Object.values(performanceResults).some(
      (entry) => !entry.passed,
    );
    const nodeRssBytes = process.memoryUsage().rss;
    const jvmRssBytes = (await candidateMetrics?.())?.jvmRssBytes;
    const derivedCacheBytes = await directoryBytes(derivedRoot);
    const resourceFailed =
      options.suite !== "matrix" &&
      (nodeRssBytes > 1024 * 1024 * 1024 ||
        jvmRssBytes === undefined ||
        jvmRssBytes > 4 * 1024 * 1024 * 1024 ||
        derivedCacheBytes > 2 * 1024 * 1024 * 1024);
    const falsePositives = results
      .flatMap((entry) => entry.operations)
      .reduce((sum, entry) => sum + entry.falsePositives, 0);
    const patchedSourceFailures = results
      .flatMap((entry) => entry.operations)
      .reduce((sum, entry) => sum + entry.patchedSourceFailures, 0);
    return {
      status:
        failedCases === 0 &&
        failedOperations === 0 &&
        !performanceFailed &&
        !resourceFailed &&
        falsePositives === 0 &&
        patchedSourceFailures === 0
          ? "passed"
          : "failed",
      suite: options.suite,
      candidate: options.candidate,
      revision: options.revision,
      network: options.network,
      total: selectedCases.length,
      passed: selectedCases.length - failedCases,
      failed: failedCases,
      failedOperations,
      falsePositives,
      patchedSourceFailures,
      categories: categoryCounts(selectedCases),
      cases: results,
      ...(options.suite === "matrix"
        ? {}
        : {
            performance: performanceResults,
            resources: {
              nodeRssBytes,
              nodeRssLimitBytes: 1024 * 1024 * 1024,
              jvmRssBytes: jvmRssBytes ?? null,
              jvmRssLimitBytes: 4 * 1024 * 1024 * 1024,
              derivedCacheBytes,
              derivedCacheLimitBytes: 2 * 1024 * 1024 * 1024,
            },
          }),
    };
  } finally {
    await dispose?.();
    await closeVersionServer?.();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const report = await runBenchmark(options);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "passed") process.exitCode = 1;
  } catch (error) {
    console.log(
      JSON.stringify({
        status: "failed",
        code: errorCode(error),
        detail: errorMessage(error),
        usage,
      }),
    );
    process.exitCode = 1;
  }
}
