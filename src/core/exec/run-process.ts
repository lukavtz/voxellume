import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

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

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => {});
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
    tail.push(line.replace(/\r$/, ""));
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

function spawnSpec(invocation: ProcessInvocation): {
  readonly file: string;
  readonly args: readonly string[];
} {
  const prefix = invocation.windowsCommandPrefix;
  if (prefix === undefined) {
    return { file: invocation.file, args: invocation.args };
  }
  return {
    file: prefix[0] ?? "cmd.exe",
    args: [...prefix.slice(1), invocation.file, ...invocation.args],
  };
}

export async function executeProcess(
  invocation: ProcessInvocation,
): Promise<ProcessOutcome> {
  const started = Date.now();
  await mkdir(dirname(invocation.logPath), { recursive: true });
  const log = createWriteStream(invocation.logPath, { flags: "w" });
  const { promise, resolve } = Promise.withResolvers<ProcessOutcome>();

  let child: ChildProcess | undefined;
  let settled = false;
  let stopped: ProcessStatus | undefined;

  const sink = createSink({
    maxBytes: invocation.maxOutputBytes,
    onLimit: () => stop("output_limit_reached"),
    onLine: (line) => {
      if (stopped === undefined && invocation.stopPattern?.test(line) === true) {
        stop("stopped_by_log");
      }
    },
  });

  function finish(status: ProcessStatus, exitCode: number | null): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    invocation.signal?.removeEventListener("abort", onAbort);
    log.end(() => {
      resolve({
        status: stopped ?? status,
        exitCode: stopped === undefined ? exitCode : null,
        durationMs: Date.now() - started,
        tail: sink.tail,
      });
    });
  }

  function stop(reason: ProcessStatus): void {
    if (stopped !== undefined) return;
    stopped = reason;
    killTree(child?.pid);
  }

  const timer = setTimeout(() => stop("timed_out"), invocation.timeoutMs);
  timer.unref?.();
  const onAbort = (): void => stop("cancelled");
  invocation.signal?.addEventListener("abort", onAbort, { once: true });

  const spec = spawnSpec(invocation);
  try {
    child = spawn(spec.file, [...spec.args], {
      cwd: invocation.cwd,
      env: invocation.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    log.write(`spawn failed: ${String(error)}\n`);
    finish("spawn_failed", null);
    return promise;
  }

  const onData = (chunk: Buffer): void => {
    log.write(chunk);
    sink.consume(chunk);
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  child.on("error", (error) => {
    log.write(`spawn failed: ${error.message}\n`);
    finish("spawn_failed", null);
  });

  child.on("close", (code) => {
    sink.flush();
    finish(stopped ?? "exited", code);
  });

  return promise;
}
