import { failure, passed } from "./operations.ts";
import {
  type RuntimeAdapter,
  type RuntimeOperationResult,
  type RuntimeQualificationScenario,
  type RuntimeSession,
} from "./types.ts";

export async function qualifyRuntimeAdapter(
  adapter: RuntimeAdapter,
  scenario: RuntimeQualificationScenario,
): Promise<RuntimeOperationResult<{ readonly session: RuntimeSession }>> {
  let session: RuntimeSession = {
    id: scenario.launch.projectId,
    ownedPids: [],
  };
  let outcome: RuntimeOperationResult<unknown> | undefined;
  const deadlineMs = scenario.deadlineMs ?? scenario.launch.deadlineMs;

  try {
    const launched = await adapter.launch({
      ...scenario.launch,
      ...(deadlineMs === undefined ? {} : { deadlineMs }),
    });
    if (launched.status === "passed") session = launched.value;
    else if (launched.session !== undefined) session = launched.session;

    if (launched.status !== "passed") {
      outcome = launched;
    } else {
      const stages: Array<() => Promise<RuntimeOperationResult<unknown>>> = [
        () =>
          adapter.worldCreate({
            sessionId: session.id,
            name: scenario.world.name,
            seed: scenario.world.seed,
            isolated: true,
            ...(deadlineMs === undefined ? {} : { deadlineMs }),
          }),
        () =>
          adapter.input({
            sessionId: session.id,
            action: scenario.input,
            ...(deadlineMs === undefined ? {} : { deadlineMs }),
          }),
        () =>
          adapter.assert({
            sessionId: session.id,
            ...scenario.assertion,
            ...(deadlineMs === undefined ? {} : { deadlineMs }),
          }),
        () =>
          adapter.screenshot({
            sessionId: session.id,
            ...scenario.screenshot,
            ...(deadlineMs === undefined ? {} : { deadlineMs }),
          }),
      ];
      for (const stage of stages) {
        const result = await stage();
        if (result.status !== "passed") {
          outcome = result;
          break;
        }
      }
    }
  } catch {
    outcome = failure(
      adapter.id,
      "launch",
      "failed",
      "qualification_failed",
      session,
    );
  }

  try {
    const cancelled = await adapter.cancel({
      sessionId: session.id,
      ownedPids: session.ownedPids,
    });
    if (outcome === undefined && cancelled.status !== "passed") {
      outcome = cancelled;
    }
  } catch {
    outcome ??= failure(
      adapter.id,
      "cancel",
      "failed",
      "cancel_failed",
      session,
    );
  }

  try {
    const cleaned = await adapter.cleanup({
      sessionId: session.id,
      ownedPids: session.ownedPids,
    });
    if (outcome === undefined && cleaned.status !== "passed") outcome = cleaned;
  } catch {
    outcome ??= failure(
      adapter.id,
      "cleanup",
      "failed",
      "cleanup_failed",
      session,
    );
  }

  if (outcome !== undefined && outcome.status !== "passed") return outcome;
  return passed({ session });
}
