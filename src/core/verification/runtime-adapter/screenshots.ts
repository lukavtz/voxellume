import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { basename } from "node:path";

import {
  readAuthorizedFile,
  resolveAuthorizedPath,
  writeAuthorizedFile,
} from "../../execution/paths.ts";
import {
  failure,
  toolFailed,
  unsupported,
  type RuntimeAdapterContext,
} from "./operations.ts";
import { pathFailure } from "./scenarios.ts";
import {
  type RuntimeAdapterId,
  type RuntimeOperationResult,
  type RuntimeScreenshot,
  type RuntimeScreenshotInput,
} from "./types.ts";

const SCREENSHOT_LIMIT_BYTES = 2 * 1024 ** 3;

function imageBytes(value: unknown): Buffer | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const bytes = imageBytes(entry);
      if (bytes !== undefined) return bytes;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  if ("kind" in value && value.kind === "image" && "data" in value) {
    return Buffer.isBuffer(value.data) ? value.data : undefined;
  }
  if (
    "type" in value &&
    value.type === "image" &&
    "data" in value &&
    typeof value.data === "string" &&
    "mimeType" in value &&
    typeof value.mimeType === "string" &&
    value.mimeType.startsWith("image/")
  ) {
    return Buffer.from(value.data, "base64");
  }
  return undefined;
}

export function createRuntimeScreenshot(
  id: RuntimeAdapterId,
  context: RuntimeAdapterContext,
): (
  input: RuntimeScreenshotInput,
) => Promise<
  RuntimeOperationResult<RuntimeScreenshot | Record<string, never>>
> {
  const { options, checkedRequest } = context;

  return async function screenshot(
    input: RuntimeScreenshotInput,
  ): Promise<
    RuntimeOperationResult<RuntimeScreenshot | Record<string, never>>
  > {
    const root = options.roots?.screenshots;
    if (root === undefined) {
      return failure(
        id,
        "screenshot",
        "unavailable",
        "screenshot_root_required",
      );
    }
    if (
      !Number.isSafeInteger(input.maxBytes) ||
      input.maxBytes < 0 ||
      input.maxBytes > SCREENSHOT_LIMIT_BYTES
    ) {
      return failure(id, "screenshot", "failed", "invalid_screenshot_limit");
    }
    try {
      const outputPath = await resolveAuthorizedPath(root, input.path);
      try {
        const existing = await lstat(outputPath);
        return existing.isSymbolicLink()
          ? unsupported(id, "screenshot", "path_escape")
          : failure(id, "screenshot", "failed", "screenshot_output_exists");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } catch (error) {
      return pathFailure(id, "screenshot", error);
    }

    let response: RuntimeOperationResult<unknown>;
    if (id === "rogal") {
      response = await checkedRequest(
        "screenshot",
        input.sessionId,
        "take_screenshot",
        {},
        { deadlineMs: input.deadlineMs },
        "screenshot_failed",
      );
    } else if (id === "arclight") {
      response = await checkedRequest(
        "screenshot",
        input.sessionId,
        "mc.screenshot.take",
        { name: basename(input.path) },
        { deadlineMs: input.deadlineMs },
        "screenshot_failed",
      );
    } else if (id === "modlens") {
      response = await checkedRequest(
        "screenshot",
        input.sessionId,
        "runtime",
        {
          action: "command",
          sessionId: input.sessionId,
          command: { type: "screenshot" },
        },
        { deadlineMs: input.deadlineMs },
        "screenshot_failed",
      );
      if (
        response.status === "passed" &&
        imageBytes(response.value) === undefined
      ) {
        const value = response.value;
        const artifactName =
          typeof value === "object" &&
          value !== null &&
          "artifactName" in value &&
          typeof value.artifactName === "string"
            ? value.artifactName
            : basename(input.path);
        if (!/^[a-zA-Z0-9._-]+\.png$/.test(artifactName)) {
          return failure(id, "screenshot", "failed", "screenshot_failed");
        }
        response = await checkedRequest(
          "screenshot",
          input.sessionId,
          "runtime",
          {
            action: "artifact",
            sessionId: input.sessionId,
            artifactName,
          },
          { deadlineMs: input.deadlineMs },
          "screenshot_failed",
        );
      }
    } else {
      response = await checkedRequest(
        "screenshot",
        input.sessionId,
        "voxellume.screenshot",
        { path: input.path },
        { deadlineMs: input.deadlineMs },
        "screenshot_failed",
      );
    }
    if (response.status !== "passed") return response;
    if (toolFailed(response.value)) {
      return failure(id, "screenshot", "failed", "screenshot_failed");
    }

    let bytes: Buffer;
    const inline = imageBytes(response.value);
    try {
      if (inline !== undefined) {
        bytes = inline;
        if (bytes.byteLength > input.maxBytes) {
          return failure(id, "screenshot", "failed", "screenshot_too_large");
        }
        await writeAuthorizedFile(root, {
          path: input.path,
          contents: bytes,
          expectedRevision: null,
        });
      } else {
        const file = await readAuthorizedFile(root, input.path);
        if (
          file.stat.kind !== "file" ||
          file.stat.nlink !== 1 ||
          file.stat.size !== file.contents.byteLength
        ) {
          return failure(id, "screenshot", "failed", "screenshot_unsafe_file");
        }
        bytes = file.contents;
        if (bytes.byteLength > input.maxBytes) {
          return failure(id, "screenshot", "failed", "screenshot_too_large");
        }
      }
    } catch (error) {
      const denied = pathFailure(id, "screenshot", error);
      if (denied.code === "path_escape") return denied;
      return failure(id, "screenshot", "failed", "screenshot_write_failed");
    }
    return {
      status: "passed",
      value: {
        path: input.path,
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    };
  };
}
