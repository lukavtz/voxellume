import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { PNG } from "pngjs";

import {
  BLOCKBENCH_MCP_REVISION,
  BLOCKBENCH_MCP_VERSION,
  createBlockbenchExporter,
  type BlockbenchTool,
} from "../../src/core/assets/blockbench.ts";
import { exportDirectAsset } from "../../src/core/assets/direct-export.ts";
import {
  MC_ASSET_REVISION,
  MC_ASSET_DIST_SHA256,
  createMcAssetExecutor,
  runMcAsset,
} from "../../src/core/assets/mc-asset.ts";
import { inspectPng } from "../../src/core/assets/png.ts";
import { compareVisualBaseline } from "../../src/core/assets/visual-diff.ts";
import {
  grantAuthorizedRoot,
  releaseAuthorizedRoot,
  type AuthorizedRoot,
} from "../../src/core/execution/paths.ts";

const grid = `[palette]
. = transparent
o = #0E1846FF
s = #1E3A8CFF
D = #2448A8FF
m = #3569D0FF
l = #5A92EEFF
t = #7FB2F6FF
T = #A9D2FFFF
W = #FFFFFFFF

[grid]
................
................
......sssss.....
.....sTTTTTo....
....sTTWWTTto...
...sTTWWTTttto..
..slllTTTtttmmo.
..slllllmmmmmDo.
..slllllmmmmmDo.
..slllllmmmmDDo.
...olllmmmmDDo..
....ollmmmDDo...
.....olmmmDo....
......ommDo.....
.......ooo......
................
`;

