import { capabilities } from "./capabilities.ts";
import { createRuntimeLifecycle } from "./lifecycle.ts";
import {
  unsupported,
  type RuntimeAdapterContext,
} from "./operations.ts";
import { createRuntimeScreenshot } from "./screenshots.ts";
import {
  type RuntimeAdapter,
  type RuntimeInput,
  type RuntimeInputAction,
  type RuntimeSettleInput,
  revisions,
} from "./types.ts";

function inputMapping(
  action: RuntimeInputAction,
): { tool: string; args: Record<string, unknown> } | undefined {
  let command: Record<string, unknown>;
  if (action.kind === "key") {
    if (
      (action.modifiers !== undefined && action.modifiers.length > 0) ||
      action.holdTicks !== undefined
    ) {
      return undefined;
    }
    command = {
      type: "key",
      key: action.key,
      down: action.action !== "release",
      ...(action.action === "tap" ? { holdMs: 50 } : {}),
      ...(action.holdMs === undefined ? {} : { holdMs: action.holdMs }),
    };
  } else if (action.kind === "text") {
    command = { type: "text", text: action.text };
  } else if (action.kind === "mouse") {
    command =
      action.action === "move"
        ? {
            type: "mouse_move",
            x: action.x,
            y: action.y,
            relative: action.relative ?? false,
          }
        : {
            type: "mouse_button",
            button: action.button ?? 1,
            down: action.action !== "up",
          };
  } else {
    command = {
      type: "scroll",
      deltaX: action.deltaX ?? 0,
      deltaY: action.deltaY,
    };
  }
  return { tool: "runtime", args: { action: "command", command } };
}

export function createModlensAdapter(
  context: RuntimeAdapterContext,
): RuntimeAdapter {
  const lifecycle = createRuntimeLifecycle("modlens", context);
  const screenshot = createRuntimeScreenshot("modlens", context);

  return {
    id: "modlens",
    revision: revisions.modlens,
    target: context.options.target,
    capabilities: capabilities("modlens"),
    ...lifecycle,
    worldCreate: async () => unsupported("modlens", "worldCreate"),
    settle: async (input: RuntimeSettleInput) => {
      if (input.ticks === undefined) {
        return context.checkedRequest(
          "settle",
          input.sessionId,
          "runtime",
          { action: "status", sessionId: input.sessionId },
          { deadlineMs: input.deadlineMs },
          "settle_failed",
        );
      }
      return unsupported("modlens", "settle", "real_ticks_unavailable");
    },
    input: async (input: RuntimeInput) => {
      const mapping = inputMapping(input.action);
      if (mapping === undefined) return unsupported("modlens", "input");
      return context.checkedRequest(
        "input",
        input.sessionId,
        mapping.tool,
        { ...mapping.args, sessionId: input.sessionId },
        { deadlineMs: input.deadlineMs },
        "input_failed",
      );
    },
    command: async () => unsupported("modlens", "command"),
    assert: async () => unsupported("modlens", "assert"),
    screenshot,
  };
}
