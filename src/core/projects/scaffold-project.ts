import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import {
  grantAuthorizedRoot,
  readAuthorizedFile,
  releaseAuthorizedRoot,
  writeAuthorizedFile,
} from "../execution/paths.ts";
import {
  MOD_SPEC_SCHEMA_VERSION,
  validateModSpec,
  type ModSpec,
} from "../spec/mod-spec.ts";
import { canonicalJson, sha256 } from "../targets/canonical-json.ts";
import type { TargetLoader, TargetPack } from "../targets/target-pack.ts";

const MANIFEST_PATH = ".voxellume/scaffold.json";
const MOD_SPEC_PATH = "voxellume.mod.json";
const MANIFEST_SCHEMA_VERSION = "voxellume-scaffold-1.0.0";
const LOADERS = new Set<TargetLoader>(["fabric", "neoforge", "forge", "quilt"]);

export interface ScaffoldModMetadata {
  readonly modId: string;
  readonly namespace: string;
  readonly javaPackage: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly authors: readonly string[];
  readonly license: string;
}

export interface ScaffoldProjectRequest {
  readonly destination: string;
  readonly target: TargetPack;
  readonly targetPackRoot: string;
  readonly mod: ScaffoldModMetadata;
  readonly loaders?: readonly TargetLoader[];
}

export type ScaffoldProjectResult =
  | {
      readonly status: "scaffolded";
      readonly createdPaths: readonly string[];
      readonly modSpec: ModSpec;
    }
  | {
      readonly status: "unsupported";
      readonly code: "unsupported_target";
      readonly targetPackId: string;
      readonly targetStatus: TargetPack["status"];
    }
  | {
      readonly status: "conflict";
      readonly code: "existing_file_conflict";
      readonly conflicts: readonly string[];
    };

interface TemplateFile {
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly contents: Buffer;
  readonly mode: number;
}

interface ScaffoldManifest {
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  readonly targetPackId: string;
  readonly targetPackRevision: number;
  readonly modId: string;
  readonly ownedPaths: readonly string[];
  readonly fileSha256: Readonly<Record<string, string>>;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safePath(value: string): string {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  ) {
    throw new Error(`Unsafe scaffold path: ${JSON.stringify(value)}`);
  }
  const parts = value.split("/");
  if (
    parts.some((part) => part.length === 0 || part === "." || part === "..") ||
    parts[0] === ".git"
  ) {
    throw new Error(`Unsafe scaffold path: ${JSON.stringify(value)}`);
  }
  return value;
}

function validateMod(mod: ScaffoldModMetadata): void {
  const identifier = /^[a-z][a-z0-9_]{1,63}$/;
  const javaPackage = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
  if (!identifier.test(mod.modId) || !identifier.test(mod.namespace)) {
    throw new TypeError(
      "modId and namespace must be valid Minecraft identifiers",
    );
  }
  if (!javaPackage.test(mod.javaPackage)) {
    throw new TypeError("javaPackage must be a valid lowercase Java package");
  }
  const strings = [
    mod.name,
    mod.version,
    mod.description,
    mod.license,
    ...mod.authors,
  ];
  if (
    mod.authors.length === 0 ||
    strings.some(
      (value) =>
        typeof value !== "string" ||
        value.length === 0 ||
        /[\0\r\n]/.test(value),
    )
  ) {
    throw new TypeError("Mod metadata must be non-empty single-line strings");
  }
}

function className(modId: string): string {
  return modId
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join("");
}

