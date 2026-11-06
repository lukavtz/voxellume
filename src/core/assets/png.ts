import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";

import { PNG } from "pngjs";

import {
  readAuthorizedFile,
  resolveAuthorizedPath,
  type AuthorizedRoot,
} from "../execution/paths.ts";

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

export type AlphaMode = "opaque" | "cutout" | "translucent";
export type Rgba = readonly [number, number, number, number];

export interface TextureSpec {
  readonly width: number;
  readonly height: number;
  readonly alphaMode: AlphaMode;
  readonly allowedAlpha?: readonly number[];
  readonly palette: {
    readonly allowedRgba: readonly Rgba[];
    readonly maxColors: number;
  };
  readonly tileable: boolean;
}

export interface TextureFinding {
  readonly ruleId: string;
  readonly checkClass: "source";
  readonly detail: string;
}

export interface TextureValidationResult {
  readonly status: "passed" | "failed";
  readonly checkClass: "source";
  readonly findings: readonly TextureFinding[];
}

export class AssetError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(detail);
    this.name = "AssetError";
    this.code = code;
  }
}

function limits(limits?: Partial<PngLimits>): PngLimits {
  return { ...PNG_DEFAULT_LIMITS, ...limits };
}

function assertLimits(value: PngLimits): void {
  for (const [name, limit] of Object.entries(value)) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new AssetError(
        "invalid_png_limits",
        `${name} must be a positive integer`,
      );
    }
  }
}

export function inspectPng(
  bytes: Buffer | Uint8Array,
  requestedLimits?: Partial<PngLimits>,
): InspectedPng {
  const cap = limits(requestedLimits);
  assertLimits(cap);
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (source.byteLength > cap.maxBytes) {
    throw new AssetError("input_too_large", "PNG exceeds the input byte limit");
  }
  if (
    source.length < 33 ||
    !source
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    source.readUInt32BE(8) !== 13 ||
    source.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new AssetError("invalid_png", "PNG signature or IHDR is invalid");
  }

  const width = source.readUInt32BE(16);
  const height = source.readUInt32BE(20);
  if (width === 0 || height === 0) {
    throw new AssetError(
      "invalid_dimensions",
      "PNG dimensions must be nonzero",
    );
  }
  if (width * height > cap.maxPixels) {
    throw new AssetError(
      "pixel_limit_exceeded",
      "PNG exceeds the decoded pixel limit",
    );
  }
  if (width > cap.maxEdge || height > cap.maxEdge) {
    throw new AssetError(
      "dimension_limit_exceeded",
      "PNG exceeds the decoded edge limit",
    );
  }

  try {
    const decoded = PNG.sync.read(source, { checkCRC: true });
    if (decoded.width !== width || decoded.height !== height) {
      throw new AssetError(
        "invalid_png",
        "Decoded PNG dimensions differ from IHDR",
      );
    }
    return {
      width,
      height,
      data: decoded.data,
      sha256: createHash("sha256").update(source).digest("hex"),
    };
  } catch (error) {
    if (error instanceof AssetError) throw error;
    throw new AssetError("invalid_png", `PNG decode failed: ${String(error)}`);
  }
}

export async function readPngBounded(
  root: AuthorizedRoot,
  path: string,
  requestedLimits?: Partial<PngLimits>,
  hooks?: { readonly beforeRead?: () => void | Promise<void> },
): Promise<InspectedPng> {
  const cap = limits(requestedLimits);
  assertLimits(cap);
  const resolved = await resolveAuthorizedPath(root, path);
  const before = await stat(resolved);
  if (!before.isFile())
    throw new AssetError("not_regular_file", `Not a file: ${path}`);
  if (before.nlink !== 1) {
    throw new AssetError(
      "hardlink_forbidden",
      `Hard-linked input is forbidden: ${path}`,
    );
  }
  if (before.size > cap.maxBytes) {
    throw new AssetError("input_too_large", "PNG exceeds the input byte limit");
  }
  await hooks?.beforeRead?.();
  const file = await readAuthorizedFile(root, path);
  if (file.stat.nlink !== 1) {
    throw new AssetError(
      "hardlink_forbidden",
      `Hard-linked input is forbidden: ${path}`,
    );
  }
  if (file.stat.size > cap.maxBytes) {
    throw new AssetError("input_too_large", "PNG exceeds the input byte limit");
  }
  return inspectPng(file.contents, cap);
}

