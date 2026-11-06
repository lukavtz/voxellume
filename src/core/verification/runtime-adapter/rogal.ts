import { capabilities } from "./capabilities.ts";
import { createRuntimeLifecycle } from "./lifecycle.ts";
import {
  failure,
  forbiddenCommand,
  unsupported,
  type RuntimeAdapterContext,
} from "./operations.ts";
import { createRuntimeScreenshot } from "./screenshots.ts";
import {
  type RuntimeAdapter,
  type RuntimeCommandInput,
  type RuntimeInput,
  type RuntimeInputAction,
  type RuntimeSettleInput,
  revisions,
} from "./types.ts";

function inputMapping(
  action: RuntimeInputAction,
): { tool: string; args: Record<string, unknown> } | undefined {
  if (action.kind === "key") {
    if (action.holdMs !== undefined) return undefined;
    return {
      tool: "press_key",
      args: {
        key: action.key,
        action: action.action,
        ...(action.holdTicks === undefined
          ? {}
          : { hold_ticks: action.holdTicks }),
        ...(action.modifiers === undefined
          ? {}
          : { modifiers: [...action.modifiers] }),
      },
    };
  }
  if (action.kind === "text") {
    return { tool: "type_text", args: { text: action.text } };
  }
  if (action.kind === "mouse") {
    return {
      tool: "mouse",
      args: {
        action: action.action,
        x: action.x,
        y: action.y,
        ...(action.button === undefined ? {} : { button: action.button }),
        coord_space: action.coordSpace ?? "window",
      },
    };
  }
  return undefined;
}

export function createRogalAdapter(
  context: RuntimeAdapterContext,
): RuntimeAdapter {
  const lifecycle = createRuntimeLifecycle("rogal", context);
  const screenshot = createRuntimeScreenshot("rogal", context);

  return {
    id: "rogal",
    revision: revisions.rogal,
    target: context.options.target,
    capabilities: capabilities("rogal"),
    ...lifecycle,
    worldCreate: async () => unsupported("rogal", "worldCreate"),
    settle: async (input: RuntimeSettleInput) => {
      if (input.ticks === undefined) return unsupported("rogal", "settle");
      if (
        !Number.isSafeInteger(input.ticks) ||
        input.ticks < 1 ||
        input.ticks > 12_000
      ) {
        return failure("rogal", "settle", "failed", "invalid_ticks");
      }
      return context.checkedRequest(
        "settle",
        input.sessionId,
        "advance_ticks",
        { ticks: input.ticks },
        { deadlineMs: input.deadlineMs },
        "settle_failed",
      );
    },
    input: async (input: RuntimeInput) => {
      const mapping = inputMapping(input.action);
      if (mapping === undefined) return unsupported("rogal", "input");
      return context.checkedRequest(
        "input",
        input.sessionId,
        mapping.tool,
        mapping.args,
        { deadlineMs: input.deadlineMs },
        "input_failed",
      );
    },
    command: async (input: RuntimeCommandInput) => {
      if (forbiddenCommand(input.command)) {
        return unsupported("rogal", "command", "command_not_allowed");
      }
      return context.checkedRequest(
        "command",
        input.sessionId,
        "execute_commands",
        { commands: [input.command], wait_ticks: 1 },
        { deadlineMs: input.deadlineMs },
        "command_failed",
      );
    },
    assert: async () => unsupported("rogal", "assert"),
    screenshot,
  };
}
