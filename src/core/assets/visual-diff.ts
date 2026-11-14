import pixelmatch from "pixelmatch";

import { AssetError, type InspectedPng } from "./png.ts";

export interface VisualDiffResult {
  readonly status: "passed" | "failed";
  readonly checkClass: "visual_diff";
  readonly width: number;
  readonly height: number;
  readonly differentPixels: number;
  readonly totalPixels: number;
}

export function compareVisualBaseline(options: {
  readonly baseline: InspectedPng;
  readonly actual: InspectedPng;
  readonly threshold: number;
  readonly maxDifferentPixels?: number;
}): VisualDiffResult {
  const { baseline, actual, threshold } = options;
  const budget = options.maxDifferentPixels ?? 0;
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    throw new AssetError(
      "visual_dimension_mismatch",
      "Visual comparison requires equal dimensions",
    );
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new AssetError(
      "invalid_visual_threshold",
      "Pixelmatch threshold must be between 0 and 1",
    );
  }
  if (!Number.isSafeInteger(budget) || budget < 0) {
    throw new AssetError(
      "invalid_visual_budget",
      "maxDifferentPixels must be a non-negative integer",
    );
  }
  const differentPixels = pixelmatch(
    baseline.data,
    actual.data,
    null,
    baseline.width,
    baseline.height,
    { threshold, includeAA: true },
  );
  return {
    status: differentPixels <= budget ? "passed" : "failed",
    checkClass: "visual_diff",
    width: baseline.width,
    height: baseline.height,
    differentPixels,
    totalPixels: baseline.width * baseline.height,
  };
}
