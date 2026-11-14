import assert from "node:assert/strict";
import test from "node:test";

import { PNG } from "pngjs";

import {
  AssetError,
  PNG_DEFAULT_LIMITS,
  inspectPng,
} from "../../src/core/assets/png.ts";
import { compareVisualBaseline } from "../../src/core/assets/visual-diff.ts";

type Rgba = readonly [number, number, number, number];

const RED: Rgba = [255, 0, 0, 255];
const GREEN: Rgba = [0, 255, 0, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

function png(width: number, height: number, pixels: readonly Rgba[]): Buffer {
  const image = new PNG({ width, height });
  for (let index = 0; index < width * height; index += 1) {
    const pixel = pixels[index % pixels.length] ?? CLEAR;
    image.data[index * 4] = pixel[0];
    image.data[index * 4 + 1] = pixel[1];
    image.data[index * 4 + 2] = pixel[2];
    image.data[index * 4 + 3] = pixel[3];
  }
  return PNG.sync.write(image);
}

function codeOf(error: unknown): string {
  assert.ok(error instanceof AssetError, `expected AssetError, got ${String(error)}`);
  return error.code;
}

test("inspectPng rejects a buffer without a PNG signature", () => {
  assert.throws(() => inspectPng(Buffer.from("not a png at all, definitely not")), (error: unknown) =>
    codeOf(error) === "invalid_png",
  );
});

test("inspectPng enforces the declared pixel budget before decoding", () => {
  const bytes = Buffer.from(png(1, 1, [RED]));
  bytes.writeUInt32BE(PNG_DEFAULT_LIMITS.maxEdge + 1, 16);
  bytes.writeUInt32BE(PNG_DEFAULT_LIMITS.maxEdge + 1, 20);
  assert.throws(() => inspectPng(bytes), (error: unknown) => codeOf(error) === "pixel_limit_exceeded");
});

test("inspectPng enforces the byte cap", () => {
  const bytes = png(2, 2, [RED]);
  assert.throws(
    () => inspectPng(bytes, { maxBytes: bytes.byteLength - 1 }),
    (error: unknown) => codeOf(error) === "input_too_large",
  );
});

test("inspectPng reports dimensions and hash", () => {
  const image = inspectPng(png(2, 2, [RED, GREEN]));
  assert.equal(image.width, 2);
  assert.equal(image.height, 2);
  assert.match(image.sha256, /^[a-f0-9]{64}$/);
});

test("inspectPng rejects an image whose header declares a missing body", () => {
  const bytes = png(2, 2, [RED]).subarray(0, 33);
  assert.throws(() => inspectPng(bytes), (error: unknown) => codeOf(error) === "invalid_png");
});

test("compareVisualBaseline counts a single changed pixel", () => {
  const baseline = inspectPng(png(2, 2, [RED, RED, RED, RED]));
  const actual = inspectPng(png(2, 2, [RED, RED, RED, GREEN]));
  assert.deepEqual(compareVisualBaseline({ baseline, actual, threshold: 0.1 }), {
    status: "failed",
    checkClass: "visual_diff",
    width: 2,
    height: 2,
    differentPixels: 1,
    totalPixels: 4,
  });
});

test("compareVisualBaseline honours a pixel budget", () => {
  const baseline = inspectPng(png(2, 2, [RED, RED, RED, RED]));
  const actual = inspectPng(png(2, 2, [RED, RED, RED, GREEN]));
  assert.equal(
    compareVisualBaseline({ baseline, actual, threshold: 0.1, maxDifferentPixels: 1 }).status,
    "passed",
  );
});

test("compareVisualBaseline rejects different sizes and bad thresholds", () => {
  const small = inspectPng(png(2, 2, [RED]));
  const large = inspectPng(png(4, 4, [RED]));
  assert.throws(
    () => compareVisualBaseline({ baseline: small, actual: large, threshold: 0.1 }),
    (error: unknown) => codeOf(error) === "visual_dimension_mismatch",
  );
  assert.throws(
    () => compareVisualBaseline({ baseline: small, actual: small, threshold: 2 }),
    (error: unknown) => codeOf(error) === "invalid_visual_threshold",
  );
});
