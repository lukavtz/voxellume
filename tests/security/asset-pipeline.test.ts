import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { PNG } from "pngjs";

import {
  inspectPng,
  readPngBounded,
  scalePngNearest,
  validateTexture,
} from "../../src/core/assets/png.ts";
import { compareVisualBaseline } from "../../src/core/assets/visual-diff.ts";
import { DOCKER_NODE_IMAGE } from "../../src/core/execution/docker.ts";
import {
  MC_ASSET_REVISION,
  MC_ASSET_DIST_SHA256,
  assertMcAssetDistSha256,
  computeMcAssetDistSha256,
  createMcAssetExecutor,
  runMcAsset,
  publishStagedAssetSet,
} from "../../src/core/assets/mc-asset.ts";
import {
  grantAuthorizedRoot,
  releaseAuthorizedRoot,
  type AuthorizedRoot,
} from "../../src/core/execution/paths.ts";

const inputCap = 16 * 1024 * 1024;
const pixelCap = 4096 * 4096;
const transparent = [0, 0, 0, 0] as const;
const red = [255, 0, 0, 255] as const;
const green = [0, 255, 0, 255] as const;
const blue = [0, 0, 255, 255] as const;
const white = [255, 255, 255, 255] as const;

type Rgba = readonly [number, number, number, number];

interface Fixture {
  root: string;
  stagingPath: string;
  publicationPath: string;
  outsidePath: string;
  staging: AuthorizedRoot;
  publication: AuthorizedRoot;
}

function png(width: number, height: number, pixels: readonly Rgba[]): Buffer {
  assert.equal(pixels.length, width * height);
  const image = new PNG({ width, height });
  for (const [index, color] of pixels.entries()) {
    image.data.set(color, index * 4);
  }
  return PNG.sync.write(image);
}

function solid(width: number, height: number, color: Rgba = red): Buffer {
  return png(
    width,
    height,
    Array.from({ length: width * height }, () => color),
  );
}

function image(bytes: Buffer) {
  return inspectPng(bytes, { maxEdge: 4096, maxPixels: pixelCap });
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
}

async function rejectsCode(
  operation: Promise<unknown> | (() => unknown),
  code: string,
): Promise<void> {
  if (typeof operation === "function") {
    assert.throws(operation, (error: unknown) => {
      assert.equal(errorCode(error), code);
      return true;
    });
    return;
  }
  await assert.rejects(operation, (error: unknown) => {
    assert.equal(errorCode(error), code);
    return true;
  });
}

function findings(bytes: Buffer, spec: Parameters<typeof validateTexture>[1]) {
  const result = validateTexture(image(bytes), spec);
  return result.findings.map((finding) => finding.ruleId);
}

