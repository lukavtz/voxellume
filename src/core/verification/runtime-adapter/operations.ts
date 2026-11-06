import {
  type CreateRuntimeAdapterOptions,
  type RuntimeAdapterId,
  type RuntimeOperationName,
  type RuntimeOperationResult,
  type RuntimeRequestTiming,
  type RuntimeSession,
} from "./types.ts";

export class RuntimeTransportError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "RuntimeTransportError";
    this.code = code;
  }
}

export function passed<T>(value: T): RuntimeOperationResult<T> {
  return { status: "passed", value };
}

export function failure(
  adapter: RuntimeAdapterId,
  operation: RuntimeOperationName,
  status: "failed" | "unsupported" | "unavailable" | "cancelled" | "timed_out",
  code: string,
  session?: RuntimeSession,
): RuntimeOperationResult<never> {
  return {
    status,
    code,
    adapter,
    operation,
    ...(session === undefined ? {} : { session }),
  };
}

export function unsupported(
  adapter: RuntimeAdapterId,
  operation: RuntimeOperationName,
  code = "unsupported_operation",
): RuntimeOperationResult<never> {
  return failure(adapter, operation, "unsupported", code);
}

export function transportFailure(
  adapter: RuntimeAdapterId,
  operation: RuntimeOperationName,
  error: unknown,
): RuntimeOperationResult<never> {
  const code = error instanceof RuntimeTransportError ? error.code : undefined;
  if (code === "cancelled") {
    return failure(adapter, operation, "cancelled", code);
  }
  if (code === "transport_timeout") {
    return failure(adapter, operation, "timed_out", code);
  }
  if (code === "tool_failed") {
    return failure(adapter, operation, "failed", code);
  }
  return failure(
    adapter,
    operation,
    "unavailable",
    code === "request_too_large" ||
      code === "response_too_large" ||
      code === "authentication_failed" ||
      code === "transport_required"
      ? code
      : "transport_unavailable",
  );
}

export function toolFailed(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as {
    success?: unknown;
    matched?: unknown;
    status?: unknown;
    failed?: unknown;
  };
  return (
    result.success === false ||
    result.matched === false ||
    result.status === "failed" ||
    result.status === "error" ||
    (typeof result.failed === "number" && result.failed > 0)
  );
}

export function forbiddenCommand(command: string): boolean {
  return (
    command.includes("\0") ||
    /[\r\n]/.test(command) ||
    /(?:^|[\s/.])(?:mc\.)?server\.command(?:\.run)?(?=$|[\s/])/.test(command) ||
    /(?:^|[\s/.])(?:mc\.)?schematic\.paste(?=$|[\s/])/.test(command)
  );
}

export type RuntimeRequest = (
  operation: RuntimeOperationName,
  sessionId: string | undefined,
  tool: string,
  args: Record<string, unknown>,
  timing?: RuntimeRequestTiming,
) => Promise<RuntimeOperationResult<unknown>>;

export type RuntimeCheckedRequest = (
  operation: RuntimeOperationName,
  sessionId: string | undefined,
  tool: string,
  args: Record<string, unknown>,
  timing: RuntimeRequestTiming,
  failureCode: string,
) => Promise<RuntimeOperationResult<unknown>>;

export interface RuntimeRequests {
  readonly request: RuntimeRequest;
  readonly checkedRequest: RuntimeCheckedRequest;
}

export interface RuntimeAdapterContext extends RuntimeRequests {
  readonly options: CreateRuntimeAdapterOptions;
  readonly pendingCalls: Map<string, Set<AbortController>>;
  readonly sessions: Map<string, RuntimeSession>;
}

export function createRuntimeRequests(
  id: RuntimeAdapterId,
  options: CreateRuntimeAdapterOptions,
  pendingCalls: Map<string, Set<AbortController>>,
): RuntimeRequests {
  async function request(
    operation: RuntimeOperationName,
    sessionId: string | undefined,
    tool: string,
    args: Record<string, unknown>,
    timing: RuntimeRequestTiming = {},
  ): Promise<RuntimeOperationResult<unknown>> {
    if (options.transport === undefined) {
      return failure(id, operation, "unavailable", "transport_required");
    }
    let timeoutMs = timing.timeoutMs;
    const approvedDeadline = timing.deadlineMs ?? options.deadlineMs;
    if (approvedDeadline !== undefined) {
      if (!Number.isFinite(approvedDeadline)) {
        return failure(id, operation, "failed", "invalid_deadline");
      }
      const remaining = Math.floor(approvedDeadline - Date.now());
      if (remaining <= 0) {
        return failure(id, operation, "timed_out", "deadline_exceeded");
      }
      timeoutMs =
        timeoutMs === undefined ? remaining : Math.min(timeoutMs, remaining);
    }
    if (
      timeoutMs !== undefined &&
      (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    ) {
      return failure(id, operation, "failed", "invalid_timeout");
    }
    const controller = new AbortController();
    let owned: Set<AbortController> | undefined;
    if (sessionId !== undefined) {
      owned = pendingCalls.get(sessionId);
      if (owned === undefined) {
        owned = new Set();
        pendingCalls.set(sessionId, owned);
      }
      owned.add(controller);
    }
    try {
      const value = await options.transport.call(tool, args, {
        signal: controller.signal,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
      return passed(value);
    } catch (error) {
      return transportFailure(id, operation, error);
    } finally {
      owned?.delete(controller);
      if (owned?.size === 0) pendingCalls.delete(sessionId!);
    }
  }

  async function checkedRequest(
    operation: RuntimeOperationName,
    sessionId: string | undefined,
    tool: string,
    args: Record<string, unknown>,
    timing: RuntimeRequestTiming,
    failureCode: string,
  ): Promise<RuntimeOperationResult<unknown>> {
    const response = await request(operation, sessionId, tool, args, timing);
    if (response.status === "passed" && toolFailed(response.value)) {
      return failure(id, operation, "failed", failureCode);
    }
    return response;
  }

  return { request, checkedRequest };
}