interface Fixture {
  root: string;
  workspacePath: string;
  workspace: AuthorizedRoot;
  tool: {
    entryPoint: string;
    sha256: string;
    revision: typeof MC_ASSET_REVISION;
    distSha256: typeof MC_ASSET_DIST_SHA256;
  };
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function rgba(red: number, green: number, blue: number, alpha = 255) {
  return [red, green, blue, alpha] as const;
}

function png(
  width: number,
  height: number,
  colors: readonly (readonly number[])[],
) {
  assert.equal(colors.length, width * height);
  const result = new PNG({ width, height });
  for (const [index, color] of colors.entries()) {
    assert.equal(color.length, 4);
    result.data.set(color, index * 4);
  }
  return PNG.sync.write(result);
}

async function setup(t: TestContext): Promise<Fixture> {
  const entryPoint =
    process.env.VOXELLUME_MC_ASSET_CLI ??
    createRequire(import.meta.url).resolve("mc-asset/bin/mc-asset.js");
  const root = await mkdtemp(join(tmpdir(), "voxellume-assets-integration-"));
  const workspacePath = join(root, "workspace");
  await mkdir(workspacePath);
  const workspace = await grantAuthorizedRoot({
    path: workspacePath,
    kind: "transactionStaging",
    transactionId: "tx-assets-integration",
  });
  t.after(async () => {
    await releaseAuthorizedRoot(workspace);
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    workspacePath,
    workspace,
    tool: {
      entryPoint,
      sha256: hash(await readFile(entryPoint)),
      revision: MC_ASSET_REVISION,
      distSha256: MC_ASSET_DIST_SHA256,
    },
  };
}

async function outputHash(
  fixture: Pick<Fixture, "workspacePath">,
  path: string,
): Promise<string> {
  return hash(await readFile(join(fixture.workspacePath, path)));
}

function assertWindowsSandboxUnavailable(result: {
  status: string;
  error?: { code: string };
}): boolean {
  if (process.platform !== "win32") return false;
  assert.equal(result.status, "unavailable");
  assert.equal(result.error?.code, "network_sandbox_unavailable");
  return true;
}

test("real pinned mc-asset generates the pilot brick PNG and editable source", async (t) => {
  const fixture = await setup(t);
  const result = await runMcAsset({
    root: fixture.workspace,
    operation: {
      kind: "generate",
      pattern: "brick",
      size: 16,
      palette: "stone",
      seed: 12345,
      output: { png: "brick.png", source: "brick.mcpx" },
    },
    limits: {
      inputBytes: 16 * 1024 * 1024,
      outputBytes: 16 * 1024 * 1024,
      outputFiles: 2,
    },
  });
  if (assertWindowsSandboxUnavailable(result)) return;
  assert.equal(result.status, "passed");
  assert.equal(
    result.tool.revision,
    "bedf67229ab0fdf304f6d40bc0000a27bd05e880",
  );
  assert.equal(result.tool.version, "0.5.0");
  assert.equal(
    await outputHash(fixture, "brick.png"),
    "49e3dffe44b1f9bf058043c6071e53126cb6294ddc228c27b7753dfeb8d9074e",
  );
  assert.equal(
    await outputHash(fixture, "brick.mcpx"),
    "cd651ebbf6aa611528d952aacc63cef109b87bb3ae849cd2265f84b1a275f8e0",
  );
  const generated = inspectPng(
    await readFile(join(fixture.workspacePath, "brick.png")),
    {
      maxEdge: 4096,
      maxPixels: 4096 * 4096,
    },
  );
  assert.equal(generated.width, 16);
  assert.equal(generated.height, 16);
  assert.deepEqual(result.outputs.map((output) => output.path).sort(), [
    "brick.mcpx",
    "brick.png",
  ]);
});

test("identical seeds reproduce bytes and different seeds change generated bytes", async (t) => {
  const fixture = await setup(t);
  const runMcAsset = createMcAssetExecutor(fixture.tool);
  for (const directory of ["run1", "run2", "different"]) {
    await mkdir(join(fixture.workspacePath, directory));
  }
  for (const [directory, seed] of [
    ["run1", 7],
    ["run2", 7],
    ["different", 9],
  ] as const) {
    const result = await runMcAsset({
      root: fixture.workspace,
      operation: {
        kind: "generate",
        pattern: "checker",
        size: 16,
        palette: "iron",
        seed,
        output: {
          png: `${directory}/checker.png`,
          source: `${directory}/checker.mcpx`,
        },
      },
    });
    if (!assertWindowsSandboxUnavailable(result)) {
      assert.equal(result.status, "passed");
    }
  }
  if (process.platform === "win32") return;
  const first = await outputHash(fixture, "run1/checker.png");
  assert.equal(
    first,
    "18b246bcffe4f1c3a3fc24d5fa081665539a0486ee730afa6c8922b0d3b52ef3",
  );
  assert.equal(await outputHash(fixture, "run2/checker.png"), first);
  assert.equal(
    await outputHash(fixture, "run1/checker.mcpx"),
    await outputHash(fixture, "run2/checker.mcpx"),
  );
  assert.notEqual(await outputHash(fixture, "different/checker.png"), first);
});

test("real mc-asset emits a four-frame vertical strip and sibling mcmeta", async (t) => {
  const fixture = await setup(t);
  const runMcAsset = createMcAssetExecutor(fixture.tool);
  await writeFile(join(fixture.workspacePath, "gem.grid"), grid);
  const rendered = await runMcAsset({
    root: fixture.workspace,
    operation: {
      kind: "render",
      input: "gem.grid",
      output: { png: "gem.png", source: "gem.mcpx" },
    },
  });
  if (assertWindowsSandboxUnavailable(rendered)) return;
  assert.equal(rendered.status, "passed");
  assert.equal(
    await outputHash(fixture, "gem.png"),
    "a77d5f4de088f189e0647d256ee8fdc3ed067b6de562636ad90a39db35b325b3",
  );

  const animated = await runMcAsset({
    root: fixture.workspace,
    operation: {
      kind: "animateSweep",
      input: "gem.png",
      angle: 45,
      frameCount: 4,
      frameTimeTicks: 2,
      interpolate: false,
      output: { png: "gem-sweep.png", mcmeta: "gem-sweep.png.mcmeta" },
    },
  });
  assert.equal(animated.status, "passed");
  assert.equal(
    await outputHash(fixture, "gem-sweep.png"),
    "ed8d81a6ca8adbcba01fb0204acdfde618d088a35af445af30d4da0a2712ce67",
  );
  assert.equal(
    await outputHash(fixture, "gem-sweep.png.mcmeta"),
    "59c7b21cf705830c2c2220c4b82084a8eb850d5f156237cacb0e1c415338d839",
  );
  const strip = inspectPng(
    await readFile(join(fixture.workspacePath, "gem-sweep.png")),
    {
      maxEdge: 4096,
      maxPixels: 4096 * 4096,
    },
  );
  assert.equal(strip.width, 16);
  assert.equal(strip.height, 64);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(fixture.workspacePath, "gem-sweep.png.mcmeta"),
        "utf8",
      ),
    ),
    {
      animation: {
        width: 16,
        height: 16,
        frametime: 2,
        frames: [{ index: 0, time: 100 }, 1, 2, 3],
      },
    },
  );
});