async function setup(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-assets-security-"));
  const stagingPath = join(root, "transaction", "staging");
  const publicationPath = join(root, "transaction", "publication");
  const outsidePath = join(root, "outside");
  await Promise.all([
    mkdir(stagingPath, { recursive: true }),
    mkdir(publicationPath, { recursive: true }),
    mkdir(outsidePath),
  ]);
  const staging = await grantAuthorizedRoot({
    path: stagingPath,
    kind: "transactionStaging",
    transactionId: "tx-assets",
  });
  const publication = await grantAuthorizedRoot({
    path: publicationPath,
    kind: "transactionStaging",
    transactionId: "tx-assets",
  });
  t.after(async () => {
    await Promise.all([
      releaseAuthorizedRoot(staging),
      releaseAuthorizedRoot(publication),
    ]);
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    stagingPath,
    publicationPath,
    outsidePath,
    staging,
    publication,
  };
}

function missingTool(fixture: Fixture) {
  return {
    entryPoint: join(fixture.root, "missing-mc-asset.js"),
    sha256: "0".repeat(64),
    revision: MC_ASSET_REVISION,
  } as const;
}

function generate(outputPath: string) {
  return {
    kind: "generate" as const,
    pattern: "checker" as const,
    size: 16,
    palette: "iron" as const,
    seed: 7,
    output: { png: outputPath, source: "checker.mcpx" },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

test("byte and pixel limits fail before format decode or process spawn", async (t) => {
  const fixture = await setup(t);
  const execute = createMcAssetExecutor(missingTool(fixture));
  const oversized = join(fixture.stagingPath, "oversized.bin");
  await writeFile(oversized, Buffer.alloc(inputCap + 1, 0x41));
  await rejectsCode(
    readPngBounded(fixture.staging, "oversized.bin", {
      maxBytes: inputCap,
      maxEdge: 4096,
      maxPixels: pixelCap,
    }),
    "input_too_large",
  );

  const declaringTooManyPixels = solid(1, 1);
  declaringTooManyPixels.writeUInt32BE(4097, 16);
  declaringTooManyPixels.writeUInt32BE(4097, 20);
  rejectsCode(
    () =>
      inspectPng(declaringTooManyPixels.subarray(0, 33), {
        maxEdge: 4096,
        maxPixels: pixelCap,
      }),
    "pixel_limit_exceeded",
  );

  await rejectsCode(
    execute({
      root: fixture.staging,
      operation: {
        kind: "pixelize",
        input: "oversized.bin",
        size: 16,
        preset: "item",
        output: { png: "pixelized.png", source: "pixelized.mcpx" },
      },
      limits: { inputBytes: inputCap, outputBytes: inputCap, outputFiles: 4 },
    }),
    "input_too_large",
  );
  assert.equal(await exists(join(fixture.stagingPath, "pixelized.png")), false);
});

test("dimensions, alpha modes, palette membership, and color budget are source gates", () => {
  const baseSpec = {
    width: 2,
    height: 2,
    alphaMode: "cutout" as const,
    palette: { allowedRgba: [red, green], maxColors: 2 },
    tileable: false,
  };
  assert.deepEqual(findings(solid(1, 2), baseSpec), ["VX-TEX-001-DIMENSIONS"]);
  assert.deepEqual(findings(png(2, 2, [red, green, red, green]), baseSpec), []);
  assert.deepEqual(findings(png(2, 2, [red, blue, red, green]), baseSpec), [
    "VX-TEX-003-PALETTE",
  ]);
  assert.deepEqual(
    findings(png(2, 2, [red, green, blue, white]), {
      ...baseSpec,
      palette: { allowedRgba: [red, green, blue, white], maxColors: 3 },
    }),
    ["VX-TEX-003-PALETTE"],
  );
  assert.deepEqual(
    findings(png(2, 2, [red, transparent, red, red]), {
      ...baseSpec,
      alphaMode: "opaque",
    }),
    ["VX-TEX-004-ALPHA"],
  );
  assert.deepEqual(
    findings(png(2, 2, [red, [255, 0, 0, 128], red, red]), baseSpec),
    ["VX-TEX-004-ALPHA"],
  );
  assert.deepEqual(
    findings(png(2, 2, [red, [255, 0, 0, 128], red, transparent]), {
      ...baseSpec,
      alphaMode: "translucent",
      allowedAlpha: [0, 128, 255],
    }),
    [],
  );
  assert.deepEqual(
    findings(
      png(
        2,
        2,
        Array.from({ length: 4 }, () => transparent),
      ),
      baseSpec,
    ),
    ["VX-TEX-004-ALPHA"],
  );
});

test("nearest scaling preserves texel blocks, rejects fractional resampling, and is deterministic", () => {
  const source = png(2, 2, [red, green, blue, white]);
  const first = scalePngNearest(source, 2);
  const second = scalePngNearest(source, 2);
  assert.equal(hash(first), hash(second));
  const scaled = PNG.sync.read(first);
  assert.equal(scaled.width, 4);
  assert.equal(scaled.height, 4);
  const actual: number[][] = [];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      actual.push([
        ...scaled.data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4),
      ]);
    }
  }
  assert.deepEqual(actual, [
    red,
    red,
    green,
    green,
    red,
    red,
    green,
    green,
    blue,
    blue,
    white,
    white,
    blue,
    blue,
    white,
    white,
  ]);
  rejectsCode(() => scalePngNearest(source, 1.5), "invalid_upscale");
  rejectsCode(() => scalePngNearest(source, 0), "invalid_upscale");
});

