import { join } from "node:path";

import { findPin, loadPins, pinsFailure, type TargetPin } from "../pins.ts";
import { ok, type ToolResult } from "../results.ts";

export const TOOL_NAMES = [
  "minecraft_target_info",
  "minecraft_project_scaffold",
  "minecraft_run",
  "minecraft_assets_check",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface TargetInfoRequest {
  readonly id?: string;
  readonly minecraft?: string;
  readonly loader?: string;
}

export interface TargetInfoResult {
  readonly pins: readonly TargetPin[];
  readonly tools: readonly ToolName[];
}

export async function targetInfo(
  request: TargetInfoRequest,
  options: { readonly packageRoot: string },
): Promise<ToolResult<TargetInfoResult>> {
  let pins: readonly TargetPin[];
  try {
    pins = await loadPins(join(options.packageRoot, "targets", "pins.json"));
  } catch (error) {
    return pinsFailure(error);
  }
  const filters = [request.id, request.minecraft, request.loader].filter(
    (value): value is string => value !== undefined,
  );
  const matched =
    filters.length === 0
      ? pins
      : pins.filter((pin) => findPin([pin], request) !== undefined);
  return ok({ pins: matched, tools: TOOL_NAMES });
}
