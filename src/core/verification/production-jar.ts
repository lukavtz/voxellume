import { createHash } from "node:crypto";
import { matchesGlob } from "node:path";
import { unzipSync } from "fflate";

export interface ProductionJarInspectionInput {
  readonly bytes: Uint8Array;
  readonly artifact: {
    readonly path: string;
    readonly glob: string;
    readonly sha256: string;
  };
  readonly metadata: {
    readonly path: string;
    readonly modId: string;
    readonly version: string;
    readonly minecraftVersion: string;
  };
  readonly remapEvidence?: {
    readonly executed: boolean;
    readonly status: string;
    readonly productionJarSha256: string;
  };
  readonly limits: {
    readonly maxEntries: number;
    readonly maxTotalUncompressedBytes: number;
    readonly maxEntryUncompressedBytes: number;
    readonly maxCompressionRatio: number;
  };
}

export interface ProductionJarFinding {
  readonly code: string;
  readonly path: string;
}

export interface ProductionJarInspectionResult {
  readonly status: "passed" | "failed";
  readonly code?: string;
  readonly sha256: string;
  readonly entryCount: number;
  readonly totalUncompressedBytes: number;
  readonly findings: readonly ProductionJarFinding[];
}

interface CentralEntry {
  readonly name: string;
  readonly compressedSize: number;
  readonly originalSize: number;
  readonly externalAttributes: number;
  readonly localHeaderOffset: number;
}

const textDecoder = new TextDecoder("utf-8", { fatal: true });

function failure(
  code: string,
  sha256: string,
  entryCount = 0,
  totalUncompressedBytes = 0,
  path?: string,
): ProductionJarInspectionResult {
  return {
    status: "failed",
    code,
    sha256,
    entryCount,
    totalUncompressedBytes,
    findings: path === undefined ? [] : [{ code, path }],
  };
}

function parseCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  if (bytes.byteLength < 22) throw new Error("ZIP end record is missing");
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
  if (endOffset < 0) throw new Error("ZIP end record is invalid");
  if (
    view.getUint16(endOffset + 4, true) !== 0 ||
    view.getUint16(endOffset + 6, true) !== 0 ||
    view.getUint16(endOffset + 8, true) !== view.getUint16(endOffset + 10, true)
  ) {
    throw new Error("Multi-disk ZIP archives are unsupported");
  }

  const count = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (centralOffset + centralSize !== endOffset) {
    throw new Error("ZIP central directory is invalid");
  }

  const entries: CentralEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (
      cursor + 46 > endOffset ||
      view.getUint32(cursor, true) !== 0x02014b50
    ) {
      throw new Error("ZIP central entry is invalid");
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > endOffset) throw new Error("ZIP central entry is truncated");
    if ((view.getUint16(cursor + 8, true) & 1) !== 0) {
      throw new Error("Encrypted ZIP entries are unsupported");
    }

    const compressedSize = view.getUint32(cursor + 20, true);
    const originalSize = view.getUint32(cursor + 24, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    if (
      compressedSize === 0xffffffff ||
      originalSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      localHeaderOffset >= centralOffset
    ) {
      throw new Error("ZIP64 or invalid local offsets are unsupported");
    }
    entries.push({
      name: textDecoder.decode(
        bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      ),
      compressedSize,
      originalSize,
      externalAttributes: view.getUint32(cursor + 38, true),
      localHeaderOffset,
    });
    cursor = next;
  }
  if (cursor !== endOffset)
    throw new Error("ZIP central directory has trailing data");
  return entries;
}

function safeEntryName(name: string): boolean {
  if (
    name.length === 0 ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[a-zA-Z]:/.test(name)
  ) {
    return false;
  }
  return !name.split("/").some((part) => part === "..");
}

function forbiddenProductionEntry(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith("dev/voxellume/verification/") ||
    lower.startsWith("dev/voxellume/bridge/") ||
    lower === "voxellume-bridge.json" ||
    /^config\/voxellume-.*\.json$/.test(lower) ||
    /(^|\/)data\/[^/]+\/gametest\//.test(lower) ||
    lower.startsWith("test-fixtures/") ||
    lower.endsWith(".bbmodel")
  );
}

function validLimits(limits: ProductionJarInspectionInput["limits"]): boolean {
  return (
    Number.isSafeInteger(limits.maxEntries) &&
    limits.maxEntries >= 0 &&
    Number.isSafeInteger(limits.maxTotalUncompressedBytes) &&
    limits.maxTotalUncompressedBytes >= 0 &&
    Number.isSafeInteger(limits.maxEntryUncompressedBytes) &&
    limits.maxEntryUncompressedBytes >= 0 &&
    Number.isFinite(limits.maxCompressionRatio) &&
    limits.maxCompressionRatio >= 0
  );
}