test("tiling checks both wrap axes independently of mirror previews", () => {
  const seamless = solid(4, 4);
  assert.deepEqual(
    findings(seamless, {
      width: 4,
      height: 4,
      alphaMode: "opaque",
      palette: { allowedRgba: [red], maxColors: 1 },
      tileable: true,
    }),
    [],
  );
  const rows = [
    red,
    red,
    red,
    green,
    red,
    red,
    red,
    green,
    red,
    red,
    red,
    green,
    blue,
    blue,
    blue,
    white,
  ];
  assert.deepEqual(
    findings(png(4, 4, rows), {
      width: 4,
      height: 4,
      alphaMode: "opaque",
      palette: { allowedRgba: [red, green, blue, white], maxColors: 4 },
      tileable: true,
    }),
    ["VX-TEX-005-TILING-WRAP"],
  );
});

test("pixelmatch produces only a numeric visual diff, never source, aesthetic, or gameplay approval", () => {
  const baseline = image(solid(2, 2));
  const identical = compareVisualBaseline({
    baseline,
    actual: baseline,
    threshold: 0.1,
  });
  assert.deepEqual(identical, {
    status: "passed",
    checkClass: "visual_diff",
    width: 2,
    height: 2,
    differentPixels: 0,
    totalPixels: 4,
  });

  const changed = compareVisualBaseline({
    baseline,
    actual: image(png(2, 2, [red, red, red, green])),
    threshold: 0.1,
  });
  assert.deepEqual(changed, {
    status: "failed",
    checkClass: "visual_diff",
    width: 2,
    height: 2,
    differentPixels: 1,
    totalPixels: 4,
  });
});

test("facade rejects the raw CLI traversal, absolute, NUL, and symlink-parent escapes before spawn", async (t) => {
  const fixture = await setup(t);
  const execute = createMcAssetExecutor(missingTool(fixture));
  await symlink(
    fixture.outsidePath,
    join(fixture.stagingPath, "linked"),
    "dir",
  );
  const cases = [
    ["../outside/escape.png", "path_traversal"],
    [join(fixture.outsidePath, "escape.png"), "absolute_path"],
    ["bad\0.png", "invalid_path"],
    ["linked/escape.png", "unsafe_symlink"],
  ] as const;
  for (const [outputPath, code] of cases) {
    await t.test(JSON.stringify(outputPath), async () => {
      await rejectsCode(
        execute({
          root: fixture.staging,
          operation: generate(outputPath),
        }),
        code,
      );
    });
  }
  assert.deepEqual(await readdir(fixture.outsidePath), []);

  await rejectsCode(
    execute({
      root: fixture.staging,
      operation: {
        kind: "raw",
        argv: [
          "generate",
          "checker",
          "--output",
          join(fixture.outsidePath, "raw.png"),
        ],
      } as unknown as Parameters<typeof runMcAsset>[0]["operation"],
    }),
    "unsupported_operation",
  );
  assert.equal(await exists(join(fixture.outsidePath, "raw.png")), false);
});