test("direct JSON, PNG, and Java routes preserve bytes and record source/export links", async (t) => {
  const fixture = await setup(t);
  await mkdir(join(fixture.workspacePath, "sources"));
  const cases = [
    {
      route: "json" as const,
      source: "sources/model.json",
      output: "exports/model.json",
      contents: Buffer.from(
        '{"parent":"minecraft:block/cube_all","textures":{"all":"voxellume:block/ruby"}}\n',
      ),
    },
    {
      route: "png" as const,
      source: "sources/texture.png",
      output: "exports/texture.png",
      contents: png(2, 2, [
        rgba(255, 0, 0),
        rgba(0, 255, 0),
        rgba(0, 0, 255),
        rgba(255, 255, 255),
      ]),
    },
    {
      route: "java" as const,
      source: "sources/RubyModel.java",
      output: "exports/RubyModel.java",
      contents: Buffer.from(
        "package dev.voxellume; public final class RubyModel {}\n",
      ),
    },
  ];
  for (const asset of cases) {
    await writeFile(join(fixture.workspacePath, asset.source), asset.contents);
    const result = await exportDirectAsset({
      root: fixture.workspace,
      assetId: `direct_${asset.route}`,
      route: asset.route,
      sourcePath: asset.source,
      outputPath: asset.output,
      targetPackId: "java-fabric-1.21.1-r1",
      targetPackRevision: "r1",
    });
    assert.equal(result.manifestEntry.generationRoute, `direct_${asset.route}`);
    assert.equal(result.manifestEntry.sourceSha256, hash(asset.contents));
    assert.equal(result.manifestEntry.exportSha256, hash(asset.contents));
    assert.deepEqual(
      await readFile(join(fixture.workspacePath, asset.output)),
      asset.contents,
    );
  }
});

test("direct routes reject Modded Entity output substituted for Java Block/Item", async (t) => {
  const fixture = await setup(t);
  await mkdir(join(fixture.workspacePath, "sources"));
  await writeFile(
    join(fixture.workspacePath, "sources", "entity.json"),
    '{"format_version":"1.12.0"}\n',
  );
  await assert.rejects(
    exportDirectAsset({
      root: fixture.workspace,
      assetId: "entity_as_java_block",
      route: "json",
      sourceFormat: "modded_entity",
      outputFormat: "java_block_item",
      sourcePath: "sources/entity.json",
      outputPath: "exports/entity.json",
      targetPackId: "java-fabric-1.21.1-r1",
      targetPackRevision: "r1",
    }),
    (error: unknown) => {
      assert.equal(
        error !== null && typeof error === "object" && "code" in error
          ? error.code
          : undefined,
        "incompatible_asset_format",
      );
      return true;
    },
  );
});

async function setupBlockbench(t: TestContext, childSource: string) {
  const fixture = await setup(t);
  const entryPoint = join(fixture.root, "fake-blockbench.mjs");
  await writeFile(entryPoint, childSource);
  await writeFile(
    join(fixture.workspacePath, "source.bbmodel"),
    '{"meta":{"model_format":"java_block"}}\n',
  );
  const tool: BlockbenchTool = {
    executable: process.execPath,
    entryPoint,
    sha256: hash(await readFile(entryPoint)),
    revision: BLOCKBENCH_MCP_REVISION,
    version: BLOCKBENCH_MCP_VERSION,
  };
  return {
    ...fixture,
    tool,
    exportBlockbenchAsset: createBlockbenchExporter(tool),
  };
}

