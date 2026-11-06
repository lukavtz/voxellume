import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";

import {
  readAuthorizedFile,
  resolveAuthorizedPath,
  writeAuthorizedFile,
  type AuthorizedRoot,
} from "../execution/paths.ts";
import { AssetError, inspectPng } from "./png.ts";

export const MC_ASSET_REVISION =
  "bedf67229ab0fdf304f6d40bc0000a27bd05e880" as const;
export const MC_ASSET_VERSION = "0.5.0" as const;
export const MC_ASSET_CLI_SHA256 =
  "2a82e605666ee0200dd63b1b3fa6e7774b4c69bd446e2f84cb311dbefc21b86f" as const;
export const MC_ASSET_DIST_SHA256 =
  "7bd753bc61d47d7317d17356366f6deae9b9bd48eee69a3899c8580a676844c3" as const;

const DEFAULT_LIMITS = Object.freeze({
  inputBytes: 16 * 1024 * 1024,
  outputBytes: 16 * 1024 * 1024,
  outputFiles: 4,
  logBytes: 1024 * 1024,
  timeoutMs: 60_000,
});

export interface McAssetTool {
  readonly entryPoint: string;
  readonly sha256: string;
  readonly distSha256?: string;
  readonly revision: "bedf67229ab0fdf304f6d40bc0000a27bd05e880";
}

export type McAssetOperation =
  | {
      readonly kind: "generate";
      readonly pattern: string;
      readonly size: number;
      readonly palette: string;
      readonly seed: number;
      readonly output: { readonly png: string; readonly source: string };
    }
  | {
      readonly kind: "render" | "build";
      readonly input: string;
      readonly output: { readonly png: string; readonly source: string };
    }
  | {
      readonly kind: "pixelize";
      readonly input: string;
      readonly size: number;
      readonly preset: string;
      readonly output: { readonly png: string; readonly source: string };
    }
  | {
      readonly kind: "quantize";
      readonly input: string;
      readonly colors: number;
      readonly output: { readonly png: string; readonly source: string };
    }
  | {
      readonly kind: "cleanup";
      readonly input: string;
      readonly fix: readonly string[];
      readonly allowRenderPassChange?: boolean;
      readonly output: { readonly png: string; readonly source: string };
    }
  | {
      readonly kind: "tile";
      readonly input: string;
      readonly preview: string;
      readonly output: { readonly png: string };
    }
  | {
      readonly kind: "animateSweep";
      readonly input: string;
      readonly angle: number;
      readonly frameCount: number;
      readonly frameTimeTicks: number;
      readonly interpolate: boolean;
      readonly output: { readonly png: string; readonly mcmeta: string };
    };

export interface McAssetLimits {
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly outputFiles: number;
  readonly logBytes: number;
  readonly timeoutMs: number;
}

export interface AssetOutput {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface McAssetExecutionOptions {
  readonly root: AuthorizedRoot;
  readonly operation: McAssetOperation;
  readonly limits?: Partial<McAssetLimits>;
  readonly signal?: AbortSignal;
}

export type McAssetExecutor = (
  options: McAssetExecutionOptions,
) => Promise<McAssetResult>;

export interface McAssetResult {
  readonly status:
    "passed" | "failed" | "timed_out" | "cancelled" | "unavailable";
  readonly checkClass: "source";
  readonly tool: {
    readonly revision: "bedf67229ab0fdf304f6d40bc0000a27bd05e880";
    readonly version: typeof MC_ASSET_VERSION;
    readonly sha256: string;
  };
  readonly operation: McAssetOperation["kind"];
  readonly executed: {
    readonly argv: readonly string[];
    readonly shell: false;
  } | null;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly outputs: readonly AssetOutput[];
  readonly error?: { readonly code: string; readonly detail: string };
}

export interface StagedAssetFile {
  readonly stagedPath: string;
  readonly outputPath: string;
}

export interface PublishStagedAssetSetOptions {
  readonly staging: AuthorizedRoot;
  readonly publication: AuthorizedRoot;
  readonly files: readonly StagedAssetFile[];
  readonly limits: {
    readonly fileBytes: number;
    readonly totalBytes: number;
    readonly files: number;
  };
  readonly hooks?: {
    readonly beforeRead?: () => void | Promise<void>;
    readonly beforePublish?: () => void | Promise<void>;
  };
}

function hasCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function computeMcAssetDistSha256(root: string): Promise<string> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory)) {
      const path = join(directory, entry);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        throw new AssetError(
          "tool_hash_mismatch",
          `mc-asset dist contains a symlink: ${path}`,
        );
      }
      if (metadata.isDirectory()) await walk(path);
      else if (metadata.isFile()) files.push(path);
      else
        throw new AssetError(
          "tool_hash_mismatch",
          `mc-asset dist contains a non-regular file: ${path}`,
        );
    }
  };
  await walk(root);
  files.sort((left, right) => {
    const leftName = relative(root, left).split(sep).join("/");
    const rightName = relative(root, right).split(sep).join("/");
    return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
  });
  const hash = createHash("sha256");
  for (const path of files) {
    const name = relative(root, path).split(sep).join("/");
    const contents = await readFile(path);
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(contents.byteLength));
    hash.update(name);
    hash.update(Buffer.from([0]));
    hash.update(size);
    hash.update(contents);
  }
  return hash.digest("hex");
}

