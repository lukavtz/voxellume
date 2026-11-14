import { packageRoot } from "../core/root.ts";
import type { ToolResult } from "../core/results.ts";
import {
  checkAssets,
  type AssetsCheckRequest,
  type AssetsCheckResult,
} from "../core/tools/assets-check.ts";
import { run, type RunRequest, type RunResult } from "../core/tools/run.ts";
import {
  scaffold,
  type ScaffoldRequest,
  type ScaffoldResult,
} from "../core/tools/scaffold.ts";
import {
  targetInfo,
  type TargetInfoRequest,
  type TargetInfoResult,
} from "../core/tools/target-info.ts";

export interface VoxellumeTools {
  readonly targetInfo: (
    request: TargetInfoRequest,
  ) => Promise<ToolResult<TargetInfoResult>>;
  readonly scaffold: (
    request: ScaffoldRequest,
  ) => Promise<ToolResult<ScaffoldResult>>;
  readonly run: (
    request: RunRequest,
    signal?: AbortSignal,
  ) => Promise<ToolResult<RunResult>>;
  readonly checkAssets: (
    request: AssetsCheckRequest,
  ) => Promise<ToolResult<AssetsCheckResult>>;
}

/** Build the four tool closures for one host working directory. */
export function createVoxellumeTools(cwd: string): VoxellumeTools {
  const root = packageRoot();
  return {
    targetInfo: (request) => targetInfo(request, { packageRoot: root }),
    scaffold: (request) => scaffold(request, { packageRoot: root, cwd }),
    run: (request, signal) =>
      run(request, signal === undefined ? { cwd } : { cwd, signal }),
    checkAssets: (request) => checkAssets(request, { cwd }),
  };
}
