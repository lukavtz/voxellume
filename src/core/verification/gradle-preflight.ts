import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { assertNetworkApproved } from "../execution/approvals.ts";
import {
  NativeDirFdError,
  closeRoot,
  openRoot,
  readRootFile,
  statRootFile,
  writeRootFileAtomic,
  type NativeRoot,
} from "../execution/fs-at.ts";
import type { TargetGradle, TargetPack } from "../targets/target-pack.ts";

const MAX_DISTRIBUTION_BYTES = 512 * 1024 * 1024;
const DEFAULT_ARCHIVE_LIMITS = {
  maxEntries: 10_000,
  maxEntryUncompressedBytes: 512 * 1024 * 1024,
  maxTotalUncompressedBytes: 2 * 1024 * 1024 * 1024,
  maxCompressionRatio: 1_000,
} as const;

export interface GradleArchiveLimits {
  readonly maxEntries: number;
  readonly maxEntryUncompressedBytes: number;
  readonly maxTotalUncompressedBytes: number;
  readonly maxCompressionRatio: number;
}

export interface GradlePreflightOptions {
  readonly target: Pick<TargetPack, "gradle">;
  readonly projectRoot: string;
  readonly cacheRoot: string;
  readonly configRoot?: string;
  readonly cacheIdentity: string;
  readonly mode: "offline" | "cold";
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly archiveLimits?: GradleArchiveLimits;
}

export interface GradlePreflightResult {
  readonly status: "passed" | "failed" | "unavailable" | "cancelled";
  readonly code: string;
  readonly networkUsed: boolean;
  readonly wrapperJarSha256: string | null;
  readonly distributionSha256: string | null;
  readonly distributionPath: string | null;
}

function result(
  status: GradlePreflightResult["status"],
  code: string,
  overrides: Partial<GradlePreflightResult> = {},
): GradlePreflightResult {
  return {
    status,
    code,
    networkUsed: false,
    wrapperJarSha256: null,
    distributionSha256: null,
    distributionPath: null,
    ...overrides,
  };
}

class PreflightFailure extends Error {
  readonly code: string;
  readonly distributionSha256: string | undefined;