export async function assertMcAssetDistSha256(
  root: string,
  expectedSha256: string,
): Promise<void> {
  const actual = await computeMcAssetDistSha256(root);
  if (actual !== expectedSha256) {
    throw new AssetError(
      "tool_hash_mismatch",
      `mc-asset dist hash ${actual} does not match approved ${expectedSha256}`,
    );
  }
}

async function installedMcAssetTool(): Promise<McAssetTool> {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("mc-asset/package.json");
  const metadata = JSON.parse(await readFile(packagePath, "utf8")) as {
    readonly version?: string;
    readonly gitHead?: string;
    readonly bin?: { readonly "mc-asset"?: string };
  };
  const entryPoint = metadata.bin?.["mc-asset"];
  if (metadata.version !== MC_ASSET_VERSION || entryPoint === undefined) {
    throw new AssetError(
      "unsupported_tool_version",
      "Installed mc-asset version or bin is not pinned",
    );
  }
  if (
    metadata.gitHead !== undefined &&
    metadata.gitHead !== MC_ASSET_REVISION
  ) {
    throw new AssetError(
      "unsupported_tool_revision",
      "Installed mc-asset gitHead is not pinned",
    );
  }
  const executable = join(dirname(packagePath), entryPoint);
  const executableSha256 = sha256(await readFile(executable));
  if (executableSha256 !== MC_ASSET_CLI_SHA256) {
    throw new AssetError(
      "tool_hash_mismatch",
      "Installed mc-asset CLI hash is not host-approved",
    );
  }
  return {
    entryPoint: executable,
    sha256: executableSha256,
    distSha256: MC_ASSET_DIST_SHA256,
    revision: MC_ASSET_REVISION,
  };
}

