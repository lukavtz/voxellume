import { setTimeout as delay } from "node:timers/promises";

import {
  failure,
  passed,
  RuntimeTransportError,
  toolFailed,
  type RuntimeAdapterContext,
} from "./operations.ts";
import {
  type RuntimeAdapterId,
  type RuntimeLaunchInput,
  type RuntimeOperationResult,
  type RuntimeProcessInput,
  type RuntimeSession,
} from "./types.ts";

const PROCESS_TERM_TIMEOUT_MS = 5_000;

async function terminateOwnedPids(pids: readonly number[]): Promise<void> {
  const unique = [...new Set(pids)];
  if (
    unique.some(
      (pid) => !Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid,
    )
  ) {
    throw new RuntimeTransportError("invalid_owned_pid");
  }

  const pending = new Set<number>();
  for (const pid of unique) {
    try {
      process.kill(pid, "SIGTERM");
      pending.add(pid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }

  const deadline = Date.now() + PROCESS_TERM_TIMEOUT_MS;
  while (pending.size > 0 && Date.now() < deadline) {
    for (const pid of pending) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH")
          pending.delete(pid);
        else throw error;
      }
    }
    if (pending.size > 0) await delay(25);
  }
  for (const pid of pending) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

export interface RuntimeLifecycle {
  launch(
    input: RuntimeLaunchInput,
  ): Promise<RuntimeOperationResult<RuntimeSession>>;
  cancel(input: RuntimeProcessInput): Promise<RuntimeOperationResult<unknown>>;
  cleanup(input: RuntimeProcessInput): Promise<RuntimeOperationResult<unknown>>;
}

export function createRuntimeLifecycle(
  id: RuntimeAdapterId,
  context: RuntimeAdapterContext,
): RuntimeLifecycle {
  const { pendingCalls, sessions, request, checkedRequest } = context;
  async function launch(
    input: RuntimeLaunchInput,
  ): Promise<RuntimeOperationResult<RuntimeSession>> {
    if (id !== "modlens" && id !== "voxellume") {
      return failure(id, "launch", "unsupported", "unsupported_operation");
    }
    const response = await request(
      "launch",
      undefined,
      id === "modlens" ? "runtime" : "voxellume.launch",
      id === "modlens"
        ? {
            action: "launch",
            projectId: input.projectId,
            ...(input.javaHome === undefined
              ? {}
              : { javaHome: input.javaHome }),
          }
        : {
            projectId: input.projectId,
            projectRoot: input.projectRoot,
            mode: input.mode,
          },
      { deadlineMs: input.deadlineMs },
    );
    if (response.status !== "passed") return response;
    if (toolFailed(response.value)) {
      return failure(id, "launch", "failed", "launch_failed");
    }
    const value = response.value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return failure(id, "launch", "failed", "launch_failed");
    }
    const pid = "pid" in value ? value.pid : undefined;
    if (
      typeof pid !== "number" ||
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      pid === process.pid
    ) {
      return failure(id, "launch", "failed", "launch_failed");
    }
    const sessionId =
      "sessionId" in value && typeof value.sessionId === "string"
        ? value.sessionId
        : "id" in value && typeof value.id === "string"
          ? value.id
          : input.projectId;
    if (sessions.has(sessionId)) {
      return failure(id, "launch", "failed", "session_already_launched");
    }
    const session = { id: sessionId, ownedPids: [pid] };
    sessions.set(sessionId, session);
    return passed(session);
  }

  async function cancel(
    input: RuntimeProcessInput,
  ): Promise<RuntimeOperationResult<unknown>> {
    if (id === "rogal") {
      return failure(id, "cancel", "unsupported", "unsupported_operation");
    }
    const pending = pendingCalls.get(input.sessionId);
    if (pending !== undefined) {
      for (const controller of pending) controller.abort();
    }
    if (id === "modlens") {
      const response = await checkedRequest(
        "cancel",
        input.sessionId,
        "runtime",
        {
          action: "command",
          sessionId: input.sessionId,
          command: { type: "release_all" },
        },
        { deadlineMs: input.deadlineMs },
        "cancel_failed",
      );
      if (response.status !== "passed") return response;
    }
    return passed({ status: "unknown" });
  }

  async function cleanup(
    input: RuntimeProcessInput,
  ): Promise<RuntimeOperationResult<unknown>> {
    const tracked = sessions.get(input.sessionId)?.ownedPids ?? [];
    const launched = new Set(tracked);
    if (input.ownedPids.some((pid) => !launched.has(pid))) {
      return failure(id, "cleanup", "failed", "unowned_pid");
    }
    try {
      await terminateOwnedPids(tracked);
      sessions.delete(input.sessionId);
      pendingCalls.delete(input.sessionId);
      return passed({ ownedPids: tracked });
    } catch {
      return failure(id, "cleanup", "failed", "cleanup_failed");
    }
  }

  return { launch, cancel, cleanup };
}
