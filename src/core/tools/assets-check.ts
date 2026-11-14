import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { posix } from "node:path";

import { AssetError, PNG_DEFAULT_LIMITS, inspectPng } from "../assets/png.ts";
import { extractPlaceholders, flattenLang } from "../assets/lang.ts";
import { compareVisualBaseline } from "../assets/visual-diff.ts";
import { isPathEscape, resolveInsideRoot } from "../fs-guard.ts";
import { fail, ok, type ToolResult } from "../results.ts";

export interface AssetsCheckRequest {
  readonly projectRoot: string;
  readonly textures?: readonly string[];
  readonly models?: readonly string[];
  readonly lang?: {
    readonly baseline: string;
    readonly compare: readonly string[];
    readonly requiredKeys?: readonly string[];
  };
  readonly diff?: {
    readonly baseline: string;
    readonly baselineSha256: string;
    readonly capture: string;
    readonly threshold: number;
    readonly maxDifferentPixels: number;
  };
}

export interface Finding {
  readonly code: string;
  readonly detail: string;
}

export interface AssetEntry {
  readonly path: string;
  readonly status: "ok" | "failed";
  readonly findings: readonly Finding[];
}

export interface AssetsCheckResult {
  readonly textures: readonly AssetEntry[];
  readonly models: readonly AssetEntry[];
  readonly lang: readonly Finding[];
  readonly diff: {
    readonly differentPixels: number;
    readonly status: "ok" | "failed";
  } | null;
}

const TEXTURE_SPEC = /^(.*)::(\d{1,4})x(\d{1,4})$/;

const PNG_CODE_MAP: Record<string, string> = {
  invalid_png: "png_invalid",
  invalid_dimensions: "png_invalid",
  input_too_large: "png_too_large",
  pixel_limit_exceeded: "png_too_large",
  dimension_limit_exceeded: "png_too_large",
  visual_dimension_mismatch: "dimension_mismatch",
  invalid_visual_threshold: "invalid_request",
  invalid_visual_budget: "invalid_request",
  invalid_png_limits: "invalid_request",
};

/** Translate a decoder error code into the tool's documented code. */
function mapPngError(error: AssetError): string {
  return PNG_CODE_MAP[error.code] ?? error.code;
}

async function readBounded(path: string): Promise<Buffer> {
  const info = await stat(path);
  if (!info.isFile())
    throw new AssetError("file_missing", `${path} is not a file`);
  if (info.size > PNG_DEFAULT_LIMITS.maxBytes) {
    throw new AssetError("png_too_large", `${path} exceeds the byte limit`);
  }
  return readFile(path);
}

interface TextureExpectation {
  readonly relative: string;
  readonly width?: number;
  readonly height?: number;
}

function parseTextureEntry(entry: string): TextureExpectation {
  const match = TEXTURE_SPEC.exec(entry);
  if (match?.[2] === undefined || match[3] === undefined)
    return { relative: entry };
  return {
    relative: match[1] ?? entry,
    width: Number(match[2]),
    height: Number(match[3]),
  };
}

function dimensionFinding(
  expectation: TextureExpectation,
  width: number,
  height: number,
): Finding | undefined {
  if (expectation.width === undefined || expectation.height === undefined)
    return undefined;
  if (width === expectation.width && height === expectation.height)
    return undefined;
  return {
    code: "dimension_mismatch",
    detail: `expected ${expectation.width}x${expectation.height}, got ${width}x${height}`,
  };
}

async function checkTexture(
  projectRoot: string,
  entry: string,
): Promise<AssetEntry> {
  const expectation = parseTextureEntry(entry);
  try {
    const absolute = await resolveInsideRoot(projectRoot, expectation.relative);
    const image = inspectPng(await readBounded(absolute));
    const finding = dimensionFinding(expectation, image.width, image.height);
    return finding === undefined
      ? { path: entry, status: "ok", findings: [] }
      : { path: entry, status: "failed", findings: [finding] };
  } catch (error) {
    if (isPathEscape(error)) throw error;
    if (error instanceof AssetError) {
      return {
        path: entry,
        status: "failed",
        findings: [{ code: mapPngError(error), detail: error.message }],
      };
    }
    return {
      path: entry,
      status: "failed",
      findings: [{ code: "file_missing", detail: (error as Error).message }],
    };
  }
}

async function textureExists(
  projectRoot: string,
  namespace: string,
  texturePath: string,
): Promise<boolean> {
  const relative = posix.join(
    "src",
    "main",
    "resources",
    "assets",
    namespace,
    "textures",
    `${texturePath}.png`,
  );
  try {
    const absolute = await resolveInsideRoot(projectRoot, relative);
    return await stat(absolute).then(
      (info) => info.isFile(),
      () => false,
    );
  } catch (error) {
    if (isPathEscape(error)) return false;
    throw error;
  }
}