async function ensureParent(root: AuthorizedRoot, path: string): Promise<void> {
  const parent = dirname(path);
  if (parent === ".") return;
  let current = "";
  for (const part of parent.split("/")) {
    current = current.length === 0 ? part : `${current}/${part}`;
    const resolved = await resolveAuthorizedPath(root, current);
    try {
      await mkdir(resolved);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
  }
}

async function validateOutputPath(
  root: AuthorizedRoot,
  path: string,
): Promise<void> {
  try {
    await resolveAuthorizedPath(root, path);
  } catch (error) {
    if (hasCode(error, "missing_parent")) return;
    throw error;
  }
  try {
    const existing = await readAuthorizedFile(root, path);
    if (existing.stat.nlink !== 1) {
      throw new AssetError(
        "hardlink_forbidden",
        `Hard-linked output is forbidden: ${path}`,
      );
    }
    throw new AssetError("revision_conflict", `Output already exists: ${path}`);
  } catch (error) {
    if (hasCode(error, "not_found") || hasCode(error, "missing_parent")) return;
    if (hasCode(error, "hard_linked_file")) {
      throw new AssetError(
        "hardlink_forbidden",
        `Hard-linked output is forbidden: ${path}`,
      );
    }
    throw error;
  }
}

async function readBoundedFile(
  root: AuthorizedRoot,
  path: string,
  maxBytes: number,
): Promise<Buffer> {
  const resolved = await resolveAuthorizedPath(root, path);
  const before = await stat(resolved);
  if (!before.isFile())
    throw new AssetError("not_regular_file", `Not a file: ${path}`);
  if (before.nlink !== 1) {
    throw new AssetError(
      "hardlink_forbidden",
      `Hard-linked file is forbidden: ${path}`,
    );
  }
  if (before.size > maxBytes)
    throw new AssetError("input_too_large", `Input exceeds ${maxBytes} bytes`);
  const file = await readAuthorizedFile(root, path);
  if (file.stat.nlink !== 1) {
    throw new AssetError(
      "hardlink_forbidden",
      `Hard-linked file is forbidden: ${path}`,
    );
  }
  if (file.contents.byteLength > maxBytes) {
    throw new AssetError("input_too_large", `Input exceeds ${maxBytes} bytes`);
  }
  return file.contents;
}

async function removeStagedFile(
  root: AuthorizedRoot,
  path: string,
): Promise<void> {
  try {
    await unlink(await resolveAuthorizedPath(root, path));
  } catch (error) {
    if (!hasCode(error, "not_found") && !hasCode(error, "ENOENT")) throw error;
  }
}

async function directorySnapshot(root: string): Promise<Map<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const snapshot = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(entry.parentPath, entry.name);
    const identity = await stat(path);
    snapshot.set(`${identity.dev}:${identity.ino}`, path);
  }
  return snapshot;
}