test("hard-linked inputs and outputs fail closed without changing the outside inode", async (t) => {
  const fixture = await setup(t);
  const execute = createMcAssetExecutor(missingTool(fixture));
  const outsideInput = join(fixture.outsidePath, "input.png");
  const outsideOutput = join(fixture.outsidePath, "sentinel.png");
  await writeFile(outsideInput, solid(16, 16));
  await writeFile(outsideOutput, "outside sentinel\n");
  await link(outsideInput, join(fixture.stagingPath, "linked-input.png"));
  await link(outsideOutput, join(fixture.stagingPath, "checker.png"));

  await rejectsCode(
    execute({
      root: fixture.staging,
      operation: {
        kind: "pixelize",
        input: "linked-input.png",
        size: 16,
        preset: "item",
        output: { png: "pixelized.png", source: "pixelized.mcpx" },
      },
    }),
    "hardlink_forbidden",
  );
  await rejectsCode(
    execute({
      root: fixture.staging,
      operation: generate("checker.png"),
    }),
    "hardlink_forbidden",
  );
  assert.equal(await readFile(outsideOutput, "utf8"), "outside sentinel\n");
  assert.equal(await exists(join(fixture.stagingPath, "pixelized.png")), false);
});

test("PNG replaced by an outside hardlink after precheck is rejected by post-read nlink", async (t) => {
  const fixture = await setup(t);
  const stagedPath = join(fixture.stagingPath, "swap.png");
  const outsidePath = join(fixture.outsidePath, "outside.png");
  const outsideBytes = solid(16, 16, green);
  await writeFile(stagedPath, solid(16, 16));
  await writeFile(outsidePath, outsideBytes);

  await rejectsCode(
    readPngBounded(
      fixture.staging,
      "swap.png",
      { maxBytes: inputCap, maxEdge: 4096, maxPixels: pixelCap },
      {
        beforeRead: async () => {
          await unlink(stagedPath);
          await link(outsidePath, stagedPath);
        },
      },
    ),
    "hardlink_forbidden",
  );
  assert.deepEqual(await readFile(outsidePath), outsideBytes);
  assert.equal(
    await readFile(stagedPath).then((bytes) => hash(bytes)),
    hash(outsideBytes),
  );
});

test("publication enforces per-file, total-byte, and file-count quotas before any rename", async (t) => {
  const fixture = await setup(t);
  await mkdir(join(fixture.stagingPath, "candidate"));
  await writeFile(
    join(fixture.stagingPath, "candidate", "one.png"),
    solid(16, 16),
  );
  await writeFile(
    join(fixture.stagingPath, "candidate", "two.mcpx"),
    Buffer.alloc(32, 0x42),
  );
  const files = [
    { stagedPath: "candidate/one.png", outputPath: "one.png" },
    { stagedPath: "candidate/two.mcpx", outputPath: "two.mcpx" },
  ];

  await rejectsCode(
    publishStagedAssetSet({
      staging: fixture.staging,
      publication: fixture.publication,
      files,
      limits: { fileBytes: 16, totalBytes: inputCap, files: 2 },
    }),
    "output_too_large",
  );
  await rejectsCode(
    publishStagedAssetSet({
      staging: fixture.staging,
      publication: fixture.publication,
      files,
      limits: { fileBytes: inputCap, totalBytes: 32, files: 2 },
    }),
    "output_too_large",
  );
  await rejectsCode(
    publishStagedAssetSet({
      staging: fixture.staging,
      publication: fixture.publication,
      files,
      limits: { fileBytes: inputCap, totalBytes: inputCap, files: 1 },
    }),
    "output_file_limit",
  );
  assert.deepEqual(await readdir(fixture.publicationPath), []);
});

test("staged growth after pre-stat cannot bypass total output bytes", async (t) => {
  const fixture = await setup(t);
  await mkdir(join(fixture.stagingPath, "candidate"));
  await writeFile(
    join(fixture.stagingPath, "candidate", "one.mcpx"),
    Buffer.alloc(32, 0x41),
  );
  await writeFile(
    join(fixture.stagingPath, "candidate", "two.mcpx"),
    Buffer.alloc(32, 0x42),
  );
  let readCount = 0;

  await rejectsCode(
    publishStagedAssetSet({
      staging: fixture.staging,
      publication: fixture.publication,
      files: [
        { stagedPath: "candidate/one.mcpx", outputPath: "one.mcpx" },
        { stagedPath: "candidate/two.mcpx", outputPath: "two.mcpx" },
      ],
      limits: { fileBytes: 256, totalBytes: 64, files: 2 },
      hooks: {
        beforeRead: async () => {
          readCount += 1;
          if (readCount === 2) {
            await writeFile(
              join(fixture.stagingPath, "candidate", "two.mcpx"),
              Buffer.alloc(128, 0x43),
            );
          }
        },
      },
    }),
    "output_too_large",
  );
  assert.deepEqual(await readdir(fixture.publicationPath), []);
});

