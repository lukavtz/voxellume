import { createArclightAdapter } from "./arclight.ts";
import { selectedUpstream } from "./capabilities.ts";
import { createModlensAdapter } from "./modlens.ts";
import {
  createRuntimeRequests,
  type RuntimeAdapterContext,
} from "./operations.ts";
import { createRogalAdapter } from "./rogal.ts";
import {
  type CreateRuntimeAdapterOptions,
  type CreateRuntimeAdapterResult,
  type RuntimeSession,
} from "./types.ts";
import { createVerificationModRuntimeAdapter } from "./verification-mod.ts";

export function createRuntimeAdapter(
  options: CreateRuntimeAdapterOptions,
): CreateRuntimeAdapterResult {
  const upstream = options.enabledAdapters.filter(
    (id, index, ids) => id !== "voxellume" && ids.indexOf(id) === index,
  );
  if (upstream.length > 1) {
    return {
      status: "unavailable",
      code: "multiple_runtime_adapters",
      adapters: upstream,
    };
  }

  const selected =
    selectedUpstream(options.target, options.enabledAdapters) ??
    (options.verificationMod?.installed === true ? "voxellume" : undefined);
  if (selected === undefined) {
    return {
      status: "unavailable",
      code: "runtime_adapter_unavailable",
      target: options.target,
    };
  }

  const pendingCalls = new Map<string, Set<AbortController>>();
  const sessions = new Map<string, RuntimeSession>();
  const context: RuntimeAdapterContext = {
    options,
    pendingCalls,
    sessions,
    ...createRuntimeRequests(selected, options, pendingCalls),
  };
  const adapter =
    selected === "modlens"
      ? createModlensAdapter(context)
      : selected === "rogal"
        ? createRogalAdapter(context)
        : selected === "arclight"
          ? createArclightAdapter(context)
          : createVerificationModRuntimeAdapter(context);
  return { status: "available", adapter };
}
