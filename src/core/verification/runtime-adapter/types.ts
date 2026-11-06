import { type AuthorizedRoot } from "../../execution/paths.ts";

export const revisions = {
  modlens: "ba2020c226b51858d157bc943ed13f1c6b578514",
  rogal: "c153433ae8b043afee755d885808c519291103af",
  arclight: "d9387740f005fb5f3fe3c4d2cc97787588448f36",
  voxellume: "voxellume-verification-mod",
} as const;

export type RuntimeAdapterId = keyof typeof revisions;
export type RuntimeOperationName =
  | "launch"
  | "worldCreate"
  | "settle"
  | "input"
  | "command"
  | "assert"
  | "screenshot"
  | "cancel"
  | "cleanup";

export interface RuntimeTarget {
  readonly minecraftVersion: string;
  readonly loader: "fabric" | "neoforge" | "forge" | "quilt";
}

export interface RuntimeCapabilities {
  readonly launch: boolean;
  readonly worldCreate: boolean;
  readonly settle: boolean;
  readonly realTicks: boolean;
  readonly input: boolean;
  readonly command: boolean;
  readonly assert: boolean;
  readonly screenshot: boolean;
  readonly cancel: boolean;
  readonly cleanup: boolean;
}

export interface RuntimeSession {
  readonly id: string;
  readonly ownedPids: readonly number[];
}

export type RuntimeOperationResult<T> =
  | {
      readonly status: "passed";
      readonly value: T;
      readonly code?: never;
      readonly adapter?: never;
      readonly operation?: never;
      readonly session?: RuntimeSession;
    }
  | {
      readonly status:
        | "failed"
        | "unsupported"
        | "unavailable"
        | "cancelled"
        | "timed_out";
      readonly code: string;
      readonly adapter: RuntimeAdapterId;
      readonly operation: string;
      readonly value?: never;
      readonly session?: RuntimeSession;
    };

export interface RuntimeOperationDeadline {
  /** Absolute epoch milliseconds; each transport call receives the remaining time. */
  readonly deadlineMs?: number;
}

export interface RuntimeLaunchInput extends RuntimeOperationDeadline {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly mode: "hidden" | "visible";
  readonly javaHome?: string;
}

export interface RuntimeWorldCreateInput extends RuntimeOperationDeadline {
  readonly sessionId: string;
  readonly name: string;
  readonly seed: string;
  readonly isolated: true;
}

export interface RuntimeSettleInput extends RuntimeOperationDeadline {
  readonly sessionId: string;
  readonly ticks?: number;
  readonly synchronize?: boolean;
}

export type RuntimeInputAction =
  | {
      readonly kind: "key";
      readonly key: string;
      readonly action: "tap" | "press" | "release" | "hold";
      readonly holdTicks?: number;
      readonly holdMs?: number;
      readonly modifiers?: readonly string[];
    }
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "mouse";
      readonly action: "click" | "move" | "down" | "up";
      readonly x: number;
      readonly y: number;
      readonly button?: number;
      readonly relative?: boolean;
      readonly coordSpace?: "window" | "gui";
    }
  | {
      readonly kind: "scroll";
      readonly deltaX?: number;
      readonly deltaY: number;
      readonly x?: number;
      readonly y?: number;
    };

export interface RuntimeInput extends RuntimeOperationDeadline {
  readonly sessionId: string;
  readonly action: RuntimeInputAction;
}

export interface RuntimeCommandInput extends RuntimeOperationDeadline {
  readonly sessionId: string;
  readonly command: string;
}

export interface RuntimeAssertInput extends RuntimeOperationDeadline {
  readonly sessionId: string;
  readonly condition?: string;
  readonly timeoutMs?: number;
  readonly scenarioPath?: string;
}

export interface RuntimeScreenshotInput extends RuntimeOperationDeadline {
  readonly sessionId: string;
  readonly path: string;
  readonly maxBytes: number;
}

export interface RuntimeProcessInput extends RuntimeOperationDeadline {
  readonly sessionId: string;
  readonly ownedPids: readonly number[];
}

export interface RuntimeScreenshot {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface RuntimeRequestTiming {
  readonly deadlineMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface RuntimeCallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface RuntimeTransport {
  call(
    tool: string,
    args: Record<string, unknown>,
    options?: RuntimeCallOptions,
  ): Promise<unknown>;
}

export interface RuntimeAdapter {
  readonly id: RuntimeAdapterId;
  readonly revision: string;
  readonly target: RuntimeTarget;
  readonly capabilities: RuntimeCapabilities;
  launch(
    input: RuntimeLaunchInput,
  ): Promise<RuntimeOperationResult<RuntimeSession>>;
  worldCreate(
    input: RuntimeWorldCreateInput,
  ): Promise<RuntimeOperationResult<unknown>>;
  settle(input: RuntimeSettleInput): Promise<RuntimeOperationResult<unknown>>;
  input(input: RuntimeInput): Promise<RuntimeOperationResult<unknown>>;
  command(input: RuntimeCommandInput): Promise<RuntimeOperationResult<unknown>>;
  assert(input: RuntimeAssertInput): Promise<RuntimeOperationResult<unknown>>;
  screenshot(
    input: RuntimeScreenshotInput,
  ): Promise<RuntimeOperationResult<RuntimeScreenshot | Record<string, never>>>;
  cancel(input: RuntimeProcessInput): Promise<RuntimeOperationResult<unknown>>;
  cleanup(input: RuntimeProcessInput): Promise<RuntimeOperationResult<unknown>>;
}

export interface CreateRuntimeAdapterOptions extends RuntimeOperationDeadline {
  readonly target: RuntimeTarget;
  readonly enabledAdapters: readonly RuntimeAdapterId[];
  readonly transport?: RuntimeTransport;
  readonly roots?: {
    readonly scenarios?: AuthorizedRoot;
    readonly screenshots?: AuthorizedRoot;
  };
  readonly verificationMod?: { readonly installed: boolean };
}

export type CreateRuntimeAdapterResult =
  | { readonly status: "available"; readonly adapter: RuntimeAdapter }
  | {
      readonly status: "unavailable";
      readonly code: "runtime_adapter_unavailable";
      readonly target: RuntimeTarget;
    }
  | {
      readonly status: "unavailable";
      readonly code: "multiple_runtime_adapters";
      readonly adapters: readonly RuntimeAdapterId[];
    };

export interface RuntimeQualificationScenario extends RuntimeOperationDeadline {
  readonly launch: RuntimeLaunchInput;
  readonly world: { readonly name: string; readonly seed: string };
  readonly input: RuntimeInputAction;
  readonly assertion: {
    readonly condition?: string;
    readonly timeoutMs?: number;
    readonly scenarioPath?: string;
  };
  readonly screenshot: {
    readonly path: string;
    readonly maxBytes: number;
  };
}