test("staged publication is all-or-nothing and removes candidate files on failure", async (t) => {
  console.error("staged-publication:setup");
  const fixture = await setup(t);
  console.error("staged-publication:ready");
  await mkdir(join(fixture.stagingPath, "candidate"));
  await writeFile(
    join(fixture.stagingPath, "candidate", "one.png"),
    solid(16, 16),
  );
  await writeFile(
    join(fixture.stagingPath, "candidate", "two.mcpx"),
    "editable\n",
  );
  const files = [
    { stagedPath: "candidate/one.png", outputPath: "one.png" },
    { stagedPath: "candidate/two.mcpx", outputPath: "two.mcpx" },
  ];
  await rejectsCode(
    publishStagedAssetSet({
      staging: fixture.staging,
      publication: fixture.publication,
      files,
      limits: { fileBytes: inputCap, totalBytes: inputCap, files: 2 },
      hooks: {
        beforePublish: () => {
          throw Object.assign(new Error("injected publication failure"), {
            code: "injected_failure",
          });
        },
      },
    }),
    "injected_failure",
  );
  console.error("staged-publication:rejected");
  assert.deepEqual(await readdir(fixture.publicationPath), []);
  assert.equal(
    await exists(join(fixture.stagingPath, "candidate", "one.png")),
    false,
  );
  assert.equal(
    await exists(join(fixture.stagingPath, "candidate", "two.mcpx")),
    false,
  );

  console.error("staged-publication:cleaned");
  await mkdir(join(fixture.stagingPath, "candidate"));
  await writeFile(
    join(fixture.stagingPath, "candidate", "one.png"),
    solid(16, 16),
  );
  await writeFile(
    join(fixture.stagingPath, "candidate", "two.mcpx"),
    "editable\n",
  );
  const published = await publishStagedAssetSet({
    staging: fixture.staging,
    publication: fixture.publication,
    files,
    limits: { fileBytes: inputCap, totalBytes: inputCap, files: 2 },
  });
  assert.equal(published.outputs.length, 2);
  assert.equal(
    published.outputs[0]?.sha256,
    hash(await readFile(join(fixture.publicationPath, "one.png"))),
  );
  assert.equal(
    await readFile(join(fixture.publicationPath, "two.mcpx"), "utf8"),
    "editable\n",
  );
});

test("parent swap during publication cannot redirect any output", async (t) => {
  const fixture = await setup(t);
  const parent = join(fixture.publicationPath, "assets");
  const retired = join(fixture.publicationPath, "retired");
  const outsideParent = join(fixture.outsidePath, "assets");
  await mkdir(parent);
  await mkdir(outsideParent);
  await writeFile(join(outsideParent, "sentinel"), "outside\n");
  await mkdir(join(fixture.stagingPath, "candidate"));
  await writeFile(
    join(fixture.stagingPath, "candidate", "one.png"),
    solid(16, 16),
  );

  await rejectsCode(
    publishStagedAssetSet({
      staging: fixture.staging,
      publication: fixture.publication,
      files: [
        { stagedPath: "candidate/one.png", outputPath: "assets/one.png" },
      ],
      limits: { fileBytes: inputCap, totalBytes: inputCap, files: 1 },
      hooks: {
        beforePublish: async () => {
          await rename(parent, retired);
          await rename(outsideParent, parent);
        },
      },
    }),
    "path_swap",
  );
  assert.equal(await readFile(join(parent, "sentinel"), "utf8"), "outside\n");
  assert.equal(await exists(join(parent, "one.png")), false);
  assert.deepEqual(await readdir(fixture.outsidePath), ["assets"]);
});

