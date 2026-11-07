import {
  failure,
  unsupported,
  type RuntimeAdapterContext,
} from "./operations.ts";
import { pathFailure, validateScenarioDirectory } from "./scenarios.ts";
import {
  type RuntimeAssertInput,
  type RuntimeOperationResult,
} from "./types.ts";

export function createRuntimeAssertion(
  id: "arclight" | "voxellume",
  context: RuntimeAdapterContext,
): (input: RuntimeAssertInput) => Promise<RuntimeOperationResult<unknown>> {
  return async function assert(
    input: RuntimeAssertInput,
  ): Promise<RuntimeOperationResult<unknown>> {
    if (input.scenarioPath !== undefined) {
      const root = context.options.roots?.scenarios;
      if (root === undefined) {
        return failure(id, "assert", "unavailable", "scenario_root_required");
      }
      let directory: string;
      try {
        directory = await validateScenarioDirectory(root, input.scenarioPath);
      } catch (error) {
        return pathFailure(id, "assert", error);
      }
      return context.checkedRequest(
        "assert",
        input.sessionId,
        id === "arclight" ? "mc.scenario.batch.run" : "voxellume.assert",
        id === "arclight"
          ? { directory }
          : { scenarioPath: input.scenarioPath },
        { deadlineMs: input.deadlineMs, timeoutMs: input.timeoutMs },
        "assertion_failed",
      );
    }
    if (input.condition === undefined) return unsupported(id, "assert");
    return context.checkedRequest(
      "assert",
      input.sessionId,
      id === "arclight" ? "mc.condition.wait" : "voxellume.assert",
      {
        condition: input.condition,
        ...(input.timeoutMs === undefined
          ? {}
          : { timeoutMs: input.timeoutMs }),
      },
      { deadlineMs: input.deadlineMs, timeoutMs: input.timeoutMs },
      "assertion_failed",
    );
  };
}
