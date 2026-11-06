import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import {
  inspectProductionJar,
  type ProductionJarInspectionInput,
  type ProductionJarInspectionResult,
} from "../../src/core/verification/production-jar.ts";

interface ZipEntry {
  readonly name: string;
  readonly data?: string | Uint8Array;
  readonly mode?: number;
  readonly aliasOf?: string;
  readonly localUncompressedSize?: number;
  readonly centralUncompressedSize?: number;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Small synthetic ZIP writer: alias entries share a local header, as hardlinks do.
function zip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  const prepared = entries.map((entry) => {
    const source = entry.data ?? entry.name;
    const data =
      typeof source === "string" ? Buffer.from(source) : Buffer.from(source);
    return {
      entry,
      data,
      compressed: deflateRawSync(data, { level: 9 }),
      crc: crc32(data),
      offset: -1,
    };
  });

  for (const item of prepared) {
    if (item.entry.aliasOf !== undefined) continue;
    const name = Buffer.from(item.entry.name, "utf8");
    const header = Buffer.alloc(30);
    item.offset = locals.reduce((size, part) => size + part.length, 0);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(item.crc, 14);
    header.writeUInt32LE(item.compressed.length, 18);
    header.writeUInt32LE(
      item.entry.localUncompressedSize ?? item.data.length,
      22,
    );
    header.writeUInt16LE(name.length, 26);
    locals.push(header, name, item.compressed);
  }

  const centralOffset = locals.reduce((size, part) => size + part.length, 0);
  for (const item of prepared) {
    const source =
      item.entry.aliasOf === undefined
        ? item
        : prepared.find(
            (candidate) => candidate.entry.name === item.entry.aliasOf,
          );
    assert.ok(source, `missing alias target ${item.entry.aliasOf}`);
    assert.ok(source.offset >= 0, `alias target has no local header`);
    const name = Buffer.from(item.entry.name, "utf8");
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(source.crc, 16);
    header.writeUInt32LE(source.compressed.length, 20);
    header.writeUInt32LE(
      item.entry.centralUncompressedSize ??
        item.entry.localUncompressedSize ??
        source.data.length,
      24,
    );
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(((source.entry.mode ?? 0o100644) << 16) >>> 0, 38);
    header.writeUInt32LE(source.offset, 42);
    central.push(header, name);
  }