test("default installation verifies a deterministic full-dist digest and rejects tampered fixtures", async (t) => {
  const fixture = await setup(t);
  const first = join(fixture.root, "dist-first");
  const second = join(fixture.root, "dist-second");
  await mkdir(join(first, "nested"), { recursive: true });
  await mkdir(join(second, "nested"), { recursive: true });
  await writeFile(
    join(first, "index.js"),
    "export const implementation = 1;\n",
  );
  await writeFile(
    join(first, "nested", "codec.js"),
    "export const codec = 'png';\n",
  );
  await writeFile(
    join(second, "nested", "codec.js"),
    "export const codec = 'png';\n",
  );
  await writeFile(
    join(second, "index.js"),
    "export const implementation = 1;\n",
  );

  const digest = await computeMcAssetDistSha256(first);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(await computeMcAssetDistSha256(second), digest);
  await assertMcAssetDistSha256(second, digest);

  const packagePath = createRequire(import.meta.url).resolve(
    "mc-asset/package.json",
  );
  const installedDist = join(dirname(packagePath), "dist");
  assert.equal(
    await computeMcAssetDistSha256(installedDist),
    MC_ASSET_DIST_SHA256,
  );
  await assertMcAssetDistSha256(installedDist, MC_ASSET_DIST_SHA256);

  await writeFile(
    join(first, "nested", "codec.js"),
    "export const codec = 'webp';\n",
  );
  assert.notEqual(await computeMcAssetDistSha256(first), digest);
  await rejectsCode(
    assertMcAssetDistSha256(first, digest),
    "tool_hash_mismatch",
  );
});

test("executor requires an approved untampered adjacent package dist", async (t) => {
  const fixture = await setup(t);
  const installedPackage = dirname(
    createRequire(import.meta.url).resolve("mc-asset/package.json"),
  );
  const packageRoot = join(fixture.root, "approved-package");
  await mkdir(join(packageRoot, "bin"), { recursive: true });
  await cp(
    join(installedPackage, "bin", "mc-asset.js"),
    join(packageRoot, "bin", "mc-asset.js"),
  );
  await cp(join(installedPackage, "dist"), join(packageRoot, "dist"), {
    recursive: true,
  });
  const entryPoint = join(packageRoot, "bin", "mc-asset.js");
  const approvedTool = {
    entryPoint,
    sha256: hash(await readFile(entryPoint)),
    distSha256: MC_ASSET_DIST_SHA256,
    revision: MC_ASSET_REVISION,
  } as const;
  const run = (tool: Parameters<typeof createMcAssetExecutor>[0]) =>
    createMcAssetExecutor(tool)({
      root: fixture.staging,
      operation: generate("checker.png"),
    });

  const { distSha256: _requiredApproval, ...withoutDistApproval } =
    approvedTool;
  await rejectsCode(run(withoutDistApproval), "tool_hash_mismatch");
  await rejectsCode(
    run({ ...approvedTool, distSha256: "0".repeat(64) }),
    "tool_hash_mismatch",
  );
  await writeFile(
    join(packageRoot, "dist", "index.js"),
    "tampered implementation\n",
  );
  await rejectsCode(run(approvedTool), "tool_hash_mismatch");
  assert.equal(await exists(join(fixture.stagingPath, "checker.png")), false);

  await rm(join(packageRoot, "dist"), { recursive: true, force: true });
  await cp(join(installedPackage, "dist"), join(packageRoot, "dist"), {
    recursive: true,
  });
  const result = await run(approvedTool);
  assert.equal(result.status, "passed", result.stderr);
  assert.equal(await exists(join(fixture.stagingPath, "checker.png")), true);
});

