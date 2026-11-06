import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface InspectionTargetPack {
  readonly id: string;
  readonly edition: "java";
  readonly status: string;
  readonly minecraft: { readonly version: string };
  readonly loader: { readonly id: string };
}

export interface ProjectCoordinates {
  readonly edition: "java";
  readonly minecraftVersion: string;
  readonly loader: string;
}

export interface ProjectSourceSet {
  readonly name: string;
  readonly java: readonly string[];
  readonly resources: readonly string[];
}

export interface ProjectDependency {
  readonly configuration: string;
  readonly coordinates: string;
}

export interface ProjectDiagnostic {
  readonly code: string;
  readonly detail: string;
  readonly path: string;
}

export interface ProjectInspection<Pack extends InspectionTargetPack> {
  readonly status: "inspected";
  readonly target: {
    readonly coordinates: ProjectCoordinates;
    readonly pack: Pack | null;
  } | null;
  readonly sourceSets: readonly ProjectSourceSet[];
  readonly modMetadata: {
    readonly file: string;
    readonly modId: string;
    readonly version: string;
  } | null;
  readonly dependencies: readonly ProjectDependency[];
  readonly availableTasks: readonly string[];
  readonly userOwnedFiles: readonly string[];
  readonly diagnostics: readonly ProjectDiagnostic[];
}

export interface InspectProjectOptions<Pack extends InspectionTargetPack> {
  readonly projectRoot: string;
  readonly targetPacks: readonly Pack[];
}

const LOADER_PLUGINS: Readonly<Record<string, string>> = {
  "net.fabricmc.fabric-loom": "fabric",
  "net.fabricmc.fabric-loom-remap": "fabric",
  "net.neoforged.moddev": "neoforge",
  "net.neoforged.moddev.legacy": "neoforge",
  "net.minecraftforge.gradle": "forge",
  "org.quiltmc.loom": "quilt",
};

const METADATA_FILES: Readonly<Record<string, string>> = {
  fabric: "src/main/resources/fabric.mod.json",
  quilt: "src/main/resources/quilt.mod.json",
  neoforge: "src/main/resources/META-INF/neoforge.mods.toml",
  forge: "src/main/resources/META-INF/mods.toml",
};

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function gradleIsBalanced(source: string): boolean {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth < 0) return false;
  }
  return depth === 0 && quote === null && !blockComment;
}