async function assertNoBlockbenchStages(
  fixture: Pick<Fixture, "workspacePath">,
): Promise<void> {
  assert.equal(
    (await readdir(fixture.workspacePath)).some((entry) =>
      entry.startsWith(".voxellume-blockbench-"),
    ),
    false,
  );
}

test("Blockbench child receives exact pinned argv, isolated loopback env, and publishes staged export", async (t) => {
  const fixture = await setupBlockbench(
    t,
    `
    import { readFile, writeFile } from "node:fs/promises";
    const request = JSON.parse(process.argv[5]);
    const source = await readFile(request.file, "utf8");
    const observation = {
      argv: process.argv.slice(2),
      envKeys: Object.keys(process.env).sort(),
      host: process.env.BLOCKBENCH_MCP_HOST,
      riskyEval: process.env.BLOCKBENCH_MCP_RISKY_EVAL,
      allowScripts: process.env.blockbench_mcp_allow_scripts,
      home: process.env.HOME,
      tmpdir: process.env.TMPDIR,
      request,
      source,
    };
    await writeFile(request.output, JSON.stringify({ parent: "minecraft:block/cube_all" }));
    process.stdout.write(JSON.stringify(observation));
  `,
  );
  const result = await fixture.exportBlockbenchAsset({
    root: fixture.workspace,
    sourcePath: "source.bbmodel",
    outputPath: "models/ruby.json",
    projectFormat: "java_block_item",
    applicationVersion: "5.0.1",
    exportSettings: { version: "1.21.1", export_groups: true },
    riskyEval: false,
    desktopHost: "127.0.0.1",
  });
  if (assertWindowsSandboxUnavailable(result)) return;
  assert.equal(result.status, "passed");
  const observed = JSON.parse(result.stdout) as {
    argv: string[];
    envKeys: string[];
    host: string;
    riskyEval: string;
    allowScripts: string;
    home: string;
    tmpdir: string;
    request: Record<string, unknown>;
    source: string;
  };
  assert.deepEqual(observed.argv.slice(0, 2), [
    "--root",
    observed.home ? join(observed.home, "..") : "",
  ]);
  assert.equal(observed.argv[2], "bbmodel_export_java_block");
  assert.deepEqual(observed.request, {
    version: "1.21.1",
    export_groups: true,
    file: "source.bbmodel",
    output: "export.json",
  });
  // The platform sandbox/image may add these fixed locale or Node runtime variables.
  assert.deepEqual(
    observed.envKeys.filter(
      (key) =>
        key !== "__CF_USER_TEXT_ENCODING" &&
        (process.platform !== "linux" ||
          (key !== "NODE_VERSION" &&
            key !== "YARN_VERSION" &&
            key !== "HOSTNAME" &&
            key !== "PWD")),
    ),
    [
      "BLOCKBENCH_MCP_HOST",
      "BLOCKBENCH_MCP_RISKY_EVAL",
      "HOME",
      "NO_COLOR",
      "PATH",
      "TMPDIR",
      "blockbench_mcp_allow_scripts",
    ],
  );
  assert.equal(observed.host, "127.0.0.1");
  assert.equal(observed.riskyEval, "false");
  assert.equal(observed.allowScripts, "false");
  assert.equal(observed.source, '{"meta":{"model_format":"java_block"}}\n');
  assert.deepEqual(result.outputs, [
    {
      path: "models/ruby.json",
      sha256: hash(Buffer.from('{"parent":"minecraft:block/cube_all"}')),
      bytes: 37,
    },
  ]);
  assert.equal(result.sourceSha256, hash(Buffer.from(observed.source)));
  assert.deepEqual(result.provenance, {
    generationRoute: "blockbench",
    projectFormat: "java_block_item",
    applicationVersion: "5.0.1",
    pluginRevision: BLOCKBENCH_MCP_REVISION,
    pluginVersion: BLOCKBENCH_MCP_VERSION,
    exportSettings: { version: "1.21.1", export_groups: true },
    riskyEval: false,
    desktopHost: "127.0.0.1",
  });
  assert.equal(
    await readFile(join(fixture.workspacePath, "source.bbmodel"), "utf8"),
    observed.source,
  );
  await assertNoBlockbenchStages(fixture);
});