test("reported argv is the exact sandbox wrapper, node, entry point, and spawned args", async (t) => {
  const fixture = await setup(t);
  const entryPoint = join(fixture.root, "fake-mc-asset.js");
  const outputPng = solid(16, 16).toString("hex");
  await writeFile(
    entryPoint,
    `import { writeFileSync } from "node:fs";\n` +
      `const args = process.argv.slice(2);\n` +
      `const value = (flag) => args[args.indexOf(flag) + 1];\n` +
      `writeFileSync(value("--output"), Buffer.from(${JSON.stringify(outputPng)}, "hex"));\n` +
      `writeFileSync(value("--source"), "mcpx 1\\n");\n` +
      `console.log(JSON.stringify({ success: true, args }));\n`,
  );
  const execute = createMcAssetExecutor({
    entryPoint,
    sha256: hash(await readFile(entryPoint)),
    revision: MC_ASSET_REVISION,
  });
  const result = await execute({
    root: fixture.staging,
    operation: generate("checker.png"),
  });
  assert.equal(result.status, "passed", result.stderr);
  assert.ok(result.executed);
  const spawnedArgs = (JSON.parse(result.stdout) as { args: string[] }).args;
  if (process.platform === "darwin") {
    assert.deepEqual(result.executed.argv, [
      "/usr/bin/sandbox-exec",
      "-p",
      "(version 1)(allow default)(deny network-outbound)",
      process.execPath,
      entryPoint,
      ...spawnedArgs,
    ]);
  } else {
    const stagePath = dirname(
      spawnedArgs[spawnedArgs.indexOf("--output") + 1]!,
    );
    const user =
      typeof process.getuid === "function" &&
      typeof process.getgid === "function"
        ? ["--user", `${process.getuid()}:${process.getgid()}`]
        : [];
    assert.deepEqual(result.executed.argv, [
      "docker",
      "run",
      "--rm",
      "--name",
      `voxellume-asset-${hash(Buffer.from(stagePath)).slice(0, 24)}`,
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=268435456,mode=1777",
      "--cpus",
      "2",
      "--memory",
      String(4 * 1024 ** 3),
      "--pids-limit",
      "512",
      ...user,
      "--mount",
      `type=bind,src=${stagePath},dst=${stagePath}`,
      "--mount",
      `type=bind,src=${fixture.root},dst=${fixture.root},readonly`,
      "--workdir",
      stagePath,
      "--env",
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "--env",
      `HOME=${join(stagePath, "home")}`,
      "--env",
      `TMPDIR=${join(stagePath, "tmp")}`,
      "--env",
      "NO_COLOR=1",
      DOCKER_NODE_IMAGE,
      "node",
      entryPoint,
      ...spawnedArgs,
    ]);
  }
  assert.deepEqual(spawnedArgs.slice(0, 8), [
    "generate",
    "checker",
    "--size",
    "16",
    "--palette",
    "iron",
    "--seed",
    "7",
  ]);
  assert.equal(result.executed.shell, false);
});

test("NaN and Infinity are rejected at every asset limit boundary", async (t) => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY]) {
    await t.test(String(invalid), async (t) => {
      const fixture = await setup(t);
      await writeFile(join(fixture.stagingPath, "input.png"), solid(16, 16));
      rejectsCode(
        () => inspectPng(solid(1, 1), { maxBytes: invalid }),
        "invalid_png_limits",
      );
      await rejectsCode(
        readPngBounded(fixture.staging, "input.png", { maxPixels: invalid }),
        "invalid_png_limits",
      );
      await assert.rejects(
        publishStagedAssetSet({
          staging: fixture.staging,
          publication: fixture.publication,
          files: [{ stagedPath: "input.png", outputPath: "output.png" }],
          limits: { fileBytes: inputCap, totalBytes: invalid, files: 1 },
        }),
      );
      assert.deepEqual(await readdir(fixture.publicationPath), []);
      await assert.rejects(
        runMcAsset({
          root: fixture.staging,
          operation: generate("generated.png"),
          limits: { outputBytes: invalid },
        }),
      );
      assert.equal(
        await exists(join(fixture.stagingPath, "generated.png")),
        false,
      );
    });
  }
});
