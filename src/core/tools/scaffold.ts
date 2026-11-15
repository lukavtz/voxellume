import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import { CodedError, failureOf } from "../errors.ts";
import { resolveInsideRoot } from "../fs-guard.ts";
import { PinsError, loadPins, pinsInvalid } from "../pins.ts";
import { ok, type ToolResult } from "../results.ts";
import {
  applySubstitutions,
  isTextPath,
  normalizeNewlines,
  renamePath,
  type ModMetadata,
} from "./scaffold/substitute.ts";

export type { ModMetadata } from "./scaffold/substitute.ts";

const DEFAULT_PIN = "java-fabric-1.21.1";
const MOD_ID = /^[a-z][a-z0-9_]{1,63}$/;
const JAVA_PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export interface ScaffoldRequest {
  readonly destination: string;
  readonly pinId?: string;
  readonly mod: ModMetadata;
}

export interface ScaffoldResult {
  readonly destination: string;
  readonly pinId: string;
  readonly files: readonly string[];
  readonly notes: readonly string[];
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CodedError(
      "invalid_request",
      `${field} must be a non-empty string`,
    );
  }
  if (/[\r\n]/.test(value)) {
    throw new CodedError(
      "invalid_request",
      `${field} must not contain line breaks`,
    );
  }
  return value;
}

function validateIdentity(mod: ModMetadata): void {
  if (!MOD_ID.test(mod.modId ?? "")) {
    throw new CodedError(
      "invalid_request",
      "modId must match ^[a-z][a-z0-9_]{1,63}$",
    );
  }
  if (!JAVA_PACKAGE.test(mod.javaPackage ?? "")) {
    throw new CodedError(
      "invalid_request",
      "javaPackage must match ^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$",
    );
  }
}

function validateAuthors(authors: readonly string[]): void {
  if (!Array.isArray(authors) || authors.length === 0) {
    throw new CodedError(
      "invalid_request",
      "authors must be a non-empty array of names",
    );
  }
  for (const author of authors) requireText(author, "authors[]");
}

function validateMod(mod: ModMetadata): void {
  if (typeof mod !== "object" || mod === null) {
    throw new CodedError("invalid_request", "mod must be an object");
  }
  validateIdentity(mod);
  for (const field of ["name", "version", "description", "license"] as const) {
    requireText(mod[field], field);
  }
  if (/\s/.test(mod.version)) {
    throw new CodedError(
      "invalid_request",
      "version must not contain whitespace",
    );
  }
  validateAuthors(mod.authors);
}

async function prepareDestination(path: string): Promise<void> {
  let info;
  try {
    info = await stat(path);
  } catch {
    await mkdir(path, { recursive: true });
    return;
  }
  if (!info.isDirectory()) {
    throw new CodedError("destination_not_empty", `${path} is not a directory`);
  }
  const entries = await readdir(path);
  if (entries.length > 0) {
    throw new CodedError("destination_not_empty", `${path} is not empty`);
  }
}

async function listTemplate(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(prefix === "" ? root : join(root, prefix), {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory())
      files.push(...(await listTemplate(root, relativePath)));
    else files.push(relativePath);
  }
  return files.sort();
}

async function resolveTemplate(
  packageRoot: string,
  pinId: string,
): Promise<{ readonly pinId: string; readonly templateDir: string }> {
  let pins;
  try {
    pins = await loadPins(join(packageRoot, "targets", "pins.json"));
  } catch (error) {
    if (error instanceof PinsError) throw error;
    throw pinsInvalid(String(error));
  }
  const pin = pins.find((entry) => entry.id === pinId);
  if (pin === undefined) {
    throw new CodedError("pin_not_found", pinId);
  }
  if (pin.template === null) {
    throw new CodedError("template_missing", `pin ${pinId} has no template`);
  }
  const templatesDir = join(packageRoot, "templates");
  const templateDir = join(templatesDir, pin.template);
  const inside = relative(templatesDir, templateDir);
  if (inside.startsWith("..") || isAbsolute(inside)) {
    throw new CodedError(
      "template_missing",
      `pin ${pinId} has an invalid template path`,
    );
  }
  try {
    if (!(await stat(templateDir)).isDirectory())
      throw new Error("not a directory");
  } catch {
    throw new CodedError(
      "template_missing",
      `template directory ${pin.template} is absent`,
    );
  }
  return { pinId, templateDir };
}

async function copyTemplate(
  templateDir: string,
  destination: string,
  mod: ModMetadata,
): Promise<readonly string[]> {
  const templateFiles = await listTemplate(templateDir);
  const created: string[] = [];
  for (const templateFile of templateFiles) {
    const source = join(templateDir, templateFile);
    const targetRelative = renamePath(templateFile, mod);
    const target = join(destination, targetRelative);
    await mkdir(dirname(target), { recursive: true });
    if (isTextPath(templateFile)) {
      const text = await readFile(source, "utf8");
      const rewritten = normalizeNewlines(
        applySubstitutions(text, mod),
        targetRelative,
      );
      await writeFile(target, rewritten, "utf8");
    } else {
      await copyFile(source, target);
    }
    if (basename(targetRelative) === "gradlew") {
      await chmod(target, 0o755);
    }
    created.push(targetRelative);
  }
  return created.sort();
}

export async function scaffold(
  request: ScaffoldRequest,
  options: { readonly packageRoot: string; readonly cwd: string },
): Promise<ToolResult<ScaffoldResult>> {
  try {
    if (
      typeof request.destination !== "string" ||
      request.destination.trim() === ""
    ) {
      throw new CodedError(
        "invalid_request",
        "destination must be a non-empty string",
      );
    }
    validateMod(request.mod);
    const resolved = await resolveTemplate(
      options.packageRoot,
      request.pinId ?? DEFAULT_PIN,
    );
    const destination = await resolveInsideRoot(
      options.cwd,
      request.destination,
    );
    await prepareDestination(destination);
    const files = await copyTemplate(
      resolved.templateDir,
      destination,
      request.mod,
    );
    return ok({
      destination: request.destination,
      pinId: resolved.pinId,
      files,
      notes: ["class names kept as ExampleMod/ExampleModClient"],
    });
  } catch (error) {
    return failureOf(error);
  }
}
