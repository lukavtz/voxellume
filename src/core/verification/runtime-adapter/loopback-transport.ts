import { RuntimeTransportError } from "./operations.ts";
import { type RuntimeTransport } from "./types.ts";

export const BODY_LIMIT_BYTES = 256 * 1024;
const DEFAULT_CALL_TIMEOUT_MS = 10_000;

function normalizeContent(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return value;
  }
  if (
    value.type === "text" &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    try {
      return JSON.parse(value.text) as unknown;
    } catch {
      return value.text;
    }
  }
  if (
    value.type === "image" &&
    "data" in value &&
    typeof value.data === "string"
  ) {
    return {
      kind: "image",
      ...("mimeType" in value ? { mimeType: value.mimeType } : {}),
      data: Buffer.from(value.data, "base64"),
    };
  }
  return value;
}

async function readBoundedResponse(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > BODY_LIMIT_BYTES) {
    await response.body?.cancel();
    throw new RuntimeTransportError("response_too_large");
  }
  if (response.body === null) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > BODY_LIMIT_BYTES) {
      await reader.cancel();
      throw new RuntimeTransportError("response_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, length);
}

export function createLoopbackRuntimeTransport(options: {
  readonly endpoint: string;
  readonly token: string;
  readonly timeoutMs?: number;
}): RuntimeTransport {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    throw new RuntimeTransportError("loopback_required");
  }
  const authority = /^https?:\/\/([^\/?#]*)/.exec(options.endpoint)?.[1];
  const rawHostname = authority?.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : authority?.split(":", 1)[0];
  if (
    (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
    (rawHostname !== "127.0.0.1" && rawHostname !== "[::1]") ||
    endpoint.username !== "" ||
    endpoint.password !== ""
  ) {
    throw new RuntimeTransportError("loopback_required");
  }
  if (options.token.trim() === "") {
    throw new RuntimeTransportError("token_required");
  }

  const endpointValue = endpoint.toString();
  const token = options.token;
  return {
    async call(tool, args, callOptions): Promise<unknown> {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      });
      if (Buffer.byteLength(body) > BODY_LIMIT_BYTES) {
        throw new RuntimeTransportError("request_too_large");
      }

      const controller = new AbortController();
      const timeoutMs =
        callOptions?.timeoutMs ?? options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
      const timer = setTimeout(
        () => controller.abort(new RuntimeTransportError("transport_timeout")),
        timeoutMs,
      );
      const abort = () => {
        controller.abort(new RuntimeTransportError("cancelled"));
      };
      callOptions?.signal?.addEventListener("abort", abort, { once: true });
      if (callOptions?.signal?.aborted) abort();

      try {
        const response = await fetch(endpointValue, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body,
          redirect: "error",
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel();
          throw new RuntimeTransportError("authentication_failed");
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new RuntimeTransportError("http_error");
        }
        const bytes = await readBoundedResponse(response);
        let envelope: unknown;
        try {
          envelope = JSON.parse(bytes.toString("utf8")) as unknown;
        } catch {
          throw new RuntimeTransportError("invalid_response");
        }
        if (typeof envelope !== "object" || envelope === null) {
          throw new RuntimeTransportError("invalid_response");
        }
        if (!("result" in envelope)) {
          throw new RuntimeTransportError(
            "error" in envelope ? "tool_failed" : "invalid_response",
          );
        }
        const result = envelope.result;
        if (typeof result !== "object" || result === null) {
          throw new RuntimeTransportError("invalid_response");
        }
        if ("isError" in result && result.isError === true) {
          throw new RuntimeTransportError("tool_failed");
        }
        if (!("content" in result) || !Array.isArray(result.content)) {
          return result;
        }
        const content = result.content.map(normalizeContent);
        return content.length === 1 ? content[0] : content;
      } catch (error) {
        if (error instanceof RuntimeTransportError) throw error;
        if (callOptions?.signal?.aborted) {
          throw new RuntimeTransportError("cancelled");
        }
        if (controller.signal.aborted) {
          throw new RuntimeTransportError("transport_timeout");
        }
        throw new RuntimeTransportError("transport_unavailable");
      } finally {
        clearTimeout(timer);
        callOptions?.signal?.removeEventListener("abort", abort);
      }
    },
  };
}
