import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { PNG } from "pngjs";

import { checkAssets } from "../../src/core/tools/assets-check.ts";

function pngBytes(width: number, height: number, rgba: readonly [number, number, number, number]): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = rgba[0];
    image.data[offset + 1] = rgba[1];
    image.data[offset + 2] = rgba[2];
    image.data[offset + 3] = rgba[3];
  }
  return PNG.sync.write(image);
}

async function project(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-assets-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "src/main/resources/assets/ruby_tools/textures/item"), { recursive: true });
  await mkdir(join(root, "src/main/resources/assets/ruby_tools/models/item"), { recursive: true });
  await mkdir(join(root, "src/main/resources/assets/ruby_tools/lang"), { recursive: true });
  return root;
}

async function write(root: string, relative: string, contents: Buffer | string): Promise<void> {
  const target = join(root, relative);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents);
}

test("checkAssets accepts a well-formed 16x16 texture", async (t) => {
  const root = await project(t);
  await write(root, "src/main/resources/assets/ruby_tools/textures/item/ruby.png", pngBytes(16, 16, [255, 0, 0, 255]));
  const result = await checkAssets(
    { projectRoot: root, textures: ["src/main/resources/assets/ruby_tools/textures/item/ruby.png::16x16"] },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.textures[0]?.status, "ok");
  assert.deepEqual(result.value.textures[0]?.findings, []);
});

test("checkAssets flags a texture whose size differs from the expectation", async (t) => {
  const root = await project(t);
  await write(root, "src/main/resources/assets/ruby_tools/textures/item/ruby.png", pngBytes(15, 16, [255, 0, 0, 255]));
  const result = await checkAssets(
    { projectRoot: root, textures: ["src/main/resources/assets/ruby_tools/textures/item/ruby.png::16x16"] },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.textures[0]?.status, "failed");
  assert.equal(result.value.textures[0]?.findings[0]?.code, "dimension_mismatch");
});

test("checkAssets reports an undecodable texture", async (t) => {
  const root = await project(t);
  await write(root, "src/main/resources/assets/ruby_tools/textures/item/broken.png", "not a png");
  const result = await checkAssets(
    { projectRoot: root, textures: ["src/main/resources/assets/ruby_tools/textures/item/broken.png"] },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.textures[0]?.findings[0]?.code, "png_invalid");
});

test("checkAssets accepts a model whose textures exist", async (t) => {
  const root = await project(t);
  await write(root, "src/main/resources/assets/ruby_tools/textures/item/ruby.png", pngBytes(16, 16, [255, 0, 0, 255]));
  await write(
    root,
    "src/main/resources/assets/ruby_tools/models/item/ruby.json",
    JSON.stringify({ parent: "item/handheld", textures: { layer0: "ruby_tools:item/ruby" } }),
  );
  const result = await checkAssets(
    { projectRoot: root, models: ["src/main/resources/assets/ruby_tools/models/item/ruby.json"] },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.models[0]?.status, "ok");
});

test("checkAssets flags a model texture that does not exist", async (t) => {
  const root = await project(t);
  await write(
    root,
    "src/main/resources/assets/ruby_tools/models/item/ruby.json",
    JSON.stringify({ textures: { layer0: "ruby_tools:item/missing" } }),
  );
  const result = await checkAssets(
    { projectRoot: root, models: ["src/main/resources/assets/ruby_tools/models/item/ruby.json"] },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.models[0]?.findings[0]?.code, "model_texture_missing");
});

test("checkAssets accepts a vanilla texture reference without touching disk", async (t) => {
  const root = await project(t);
  await write(
    root,
    "src/main/resources/assets/ruby_tools/models/item/ruby.json",
    JSON.stringify({ textures: { layer0: "minecraft:item/stick" } }),
  );
  const result = await checkAssets(
    { projectRoot: root, models: ["src/main/resources/assets/ruby_tools/models/item/ruby.json"] },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.models[0]?.status, "ok");
});

