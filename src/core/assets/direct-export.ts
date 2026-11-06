import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

import {
  readAuthorizedFile,
  resolveAuthorizedPath,
  writeAuthorizedFile,
  type AuthorizedRoot,
} from "../execution/paths.ts";
import { AssetError, inspectPng } from "./png.ts";

const DIRECT_INPUT_CAP = 16 * 1024 * 1024;

export type DirectAssetRoute = "json" | "png" | "java";
export type AssetProjectFormat = "java_block_item" | "modded_entity";

export interface DirectManifestEntry {
  readonly assetId: string;
  readonly generationRoute: `direct_${DirectAssetRoute}`;
  readonly sourcePath: string;
  readonly exportPath: string;
  readonly sourceSha256: string;
  readonly exportSha256: string;
  readonly targetPackId: string;
  readonly targetPackRevision: string;
}

export interface DirectExportResult {
  readonly status: "passed";
  readonly checkClass: "source";
  readonly manifestEntry: DirectManifestEntry;
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hasCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}

async function readSource(root: AuthorizedRoot, path: string): Promise<Buffer> {
  const resolved = await resolveAuthorizedPath(root, path);
  const before = await stat(resolved);
  if (!before.isFile())
    throw new AssetError("not_regular_file", `Not a file: ${path}`);
  if (before.nlink !== 1) {
    throw new AssetError(
      "hardlink_forbidden",
      `Hard-linked source is forbidden: ${path}`,
    );
  }
  if (before.size > DIRECT_INPUT_CAP) {
    throw new AssetError(
      "input_too_large",
      `Source exceeds ${DIRECT_INPUT_CAP} bytes`,
    );
  }
  const source = await readAuthorizedFile(root, path);
  if (source.stat.nlink !== 1) {
    throw new AssetError(
      "hardlink_forbidden",
      `Hard-linked source is forbidden: ${path}`,
    );
  }
  if (source.contents.byteLength > DIRECT_INPUT_CAP) {
    throw new AssetError(
      "input_too_large",
      `Source exceeds ${DIRECT_INPUT_CAP} bytes`,
    );
  }
  return source.contents;
}

async function ensureParent(root: AuthorizedRoot, path: string): Promise<void> {
  const parent = dirname(path);
  if (parent === ".") return;
  const parts = parent.split("/");
  let current = "";
  for (const part of parts) {
    current = current.length === 0 ? part : `${current}/${part}`;
    const resolved = await resolveAuthorizedPath(root, current);
    await mkdir(resolved, { recursive: false }).catch((error: unknown) => {
      if (!hasCode(error, "EEXIST")) throw error;
    });
  }
}

async function assertNewOutput(
  root: AuthorizedRoot,
  path: string,
): Promise<void> {
  await resolveAuthorizedPath(root, path).catch((error: unknown) => {
    if (hasCode(error, "missing_parent")) return;
    throw error;
  });
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
    throw error;
  }
}

export async function exportDirectAsset(options: {
  readonly root: AuthorizedRoot;
  readonly assetId: string;
  readonly route: DirectAssetRoute;
  readonly sourceFormat?: AssetProjectFormat;
  readonly outputFormat?: AssetProjectFormat;
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly targetPackId: string;
  readonly targetPackRevision: string;
}): Promise<DirectExportResult> {
  if (options.root.kind !== "transactionStaging") {
    throw new AssetError(
      "read_only_root",
      "Direct exports require transaction staging",
    );
  }
  if (
    !options.assetId ||
    !options.targetPackId ||
    !options.targetPackRevision
  ) {
    throw new AssetError(
      "invalid_asset_identity",
      "Asset and target identities are required",
    );
  }
  const sourceFormat =
    options.sourceFormat ??
    (options.route === "java" ? "modded_entity" : "java_block_item");
  const outputFormat = options.outputFormat ?? sourceFormat;
  if (sourceFormat !== outputFormat) {
    throw new AssetError(
      "incompatible_asset_format",
      "Java Block/Item and Modded Entity assets are not interchangeable",
    );
  }

  const source = await readSource(options.root, options.sourcePath);
  if (options.route === "json") {
    try {
      JSON.parse(source.toString("utf8"));
    } catch (error) {
      throw new AssetError(
        "invalid_json",
        `Direct JSON source is invalid: ${String(error)}`,
      );
    }
  } else if (options.route === "png") {
    inspectPng(source);
  } else if (source.includes(0)) {
    throw new AssetError("invalid_java", "Java source contains a NUL byte");
  }

  await assertNewOutput(options.root, options.outputPath);
  await ensureParent(options.root, options.outputPath);
  try {
    await writeAuthorizedFile(options.root, {
      path: options.outputPath,
      contents: source,
      expectedRevision: null,
    });
  } catch (error) {
    if (hasCode(error, "hard_linked_file")) {
      throw new AssetError(
        "hardlink_forbidden",
        `Hard-linked output is forbidden: ${options.outputPath}`,
      );
    }
    throw error;
  }
  const digest = hash(source);
  return {
    status: "passed",
    checkClass: "source",
    manifestEntry: {
      assetId: options.assetId,
      generationRoute: `direct_${options.route}`,
      sourcePath: options.sourcePath,
      exportPath: options.outputPath,
      sourceSha256: digest,
      exportSha256: digest,
      targetPackId: options.targetPackId,
      targetPackRevision: options.targetPackRevision,
    },
  };
}