export function inspectProductionJar(
  input: ProductionJarInspectionInput,
): ProductionJarInspectionResult {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (sha256 !== input.artifact.sha256) {
    return failure("artifact_sha256_mismatch", sha256);
  }
  if (!matchesGlob(input.artifact.path, input.artifact.glob)) {
    return failure("artifact_glob_mismatch", sha256);
  }
  const remap = input.remapEvidence;
  if (
    remap === undefined ||
    !remap.executed ||
    remap.status !== "passed" ||
    remap.productionJarSha256 !== sha256
  ) {
    return failure("remap_evidence_required", sha256);
  }
  if (!validLimits(input.limits)) return failure("invalid_limits", sha256);

  let entries: CentralEntry[];
  try {
    entries = parseCentralDirectory(input.bytes);
  } catch {
    return failure("invalid_archive", sha256);
  }
  if (entries.length > input.limits.maxEntries) {
    return failure("archive_entry_count_limit", sha256, entries.length);
  }

  const localOffsets = new Set<number>();
  const names = new Set<string>();
  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    if (!safeEntryName(entry.name)) {
      return failure(
        "unsafe_entry_name",
        sha256,
        entries.length,
        totalUncompressedBytes,
        entry.name,
      );
    }
    if (names.has(entry.name))
      return failure("invalid_archive", sha256, entries.length);
    names.add(entry.name);
    const fileType = (entry.externalAttributes >>> 16) & 0xf000;
    if (fileType === 0xa000) {
      return failure(
        "archive_symlink_forbidden",
        sha256,
        entries.length,
        totalUncompressedBytes,
        entry.name,
      );
    }
    if (localOffsets.has(entry.localHeaderOffset)) {
      return failure(
        "archive_hardlink_forbidden",
        sha256,
        entries.length,
        totalUncompressedBytes,
        entry.name,
      );
    }
    localOffsets.add(entry.localHeaderOffset);
    if (/\.(zip|jar)$/i.test(entry.name)) {
      return failure(
        "nested_archive_forbidden",
        sha256,
        entries.length,
        totalUncompressedBytes,
        entry.name,
      );
    }
    if (forbiddenProductionEntry(entry.name)) {
      return failure(
        "forbidden_production_entry",
        sha256,
        entries.length,
        totalUncompressedBytes,
        entry.name,
      );
    }
    if (entry.originalSize > input.limits.maxEntryUncompressedBytes) {
      return failure(
        "archive_entry_size_limit",
        sha256,
        entries.length,
        totalUncompressedBytes,
        entry.name,
      );
    }
    if (
      entry.originalSize > 0 &&
      (entry.compressedSize === 0 ||
        entry.originalSize / entry.compressedSize >
          input.limits.maxCompressionRatio)
    ) {
      return failure(
        "archive_compression_ratio_limit",
        sha256,
        entries.length,
        totalUncompressedBytes,
        entry.name,
      );
    }
    totalUncompressedBytes += entry.originalSize;
    if (totalUncompressedBytes > input.limits.maxTotalUncompressedBytes) {
      return failure(
        "archive_total_size_limit",
        sha256,
        entries.length,
        totalUncompressedBytes,
      );
    }
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(input.bytes, {
      filter: (file) =>
        file.name === input.metadata.path &&
        file.originalSize <= input.limits.maxEntryUncompressedBytes &&
        file.originalSize <= input.limits.maxTotalUncompressedBytes &&
        (file.originalSize === 0 ||
          (file.size > 0 &&
            file.originalSize / file.size <= input.limits.maxCompressionRatio)),
    });
  } catch {
    return failure(
      "invalid_archive",
      sha256,
      entries.length,
      totalUncompressedBytes,
    );
  }

  const metadataBytes = Object.hasOwn(files, input.metadata.path)
    ? files[input.metadata.path]
    : undefined;
  if (metadataBytes === undefined) {
    return failure(
      "mod_metadata_required",
      sha256,
      entries.length,
      totalUncompressedBytes,
      input.metadata.path,
    );
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(textDecoder.decode(metadataBytes));
  } catch {
    return failure(
      "invalid_mod_metadata",
      sha256,
      entries.length,
      totalUncompressedBytes,
      input.metadata.path,
    );
  }
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return failure(
      "invalid_mod_metadata",
      sha256,
      entries.length,
      totalUncompressedBytes,
      input.metadata.path,
    );
  }
  const candidate = metadata as {
    id?: unknown;
    version?: unknown;
    depends?: { minecraft?: unknown };
  };
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.version !== "string" ||
    typeof candidate.depends !== "object" ||
    candidate.depends === null ||
    typeof candidate.depends.minecraft !== "string"
  ) {
    return failure(
      "invalid_mod_metadata",
      sha256,
      entries.length,
      totalUncompressedBytes,
      input.metadata.path,
    );
  }
  if (
    candidate.id !== input.metadata.modId ||
    candidate.version !== input.metadata.version ||
    candidate.depends.minecraft !== input.metadata.minecraftVersion
  ) {
    return failure(
      "mod_metadata_mismatch",
      sha256,
      entries.length,
      totalUncompressedBytes,
      input.metadata.path,
    );
  }

  return {
    status: "passed",
    sha256,
    entryCount: entries.length,
    totalUncompressedBytes,
    findings: [],
  };
}