function quotedContents(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function replaceAuthors(contents: string, authors: readonly string[]): string {
  return contents.replace(
    /("authors"\s*:\s*)\[([\s\S]*?)\]/,
    (_match, prefix: string, body: string) => {
      if (!body.includes("\n")) {
        return `${prefix}${JSON.stringify(authors)}`;
      }
      const opening = body.match(/^\s*/)?.[0] ?? "\n\t\t";
      const closing = body.match(/\s*$/)?.[0] ?? "\n\t";
      return `${prefix}[${opening}${authors
        .map((author) => JSON.stringify(author))
        .join(`,${opening}`)}${closing}]`;
    },
  );
}

function substituteText(
  path: string,
  source: string,
  mod: ScaffoldModMetadata,
): string {
  let contents = source;
  const mainClass = className(mod.modId);

  if (path.endsWith("gradle.properties")) {
    contents = contents
      .replace(/^mod_id=.*$/gm, `mod_id=${mod.modId}`)
      .replace(/^mod_version=.*$/gm, `mod_version=${mod.version}`)
      .replace(/^mod_name=.*$/gm, `mod_name=${mod.name}`)
      .replace(/^mod_license=.*$/gm, `mod_license=${mod.license}`)
      .replace(/^mod_group_id=.*$/gm, `mod_group_id=${mod.javaPackage}`)
      .replace(/^version=.*$/gm, `version=${mod.version}`)
      .replace(/^group=.*$/gm, `group=${mod.javaPackage}`);
  }

  if (path.endsWith(".json")) {
    contents = replaceAuthors(contents, mod.authors);
    contents = contents
      .replace(
        /("version"\s*:\s*)"(?:0\.0\.1|1\.0\.0)"/,
        (_match, prefix: string) => `${prefix}${JSON.stringify(mod.version)}`,
      )
      .replace(
        /("name"\s*:\s*)"(?:Example Mod|ExampleMod)"/,
        (_match, prefix: string) => `${prefix}${JSON.stringify(mod.name)}`,
      )
      .replace(
        /("description"\s*:\s*)"(?:Example description|This is an example description! Tell everyone what your mod is about!)"/,
        (_match, prefix: string) =>
          `${prefix}${JSON.stringify(mod.description)}`,
      )
      .replace(
        /("license"\s*:\s*)"CC0-1\.0"/,
        (_match, prefix: string) => `${prefix}${JSON.stringify(mod.license)}`,
      );
  }

  if (path.endsWith("neoforge.mods.toml") || path.endsWith("mods.toml")) {
    contents = contents
      .replace(
        /description='''[\s\S]*?'''/,
        `description=${JSON.stringify(mod.description)}`,
      )
      .replace(
        /^#authors=""$/gm,
        `authors=${JSON.stringify(mod.authors.join(", "))}`,
      );
  }

  const replacements: readonly [string, string][] = [
    ["${mod_group_id}", mod.javaPackage],
    ["${mod_version}", mod.version],
    ["${version}", mod.version],
    ["${mod_name}", quotedContents(mod.name)],
    ["${mod_license}", quotedContents(mod.license)],
    ["${mod_id}", mod.modId],
    ["com.example.examplemod", mod.javaPackage],
    ["com.example", mod.javaPackage],
    ["ExampleMod", mainClass],
    ["Example Mod", quotedContents(mod.name)],
    ["Example description", quotedContents(mod.description)],
    [
      "This is an example description! Tell everyone what your mod is about!",
      quotedContents(mod.description),
    ],
    ["Example mod description.", quotedContents(mod.description)],
    ["Example Author", quotedContents(mod.authors[0]!)],
    ["Me!", quotedContents(mod.authors[0]!)],
    ["CC0-1.0", quotedContents(mod.license)],
    ["example_mod", mod.modId],
    ["examplemod", mod.modId],
    ["modid", mod.modId],
  ];
  for (const [before, after] of replacements) {
    contents = contents.split(before).join(after);
  }
  contents = contents
    .split(`assets/${mod.modId}/`)
    .join(`assets/${mod.namespace}/`)
    .split(`data/${mod.modId}/`)
    .join(`data/${mod.namespace}/`);
  return contents;
}

function outputPath(path: string, mod: ScaffoldModMetadata): string {
  let result = path;
  const javaPath = mod.javaPackage.split(".").join("/");
  result = result
    .split("com/example/examplemod")
    .join(javaPath)
    .split("com/example")
    .join(javaPath)
    .split("ExampleMod")
    .join(className(mod.modId))
    .split("example_mod")
    .join(mod.modId)
    .split("examplemod")
    .join(mod.modId)
    .split("modid")
    .join(mod.modId);
  result = result
    .split(`assets/${mod.modId}/`)
    .join(`assets/${mod.namespace}/`)
    .split(`data/${mod.modId}/`)
    .join(`data/${mod.namespace}/`);

  const productionAsset = result.match(
    /^(?:[^/]+\/)?src\/[^/]+\/resources\/(.+\.bbmodel)$/,
  );
  if (productionAsset) {
    result = `asset-sources/${productionAsset[1]!}`;
  }
  return safePath(result);
}

function isMultiLoaderPath(
  path: string,
  loaders: readonly TargetLoader[],
): boolean {
  const root = path.split("/")[0];
  if (root === "common") return true;
  return (
    LOADERS.has(root as TargetLoader) && loaders.includes(root as TargetLoader)
  );
}

function filterSettingsModules(
  contents: string,
  loaders: readonly TargetLoader[],
): string {
  return contents.replace(
    /^include\s+(['"])common\1.*$/gm,
    `include 'common', ${loaders.map((loader) => `'${loader}'`).join(", ")}`,
  );
}

function configureBuild(contents: string): string {
  let result = contents;
  if (!/\bsourceSets\s*\{[\s\S]*?\bdatagen\s*\{/.test(result)) {
    result = `${result.trimEnd()}\n\nsourceSets {\n    datagen {\n        java.srcDir 'src/datagen/java'\n        resources.srcDir 'src/datagen/resources'\n    }\n}\n`;
  }
  if (!result.includes("**/*.bbmodel") || !result.includes("development/**")) {
    result = `${result.trimEnd()}\n\njar {\n    exclude '**/*.bbmodel', 'development/**'\n}\n`;
  }
  return result;
}

async function collectTemplates(
  root: string,
  mod: ScaffoldModMetadata,
  loaders: readonly TargetLoader[] | undefined,
): Promise<TemplateFile[]> {
  const files: TemplateFile[] = [];
  const multiLoader = loaders !== undefined && loaders.length > 1;

  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => comparePaths(left.name, right.name));
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`;
      safePath(relative);
      const sourcePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Template links are not allowed: ${relative}`);
      }
      if (entry.isDirectory()) {
        await visit(sourcePath, `${relative}/`);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Template entry is not a regular file: ${relative}`);
      }
      if (
        relative === MANIFEST_PATH ||
        relative === MOD_SPEC_PATH ||
        (!multiLoader &&
          (relative.startsWith("common/") ||
            [...LOADERS].some((loader) =>
              relative.startsWith(`${loader}/`),
            ))) ||
        (multiLoader &&
          (relative.startsWith("common/") ||
            [...LOADERS].some((loader) => relative.startsWith(`${loader}/`))) &&
          !isMultiLoaderPath(relative, loaders!))
      ) {
        continue;
      }

      const transformedPath = outputPath(relative, mod);
      const original = await readFile(sourcePath);
      const text = original.includes(0) ? null : original.toString("utf8");
      let contents = original;
      if (text !== null && Buffer.from(text, "utf8").equals(original)) {
        let substituted = substituteText(transformedPath, text, mod);
        if (multiLoader && transformedPath === "settings.gradle") {
          substituted = filterSettingsModules(substituted, loaders!);
        }
        if (transformedPath === "build.gradle") {
          substituted = configureBuild(substituted);
        }
        contents = Buffer.from(substituted, "utf8");
      }
      const stat = await lstat(sourcePath);
      files.push({
        sourcePath,
        outputPath: transformedPath,
        contents,
        mode: stat.mode & 0o777,
      });
    }
  }

  await visit(root, "");
  files.sort((left, right) => comparePaths(left.outputPath, right.outputPath));
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.outputPath)) {
      throw new Error(`Template substitutions collide at ${file.outputPath}`);
    }
    seen.add(file.outputPath);
  }
  return files;
}

function createModSpec(
  target: TargetPack,
  mod: ScaffoldModMetadata,
  files: readonly TemplateFile[],
): ModSpec {
  const javaPath = mod.javaPackage.split(".").join("/");
  const entrypoint =
    files.find(
      (file) =>
        file.outputPath.includes("/main/java/") &&
        file.outputPath.endsWith(`/${className(mod.modId)}.java`),
    )?.outputPath ??
    files.find(
      (file) =>
        file.outputPath.includes("/main/java/") &&
        file.outputPath.endsWith(".java"),
    )?.outputPath ??
    `src/main/java/${javaPath}/${className(mod.modId)}.java`;
  const spec = {
    schemaVersion: MOD_SPEC_SCHEMA_VERSION,
    modId: mod.modId,
    namespace: mod.namespace,
    javaPackage: mod.javaPackage,
    metadata: {
      name: mod.name,
      version: mod.version,
      description: mod.description,
      authors: [...mod.authors],
      license: mod.license,
    },
    targetPackId: target.id,
    targetPackRevision: target.revision,
    dependencies: {
      required: target.loader.apiDependencies.map((dependency) => ({
        modId: dependency.id,
        version: dependency.version,
      })),
      optional: [],
      incompatible: [],
    },
    compatibility: {
      singleplayer: true,
      multiplayer: "optional",
      existingWorlds: "compatible",
    },
    gameplay: {
      summary: mod.description,
      progression: `${mod.name} provides the initial project scaffold.`,
      multiplayer: "Runtime compatibility is verified by target-local checks.",
      failureCases: [],
    },
    features: [
      {
        id: "mod_entrypoint",
        kind: "mechanic",
        names: { en_us: mod.name },
        properties: {},
        implementationUnitIds: ["unit_mod_entrypoint"],
        assetIds: [],
        acceptanceIds: ["accept_mod_entrypoint_build"],
      },
    ],
    implementationUnits: [
      {
        id: "unit_mod_entrypoint",
        featureId: "mod_entrypoint",
        sourcePaths: [entrypoint],
      },
    ],
    configuration: {
      schemaVersion: 1,
      entries: [
        {
          id: "scaffold_version",
          kind: "integer",
          default: 1,
          minimum: 1,
          maximum: 1,
        },
      ],
    },
    persistence: { format: "json", version: 1, migrations: [] },
    assets: [],
    acceptance: [
      {
        id: "accept_mod_entrypoint_build",
        featureId: "mod_entrypoint",
        behavior: "The generated mod entrypoint compiles in a clean build.",
        kind: "build",
        implementationUnitIds: ["unit_mod_entrypoint"],
        checkIds: ["build.clean"],
        fixture: "fixtures/build.json",
        expected: { status: "built" },
      },
    ],
    runtime: {
      scenarios: [
        {
          id: "scenario_mod_entrypoint_build",
          acceptanceIds: ["accept_mod_entrypoint_build"],
          steps: ["Run the target pack clean build check."],
          expected: "The build completes successfully.",
        },
      ],
    },
    visual: {
      rubric: "visual/scaffold-rubric.md",
      scenarioIds: ["scenario_mod_entrypoint_build"],
      required: false,
    },
    evidence: { required: ["build"], artifactGlobs: ["build/libs/*"] },
    delivery: {
      productionJar: `build/libs/${mod.modId}-${mod.version}.jar`,
      includeSource: true,
      includeEditableAssets: true,
      buildTasks: ["clean", "build"],
    },
  };
  const validated = validateModSpec(spec, {
    targetPackId: target.id,
    targetPackRevision: target.revision,
  });
  if (validated.status !== "valid") {
    throw new Error(
      `Generated ModSpec is invalid: ${canonicalJson(validated.issues)}`,
    );
  }
  return validated.spec;
}

function parseManifest(contents: string): ScaffoldManifest | null {
  try {
    const value = JSON.parse(contents) as Partial<ScaffoldManifest>;
    if (
      value.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
      typeof value.targetPackId !== "string" ||
      !Number.isInteger(value.targetPackRevision) ||
      typeof value.modId !== "string" ||
      !Array.isArray(value.ownedPaths) ||
      !value.ownedPaths.every((path) => typeof path === "string") ||
      value.fileSha256 === null ||
      typeof value.fileSha256 !== "object" ||
      Array.isArray(value.fileSha256)
    ) {
      return null;
    }
    const ownedPaths = value.ownedPaths as string[];
    if (
      new Set(ownedPaths).size !== ownedPaths.length ||
      ownedPaths.includes(MANIFEST_PATH) ||
      ownedPaths.some((path) => {
        try {
          safePath(path);
          return false;
        } catch {
          return true;
        }
      })
    ) {
      return null;
    }
    return value as ScaffoldManifest;
  } catch {
    return null;
  }
}

async function readManifest(
  destination: string,
): Promise<ScaffoldManifest | null> {
  const path = join(destination, MANIFEST_PATH);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    return parseManifest(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function existingPath(
  destination: string,
  path: string,
): Promise<"missing" | "file" | "other"> {
  try {
    const info = await lstat(join(destination, ...safePath(path).split("/")));
    return info.isFile() && !info.isSymbolicLink() ? "file" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function ensureDirectory(root: string, relative: string): Promise<void> {
  const parts = safePath(relative).split("/");
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`Scaffold parent is not a real directory: ${relative}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current);
    }
  }
}