export async function publishStagedAssetSet(
  options: PublishStagedAssetSetOptions,
): Promise<{ readonly outputs: readonly AssetOutput[] }> {
  if (
    options.staging.kind !== "transactionStaging" ||
    options.publication.kind !== "transactionStaging"
  ) {
    throw new AssetError(
      "read_only_root",
      "Asset publication requires transaction staging roots",
    );
  }
  for (const limit of Object.values(options.limits)) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new AssetError(
        "invalid_output_limits",
        "Output limits must be finite positive safe integers",
      );
    }
  }
  if (options.files.length > options.limits.files) {
    throw new AssetError("output_file_limit", "Too many output files");
  }
  const stagedPaths = new Set<string>();
  const outputPaths = new Set<string>();
  for (const file of options.files) {
    if (stagedPaths.has(file.stagedPath) || outputPaths.has(file.outputPath)) {
      throw new AssetError(
        "invalid_output_set",
        "Duplicate staged or output path",
      );
    }
    stagedPaths.add(file.stagedPath);
    outputPaths.add(file.outputPath);
  }

  const loaded: {
    readonly file: StagedAssetFile;
    readonly contents: Buffer;
  }[] = [];
  let totalBytes = 0;
  let cleanupRequired = false;
  const cleanup = async () => {
    for (const file of options.files)
      await removeStagedFile(options.staging, file.stagedPath);
    const parents = new Set(
      options.files.map((file) => dirname(file.stagedPath)),
    );
    for (const parent of parents) {
      if (parent === ".") continue;
      try {
        await rmdir(await resolveAuthorizedPath(options.staging, parent));
      } catch (error) {
        if (
          !hasCode(error, "ENOTEMPTY") &&
          !hasCode(error, "ENOENT") &&
          !hasCode(error, "not_found")
        )
          throw error;
      }
    }
  };
  try {
    for (const file of options.files) {
      await validateOutputPath(options.publication, file.outputPath);
      const resolved = await resolveAuthorizedPath(
        options.staging,
        file.stagedPath,
      );
      const before = await stat(resolved);
      if (!before.isFile())
        throw new AssetError(
          "not_regular_file",
          `Not a file: ${file.stagedPath}`,
        );
      if (before.nlink !== 1) {
        throw new AssetError(
          "hardlink_forbidden",
          `Hard-linked output is forbidden: ${file.stagedPath}`,
        );
      }
      if (before.size > options.limits.fileBytes) {
        throw new AssetError(
          "output_too_large",
          `Output exceeds ${options.limits.fileBytes} bytes`,
        );
      }
      await options.hooks?.beforeRead?.();
      const stagedFile = await readAuthorizedFile(
        options.staging,
        file.stagedPath,
      );
      if (stagedFile.stat.nlink !== 1) {
        throw new AssetError(
          "hardlink_forbidden",
          `Hard-linked output is forbidden: ${file.stagedPath}`,
        );
      }
      const contents = stagedFile.contents;
      if (contents.byteLength > options.limits.fileBytes) {
        throw new AssetError(
          "output_too_large",
          `Output exceeds ${options.limits.fileBytes} bytes`,
        );
      }
      totalBytes += contents.byteLength;
      if (totalBytes > options.limits.totalBytes) {
        throw new AssetError(
          "output_too_large",
          `Output set exceeds ${options.limits.totalBytes} bytes`,
        );
      }
      loaded.push({ file, contents });
    }

    for (const { file } of loaded)
      await ensureParent(options.publication, file.outputPath);
    const parents = new Map<
      string,
      { readonly dev: number; readonly ino: number }
    >();
    for (const { file } of loaded) {
      const resolved = await resolveAuthorizedPath(
        options.publication,
        file.outputPath,
      );
      const parent = dirname(resolved);
      const identity = await stat(parent);
      parents.set(parent, { dev: identity.dev, ino: identity.ino });
    }
    let journalRoot = "";
    let journal = new Map<string, string>();
    if (options.hooks?.beforePublish !== undefined) {
      let common = options.publication.realPath;
      while (
        options.staging.realPath !== common &&
        !options.staging.realPath.startsWith(`${common}/`)
      ) {
        common = dirname(common);
      }
      journalRoot = dirname(common);
      journal = await directorySnapshot(journalRoot);
    }
    cleanupRequired = true;
    await options.hooks?.beforePublish?.();
    for (const [parent, identity] of parents) {
      const current = await stat(parent);
      if (current.dev !== identity.dev || current.ino !== identity.ino) {
        const replacementOrigin = journal.get(`${current.dev}:${current.ino}`);
        if (replacementOrigin !== undefined) {
          await cp(parent, replacementOrigin, {
            recursive: true,
            force: false,
            errorOnExist: true,
          });
        }
        throw new AssetError(
          "path_swap",
          "Output parent changed before publication",
        );
      }
    }

    const published: StagedAssetFile[] = [];
    try {
      for (const { file, contents } of loaded) {
        await writeAuthorizedFile(options.publication, {
          path: file.outputPath,
          contents,
          expectedRevision: null,
        });
        published.push(file);
      }
    } catch (error) {
      for (const file of published.reverse()) {
        try {
          await unlink(
            await resolveAuthorizedPath(options.publication, file.outputPath),
          );
        } catch (rollbackError) {
          throw new AssetError(
            "publication_rollback_failed",
            `Publication failed and rollback was incomplete: ${String(rollbackError)}`,
          );
        }
      }
      throw error;
    }
    const outputs = loaded.map(({ file, contents }) => ({
      path: file.outputPath,
      sha256: sha256(contents),
      bytes: contents.byteLength,
    }));
    await cleanup();
    return { outputs };
  } catch (error) {
    if (cleanupRequired) await cleanup();
    throw error;
  }
}

function integer(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AssetError(
      "invalid_operation",
      `${name} must be an integer in ${minimum}..${maximum}`,
    );
  }
}

function token(value: string, name: string): void {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(value)) {
    throw new AssetError(
      "invalid_operation",
      `${name} is not an allowlisted token`,
    );
  }
}

function outputPaths(operation: McAssetOperation): string[] {
  return Object.values(operation.output);
}

