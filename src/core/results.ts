export const TOOL_SCHEMA_VERSION = "voxellume-tool-1.0.0" as const;

export interface ToolSuccess<T> {
  readonly schemaVersion: typeof TOOL_SCHEMA_VERSION;
  readonly status: "ok";
  readonly value: T;
}

export interface ToolFailure {
  readonly schemaVersion: typeof TOOL_SCHEMA_VERSION;
  readonly status: "error";
  readonly error: { readonly code: string; readonly detail: string };
}

export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export function ok<T>(value: T): ToolSuccess<T> {
  return { schemaVersion: TOOL_SCHEMA_VERSION, status: "ok", value };
}

export function fail(code: string, detail: string): ToolFailure {
  return {
    schemaVersion: TOOL_SCHEMA_VERSION,
    status: "error",
    error: { code, detail },
  };
}

export function serializeToolResult(result: ToolResult<unknown>): string {
  return JSON.stringify(result);
}