test("Blockbench Modded Entity route selects its tool and atomically publishes Java", async (t) => {
  const fixture = await setupBlockbench(
    t,
    `
    import { writeFile } from "node:fs/promises";
    const request = JSON.parse(process.argv[5]);
    await writeFile(request.output, "package dev.voxellume; public final class RubyModel {}\\n");
    process.stdout.write(JSON.stringify({ tool: process.argv[4], request }));
  `,
  );
  await writeFile(
    join(fixture.workspacePath, "source.bbmodel"),
    '{"meta":{"model_format":"modded_entity"}}\n',
  );
  const result = await fixture.exportBlockbenchAsset({
    root: fixture.workspace,
    sourcePath: "source.bbmodel",
    outputPath: "RubyModel.java",
    projectFormat: "modded_entity",
    applicationVersion: "5.0.1",
    exportSettings: { model_name: "RubyModel", flip_y: false },
  });
  if (assertWindowsSandboxUnavailable(result)) return;
  assert.equal(result.status, "passed");
  const observed = JSON.parse(result.stdout) as {
    tool: string;
    request: Record<string, unknown>;
  };
  assert.equal(observed.tool, "bbmodel_export_modded_entity");
  assert.deepEqual(observed.request, {
    model_name: "RubyModel",
    flip_y: false,
    file: "source.bbmodel",
    output: "export.java",
  });
  assert.equal(
    await readFile(join(fixture.workspacePath, "RubyModel.java"), "utf8"),
    "package dev.voxellume; public final class RubyModel {}\n",
  );
  await assertNoBlockbenchStages(fixture);
});

test("Blockbench rejects unpinned revisions and unapproved entry-point hashes before spawning", async (t) => {
  const fixture = await setupBlockbench(t, "process.exit(0);\n");
  const wrongRevision = {
    ...fixture.tool,
    revision: "unpinned" as typeof BLOCKBENCH_MCP_REVISION,
  };
  const request = {
    root: fixture.workspace,
    sourcePath: "source.bbmodel",
    outputPath: "model.json",
    projectFormat: "java_block_item" as const,
    applicationVersion: "5.0.1",
  };
  await assert.rejects(createBlockbenchExporter(wrongRevision)(request), {
    code: "unsupported_tool_revision",
  });
  await assert.rejects(
    createBlockbenchExporter({ ...fixture.tool, sha256: "0".repeat(64) })(
      request,
    ),
    { code: "tool_hash_mismatch" },
  );
  await assert.rejects(
    fixture.exportBlockbenchAsset({
      ...request,
      riskyEval: true as false,
      desktopHost: "0.0.0.0" as "127.0.0.1",
    }),
    { code: "risky_eval_forbidden" },
  );
  await assertNoBlockbenchStages(fixture);
});

test("Blockbench output cap kills the fake child and publishes nothing", async (t) => {
  const fixture = await setupBlockbench(
    t,
    `
    process.stdout.write("x".repeat(1024 * 1024 + 1));
    setInterval(() => {}, 1000);
  `,
  );
  const result = await fixture.exportBlockbenchAsset({
    root: fixture.workspace,
    sourcePath: "source.bbmodel",
    outputPath: "capped.json",
    projectFormat: "java_block_item",
    applicationVersion: "5.0.1",
  });
  if (assertWindowsSandboxUnavailable(result)) {
    assert.deepEqual(result.outputs, []);
    await assertNoBlockbenchStages(fixture);
    return;
  }
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "output_limit_exceeded");
  assert.deepEqual(result.outputs, []);
  await assert.rejects(readFile(join(fixture.workspacePath, "capped.json")), {
    code: "ENOENT",
  });
  await assertNoBlockbenchStages(fixture);
});