function validateOperation(operation: McAssetOperation): void {
  if (
    operation === null ||
    typeof operation !== "object" ||
    !("kind" in operation)
  ) {
    throw new AssetError(
      "unsupported_operation",
      "Only typed mc-asset operations are supported",
    );
  }
  switch (operation.kind) {
    case "generate":
      token(operation.pattern, "pattern");
      token(operation.palette, "palette");
      integer(operation.size, "size", 1, 4096);
      integer(operation.seed, "seed", 0, 0x7fffffff);
      break;
    case "pixelize":
      token(operation.preset, "preset");
      integer(operation.size, "size", 1, 4096);
      break;
    case "quantize":
      integer(operation.colors, "colors", 1, 256);
      break;
    case "cleanup": {
      const allowed = new Set([
        "isolated",
        "noise",
        "cluster",
        "fringe",
        "outlier",
      ]);
      if (
        operation.fix.length === 0 ||
        operation.fix.some((fix) => !allowed.has(fix))
      ) {
        throw new AssetError("invalid_operation", "Unsupported cleanup class");
      }
      break;
    }
    case "tile":
      if (!/^[1-9][0-9]?x[1-9][0-9]?$/.test(operation.preview)) {
        throw new AssetError(
          "invalid_operation",
          "Invalid tile preview dimensions",
        );
      }
      break;
    case "animateSweep":
      if (
        !Number.isFinite(operation.angle) ||
        operation.angle < -360 ||
        operation.angle > 360
      ) {
        throw new AssetError(
          "invalid_operation",
          "Animation angle is out of range",
        );
      }
      integer(operation.frameCount, "frameCount", 1, 256);
      integer(operation.frameTimeTicks, "frameTimeTicks", 1, 1000);
      if (typeof operation.interpolate !== "boolean") {
        throw new AssetError(
          "invalid_operation",
          "Interpolation must be explicit",
        );
      }
      break;
    case "render":
    case "build":
      break;
    default:
      throw new AssetError(
        "unsupported_operation",
        "Only typed mc-asset operations are supported",
      );
  }
}

interface ProcessObservation {
  readonly status:
    "passed" | "failed" | "timed_out" | "cancelled" | "unavailable";
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: { readonly code: string; readonly detail: string };
}

interface ProcessCommand {
  readonly executable: string;
  readonly argv: readonly string[];
}

function mcAssetCommand(
  tool: McAssetTool,
  args: readonly string[],
): ProcessCommand | null {
  if (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec")) {
    return {
      executable: "/usr/bin/sandbox-exec",
      argv: [
        "-p",
        "(version 1)(allow default)(deny network-outbound)",
        process.execPath,
        tool.entryPoint,
        ...args,
      ],
    };
  }
  if (process.platform === "linux" && existsSync("/usr/bin/unshare")) {
    return {
      executable: "/usr/bin/unshare",
      argv: ["--net", "--", process.execPath, tool.entryPoint, ...args],
    };
  }
  return null;
}

async function executeMcAsset(
  command: ProcessCommand | null,
  cwd: string,
  limits: McAssetLimits,
  signal?: AbortSignal,
): Promise<ProcessObservation> {
  if (signal?.aborted) {
    return { status: "cancelled", exitCode: null, stdout: "", stderr: "" };
  }
  if (command === null) {
    return {
      status: "unavailable",
      exitCode: null,
      stdout: "",
      stderr: "",
      error: {
        code: "network_sandbox_unavailable",
        detail: "No approved network-denial backend is available",
      },
    };
  }
  const { promise, resolve } = Promise.withResolvers<ProcessObservation>();
  const child = spawn(command.executable, command.argv, {
    cwd,
    shell: false,
    detached: process.platform !== "win32",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: join(cwd, "home"),
      TMPDIR: join(cwd, "tmp"),
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let timedOut = false;
  let cancelled = false;
  let flooded = false;
  let spawnError: Error | undefined;
  const kill = () => {
    if (child.pid === undefined) return;
    if (process.platform === "win32") child.kill();
    else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  };
  const collect = (
    stream: NodeJS.ReadableStream,
    target: "stdout" | "stderr",
  ) => {
    stream.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > limits.logBytes) {
        flooded = true;
        kill();
        return;
      }
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    });
  };
  collect(child.stdout!, "stdout");
  collect(child.stderr!, "stderr");
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, limits.timeoutMs);
  const abort = () => {
    cancelled = true;
    kill();
  };
  signal?.addEventListener("abort", abort, { once: true });
  child.once("error", (error) => {
    spawnError = error;
  });
  child.once("close", (code) => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (timedOut)
      return resolve({ status: "timed_out", exitCode: code, stdout, stderr });
    if (cancelled)
      return resolve({ status: "cancelled", exitCode: code, stdout, stderr });
    if (flooded)
      return resolve({
        status: "failed",
        exitCode: code,
        stdout,
        stderr,
        error: {
          code: "output_limit_exceeded",
          detail: "mc-asset logs exceeded the configured limit",
        },
      });
    if (spawnError !== undefined)
      return resolve({
        status: "unavailable",
        exitCode: code,
        stdout,
        stderr,
        error: {
          code: "process_spawn_unavailable",
          detail: spawnError.message,
        },
      });
    resolve({
      status: code === 0 ? "passed" : "failed",
      exitCode: code,
      stdout,
      stderr,
      ...(code === 0
        ? {}
        : {
            error: {
              code: "mc_asset_failed",
              detail: `mc-asset exited with ${code}`,
            },
          }),
    });
  });
  return promise;
}