  const end = Buffer.alloc(22);
  const centralSize = central.reduce((size, part) => size + part.length, 0);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function metadata(): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    id: "ruby_tools",
    version: "1.0.0",
    name: "Ruby Tools",
    depends: { minecraft: "1.21.1" },
  })}\n`;
}

function validEntries(): ZipEntry[] {
  return [
    { name: "fabric.mod.json", data: metadata() },
    { name: "ruby_tools/RubyBlade.class", data: "synthetic class bytes" },
    {
      name: "assets/ruby_tools/models/item/ruby_blade.json",
      data: '{"parent":"minecraft:item/generated"}\n',
    },
  ];
}

type InspectionInput = ProductionJarInspectionInput;
type InspectionResult = ProductionJarInspectionResult;

function requestFor(bytes: Uint8Array): InspectionInput {
  const digest = sha256(bytes);
  return {
    bytes,
    artifact: {
      path: "build/libs/ruby_tools-1.0.0.jar",
      glob: "build/libs/ruby_tools-1.0.0.jar",
      sha256: digest,
    },
    metadata: {
      path: "fabric.mod.json",
      modId: "ruby_tools",
      version: "1.0.0",
      minecraftVersion: "1.21.1",
    },
    remapEvidence: {
      executed: true,
      status: "passed",
      productionJarSha256: digest,
    },
    limits: {
      maxEntries: 32,
      maxTotalUncompressedBytes: 1_000_000,
      maxEntryUncompressedBytes: 500_000,
      maxCompressionRatio: 200,
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function removePath(value: unknown, path: readonly string[]): void {
  let parent = record(value);
  for (const part of path.slice(0, -1)) parent = record(parent[part]);
  delete parent[path.at(-1)!];
}

function assertFailure(
  result: InspectionResult,
  code: string,
  finding?: { code: string; path: string },
): void {
  assert.equal(result.status, "failed");
  assert.equal(result.code, code);
  if (finding !== undefined) assert.deepEqual(result.findings, [finding]);
}

test("accepts a synthetic production JAR only with exact identity and remap evidence", () => {
  const bytes = zip(validEntries());
  const request = requestFor(bytes);
  const result = inspectProductionJar(request);

  assert.equal(result.status, "passed");
  assert.equal(result.code, undefined);
  assert.equal(result.sha256, request.artifact.sha256);
  assert.equal(result.entryCount, 3);
  assert.equal(
    result.totalUncompressedBytes,
    validEntries().reduce((size, entry) => {
      const data = entry.data!;
      return (
        size +
        (typeof data === "string" ? Buffer.byteLength(data) : data.byteLength)
      );
    }, 0),
  );
  assert.deepEqual(result.findings, []);

  const wrongHash = requestFor(bytes);
  record(wrongHash.artifact).sha256 = "0".repeat(64);
  assertFailure(inspectProductionJar(wrongHash), "artifact_sha256_mismatch");

  const wrongGlob = requestFor(bytes);
  record(wrongGlob.artifact).path = "build/libs/ruby_tools-1.0.0-dev.jar";
  assertFailure(inspectProductionJar(wrongGlob), "artifact_glob_mismatch");
});

test("rejects absolute, traversal, platform-specific, and NUL entry names", () => {
  for (const name of [
    "../outside",
    "assets/../../outside",
    "/absolute",
    "C:\\outside",
    "assets\\..\\outside",
    "safe\u0000name",
  ]) {
    const result = inspectProductionJar(
      requestFor(zip([...validEntries(), { name, data: "bad" }])),
    );
    assertFailure(result, "unsafe_entry_name", {
      code: "unsafe_entry_name",
      path: name,
    });
  }
});

test("rejects symlink and shared-local-header hardlink entries", () => {
  const symlink = inspectProductionJar(
    requestFor(
      zip([
        ...validEntries(),
        { name: "link", data: "../../outside", mode: 0o120777 },
      ]),
    ),
  );
  assertFailure(symlink, "archive_symlink_forbidden", {
    code: "archive_symlink_forbidden",
    path: "link",
  });

  const hardlink = inspectProductionJar(
    requestFor(
      zip([
        ...validEntries(),
        { name: "hardlink.class", aliasOf: "ruby_tools/RubyBlade.class" },
      ]),
    ),
  );
  assertFailure(hardlink, "archive_hardlink_forbidden", {
    code: "archive_hardlink_forbidden",
    path: "hardlink.class",
  });
});

test("rejects nested ZIP and JAR content before recursive extraction", () => {
  for (const name of ["nested.zip", "lib/nested.jar"]) {
    const nested = zip([{ name: "inside.txt", data: "nested" }]);
    const result = inspectProductionJar(
      requestFor(zip([...validEntries(), { name, data: nested }])),
    );
    assertFailure(result, "nested_archive_forbidden", {
      code: "nested_archive_forbidden",
      path: name,
    });
  }
});

test("enforces entry count and total uncompressed size limits", () => {
  const countRequest = requestFor(zip(validEntries()));
  record(countRequest.limits).maxEntries = 2;
  assertFailure(
    inspectProductionJar(countRequest),
    "archive_entry_count_limit",
  );

  const totalRequest = requestFor(zip(validEntries()));
  record(totalRequest.limits).maxTotalUncompressedBytes = 8;
  assertFailure(inspectProductionJar(totalRequest), "archive_total_size_limit");
});

test("uses central-directory originalSize before decompressing an entry", () => {
  const bytes = zip([
    ...validEntries(),
    {
      name: "claimed-large.bin",
      data: "tiny actual payload",
      centralUncompressedSize: 900_000,
    },
  ]);
  const request = requestFor(bytes);
  record(request.limits).maxEntryUncompressedBytes = 500;
  record(request.limits).maxTotalUncompressedBytes = 2_000_000;

  assertFailure(inspectProductionJar(request), "archive_entry_size_limit", {
    code: "archive_entry_size_limit",
    path: "claimed-large.bin",
  });
});

test("enforces per-entry compressed ratio independently of byte limits", () => {
  const bytes = zip([
    ...validEntries(),
    { name: "padding.bin", data: Buffer.alloc(64 * 1024) },
  ]);
  const request = requestFor(bytes);
  record(request.limits).maxCompressionRatio = 10;

  assertFailure(
    inspectProductionJar(request),
    "archive_compression_ratio_limit",
    {
      code: "archive_compression_ratio_limit",
      path: "padding.bin",
    },
  );
});

test("excludes verification classes, bridge configs, test resources, and editable models", () => {
  const forbidden = [
    "dev/voxellume/verification/VerificationMod.class",
    "dev/voxellume/bridge/ClientBridge.class",
    "voxellume-bridge.json",
    "config/voxellume-test.json",
    "data/ruby_tools/gametest/ruby_blade.json",
    "test-fixtures/scenarios/ruby_blade.json",
    "assets/ruby_tools/models/ruby_blade.bbmodel",
  ];
  for (const name of forbidden) {
    const result = inspectProductionJar(
      requestFor(zip([...validEntries(), { name, data: "development only" }])),
    );
    assertFailure(result, "forbidden_production_entry", {
      code: "forbidden_production_entry",
      path: name,
    });
  }
});

test("requires valid matching mod metadata", () => {
  const missing = requestFor(zip(validEntries().slice(1)));
  assertFailure(inspectProductionJar(missing), "mod_metadata_required", {
    code: "mod_metadata_required",
    path: "fabric.mod.json",
  });

  const malformed = requestFor(
    zip([
      { name: "fabric.mod.json", data: "not json" },
      ...validEntries().slice(1),
    ]),
  );
  assertFailure(inspectProductionJar(malformed), "invalid_mod_metadata", {
    code: "invalid_mod_metadata",
    path: "fabric.mod.json",
  });

  const mismatch = requestFor(
    zip([
      {
        name: "fabric.mod.json",
        data: metadata().replace("ruby_tools", "other_mod"),
      },
      ...validEntries().slice(1),
    ]),
  );
  assertFailure(inspectProductionJar(mismatch), "mod_metadata_mismatch", {
    code: "mod_metadata_mismatch",
    path: "fabric.mod.json",
  });
});

test("requires executed passing remap evidence tied to the exact JAR", () => {
  const missing = requestFor(zip(validEntries()));
  removePath(missing, ["remapEvidence"]);
  assertFailure(inspectProductionJar(missing), "remap_evidence_required");

  for (const mutate of [
    (request: InspectionInput) => {
      record(request.remapEvidence).executed = false;
    },
    (request: InspectionInput) => {
      record(request.remapEvidence).status = "unavailable";
    },
    (request: InspectionInput) => {
      record(request.remapEvidence).productionJarSha256 = "0".repeat(64);
    },
  ]) {
    const request = requestFor(zip(validEntries()));
    mutate(request);
    assertFailure(inspectProductionJar(request), "remap_evidence_required");
  }
});

test("returns invalid_archive for malformed ZIP bytes instead of throwing", () => {
  const request = requestFor(Buffer.from("not a ZIP or JAR"));
  let result: InspectionResult | undefined;
  assert.doesNotThrow(() => {
    result = inspectProductionJar(request);
  });
  assert.ok(result);
  assertFailure(result, "invalid_archive");
});
