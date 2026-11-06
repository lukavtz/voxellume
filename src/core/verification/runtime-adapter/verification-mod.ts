import { createRuntimeAssertion } from "./assertions.ts";
import { capabilities } from "./capabilities.ts";
import { createRuntimeLifecycle } from "./lifecycle.ts";
import {
  forbiddenCommand,
  unsupported,
  type RuntimeAdapterContext,
} from "./operations.ts";
import { createRuntimeScreenshot } from "./screenshots.ts";
import {
  type RuntimeAdapter,
  type RuntimeCommandInput,
  type RuntimeInput,
  type RuntimeSettleInput,
  type RuntimeWorldCreateInput,
  revisions,
} from "./types.ts";

export function createVerificationModRuntimeAdapter(
  context: RuntimeAdapterContext,
): RuntimeAdapter {
  const lifecycle = createRuntimeLifecycle("voxellume", context);
  const screenshot = createRuntimeScreenshot("voxellume", context);
  const assert = createRuntimeAssertion("voxellume", context);

  return {
    id: "voxellume",
    revision: revisions.voxellume,
    target: context.options.target,
    capabilities: capabilities("voxellume"),
    ...lifecycle,
    worldCreate: async (input: RuntimeWorldCreateInput) =>
      context.checkedRequest(
        "worldCreate",
        input.sessionId,
        "voxellume.world.create",
        { name: input.name, seed: input.seed, isolated: input.isolated },
        { deadlineMs: input.deadlineMs },
        "world_create_failed",
      ),
    settle: async (input: RuntimeSettleInput) =>
      context.checkedRequest(
        "settle",
        input.sessionId,
        "voxellume.ticks.wait",
        {
          ...(input.ticks === undefined ? {} : { ticks: input.ticks }),
          synchronize: input.synchronize ?? false,
        },
        { deadlineMs: input.deadlineMs },
        "settle_failed",
      ),
    input: async (input: RuntimeInput) =>
      context.checkedRequest(
        "input",
        input.sessionId,
        "voxellume.input",
        { action: input.action },
        { deadlineMs: input.deadlineMs },
        "input_failed",
      ),
    command: async (input: RuntimeCommandInput) => {
      if (forbiddenCommand(input.command)) {
        return unsupported("voxellume", "command", "command_not_allowed");
      }
      return context.checkedRequest(
        "command",
        input.sessionId,
        "voxellume.command",
        { command: input.command },
        { deadlineMs: input.deadlineMs },
        "command_failed",
      );
    },
    assert,
    screenshot,
  };
}