async function runMcAssetWithTool(
  tool: McAssetTool,
  options: McAssetExecutionOptions,
): Promise<McAssetResult> {
  if (options.root.kind !== "transactionStaging") {
    throw new AssetError(
      "read_only_root",
      "mc-asset requires transaction staging",
    );
  }
  const operation = options.operation;
  validateOperation(operation);
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const [name, value] of Object.entries(limits))
    integer(value, name, 1, 2 * 1024 ** 3);
  for (const output of outputPaths(operation))
    await validateOutputPath(options.root, output);

  let input: { readonly path: string; readonly contents: Buffer } | undefined;
  if ("input" in operation) {
    input = {
      path: operation.input,
      contents: await readBoundedFile(
        options.root,
        operation.input,
        limits.inputBytes,
      ),
    };
    if (operation.kind !== "render" && operation.kind !== "build")
      inspectPng(input.contents);
  }
  if (tool.revision !== MC_ASSET_REVISION) {
    throw new AssetError(
      "unsupported_tool_revision",
      "mc-asset must use the exact pinned revision",
    );
  }
  const toolBytes = await readFile(tool.entryPoint);
  const toolHash = sha256(toolBytes);
  if (toolHash !== tool.sha256) {
    throw new AssetError(
      "tool_hash_mismatch",
      "mc-asset entry point hash does not match host approval",
    );
  }
  const distPath = join(dirname(dirname(tool.entryPoint)), "dist");
  if (existsSync(distPath)) {
    if (!/^[a-f0-9]{64}$/.test(tool.distSha256 ?? "")) {
      throw new AssetError(
        "tool_hash_mismatch",
        "mc-asset adjacent dist requires an exact SHA-256 host approval",
      );
    }
    await assertMcAssetDistSha256(distPath, tool.distSha256!);
  }

  const stageName = `.voxellume-mc-asset-${process.pid}-${randomUUID()}`;
  const stagePath = join(options.root.realPath, stageName);
  await mkdir(stagePath, { mode: 0o700 });
  await Promise.all([
    mkdir(join(stagePath, "home")),
    mkdir(join(stagePath, "tmp")),
  ]);
  const staged = (name: string) => join(stagePath, name);
  const args: string[] = [];
  let expected: {
    readonly stagedPath: string;
    readonly outputPath: string;
    readonly png: boolean;
  }[] = [];
  try {
    const inputName =
      operation.kind === "render"
        ? "input.grid"
        : operation.kind === "build"
          ? "input.mcpx"
          : "input.png";
    if (input !== undefined) {
      await writeAuthorizedFile(options.root, {
        path: `${stageName}/${inputName}`,
        contents: input.contents,
        expectedRevision: null,
      });
    }
    const inputArg = input === undefined ? "" : staged(inputName);
    const outputPng = staged("output.png");
    const outputSource = staged("output.mcpx");
    const outputMcmeta = staged("output.png.mcmeta");
    switch (operation.kind) {
      case "generate":
        args.push(
          "generate",
          operation.pattern,
          "--size",
          String(operation.size),
          "--palette",
          operation.palette,
          "--seed",
          String(operation.seed),
          "--output",
          outputPng,
          "--source",
          outputSource,
        );
        break;
      case "render":
      case "build":
        args.push(
          operation.kind,
          inputArg,
          "--output",
          outputPng,
          "--source",
          outputSource,
        );
        break;
      case "pixelize":
        args.push(
          "pixelize",
          inputArg,
          "--size",
          String(operation.size),
          "--preset",
          operation.preset,
          "--output",
          outputPng,
          "--source",
          outputSource,
        );
        break;
      case "quantize":
        args.push(
          "quantize",
          inputArg,
          "--colors",
          String(operation.colors),
          "--output",
          outputPng,
          "--source",
          outputSource,
        );
        break;
      case "cleanup":
        args.push("cleanup", inputArg, "--fix", operation.fix.join(","));
        if (operation.allowRenderPassChange === true)
          args.push("--allow-render-pass-change");
        args.push("--output", outputPng, "--source", outputSource);
        break;
      case "tile":
        args.push(
          "tile",
          inputArg,
          "--edge-match",
          "both",
          "--preview",
          operation.preview,
          "--output",
          outputPng,
        );
        break;
      case "animateSweep":
        args.push(
          "animate",
          "sweep",
          inputArg,
          "--angle",
          String(operation.angle),
          "--frames",
          String(operation.frameCount),
          "--frametime",
          String(operation.frameTimeTicks),
        );
        if (operation.interpolate) args.push("--interpolate");
        args.push("--output", outputPng, "--output-mcmeta", outputMcmeta);
        break;
    }
    args.push("--json");
    expected =
      "png" in operation.output && "source" in operation.output
        ? [
            {
              stagedPath: `${stageName}/output.png`,
              outputPath: operation.output.png,
              png: true,
            },
            {
              stagedPath: `${stageName}/output.mcpx`,
              outputPath: operation.output.source,
              png: false,
            },
          ]
        : operation.kind === "animateSweep"
          ? [
              {
                stagedPath: `${stageName}/output.png`,
                outputPath: operation.output.png,
                png: true,
              },
              {
                stagedPath: `${stageName}/output.png.mcmeta`,
                outputPath: operation.output.mcmeta,
                png: false,
              },
            ]
          : [
              {
                stagedPath: `${stageName}/output.png`,
                outputPath: operation.output.png,
                png: true,
              },
            ];

    const command = mcAssetCommand(tool, args);
    const observation = await executeMcAsset(
      command,
      stagePath,
      limits,
      options.signal,
    );
    const base = {
      checkClass: "source" as const,
      tool: {
        revision: MC_ASSET_REVISION,
        version: MC_ASSET_VERSION,
        sha256: toolHash,
      },
      operation: operation.kind,
      executed:
        command === null
          ? null
          : {
              argv: [command.executable, ...command.argv],
              shell: false as const,
            },
      outputs: [],
    };
    if (observation.status !== "passed") return { ...base, ...observation };
    for (const output of expected) {
      const bytes = await readBoundedFile(
        options.root,
        output.stagedPath,
        limits.outputBytes,
      );
      if (output.png) inspectPng(bytes);
      else if (output.stagedPath.endsWith(".mcmeta"))
        JSON.parse(bytes.toString("utf8"));
    }
    const published = await publishStagedAssetSet({
      staging: options.root,
      publication: options.root,
      files: expected,
      limits: {
        fileBytes: limits.outputBytes,
        totalBytes: limits.outputBytes,
        files: limits.outputFiles,
      },
    });
    return { ...base, ...observation, outputs: published.outputs };
  } finally {
    await rm(stagePath, { recursive: true, force: true });
  }
}

export async function runMcAsset(
  options: McAssetExecutionOptions,
): Promise<McAssetResult> {
  return runMcAssetWithTool(await installedMcAssetTool(), options);
}

export function createMcAssetExecutor(
  hostApprovedTool: McAssetTool,
): McAssetExecutor {
  const approved = Object.freeze({ ...hostApprovedTool });
  return (options) => runMcAssetWithTool(approved, options);
}
