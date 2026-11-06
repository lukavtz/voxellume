import {
  type RuntimeAdapterId,
  type RuntimeCapabilities,
  type RuntimeTarget,
} from "./types.ts";

export function capabilities(id: RuntimeAdapterId): RuntimeCapabilities {
  switch (id) {
    case "modlens":
      return {
        launch: true,
        worldCreate: false,
        settle: true,
        realTicks: false,
        input: true,
        command: false,
        assert: false,
        screenshot: true,
        cancel: true,
        cleanup: true,
      };
    case "rogal":
      return {
        launch: false,
        worldCreate: false,
        settle: true,
        realTicks: true,
        input: true,
        command: true,
        assert: false,
        screenshot: true,
        cancel: false,
        cleanup: true,
      };
    case "arclight":
      return {
        launch: false,
        worldCreate: true,
        settle: true,
        realTicks: false,
        input: true,
        command: true,
        assert: true,
        screenshot: true,
        cancel: true,
        cleanup: true,
      };
    case "voxellume":
      return {
        launch: true,
        worldCreate: true,
        settle: true,
        realTicks: true,
        input: true,
        command: true,
        assert: true,
        screenshot: true,
        cancel: true,
        cleanup: true,
      };
  }
}

export function selectedUpstream(
  target: RuntimeTarget,
  enabled: readonly RuntimeAdapterId[],
): "modlens" | "rogal" | "arclight" | undefined {
  if (target.minecraftVersion === "26.3" && enabled.includes("modlens")) {
    return "modlens";
  }
  if (
    target.minecraftVersion === "26.2" &&
    target.loader === "fabric" &&
    enabled.includes("rogal")
  ) {
    return "rogal";
  }
  if (
    target.minecraftVersion === "1.21.1" &&
    (target.loader === "fabric" || target.loader === "neoforge") &&
    enabled.includes("arclight")
  ) {
    return "arclight";
  }
  return undefined;
}