async function removeOwnedFile(root: string, path: string): Promise<void> {
  const absolute = join(root, ...safePath(path).split("/"));
  const relativeParent = relative(root, dirname(absolute))
    .split("\\")
    .join("/");
  if (relativeParent) await ensureDirectory(root, relativeParent);
  try {
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Stale scaffold path is not a regular file: ${path}`);
    }
    await unlink(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function scaffoldProject(
  request: ScaffoldProjectRequest,
): Promise<ScaffoldProjectResult> {
  const { destination, target, targetPackRoot, mod, loaders } = request;
  if (target.status !== "supported") {
    return {
      status: "unsupported",
      code: "unsupported_target",
      targetPackId: target.id,
      targetStatus: target.status,
    };
  }

  validateMod(mod);
  if (loaders !== undefined) {
    if (
      loaders.length === 0 ||
      new Set(loaders).size !== loaders.length ||
      loaders.some((loader) => !LOADERS.has(loader))
    ) {
      throw new TypeError("loaders must contain unique supported loader IDs");
    }
  }

  const [destinationRoot, templateRoot] = await Promise.all([
    realpath(destination),
    realpath(join(targetPackRoot, "templates")),
  ]);
  const [destinationInfo, templateInfo] = await Promise.all([
    lstat(destination),
    lstat(join(targetPackRoot, "templates")),
  ]);
  if (
    !destinationInfo.isDirectory() ||
    destinationInfo.isSymbolicLink() ||
    !templateInfo.isDirectory() ||
    templateInfo.isSymbolicLink()
  ) {
    throw new Error("Scaffold roots must be real directories");
  }

  const files = await collectTemplates(templateRoot, mod, loaders);
  const modSpec = createModSpec(target, mod, files);
  const generated = new Map<string, Buffer>(
    files.map((file) => [file.outputPath, file.contents]),
  );
  generated.set(MOD_SPEC_PATH, Buffer.from(canonicalJson(modSpec), "utf8"));

  const previous = await readManifest(destinationRoot);
  const previouslyOwned = new Set(previous?.ownedPaths ?? []);
  if (previous !== null) previouslyOwned.add(MANIFEST_PATH);
  const existingOwned = new Set<string>();
  const conflicts: string[] = [];
  for (const path of [...generated.keys(), MANIFEST_PATH]) {
    const existing = await existingPath(destinationRoot, path);
    if (existing === "file" && previouslyOwned.has(path)) {
      existingOwned.add(path);
    }
    if (
      existing === "other" ||
      (existing === "file" && !previouslyOwned.has(path))
    ) {
      conflicts.push(path);
    }
  }
  conflicts.sort(comparePaths);
  if (conflicts.length > 0) {
    return {
      status: "conflict",
      code: "existing_file_conflict",
      conflicts,
    };
  }

  const stale = [...previouslyOwned].filter(
    (path) => path !== MANIFEST_PATH && !generated.has(path),
  );
  for (const path of stale.sort(comparePaths)) {
    await removeOwnedFile(destinationRoot, path);
  }

  const directories = new Set<string>();
  for (const path of [...generated.keys(), MANIFEST_PATH]) {
    const parent = dirname(path);
    if (parent !== ".") directories.add(parent.split("\\").join("/"));
  }
  for (const directory of [...directories].sort(comparePaths)) {
    await ensureDirectory(destinationRoot, directory);
  }

  const fileModes = new Map(files.map((file) => [file.outputPath, file.mode]));
  const manifest: ScaffoldManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    targetPackId: target.id,
    targetPackRevision: target.revision,
    modId: mod.modId,
    ownedPaths: [...generated.keys()].sort(comparePaths),
    fileSha256: Object.fromEntries(
      [...generated]
        .sort(([left], [right]) => comparePaths(left, right))
        .map(([path, contents]) => [path, sha256(contents)]),
    ),
  };
  generated.set(MANIFEST_PATH, Buffer.from(canonicalJson(manifest), "utf8"));

  const root = await grantAuthorizedRoot({
    path: destinationRoot,
    kind: "transactionStaging",
    transactionId: `scaffold-${target.id}`,
  });
  try {
    for (const [path, contents] of [...generated].sort(([left], [right]) =>
      comparePaths(left, right),
    )) {
      let expectedRevision: string | null = null;
      if (existingOwned.has(path)) {
        expectedRevision = (await readAuthorizedFile(root, path)).revision;
      }
      await writeAuthorizedFile(root, { path, contents, expectedRevision });
      await chmod(
        join(destinationRoot, ...path.split("/")),
        fileModes.get(path) ?? 0o644,
      );
    }
  } finally {
    await releaseAuthorizedRoot(root);
  }

  return {
    status: "scaffolded",
    createdPaths: [...generated.keys()].sort(comparePaths),
    modSpec,
  };
}