test("Blockbench timeout and cancellation map to distinct process results", async (t) => {
  const hangingChild = "setInterval(() => {}, 1000);\n";
  const timedFixture = await setupBlockbench(t, hangingChild);
  const timedOut = await timedFixture.exportBlockbenchAsset({
    root: timedFixture.workspace,
    sourcePath: "source.bbmodel",
    outputPath: "timed.json",
    projectFormat: "java_block_item",
    applicationVersion: "5.0.1",
    timeoutMs: 50,
  });
  if (assertWindowsSandboxUnavailable(timedOut)) {
    assert.deepEqual(timedOut.outputs, []);
    await assertNoBlockbenchStages(timedFixture);
    return;
  }
  assert.equal(timedOut.status, "timed_out");
  assert.deepEqual(timedOut.outputs, []);
  await assertNoBlockbenchStages(timedFixture);

  const cancelledFixture = await setupBlockbench(t, hangingChild);
  const controller = new AbortController();
  // Real process timers are the behavior under test; no fake clock crosses spawn().
  const cancellation = setTimeout(() => controller.abort(), 50);
  const cancelled = await cancelledFixture.exportBlockbenchAsset({
    root: cancelledFixture.workspace,
    sourcePath: "source.bbmodel",
    outputPath: "cancelled.json",
    projectFormat: "java_block_item",
    applicationVersion: "5.0.1",
    signal: controller.signal,
  });
  clearTimeout(cancellation);
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(cancelled.outputs, []);
  await assertNoBlockbenchStages(cancelledFixture);
});

test("Blockbench nonzero exit preserves stderr and existing output survives publication conflict", async (t) => {
  const failedFixture = await setupBlockbench(
    t,
    `
    process.stderr.write("reviewed fake failure");
    process.exit(23);
  `,
  );
  const failed = await failedFixture.exportBlockbenchAsset({
    root: failedFixture.workspace,
    sourcePath: "source.bbmodel",
    outputPath: "failed.json",
    projectFormat: "java_block_item",
    applicationVersion: "5.0.1",
  });
  if (assertWindowsSandboxUnavailable(failed)) {
    assert.deepEqual(failed.outputs, []);
    await assertNoBlockbenchStages(failedFixture);
    return;
  }
  assert.equal(failed.status, "failed");
  assert.equal(failed.stderr, "reviewed fake failure");
  assert.deepEqual(failed.error, {
    code: "blockbench_export_failed",
    detail: "Blockbench exited with 23",
  });
  await assertNoBlockbenchStages(failedFixture);

  const conflictFixture = await setupBlockbench(
    t,
    `
    import { writeFile } from "node:fs/promises";
    await writeFile("export.json", "{}");
  `,
  );
  await writeFile(
    join(conflictFixture.workspacePath, "model.json"),
    "original\n",
  );
  await assert.rejects(
    conflictFixture.exportBlockbenchAsset({
      root: conflictFixture.workspace,
      sourcePath: "source.bbmodel",
      outputPath: "model.json",
      projectFormat: "java_block_item",
      applicationVersion: "5.0.1",
    }),
    { code: "revision_conflict" },
  );
  assert.equal(
    await readFile(join(conflictFixture.workspacePath, "model.json"), "utf8"),
    "original\n",
  );
  await assertNoBlockbenchStages(conflictFixture);
});

test("one changed pixel fails visual baseline comparison without an aesthetic verdict", () => {
  const red = rgba(255, 0, 0);
  const green = rgba(0, 255, 0);
  const baseline = inspectPng(png(2, 2, [red, red, red, red]), {
    maxEdge: 4096,
    maxPixels: 4096 * 4096,
  });
  const actual = inspectPng(png(2, 2, [red, red, red, green]), {
    maxEdge: 4096,
    maxPixels: 4096 * 4096,
  });
  assert.deepEqual(
    compareVisualBaseline({ baseline, actual, threshold: 0.1 }),
    {
      status: "failed",
      checkClass: "visual_diff",
      width: 2,
      height: 2,
      differentPixels: 1,
      totalPixels: 4,
    },
  );
});
