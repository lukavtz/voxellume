import { readdir } from "node:fs/promises";

import {
  readAuthorizedFile,
  resolveAuthorizedPath,
  type AuthorizedRoot,
} from "../../execution/paths.ts";
import { BODY_LIMIT_BYTES } from "./loopback-transport.ts";
import { failure, unsupported } from "./operations.ts";
import {
  type RuntimeAdapterId,
  type RuntimeOperationResult,
} from "./types.ts";

class ScenarioError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function forbiddenScenarioTool(tool: string): boolean {
  const normalized = tool.toLowerCase();
  const unprefixed = normalized.startsWith("mc.")
    ? normalized.slice(3)
    : normalized;
  return (
    unprefixed === "command.run" ||
    unprefixed === "command.suggest" ||
    unprefixed === "server.command" ||
    unprefixed === "server.command.run" ||
    unprefixed === "schematic.paste" ||
    unprefixed.startsWith("schematic.paste.") ||
    normalized === "execute_commands" ||
    normalized === "mc.server.call"
  );
}

function assertScenarioTools(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertScenarioTools(entry);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const step = value as Record<string, unknown>;
  if (typeof step.tool === "string" && forbiddenScenarioTool(step.tool)) {
    throw new ScenarioError("scenario_tool_not_allowed");
  }
  for (const entry of Object.values(step)) assertScenarioTools(entry);
}

export async function validateScenarioDirectory(
  root: AuthorizedRoot,
  scenarioPath: string,
): Promise<string> {
  const absolute = await resolveAuthorizedPath(root, scenarioPath);
  const pending = [scenarioPath];
  for (let index = 0; index < pending.length; index += 1) {
    const relative = pending[index]!;
    const directory = await resolveAuthorizedPath(root, relative);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const child = `${relative.replace(/\/$/, "")}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new ScenarioError("path_escape");
      if (entry.isDirectory()) {
        pending.push(child);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = await readAuthorizedFile(root, child);
      if (file.contents.byteLength > BODY_LIMIT_BYTES) {
        throw new ScenarioError("scenario_too_large");
      }
      let document: unknown;
      try {
        document = JSON.parse(file.contents.toString("utf8")) as unknown;
      } catch {
        throw new ScenarioError("scenario_invalid");
      }
      assertScenarioTools(document);
    }
  }
  return absolute;
}

export function pathFailure(
  id: RuntimeAdapterId,
  operation: "assert" | "screenshot",
  error: unknown,
): RuntimeOperationResult<never> {
  if (
    (error instanceof ScenarioError && error.code === "path_escape") ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      [
        "absolute_path",
        "path_traversal",
        "invalid_path",
        "unsafe_symlink",
        "outside_root",
      ].includes(String(error.code)))
  ) {
    return unsupported(id, operation, "path_escape");
  }
  if (error instanceof ScenarioError) {
    return failure(
      id,
      operation,
      error.code === "scenario_tool_not_allowed" ? "unsupported" : "failed",
      error.code,
    );
  }
  return failure(id, operation, "unavailable", "authorized_path_unavailable");
}
