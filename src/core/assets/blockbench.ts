import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  readAuthorizedFile,
  resolveAuthorizedPath,
  writeAuthorizedFile,
  type AuthorizedRoot,
} from "../execution/paths.ts";
import { publishStagedAssetSet, type AssetOutput } from "./mc-asset.ts";
import { AssetError } from "./png.ts";

export const BLOCKBENCH_MCP_REVISION =
  "97a8a80d3a37bf95c5e136d93d2c7da399fff753" as const;
export const BLOCKBENCH_MCP_VERSION = "1.10.1" as const;

export type BlockbenchProjectFormat = "java_block_item" | "modded_entity";

export interface BlockbenchTool {
  readonly executable: string;
  readonly entryPoint: string;
  readonly sha256: string;
  readonly revision: "97a8a80d3a37bf95c5e136d93d2c7da399fff753";
  readonly version: "1.10.1";
}

export interface BlockbenchExportResult {
  readonly status:
    "passed" | "failed" | "timed_out" | "cancelled" | "unavailable";
  readonly checkClass: "source";
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly outputs: readonly AssetOutput[];
  readonly provenance: {
    readonly generationRoute: "blockbench";
    readonly projectFormat: BlockbenchProjectFormat;
    readonly applicationVersion: string;
    readonly pluginRevision: "97a8a80d3a37bf95c5e136d93d2c7da399fff753";
    readonly pluginVersion: "1.10.1";
    readonly exportSettings: Readonly<Record<string, unknown>>;
    readonly riskyEval: false;
    readonly desktopHost: "127.0.0.1";
  };
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: { readonly code: string; readonly detail: string };
}

function hasCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}

async function validateDestination(
  root: AuthorizedRoot,
  path: string,
): Promise<void> {
  try {
    await resolveAuthorizedPath(root, path);
  } catch (error) {
    if (hasCode(error, "missing_parent")) return;
    throw error;
  }
}

interface Observation {
  readonly status:
    "passed" | "failed" | "timed_out" | "cancelled" | "unavailable";
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: { readonly code: string; readonly detail: string };
}

async function callHeadless(options: {
  readonly tool: BlockbenchTool;
  readonly cwd: string;
  readonly toolName:
    "bbmodel_export_java_block" | "bbmodel_export_modded_entity";
  readonly exportSettings: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}): Promise<Observation> {
  if (options.signal?.aborted)
    return { status: "cancelled", stdout: "", stderr: "" };
  const darwinSandbox =
    process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
  // -Urn supplies namespace-local capability; --net alone requires host CAP_SYS_ADMIN.
  const linuxSandbox =
    process.platform === "linux" && existsSync("/usr/bin/unshare");
  if (!darwinSandbox && !linuxSandbox) {
    return {
      status: "unavailable",
      stdout: "",
      stderr: "",
      error: {
        code: "network_sandbox_unavailable",
        detail: "No approved network-denial backend is available",
      },
    };
  }
  const executable = darwinSandbox
    ? "/usr/bin/sandbox-exec"
    : "/usr/bin/unshare";
  const output =
    options.toolName === "bbmodel_export_java_block"
      ? "export.json"
      : "export.java";
  const request = JSON.stringify({
    ...options.exportSettings,
    file: "source.bbmodel",
    output,
  });
  const args = [
    options.tool.entryPoint,
    "--root",
    options.cwd,
    options.toolName,
    request,
  ];
  const argv = darwinSandbox
    ? [
        "-p",
        "(version 1)(allow default)(deny network-outbound)",
        options.tool.executable,
        ...args,
      ]
    : ["-Urn", "--", options.tool.executable, ...args];
  const { promise, resolve } = Promise.withResolvers<Observation>();
  const child = spawn(executable, argv, {
    cwd: options.cwd,
    shell: false,
    detached: process.platform !== "win32",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: join(options.cwd, "home"),
      TMPDIR: join(options.cwd, "tmp"),
      BLOCKBENCH_MCP_HOST: "127.0.0.1",
      BLOCKBENCH_MCP_RISKY_EVAL: "false",
      blockbench_mcp_allow_scripts: "false",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let logBytes = 0;
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
      logBytes += chunk.byteLength;
      if (logBytes > 1024 * 1024) {
        flooded = true;
        kill();
      } else if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    });
  };
  collect(child.stdout!, "stdout");
  collect(child.stderr!, "stderr");
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, options.timeoutMs);
  const abort = () => {
    cancelled = true;
    kill();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  child.once("error", (error) => {
    spawnError = error;
  });
  child.once("close", (code) => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    if (timedOut) return resolve({ status: "timed_out", stdout, stderr });
    if (cancelled) return resolve({ status: "cancelled", stdout, stderr });
    if (flooded)
      return resolve({
        status: "failed",
        stdout,
        stderr,
        error: {
          code: "output_limit_exceeded",
          detail: "Blockbench logs exceeded 1 MiB",
        },
      });
    if (spawnError !== undefined)
      return resolve({
        status: "unavailable",
        stdout,
        stderr,
        error: {
          code: "process_spawn_unavailable",
          detail: spawnError.message,
        },
      });
    resolve({
      status: code === 0 ? "passed" : "failed",
      stdout,
      stderr,
      ...(code === 0
        ? {}
        : {
            error: {
              code: "blockbench_export_failed",
              detail: `Blockbench exited with ${code}`,
            },
          }),
    });
  });
  return promise;
}