function detectLoader(build: string): string | null {
  const loaders = new Set<string>();
  for (const match of build.matchAll(/\bid\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const loader = LOADER_PLUGINS[match[1]!];
    if (loader) loaders.add(loader);
  }
  for (const match of build.matchAll(/apply\s+plugin:\s*['"]([^'"]+)['"]/g)) {
    const loader = LOADER_PLUGINS[match[1]!];
    if (loader) loaders.add(loader);
  }
  return loaders.size === 1 ? [...loaders][0]! : null;
}

function readProperties(source: string | null): ReadonlyMap<string, string> {
  const properties = new Map<string, string>();
  if (source === null) return properties;
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*([^#!\s][^:=]*?)\s*[:=]\s*(.*?)\s*$/.exec(line);
    if (match) properties.set(match[1]!, match[2]!);
  }
  return properties;
}

function declaredMinecraftVersion(
  properties: ReadonlyMap<string, string>,
  build: string,
): string | null {
  const property = properties.get("minecraft_version");
  if (property) return property;
  return (
    /minecraft_version\s*(?:=|:)\s*['"]([^'"]+)['"]/.exec(build)?.[1] ?? null
  );
}

function parseDependencies(build: string): ProjectDependency[] {
  const dependencies = new Map<string, ProjectDependency>();
  const pattern =
    /^\s*([A-Za-z][\w]*)\s*(?:\(\s*)?['"]([^:'"\s]+:[^:'"\s]+:[^'"\s]+)['"]/gm;
  for (const match of build.matchAll(pattern)) {
    const dependency = {
      configuration: match[1]!,
      coordinates: match[2]!,
    };
    dependencies.set(
      `${dependency.configuration}\0${dependency.coordinates}`,
      dependency,
    );
  }
  return [...dependencies.values()].sort(
    (left, right) =>
      left.configuration.localeCompare(right.configuration) ||
      left.coordinates.localeCompare(right.coordinates),
  );
}

function parseTasks(build: string, loader: string | null): string[] {
  const tasks = new Set(["build", "test"]);
  if (loader) {
    tasks.add("runClient");
    tasks.add("runServer");
  }
  for (const match of build.matchAll(
    /\btasks\.(?:register|create)\s*\(\s*['"]([^'"]+)['"]/g,
  )) {
    tasks.add(match[1]!);
  }
  for (const match of build.matchAll(/^\s*task\s+([A-Za-z][\w]*)/gm)) {
    tasks.add(match[1]!);
  }
  return [...tasks].sort();
}

async function inspectSourceSets(root: string): Promise<ProjectSourceSet[]> {
  const sourceRoot = join(root, "src");
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const sourceSets: ProjectSourceSet[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const java: string[] = [];
    const resources: string[] = [];
    for (const [kind, destination] of [
      ["java", java],
      ["resources", resources],
    ] as const) {
      try {
        const stat = await readdir(join(sourceRoot, entry.name, kind));
        void stat;
        destination.push(`src/${entry.name}/${kind}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (java.length || resources.length) {
      sourceSets.push({ name: entry.name, java, resources });
    }
  }
  return sourceSets.sort((left, right) => left.name.localeCompare(right.name));
}

interface Metadata {
  readonly modId: string;
  readonly version: string;
  readonly minecraftVersion: string | null;
}

function parseJsonMetadata(source: string, loader: string): Metadata | null {
  const document: unknown = JSON.parse(source);
  if (!document || typeof document !== "object") return null;
  const root = document as Record<string, unknown>;
  const quilt = root.quilt_loader;
  const values =
    loader === "quilt" && quilt && typeof quilt === "object"
      ? (quilt as Record<string, unknown>)
      : root;
  if (typeof values.id !== "string" || typeof values.version !== "string") {
    return null;
  }
  let minecraftVersion: string | null = null;
  if (values.depends && typeof values.depends === "object") {
    const depends = values.depends as Record<string, unknown>;
    if (typeof depends.minecraft === "string") {
      minecraftVersion = depends.minecraft;
    }
  }
  return { modId: values.id, version: values.version, minecraftVersion };
}

function tomlValue(section: string, key: string): string | null {
  return (
    new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m").exec(
      section,
    )?.[1] ?? null
  );
}

function parseTomlMetadata(source: string): Metadata | null {
  const modSection = source.split("[[mods]]")[1]?.split(/\n\s*\[\[/)[0];
  if (!modSection) return null;
  const modId = tomlValue(modSection, "modId");
  const version = tomlValue(modSection, "version");
  if (!modId || !version) return null;

  let minecraftVersion: string | null = null;
  for (const match of source.matchAll(
    /\[\[dependencies\.[^\]]+\]\]([\s\S]*?)(?=\n\s*\[\[|$)/g,
  )) {
    if (tomlValue(match[1]!, "modId") === "minecraft") {
      minecraftVersion = tomlValue(match[1]!, "versionRange");
      break;
    }
  }
  return { modId, version, minecraftVersion };
}

async function inspectMetadata(
  root: string,
  loader: string,
  minecraftVersion: string,
  diagnostics: ProjectDiagnostic[],
): Promise<ProjectInspection<InspectionTargetPack>["modMetadata"]> {
  const file = METADATA_FILES[loader];
  if (!file) return null;
  const source = await readIfPresent(join(root, ...file.split("/")));
  if (source === null) {
    diagnostics.push({
      code: "mod_metadata_missing",
      detail: "Mod metadata file was not found for the inferred loader.",
      path: file,
    });
    return null;
  }

  let metadata: Metadata | null;
  try {
    metadata =
      loader === "fabric" || loader === "quilt"
        ? parseJsonMetadata(source, loader)
        : parseTomlMetadata(source);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    metadata = null;
  }
  if (!metadata) {
    diagnostics.push({
      code: "mod_metadata_malformed",
      detail:
        loader === "fabric" || loader === "quilt"
          ? "Mod metadata file is not valid JSON."
          : "Mod metadata file is malformed or lacks a mod id and version.",
      path: file,
    });
    return null;
  }

  if (
    metadata.minecraftVersion &&
    /^\d+(?:\.\d+)+$/.test(metadata.minecraftVersion) &&
    metadata.minecraftVersion !== minecraftVersion
  ) {
    diagnostics.push({
      code: "target_mismatch",
      detail: `Mod metadata requires Minecraft "${metadata.minecraftVersion}" but the build declares "${minecraftVersion}".`,
      path: file,
    });
  }
  return { file, modId: metadata.modId, version: metadata.version };
}

export async function inspectProject<Pack extends InspectionTargetPack>({
  projectRoot,
  targetPacks,
}: InspectProjectOptions<Pack>): Promise<ProjectInspection<Pack>> {
  const userOwnedFiles = (await listFiles(projectRoot)).sort();
  const diagnostics: ProjectDiagnostic[] = [];
  const buildPath =
    (await readIfPresent(join(projectRoot, "build.gradle"))) !== null
      ? "build.gradle"
      : "build.gradle.kts";
  const build = await readIfPresent(join(projectRoot, buildPath));

  if (build === null) {
    diagnostics.push({
      code: "build_file_missing",
      detail: "No build.gradle or build.gradle.kts file exists.",
      path: "build.gradle",
    });
    return {
      status: "inspected",
      target: null,
      sourceSets: [],
      modMetadata: null,
      dependencies: [],
      availableTasks: [],
      userOwnedFiles,
      diagnostics,
    };
  }
  if (!gradleIsBalanced(build)) {
    diagnostics.push({
      code: "build_file_malformed",
      detail: "Could not parse Gradle build file.",
      path: buildPath,
    });
    return {
      status: "inspected",
      target: null,
      sourceSets: [],
      modMetadata: null,
      dependencies: [],
      availableTasks: [],
      userOwnedFiles,
      diagnostics,
    };
  }

  const properties = readProperties(
    await readIfPresent(join(projectRoot, "gradle.properties")),
  );
  const loader = detectLoader(build);
  const minecraftVersion = declaredMinecraftVersion(properties, build);
  let target: ProjectInspection<Pack>["target"] = null;
  let modMetadata: ProjectInspection<Pack>["modMetadata"] = null;

  if (loader && minecraftVersion) {
    const coordinates: ProjectCoordinates = {
      edition: "java",
      minecraftVersion,
      loader,
    };
    const matches = targetPacks.filter(
      (pack) =>
        pack.edition === coordinates.edition &&
        pack.minecraft.version === minecraftVersion &&
        pack.loader.id === loader,
    );
    target = { coordinates, pack: matches.length === 1 ? matches[0]! : null };
    if (matches.length === 0) {
      diagnostics.push({
        code: "target_pack_missing",
        detail: "No target pack exactly matches the declared coordinates.",
        path: buildPath,
      });
    } else if (matches.length > 1) {
      diagnostics.push({
        code: "target_pack_ambiguous",
        detail: "Multiple target packs exactly match the declared coordinates.",
        path: buildPath,
      });
    }
    modMetadata = await inspectMetadata(
      projectRoot,
      loader,
      minecraftVersion,
      diagnostics,
    );
  } else {
    diagnostics.push({
      code: "target_coordinates_missing",
      detail: "Could not determine the exact Minecraft version and loader.",
      path: buildPath,
    });
  }

  return {
    status: "inspected",
    target,
    sourceSets: await inspectSourceSets(projectRoot),
    modMetadata,
    dependencies: parseDependencies(build),
    availableTasks: parseTasks(build, loader),
    userOwnedFiles,
    diagnostics,
  };
}