async function modelTextureFinding(
  projectRoot: string,
  key: string,
  value: string,
): Promise<Finding | undefined> {
  if (value.startsWith("minecraft:")) return undefined;
  const separator = value.indexOf(":");
  if (separator <= 0) {
    return {
      code: "model_texture_missing",
      detail: `${key}=${value} has no namespace`,
    };
  }
  const namespace = value.slice(0, separator);
  const texturePath = value.slice(separator + 1);
  if (await textureExists(projectRoot, namespace, texturePath))
    return undefined;
  return { code: "model_texture_missing", detail: `${key}=${value}` };
}

async function checkModel(
  projectRoot: string,
  entry: string,
): Promise<AssetEntry> {
  const findings: Finding[] = [];
  try {
    const absolute = await resolveInsideRoot(projectRoot, entry);
    const parsed = JSON.parse(await readFile(absolute, "utf8")) as {
      textures?: Record<string, unknown>;
    };
    for (const [key, value] of Object.entries(parsed.textures ?? {})) {
      if (typeof value !== "string") continue;
      const finding = await modelTextureFinding(projectRoot, key, value);
      if (finding !== undefined) findings.push(finding);
    }
  } catch (error) {
    if (isPathEscape(error)) throw error;
    const code = error instanceof SyntaxError ? "json_invalid" : "file_missing";
    return {
      path: entry,
      status: "failed",
      findings: [{ code, detail: (error as Error).message }],
    };
  }
  return {
    path: entry,
    status: findings.length === 0 ? "ok" : "failed",
    findings,
  };
}

async function readLang(
  projectRoot: string,
  entry: string,
): Promise<Map<string, string>> {
  try {
    const absolute = await resolveInsideRoot(projectRoot, entry);
    const parsed: unknown = JSON.parse(await readFile(absolute, "utf8"));
    return flattenLang(parsed);
  } catch (error) {
    if (error instanceof AssetError) throw error;
    const code = error instanceof SyntaxError ? "json_invalid" : "file_missing";
    throw new AssetError(code, `${entry}: ${(error as Error).message}`);
  }
}

async function checkLang(
  request: NonNullable<AssetsCheckRequest["lang"]>,
  projectRoot: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const baseline = await readLang(projectRoot, request.baseline);
  for (const key of request.requiredKeys ?? []) {
    if (!baseline.has(key))
      findings.push({ code: "lang_key_missing", detail: key });
  }
  for (const locale of request.compare) {
    const other = await readLang(projectRoot, locale);
    for (const [key, value] of baseline) {
      const translated = other.get(key);
      if (translated === undefined) {
        findings.push({
          code: "lang_key_missing",
          detail: `${locale}: ${key}`,
        });
        continue;
      }
      if (
        extractPlaceholders(value).join("\0") !==
        extractPlaceholders(translated).join("\0")
      ) {
        findings.push({
          code: "lang_placeholder_mismatch",
          detail: `${locale}: ${key}`,
        });
      }
    }
  }
  return findings;
}

async function checkDiff(
  request: NonNullable<AssetsCheckRequest["diff"]>,
  projectRoot: string,
): Promise<{
  readonly differentPixels: number;
  readonly status: "ok" | "failed";
}> {
  const baseline = await readBounded(
    await resolveInsideRoot(projectRoot, request.baseline),
  );
  const digest = createHash("sha256").update(baseline).digest("hex");
  if (digest !== request.baselineSha256) {
    throw new AssetError(
      "baseline_hash_mismatch",
      `baseline sha256 is ${digest}, expected ${request.baselineSha256}`,
    );
  }
  const capture = await readBounded(
    await resolveInsideRoot(projectRoot, request.capture),
  );
  const compared = compareVisualBaseline({
    baseline: inspectPng(baseline),
    actual: inspectPng(capture),
    threshold: request.threshold,
    maxDifferentPixels: request.maxDifferentPixels,
  });
  return {
    differentPixels: compared.differentPixels,
    status: compared.status === "passed" ? "ok" : "failed",
  };
}

async function mapEntries(
  entries: readonly string[],
  check: (entry: string) => Promise<AssetEntry>,
): Promise<AssetEntry[]> {
  const results: AssetEntry[] = [];
  for (const entry of entries) results.push(await check(entry));
  return results;
}

export async function checkAssets(
  request: AssetsCheckRequest,
  options: { readonly cwd: string },
): Promise<ToolResult<AssetsCheckResult>> {
  try {
    if (
      typeof request.projectRoot !== "string" ||
      request.projectRoot.trim() === ""
    ) {
      throw new AssetError(
        "invalid_request",
        "projectRoot must be a non-empty string",
      );
    }
    const projectRoot = await resolveInsideRoot(
      options.cwd,
      request.projectRoot,
    );
    const textures = await mapEntries(request.textures ?? [], (entry) =>
      checkTexture(projectRoot, entry),
    );
    const models = await mapEntries(request.models ?? [], (entry) =>
      checkModel(projectRoot, entry),
    );
    const lang =
      request.lang === undefined
        ? []
        : await checkLang(request.lang, projectRoot);
    const diff =
      request.diff === undefined
        ? null
        : await checkDiff(request.diff, projectRoot);
    return ok({ textures, models, lang, diff });
  } catch (error) {
    if (error instanceof AssetError) {
      return fail(mapPngError(error), error.message);
    }
    throw error;
  }
}
