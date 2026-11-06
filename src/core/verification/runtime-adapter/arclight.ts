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
  type RuntimeInputAction,
  type RuntimeSettleInput,
  type RuntimeWorldCreateInput,
  revisions,
} from "./types.ts";

function inputMapping(
  action: RuntimeInputAction,
): { tool: string; args: Record<string, unknown> } | undefined {
  if (action.kind === "key") {
    if (
      (action.modifiers !== undefined && action.modifiers.length > 0) ||
      action.holdMs !== undefined ||
      (action.holdTicks !== undefined && action.action !== "hold")
    ) {
      return undefined;
    }
    if (action.action === "hold") {
      if (action.holdTicks === undefined) return undefined;
      return {
        tool: "mc.keyboard.hold",
        args: { key: action.key, ticks: action.holdTicks },
      };
    }
    if (action.action !== "tap") return undefined;
    return { tool: "mc.keyboard.press", args: { key: action.key } };
  }
  if (action.kind === "text") {
    return { tool: "mc.screen.text.type", args: { text: action.text } };
  }
  if (action.kind === "mouse" && action.action === "click") {
    return {
      tool: "mc.screen.click.at",
      args: {
        x: action.x,
        y: action.y,
        ...(action.button === undefined ? {} : { button: action.button }),
      },
    };
  }
  return undefined;
}

export function createArclightAdapter(
  context: RuntimeAdapterContext,
): RuntimeAdapter {
  const lifecycle = createRuntimeLifecycle("arclight", context);
  const screenshot = createRuntimeScreenshot("arclight", context);
  const assert = createRuntimeAssertion("arclight", context);

  return {
    id: "arclight",
    revision: revisions.arclight,
    target: context.options.target,
    capabilities: capabilities("arclight"),
    ...lifecycle,
    worldCreate: async (input: RuntimeWorldCreateInput) =>
      context.checkedRequest(
        "worldCreate",
        input.sessionId,
        "mc.world.join",
        { name: input.name, seed: input.seed, isolated: input.isolated },
        { deadlineMs: input.deadlineMs },
        "world_create_failed",
      ),
    settle: async (input: RuntimeSettleInput) => {
      if (input.synchronize === true) {
        return context.checkedRequest(
          "settle",
          input.sessionId,
          "mc.server.sync",
          {},
          { deadlineMs: input.deadlineMs },
          "settle_failed",
        );
      }
      if (input.ticks !== undefined) {
        return unsupported("arclight", "settle", "real_ticks_unavailable");
      }
      return unsupported("arclight", "settle");
    },
    input: async (input: RuntimeInput) => {
      const mapping = inputMapping(input.action);
      if (mapping === undefined) return unsupported("arclight", "input");
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
        return unsupported("arclight", "command", "command_not_allowed");
      }
      return context.checkedRequest(
        "command",
        input.sessionId,
        "mc.command.run",
        { command: input.command },
        { deadlineMs: input.deadlineMs },
        "command_failed",
      );
    },
    assert,
    screenshot,
  };
}