export function scalePngNearest(
  bytes: Buffer | Uint8Array,
  factor: number,
): Buffer {
  if (!Number.isSafeInteger(factor) || factor < 1) {
    throw new AssetError(
      "invalid_upscale",
      "Nearest-neighbor scale must be a positive integer",
    );
  }
  const source = inspectPng(bytes);
  const width = source.width * factor;
  const height = source.height * factor;
  if (
    width > PNG_DEFAULT_LIMITS.maxEdge ||
    height > PNG_DEFAULT_LIMITS.maxEdge
  ) {
    throw new AssetError(
      "dimension_limit_exceeded",
      "Scaled PNG exceeds the edge limit",
    );
  }
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset =
        (Math.floor(y / factor) * source.width + Math.floor(x / factor)) * 4;
      source.data.copy(
        output.data,
        (y * width + x) * 4,
        sourceOffset,
        sourceOffset + 4,
      );
    }
  }
  return PNG.sync.write(output, {
    colorType: 6,
    inputColorType: 6,
    inputHasAlpha: true,
    deflateLevel: 9,
    deflateStrategy: 3,
    filterType: 0,
  });
}

function finding(ruleId: string, detail: string): TextureFinding {
  return { ruleId, checkClass: "source", detail };
}

function rgbaAt(image: InspectedPng, offset: number): Rgba {
  return [
    image.data[offset]!,
    image.data[offset + 1]!,
    image.data[offset + 2]!,
    image.data[offset + 3]!,
  ];
}

export function validateTexture(
  image: InspectedPng,
  spec: TextureSpec,
): TextureValidationResult {
  const findings: TextureFinding[] = [];
  if (image.width !== spec.width || image.height !== spec.height) {
    findings.push(
      finding(
        "VX-TEX-001-DIMENSIONS",
        "Texture dimensions differ from TextureSpec",
      ),
    );
  }

  const allowed = new Set(
    spec.palette.allowedRgba.map((color) => color.slice(0, 3).join(",")),
  );
  const colors = new Set<string>();
  let paletteRejected = false;
  let alphaRejected = false;
  let hasVisiblePixel = false;
  const allowedAlpha =
    spec.allowedAlpha === undefined ? null : new Set(spec.allowedAlpha);

  for (let offset = 0; offset < image.data.length; offset += 4) {
    const color = rgbaAt(image, offset);
    const key = color.slice(0, 3).join(",");
    const alpha = color[3];
    if (alpha !== 0) {
      colors.add(key);
      if (!allowed.has(key)) paletteRejected = true;
      hasVisiblePixel = true;
    }
    if (allowedAlpha?.has(alpha) === false) {
      alphaRejected = true;
    } else if (spec.alphaMode === "opaque" && alpha !== 255) {
      alphaRejected = true;
    } else if (spec.alphaMode === "cutout" && alpha !== 0 && alpha !== 255) {
      alphaRejected = true;
    }
  }
  if (!hasVisiblePixel) alphaRejected = true;
  if (paletteRejected || colors.size > spec.palette.maxColors) {
    findings.push(
      finding(
        "VX-TEX-003-PALETTE",
        "Texture exceeds its palette or color budget",
      ),
    );
  }
  if (alphaRejected) {
    findings.push(
      finding(
        "VX-TEX-004-ALPHA",
        "Texture violates its alpha policy or is empty",
      ),
    );
  }

  if (spec.tileable) {
    let seamless = true;
    for (let y = 0; y < image.height && seamless; y += 1) {
      const left = y * image.width * 4;
      const right = (y * image.width + image.width - 1) * 4;
      if (rgbaAt(image, left).join(",") !== rgbaAt(image, right).join(","))
        seamless = false;
    }
    for (let x = 0; x < image.width && seamless; x += 1) {
      const top = x * 4;
      const bottom = ((image.height - 1) * image.width + x) * 4;
      if (rgbaAt(image, top).join(",") !== rgbaAt(image, bottom).join(","))
        seamless = false;
    }
    if (!seamless) {
      findings.push(
        finding(
          "VX-TEX-005-TILING-WRAP",
          "Opposite texture edges do not match",
        ),
      );
    }
  }

  return {
    status: findings.length === 0 ? "passed" : "failed",
    checkClass: "source",
    findings,
  };
}
