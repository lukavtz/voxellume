import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ProcessStatus =
  | "exited"
  | "stopped_by_log"
  | "timed_out"
  | "cancelled"
  | "output_limit_reached"
  | "spawn_failed";

export interface ProcessInvocation {
  /** Absolute or cwd-relative executable. */
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly logPath: string;
  readonly stopPattern?: RegExp;
  readonly signal?: AbortSignal;
  /** Windows only: run the target through a command interpreter prefix. */
  readonly windowsCommandPrefix?: readonly string[];
}

export interface ProcessOutcome {
  readonly status: ProcessStatus;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly tail: readonly string[];
}

const TAIL_LINES = 200;
const MAX_LINE_CHARS = 2000;
const STOP_PATTERN_WINDOW = 4096;
const KILL_GRACE_MS = 5000;

function killTree(child: ChildProcess | undefined): void {
  const pid = child?.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => {
      try {
        child?.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

interface Sink {
  consume(chunk: Buffer): void;
  flush(): void;
  readonly tail: readonly string[];
}

/** Bounded line collector: keeps the last N lines and reports when the cap is hit. */
function createSink(options: {
  readonly maxBytes: number;
  readonly onLimit: () => void;
  readonly onLine: (line: string) => void;
}): Sink {
  const tail: string[] = [];
  let pending = "";
  let bytes = 0;
  let capped = false;

  const push = (line: string): void => {
    const text = line.replace(/\r$/, "");
    tail.push(
      text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text,
    );
    if (tail.length > TAIL_LINES) tail.shift();
    options.onLine(line);
  };

  return {
    consume(chunk) {
      bytes += chunk.byteLength;
      if (bytes > options.maxBytes && !capped) {
        capped = true;
        options.onLimit();
        return;
      }
      if (capped) return;
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) push(line);
    },
    flush() {
      if (pending === "") return;
      push(pending);
      pending = "";
    },
    get tail() {
      return tail;
    },
  };
}

/** Absolute cmd.exe; a bare name would be resolved through PATH and cwd. */
function commandInterpreter(): string | undefined {
  const candidate =
    process.env.ComSpec ??
    join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
  return existsSync(candidate) ? candidate : undefined;
}

function spawnSpec(invocation: ProcessInvocation): {
  readonly file: string;
  readonly args: readonly string[];
} {
  const prefix = invocation.windowsCommandPrefix;
  if (prefix === undefined) {
    return { file: invocation.file, args: invocation.args };
  }
  const interpreter = commandInterpreter();
  if (interpreter === undefined) {
    throw new Error("cmd.exe is not available");
  }
  return {
    file: interpreter,
    args: [...prefix.slice(1), invocation.file, ...invocation.args],
  };
}

/** One supervised process: owns settlement, timers, log stream and child wiring. */
class ProcessRun {
  private readonly invocation: ProcessInvocation;
  private readonly started: number;
  private readonly log: WriteStream;
  private readonly sink: Sink;
  private readonly deferred = Promise.withResolvers<ProcessOutcome>();
  private readonly onAbort = (): void => this.stop("cancelled");
  private child: ChildProcess | undefined;
  private settled = false;
  private logBroken = false;
  private stopped: ProcessStatus | undefined;
  private graceTimer: NodeJS.Timeout | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(invocation: ProcessInvocation, started: number) {
    this.invocation = invocation;
    this.started = started;
    this.log = createWriteStream(invocation.logPath, { flags: "w" });
    this.sink = createSink({
      maxBytes: invocation.maxOutputBytes,
      onLimit: () => this.stop("output_limit_reached"),
      onLine: (line) => this.watch(line),
    });
    this.log.on("error", () => {
      this.logBroken = true;
      killTree(this.child);
      this.finish("spawn_failed", null);
    });
    this.timer = setTimeout(() => this.stop("timed_out"), invocation.timeoutMs);
    this.timer.unref?.();
    invocation.signal?.addEventListener("abort", this.onAbort, {
      once: true,
    });
  }

  start(): Promise<ProcessOutcome> {
    let spec: { readonly file: string; readonly args: readonly string[] };
    try {
      spec = spawnSpec(this.invocation);
    } catch (error) {
      this.failToSpawn(error);
      return this.deferred.promise;
    }
    this.spawnUnder(spec);
    return this.deferred.promise;
  }

  /** Kill the process tree now and give it a bounded grace period to settle. */
  private stop(reason: ProcessStatus): void {
    if (this.stopped !== undefined) return;
    this.stopped = reason;
    killTree(this.child);
    this.graceTimer = setTimeout(
      () => this.finish(reason, null),
      KILL_GRACE_MS,
    );
    this.graceTimer.unref?.();
  }

  private watch(line: string): void {
    if (this.stopped !== undefined) return;
    const matched =
      this.invocation.stopPattern?.test(line.slice(0, STOP_PATTERN_WINDOW)) ===
      true;
    if (matched) this.stop("stopped_by_log");
  }

  private finish(status: ProcessStatus, exitCode: number | null): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    clearTimeout(this.graceTimer);
    this.invocation.signal?.removeEventListener("abort", this.onAbort);
    const outcome: ProcessOutcome = {
      status: this.stopped ?? status,
      exitCode: this.stopped === undefined ? exitCode : null,
      durationMs: Date.now() - this.started,
      tail: this.sink.tail,
    };
    if (this.logBroken) {
      this.deferred.resolve(outcome);
      return;
    }
    this.log.once("close", () => this.deferred.resolve(outcome));
    try {
      this.log.end();
    } catch {
      this.deferred.resolve(outcome);
    }
  }

  private spawnUnder(spec: {
    readonly file: string;
    readonly args: readonly string[];
  }): void {
    let child: ChildProcess;
    try {
      child = spawn(spec.file, [...spec.args], {
        cwd: this.invocation.cwd,
        env: this.invocation.env,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      this.failToSpawn(error);
      return;
    }
    this.child = child;
    this.wire(child);
  }

  private failToSpawn(error: unknown): void {
    this.log.write(`spawn failed: ${String(error)}\n`);
    this.finish("spawn_failed", null);
  }

  private wire(child: ChildProcess): void {
    const onData = (chunk: Buffer): void => {
      this.log.write(chunk);
      this.sink.consume(chunk);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error) => {
      this.log.write(`spawn failed: ${error.message}\n`);
      this.finish("spawn_failed", null);
    });
    child.on("close", (code) => {
      this.sink.flush();
      this.finish(this.stopped ?? "exited", code);
    });
  }
}

export async function executeProcess(
  invocation: ProcessInvocation,
): Promise<ProcessOutcome> {
  const started = Date.now();
  try {
    await mkdir(dirname(invocation.logPath), { recursive: true });
  } catch {
    return { status: "spawn_failed", exitCode: null, durationMs: 0, tail: [] };
  }
  return new ProcessRun(invocation, started).start();
}
