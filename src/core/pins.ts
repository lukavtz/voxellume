import { readFile } from "node:fs/promises";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import { TOOL_SCHEMA_VERSION, type ToolFailure } from "./results.ts";

export const PINS_SCHEMA_VERSION = "voxellume-pins-1.0.0" as const;

export const LOADER_IDS = ["fabric", "forge", "neoforge", "quilt"] as const;
export const MAPPINGS_IDS = ["mojang", "none", "parchment-layer", "quilt"] as const;
export const JDK_VERSIONS = [21, 25] as const;

export type LoaderId = (typeof LOADER_IDS)[number];
export type MappingsId = (typeof MAPPINGS_IDS)[number];
export type JdkVersion = (typeof JDK_VERSIONS)[number];

export interface TargetPin {
  readonly id: string;
  readonly minecraft: string;
  readonly loader: LoaderId;
  readonly loaderVersion: string | null;
  readonly apiVersion: string | null;
  readonly gradlePlugin: string | null;
  readonly gradlePluginVersion: string | null;
  readonly jdk: JdkVersion;
  readonly gradle: string | null;
  readonly mappings: MappingsId;
  readonly template: string | null;
}

export interface PinsFile {
  readonly schemaVersion: string;
  readonly pins: readonly TargetPin[];
}

export class PinsError extends Error {
  readonly code = "pins_invalid";
  constructor(detail: string) {
    super(detail);
    this.name = "PinsError";
  }
}

const optionalText: AnySchema = {
  type: ["string", "null"],
  minLength: 1,
  pattern: "\\S",
};

const pinSchema: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "minecraft",
    "loader",
    "loaderVersion",
    "apiVersion",
    "gradlePlugin",
    "gradlePluginVersion",
    "jdk",
    "gradle",
    "mappings",
    "template",
  ],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9][a-z0-9.-]*$" },
    minecraft: { type: "string", pattern: "^\\d{1,4}(\\.\\d{1,4}){1,2}$" },
    loader: { enum: LOADER_IDS },
    loaderVersion: optionalText,
    apiVersion: optionalText,
    gradlePlugin: optionalText,
    gradlePluginVersion: optionalText,
    jdk: { enum: JDK_VERSIONS },
    gradle: optionalText,
    mappings: { enum: MAPPINGS_IDS },
    template: optionalText,
  },
};

const pinsSchema: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "pins"],
  properties: {
    schemaVersion: { const: PINS_SCHEMA_VERSION },
    pins: { type: "array", minItems: 1, items: pinSchema },
  },
};

const validate = new Ajv2020({ allErrors: false, strict: true }).compile(pinsSchema);

/** Parse and validate a pins file. Throws `PinsError` on any structural problem. */
export async function loadPins(path: string): Promise<readonly TargetPin[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new PinsError(`cannot read ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PinsError(`invalid JSON: ${(error as Error).message}`);
  }
  if (!validate(parsed)) {
    const first = validate.errors?.[0];
    const at = first?.instancePath === "" ? "" : `${first?.instancePath}: `;
    throw new PinsError(`${at}${first?.message ?? "invalid pins file"}`);
  }
  const file = parsed as PinsFile;
  const seen = new Set<string>();
  for (const pin of file.pins) {
    if (seen.has(pin.id)) throw new PinsError(`duplicate pin id: ${pin.id}`);
    seen.add(pin.id);
  }
  return file.pins;
}

export interface PinQuery {
  readonly id?: string;
  readonly minecraft?: string;
  readonly loader?: string;
}

/** First pin matching every provided filter, in file order. */
export function findPin(
  pins: readonly TargetPin[],
  query: PinQuery,
): TargetPin | undefined {
  return pins.find(
    (pin) =>
      (query.id === undefined || pin.id === query.id) &&
      (query.minecraft === undefined || pin.minecraft === query.minecraft) &&
      (query.loader === undefined || pin.loader === query.loader),
  );
}

/** Convert a thrown pins failure into a tool error envelope. */
export function pinsFailure(error: unknown): ToolFailure {
  if (error instanceof PinsError) {
    return {
      schemaVersion: TOOL_SCHEMA_VERSION,
      status: "error",
      error: { code: error.code, detail: error.message },
    };
  }
  throw error;
}
