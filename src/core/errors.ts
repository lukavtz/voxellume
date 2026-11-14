/** Error carrying a stable tool error code from `docs/PLUGIN-SPEC.md`. */
export class CodedError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(detail);
    this.name = "CodedError";
    this.code = code;
  }
}