test("checkAssets reports lang keys missing from a locale", async (t) => {
  const root = await project(t);
  await write(
    root,
    "src/main/resources/assets/ruby_tools/lang/en_us.json",
    JSON.stringify({ "item.ruby_tools.ruby": "Ruby", "item.ruby_tools.ruby.tooltip": "%s damage" }),
  );
  await write(
    root,
    "src/main/resources/assets/ruby_tools/lang/de_de.json",
    JSON.stringify({ "item.ruby_tools.ruby": "Rubin" }),
  );
  const result = await checkAssets(
    {
      projectRoot: root,
      lang: {
        baseline: "src/main/resources/assets/ruby_tools/lang/en_us.json",
        compare: ["src/main/resources/assets/ruby_tools/lang/de_de.json"],
      },
    },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(
    result.value.lang.map((finding) => finding.code),
    ["lang_key_missing"],
  );
});

test("checkAssets reports placeholder drift between locales", async (t) => {
  const root = await project(t);
  await write(
    root,
    "src/main/resources/assets/ruby_tools/lang/en_us.json",
    JSON.stringify({ "item.ruby_tools.ruby": "%s damage" }),
  );
  await write(
    root,
    "src/main/resources/assets/ruby_tools/lang/de_de.json",
    JSON.stringify({ "item.ruby_tools.ruby": "%d Schaden" }),
  );
  const result = await checkAssets(
    {
      projectRoot: root,
      lang: {
        baseline: "src/main/resources/assets/ruby_tools/lang/en_us.json",
        compare: ["src/main/resources/assets/ruby_tools/lang/de_de.json"],
      },
    },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(
    result.value.lang.map((finding) => finding.code),
    ["lang_placeholder_mismatch"],
  );
});

test("checkAssets reports required lang keys absent from the baseline", async (t) => {
  const root = await project(t);
  await write(
    root,
    "src/main/resources/assets/ruby_tools/lang/en_us.json",
    JSON.stringify({ "item.ruby_tools.ruby": "Ruby" }),
  );
  const result = await checkAssets(
    {
      projectRoot: root,
      lang: {
        baseline: "src/main/resources/assets/ruby_tools/lang/en_us.json",
        compare: [],
        requiredKeys: ["item.ruby_tools.ruby", "block.ruby_tools.ruby_ore"],
      },
    },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(
    result.value.lang.map((finding) => finding.detail),
    ["block.ruby_tools.ruby_ore"],
  );
});

test("checkAssets compares identical captures as identical", async (t) => {
  const root = await project(t);
  const bytes = pngBytes(8, 8, [10, 20, 30, 255]);
  await write(root, "shots/before.png", bytes);
  await write(root, "shots/after.png", bytes);
  const result = await checkAssets(
    {
      projectRoot: root,
      diff: {
        baseline: "shots/before.png",
        baselineSha256: createHash("sha256").update(bytes).digest("hex"),
        capture: "shots/after.png",
        threshold: 0.1,
        maxDifferentPixels: 0,
      },
    },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.value.diff, { differentPixels: 0, status: "ok" });
});

test("checkAssets fails a capture that differs beyond the budget", async (t) => {
  const root = await project(t);
  const before = pngBytes(8, 8, [10, 20, 30, 255]);
  const after = Buffer.from(before);
  const image = PNG.sync.read(after);
  image.data[0] = 250;
  const changed = PNG.sync.write(image);
  await write(root, "shots/before.png", before);
  await write(root, "shots/after.png", changed);
  const result = await checkAssets(
    {
      projectRoot: root,
      diff: {
        baseline: "shots/before.png",
        baselineSha256: createHash("sha256").update(before).digest("hex"),
        capture: "shots/after.png",
        threshold: 0,
        maxDifferentPixels: 0,
      },
    },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.diff?.status, "failed");
  assert.ok((result.value.diff?.differentPixels ?? 0) > 0);
});

test("checkAssets rejects a baseline whose hash does not match", async (t) => {
  const root = await project(t);
  const bytes = pngBytes(4, 4, [1, 2, 3, 255]);
  await write(root, "shots/before.png", bytes);
  await write(root, "shots/after.png", bytes);
  const result = await checkAssets(
    {
      projectRoot: root,
      diff: {
        baseline: "shots/before.png",
        baselineSha256: "0".repeat(64),
        capture: "shots/after.png",
        threshold: 0.1,
        maxDifferentPixels: 0,
      },
    },
    { cwd: root },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "baseline_hash_mismatch");
});

test("checkAssets rejects paths outside the project root", async (t) => {
  const root = await project(t);
  const result = await checkAssets(
    { projectRoot: root, textures: ["../escape.png"] },
    { cwd: root },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "destination_outside_root");
});