  constructor(code: string, distributionSha256?: string) {
    super(code);
    this.code = code;
    this.distributionSha256 = distributionSha256;
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function isCancellation(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function closeQuietly(root: NativeRoot): void {
  try {
    closeRoot(root);
  } catch {
    // Preserve the preflight result; closing a pinned descriptor is best effort.
  }
}

function validArchiveLimits(limits: GradleArchiveLimits): boolean {
  return (
    Number.isSafeInteger(limits.maxEntries) &&
    limits.maxEntries >= 0 &&
    Number.isSafeInteger(limits.maxEntryUncompressedBytes) &&
    limits.maxEntryUncompressedBytes >= 0 &&
    Number.isSafeInteger(limits.maxTotalUncompressedBytes) &&
    limits.maxTotalUncompressedBytes >= 0 &&
    Number.isFinite(limits.maxCompressionRatio) &&
    limits.maxCompressionRatio >= 0
  );
}

const archiveDecoder = new TextDecoder("utf-8", { fatal: true });

function unsafeArchivePath(name: string): boolean {
  if (
    name.length === 0 ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name)
  ) {
    return true;
  }
  const parts = name.split("/");
  return parts.some(
    (part, index) =>
      part === ".." ||
      part === "." ||
      (part === "" && index !== parts.length - 1),
  );
}

function assertSafeDistribution(
  bytes: Buffer,
  limits: GradleArchiveLimits,
): void {
  if (bytes.byteLength < 22) throw new PreflightFailure("invalid_archive");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  const firstPossibleEnd = Math.max(0, bytes.byteLength - 22 - 65_535);
  for (
    let offset = bytes.byteLength - 22;
    offset >= firstPossibleEnd;
    offset -= 1
  ) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.byteLength
    ) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new PreflightFailure("invalid_archive");
  if (
    view.getUint16(endOffset + 4, true) !== 0 ||
    view.getUint16(endOffset + 6, true) !== 0 ||
    view.getUint16(endOffset + 8, true) !== view.getUint16(endOffset + 10, true)
  ) {
    throw new PreflightFailure("invalid_archive");
  }

  const count = view.getUint16(endOffset + 10, true);
  if (count === 0) throw new PreflightFailure("invalid_archive");
  if (count > limits.maxEntries) {
    throw new PreflightFailure("archive_entry_count_limit");
  }
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (
    centralSize > 64 * 1024 * 1024 ||
    centralOffset + centralSize !== endOffset
  ) {
    throw new PreflightFailure("invalid_archive");
  }

  const names = new Set<string>();
  const localOffsets = new Set<number>();
  let declaredTotalUncompressedBytes = 0;
  let actualTotalUncompressedBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (
      cursor + 46 > endOffset ||
      view.getUint32(cursor, true) !== 0x02014b50
    ) {
      throw new PreflightFailure("invalid_archive");
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const next =
      cursor +
      46 +
      nameLength +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
    if (next > endOffset || (view.getUint16(cursor + 8, true) & 9) !== 0) {
      throw new PreflightFailure("invalid_archive");
    }
    let name: string;
    try {
      name = archiveDecoder.decode(
        bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      );
    } catch {
      throw new PreflightFailure("invalid_archive");
    }
    if (unsafeArchivePath(name)) {
      throw new PreflightFailure("archive_unsafe_path");
    }
    if (names.has(name)) throw new PreflightFailure("invalid_archive");
    names.add(name);
    if (/\.(zip|jar)$/i.test(name)) {
      throw new PreflightFailure("nested_archive_forbidden");
    }

    const fileType = (view.getUint32(cursor + 38, true) >>> 16) & 0xf000;
    if (fileType === 0xa000) {
      throw new PreflightFailure("archive_symlink_forbidden");
    }
    const localOffset = view.getUint32(cursor + 42, true);
    if (
      localOffset === 0xffffffff ||
      localOffset >= centralOffset ||
      localOffsets.has(localOffset)
    ) {
      throw new PreflightFailure("archive_hardlink_forbidden");
    }
    localOffsets.add(localOffset);

    const compressedSize = view.getUint32(cursor + 20, true);
    const originalSize = view.getUint32(cursor + 24, true);
    const method = view.getUint16(cursor + 10, true);
    if (
      compressedSize === 0xffffffff ||
      originalSize === 0xffffffff ||
      (method !== 0 && method !== 8)
    ) {
      throw new PreflightFailure("invalid_archive");
    }
    if (
      localOffset + 30 > centralOffset ||
      view.getUint32(localOffset, true) !== 0x04034b50
    ) {
      throw new PreflightFailure("invalid_archive");
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localDataStart =
      localOffset +
      30 +
      localNameLength +
      view.getUint16(localOffset + 28, true);
    if (
      localDataStart > centralOffset ||
      localDataStart + compressedSize > centralOffset
    ) {
      throw new PreflightFailure("invalid_archive");
    }
    if (
      (view.getUint16(localOffset + 6, true) & 9) !== 0 ||
      view.getUint16(localOffset + 8, true) !== method ||
      view.getUint32(localOffset + 18, true) !== compressedSize ||
      view.getUint32(localOffset + 22, true) !== originalSize ||
      localNameLength !== nameLength ||
      !bytes
        .subarray(localOffset + 30, localOffset + 30 + localNameLength)
        .equals(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    ) {
      throw new PreflightFailure("archive_entry_mismatch");
    }
    if (originalSize > limits.maxEntryUncompressedBytes) {
      throw new PreflightFailure("archive_entry_size_limit");
    }
    if (
      originalSize > 0 &&
      (compressedSize === 0 ||
        originalSize / compressedSize > limits.maxCompressionRatio)
    ) {
      throw new PreflightFailure("archive_compression_ratio_limit");
    }
    declaredTotalUncompressedBytes += originalSize;
    if (declaredTotalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw new PreflightFailure("archive_total_size_limit");
    }

    const remainingTotal =
      limits.maxTotalUncompressedBytes - actualTotalUncompressedBytes;
    const outputCap = Math.min(
      limits.maxEntryUncompressedBytes,
      remainingTotal,
    );
    const compressed = bytes.subarray(
      localDataStart,
      localDataStart + compressedSize,
    );
    let actual: Buffer;
    try {
      actual =
        method === 0
          ? compressed
          : inflateRawSync(compressed, {
              maxOutputLength: Math.max(1, outputCap + 1),
            });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ERR_BUFFER_TOO_LARGE"
      ) {
        throw new PreflightFailure(
          outputCap === limits.maxEntryUncompressedBytes
            ? "archive_entry_size_limit"
            : "archive_total_size_limit",
        );
      }
      throw new PreflightFailure("invalid_archive");
    }
    if (actual.byteLength > limits.maxEntryUncompressedBytes) {
      throw new PreflightFailure("archive_entry_size_limit");
    }
    actualTotalUncompressedBytes += actual.byteLength;
    if (actualTotalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw new PreflightFailure("archive_total_size_limit");
    }
    if (actual.byteLength !== originalSize) {
      throw new PreflightFailure("archive_entry_size_mismatch");
    }
    if (
      actual.byteLength > 0 &&
      (compressedSize === 0 ||
        actual.byteLength / compressedSize > limits.maxCompressionRatio)
    ) {
      throw new PreflightFailure("archive_compression_ratio_limit");
    }
    cursor = next;
  }
  if (cursor !== endOffset) throw new PreflightFailure("invalid_archive");
}

function verifiedDistributionSha256(
  bytes: Buffer,
  expectedSha256: string,
  limits: GradleArchiveLimits,
): string {
  const distributionSha256 = createHash("sha256").update(bytes).digest("hex");
  if (distributionSha256 !== expectedSha256) {
    throw new PreflightFailure(
      "distribution_sha256_mismatch",
      distributionSha256,
    );
  }
  assertSafeDistribution(bytes, limits);
  return distributionSha256;
}

function distributionFailure(
  error: unknown,
  options: GradlePreflightOptions,
  wrapperJarSha256: string,
  distributionPath: string,
  networkUsed: boolean,
): GradlePreflightResult {
  if (isCancellation(error, options.signal)) {
    return result("cancelled", "cancelled", {
      networkUsed,
      wrapperJarSha256,
      distributionPath,
    });
  }
  if (error instanceof PreflightFailure) {
    return result("failed", error.code, {
      networkUsed,
      wrapperJarSha256,
      distributionSha256: error.distributionSha256 ?? null,
      distributionPath,
    });
  }
  if (error instanceof NativeDirFdError) {
    return result(
      "failed",
      error.code === "revision_conflict"
        ? "distribution_cache_conflict"
        : "distribution_cache_unavailable",
      { networkUsed, wrapperJarSha256, distributionPath },
    );
  }
  return result("failed", "distribution_download_failed", {
    networkUsed,
    wrapperJarSha256,
    distributionPath,
  });
}

function actualRedirectFailure(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  let cause: unknown = error.cause;
  for (let depth = 0; depth < 4 && cause !== undefined; depth += 1) {
    if (!(cause instanceof Error)) return false;
    if (
      /redirect mode is set to error|too many redirects|redirect (?:is )?(?:forbidden|not allowed)/i.test(
        cause.message,
      )
    ) {
      return true;
    }
    cause = cause.cause;
  }
  return false;
}

async function downloadDistribution(
  options: GradlePreflightOptions,
  gradle: TargetGradle,
  cacheRoot: NativeRoot,
  rootedDistributionPath: string,
  distributionPath: string,
  wrapperJarSha256: string,
  archiveLimits: GradleArchiveLimits,
): Promise<GradlePreflightResult> {
  let url: URL;
  try {
    url = new URL(gradle.distributionUrl);
  } catch {
    return result("failed", "invalid_distribution_url", {
      wrapperJarSha256,
      distributionPath,
    });
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    return result("failed", "invalid_distribution_url", {
      wrapperJarSha256,
      distributionPath,
    });
  }
  if (options.configRoot === undefined) {
    return result("unavailable", "network_not_approved", {
      wrapperJarSha256,
      distributionPath,
    });
  }
  try {
    await assertNetworkApproved({
      configRoot: options.configRoot,
      host: url.hostname,
      purpose: "gradle-distribution",
      cacheIdentity: options.cacheIdentity,
    });
  } catch (error) {
    const code =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "network_not_approved";
    return result("unavailable", code, {
      wrapperJarSha256,
      distributionPath,
    });
  }

  let networkUsed = false;
  try {
    networkUsed = true;
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(url, {
        redirect: "error",
        signal: options.signal ?? null,
      });
    } catch (error) {
      if (actualRedirectFailure(error) && !options.signal?.aborted) {
        throw new PreflightFailure("redirect_forbidden");
      }
      throw error;
    }
    throwIfCancelled(options.signal);
    if (
      response.redirected ||
      (response.status >= 300 && response.status < 400)
    ) {
      throw new PreflightFailure("redirect_forbidden");
    }
    if (!response.ok || response.body === null) {
      throw new PreflightFailure("distribution_download_failed");
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      (response.headers.has("content-length") &&
        (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) ||
      declaredLength > MAX_DISTRIBUTION_BYTES
    ) {
      throw new PreflightFailure("distribution_size_limit");
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      throwIfCancelled(options.signal);
      size += chunk.byteLength;
      if (size > MAX_DISTRIBUTION_BYTES) {
        throw new PreflightFailure("distribution_size_limit");
      }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks, size);
    const distributionSha256 = verifiedDistributionSha256(
      bytes,
      gradle.distributionSha256,
      archiveLimits,
    );
    throwIfCancelled(options.signal);
    await writeRootFileAtomic(cacheRoot, {
      path: rootedDistributionPath,
      contents: bytes,
      expectedRevision: null,
      beforeRename: () => throwIfCancelled(options.signal),
    });
    throwIfCancelled(options.signal);
    return result("passed", "ok", {
      networkUsed,
      wrapperJarSha256,
      distributionSha256,
      distributionPath,
    });
  } catch (error) {
    return distributionFailure(
      error,
      options,
      wrapperJarSha256,
      distributionPath,
      networkUsed,
    );
  }
}

export async function assertGradlePreflight(
  options: GradlePreflightOptions,
): Promise<GradlePreflightResult> {
  const wrapperJarSha256 = options.target.gradle?.wrapperJarSha256;
  if (
    wrapperJarSha256 === undefined ||
    !/^[0-9a-f]{64}$/.test(wrapperJarSha256)
  ) {
    return result("unavailable", "wrapper_jar_hash_required");
  }
  if (options.signal?.aborted) return result("cancelled", "cancelled");
  const archiveLimits = options.archiveLimits ?? DEFAULT_ARCHIVE_LIMITS;
  if (!validArchiveLimits(archiveLimits)) {
    return result("failed", "invalid_archive_limits", { wrapperJarSha256 });
  }

  let projectRoot: NativeRoot;
  try {
    projectRoot = openRoot(options.projectRoot);
  } catch {
    return result("unavailable", "wrapper_jar_unavailable");
  }
  let wrapperBytes: Buffer;
  try {
    wrapperBytes = readRootFile(
      projectRoot,
      "gradle/wrapper/gradle-wrapper.jar",
    ).contents;
  } catch (error) {
    return result(
      error instanceof NativeDirFdError && error.code === "not_found"
        ? "unavailable"
        : "failed",
      error instanceof NativeDirFdError && error.code === "not_found"
        ? "wrapper_jar_unavailable"
        : "wrapper_jar_read_failed",
    );
  } finally {
    closeQuietly(projectRoot);
  }
  const actualWrapperSha256 = createHash("sha256")
    .update(wrapperBytes)
    .digest("hex");
  if (actualWrapperSha256 !== wrapperJarSha256) {
    return result("failed", "wrapper_jar_sha256_mismatch", {
      wrapperJarSha256: actualWrapperSha256,
    });
  }

  const gradle = options.target.gradle;
  if (gradle === null || !/^[0-9a-f]{64}$/.test(gradle.distributionSha256)) {
    return result("unavailable", "distribution_hash_required", {
      wrapperJarSha256,
    });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.cacheIdentity)) {
    return result("failed", "invalid_cache_identity", { wrapperJarSha256 });
  }
  const cacheRootName = basename(options.cacheRoot);
  if (
    cacheRootName.length === 0 ||
    cacheRootName === "." ||
    cacheRootName === ".."
  ) {
    return result("failed", "distribution_cache_unavailable", {
      wrapperJarSha256,
    });
  }
  const distributionPath = join(
    options.cacheRoot,
    options.cacheIdentity,
    `${gradle.distributionSha256}.zip`,
  );
  const rootedDistributionPath = `${cacheRootName}/${options.cacheIdentity}/${gradle.distributionSha256}.zip`;

  let cacheRoot: NativeRoot;
  try {
    cacheRoot = openRoot(dirname(options.cacheRoot));
  } catch {
    return result("failed", "distribution_cache_unavailable", {
      wrapperJarSha256,
      distributionPath,
    });
  }
  try {
    let distributionBytes: Buffer;
    try {
      const cacheStat = statRootFile(cacheRoot, rootedDistributionPath);
      if (cacheStat.kind !== "file") {
        throw new PreflightFailure("distribution_cache_unavailable");
      }
      if (cacheStat.size > MAX_DISTRIBUTION_BYTES) {
        throw new PreflightFailure("distribution_size_limit");
      }
      const cached = readRootFile(cacheRoot, rootedDistributionPath);
      if (cached.stat.size > MAX_DISTRIBUTION_BYTES) {
        throw new PreflightFailure("distribution_size_limit");
      }
      distributionBytes = cached.contents;
    } catch (error) {
      throwIfCancelled(options.signal);
      if (error instanceof NativeDirFdError && error.code === "not_found") {
        if (options.mode === "offline") {
          return result("unavailable", "distribution_cache_missing", {
            wrapperJarSha256,
            distributionPath,
          });
        }
        return await downloadDistribution(
          options,
          gradle,
          cacheRoot,
          rootedDistributionPath,
          distributionPath,
          wrapperJarSha256,
          archiveLimits,
        );
      }
      if (error instanceof PreflightFailure) throw error;
      return result("failed", "distribution_cache_unavailable", {
        wrapperJarSha256,
        distributionPath,
      });
    }

    const distributionSha256 = verifiedDistributionSha256(
      distributionBytes,
      gradle.distributionSha256,
      archiveLimits,
    );
    throwIfCancelled(options.signal);
    return result("passed", "ok", {
      wrapperJarSha256,
      distributionSha256,
      distributionPath,
    });
  } catch (error) {
    return distributionFailure(
      error,
      options,
      wrapperJarSha256,
      distributionPath,
      false,
    );
  } finally {
    closeQuietly(cacheRoot);
  }
}
