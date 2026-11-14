import { createHash } from "node:crypto";

import { PNG } from "pngjs";

import { CodedError } from "../errors.ts";

export const PNG_DEFAULT_LIMITS = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxEdge: 4096,
  maxPixels: 4096 * 4096,
});

export interface PngLimits {
  readonly maxBytes: number;
  readonly maxEdge: number;
  readonly maxPixels: number;
}

export interface InspectedPng {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
  readonly sha256: string;
}

export { CodedError as AssetError };

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function resolveLimits(requested?: Partial<PngLimits>): PngLimits {
  const limits: PngLimits = { ...PNG_DEFAULT_LIMITS, ...requested };
  for (const [name, limit] of Object.entries(limits)) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new CodedError(
        "invalid_png_limits",
        `${name} must be a positive integer`,
      );
    }
  }
  return limits;
}

function assertHeader(source: Buffer): {
  readonly width: number;
  readonly height: number;
} {
  if (
    source.length < 33 ||
    !source.subarray(0, 8).equals(SIGNATURE) ||
    source.readUInt32BE(8) !== 13 ||
    source.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new CodedError("invalid_png", "PNG signature or IHDR is invalid");
  }
  const width = source.readUInt32BE(16);
  const height = source.readUInt32BE(20);
  if (width === 0 || height === 0) {
    throw new CodedError(
      "invalid_dimensions",
      "PNG dimensions must be nonzero",
    );
  }
  return { width, height };
}

function assertWithinLimits(
  width: number,
  height: number,
  limits: PngLimits,
): void {
  if (width * height > limits.maxPixels) {
    throw new CodedError(
      "pixel_limit_exceeded",
      "PNG exceeds the decoded pixel limit",
    );
  }
  if (width > limits.maxEdge || height > limits.maxEdge) {
    throw new CodedError(
      "dimension_limit_exceeded",
      "PNG exceeds the decoded edge limit",
    );
  }
}

function decode(
  source: Buffer,
  width: number,
  height: number,
): { readonly data: Buffer; readonly sha256: string } {
  let decoded;
  try {
    decoded = PNG.sync.read(source, { checkCRC: true });
  } catch (error) {
    throw new CodedError("invalid_png", `PNG decode failed: ${String(error)}`);
  }
  if (decoded.width !== width || decoded.height !== height) {
    throw new CodedError(
      "invalid_png",
      "Decoded PNG dimensions differ from IHDR",
    );
  }
  return {
    data: decoded.data,
    sha256: createHash("sha256").update(source).digest("hex"),
  };
}

/** Validate PNG structure against limits, then decode it. */
export function inspectPng(
  bytes: Buffer | Uint8Array,
  requestedLimits?: Partial<PngLimits>,
): InspectedPng {
  const limits = resolveLimits(requestedLimits);
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (source.byteLength > limits.maxBytes) {
    throw new CodedError("input_too_large", "PNG exceeds the input byte limit");
  }
  const { width, height } = assertHeader(source);
  assertWithinLimits(width, height, limits);
  const { data, sha256 } = decode(source, width, height);
  return { width, height, data, sha256 };
}