export interface BlockbenchExportOptions {
  readonly root: AuthorizedRoot;
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly projectFormat: BlockbenchProjectFormat;
  readonly applicationVersion: string;
  readonly exportSettings?: Readonly<Record<string, unknown>>;
  readonly riskyEval?: false;
  readonly desktopHost?: "127.0.0.1";
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export type BlockbenchExporter = (
  options: BlockbenchExportOptions,
) => Promise<BlockbenchExportResult>;

async function exportBlockbenchAssetWithTool(
  tool: BlockbenchTool,
  options: BlockbenchExportOptions,
): Promise<BlockbenchExportResult> {
  if (options.root.kind !== "transactionStaging") {
    throw new AssetError(
      "read_only_root",
      "Blockbench exports require transaction staging",
    );
  }
  if (
    tool.revision !== BLOCKBENCH_MCP_REVISION ||
    tool.version !== BLOCKBENCH_MCP_VERSION
  ) {
    throw new AssetError(
      "unsupported_tool_revision",
      "Blockbench engine must use the exact pinned revision",
    );
  }
  if (options.riskyEval !== false && options.riskyEval !== undefined) {
    throw new AssetError(
      "risky_eval_forbidden",
      "Blockbench risky_eval must remain disabled",
    );
  }
  if (
    options.desktopHost !== undefined &&
    options.desktopHost !== "127.0.0.1"
  ) {
    throw new AssetError(
      "non_loopback_forbidden",
      "Blockbench desktop access is loopback-only",
    );
  }
  if (
    options.projectFormat !== "java_block_item" &&
    options.projectFormat !== "modded_entity"
  ) {
    throw new AssetError(
      "incompatible_asset_format",
      "Unknown Blockbench project format",
    );
  }
  const exportSettings = options.exportSettings ?? {};
  const allowedSettings =
    options.projectFormat === "java_block_item"
      ? new Set(["version", "export_groups", "export_pivots", "credit"])
      : new Set(["template", "model_name", "entity_class", "flip_y"]);
  if (Object.keys(exportSettings).some((key) => !allowedSettings.has(key))) {
    throw new AssetError(
      "invalid_export_settings",
      "Unknown Blockbench export setting",
    );
  }
  await validateDestination(options.root, options.outputPath);
  const resolvedSource = await resolveAuthorizedPath(
    options.root,
    options.sourcePath,
  );
  const sourceBefore = await stat(resolvedSource);
  if (!sourceBefore.isFile())
    throw new AssetError("not_regular_file", "Blockbench source is not a file");
  if (sourceBefore.nlink !== 1) {
    throw new AssetError(
      "hardlink_forbidden",
      "Hard-linked Blockbench sources are forbidden",
    );
  }
  if (sourceBefore.size > 16 * 1024 * 1024) {
    throw new AssetError("input_too_large", "Blockbench source exceeds 16 MiB");
  }
  const source = await readAuthorizedFile(options.root, options.sourcePath);
  if (source.stat.nlink !== 1) {
    throw new AssetError(
      "hardlink_forbidden",
      "Hard-linked Blockbench sources are forbidden",
    );
  }
  if (source.contents.byteLength > 16 * 1024 * 1024) {
    throw new AssetError("input_too_large", "Blockbench source exceeds 16 MiB");
  }
  let document: { readonly meta?: { readonly model_format?: unknown } };
  try {
    document = JSON.parse(source.contents.toString("utf8")) as typeof document;
  } catch (error) {
    throw new AssetError(
      "invalid_bbmodel",
      `Invalid .bbmodel JSON: ${String(error)}`,
    );
  }
  const actualFormat = document.meta?.model_format;
  const expectedFormat =
    options.projectFormat === "java_block_item"
      ? "java_block"
      : "modded_entity";
  if (actualFormat !== undefined && actualFormat !== expectedFormat) {
    throw new AssetError(
      "incompatible_asset_format",
      "Blockbench project format does not match the requested export route",
    );
  }
  const toolHash = createHash("sha256")
    .update(await readFile(tool.entryPoint))
    .digest("hex");
  if (toolHash !== tool.sha256) {
    throw new AssetError(
      "tool_hash_mismatch",
      "Blockbench entry point hash does not match host approval",
    );
  }

  const stageName = `.voxellume-blockbench-${process.pid}-${randomUUID()}`;
  const stagePath = join(options.root.realPath, stageName);
  await mkdir(stagePath, { mode: 0o700 });
  await Promise.all([
    mkdir(join(stagePath, "home")),
    mkdir(join(stagePath, "tmp")),
  ]);
  try {
    await writeAuthorizedFile(options.root, {
      path: `${stageName}/source.bbmodel`,
      contents: source.contents,
      expectedRevision: null,
    });
    const observation = await callHeadless({
      tool: tool,
      cwd: stagePath,
      toolName:
        options.projectFormat === "java_block_item"
          ? "bbmodel_export_java_block"
          : "bbmodel_export_modded_entity",
      exportSettings,
      timeoutMs: options.timeoutMs ?? 60_000,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const sourceSha256 = createHash("sha256")
      .update(source.contents)
      .digest("hex");
    const provenance = {
      generationRoute: "blockbench" as const,
      projectFormat: options.projectFormat,
      applicationVersion: options.applicationVersion,
      pluginRevision: BLOCKBENCH_MCP_REVISION,
      pluginVersion: BLOCKBENCH_MCP_VERSION,
      exportSettings: options.exportSettings ?? {},
      riskyEval: false as const,
      desktopHost: "127.0.0.1" as const,
    };
    if (observation.status !== "passed") {
      return {
        ...observation,
        checkClass: "source",
        sourcePath: options.sourcePath,
        sourceSha256,
        outputs: [],
        provenance,
      };
    }
    const extension =
      options.projectFormat === "java_block_item" ? "json" : "java";
    const stagedPath = `${stageName}/export.${extension}`;
    const exportedBefore = await stat(
      await resolveAuthorizedPath(options.root, stagedPath),
    );
    if (exportedBefore.size > 16 * 1024 * 1024) {
      throw new AssetError(
        "output_too_large",
        "Blockbench export exceeds 16 MiB",
      );
    }
    const exported = await readAuthorizedFile(options.root, stagedPath);
    if (options.projectFormat === "java_block_item")
      JSON.parse(exported.contents.toString("utf8"));
    else if (exported.contents.includes(0))
      throw new AssetError("invalid_java", "Exported Java contains NUL");
    const published = await publishStagedAssetSet({
      staging: options.root,
      publication: options.root,
      files: [{ stagedPath, outputPath: options.outputPath }],
      limits: {
        fileBytes: 16 * 1024 * 1024,
        totalBytes: 16 * 1024 * 1024,
        files: 1,
      },
    });
    return {
      ...observation,
      checkClass: "source",
      sourcePath: options.sourcePath,
      sourceSha256,
      outputs: published.outputs,
      provenance,
    };
  } finally {
    await rm(stagePath, { recursive: true, force: true });
  }
}

export function createBlockbenchExporter(
  hostApprovedTool: BlockbenchTool,
): BlockbenchExporter {
  const approved = Object.freeze({ ...hostApprovedTool });
  return (options) => exportBlockbenchAssetWithTool(approved, options);
}
