import { fail, type ToolFailure } from "./results.ts";

/** Error carrying a stable tool error code from `docs/PLUGIN-SPEC.md`. */
export class CodedError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(detail);
    this.name = "CodedError";
    this.code = code;
  }
}

/**
 * Turn any thrown value into a tool envelope: coded failures keep their code
 * (optionally translated), everything else becomes `internal_error`.
 */
export function failureOf(
  error: unknown,
  translate: (code: string) => string = (code) => code,
): ToolFailure {
  const detail = error instanceof Error ? error.message : String(error);
  return error instanceof CodedError
    ? fail(translate(error.code), detail)
    : fail("internal_error", detail);
}
