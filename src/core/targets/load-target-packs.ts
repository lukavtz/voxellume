import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";

import { canonicalJson, sha256 } from "./canonical-json.ts";
import { ALLOWED_GRADLE_TASKS, TARGET_CAPABILITIES } from "./target-pack.ts";
import type {
  TargetDocs,
  TargetPack,
  TargetVerification,
} from "./target-pack.ts";

type DocumentName = "target.json" | "docs.json" | "verification.json";

export type LoadedTargetPack = TargetPack;

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
  removeAdditional: false,
  useDefaults: false,
  coerceTypes: false,
});

let validatorsPromise:
  Promise<Readonly<Record<DocumentName, ValidateFunction>>> | undefined;

async function compileSchemas(): Promise<
  Readonly<Record<DocumentName, ValidateFunction>>
> {
  const entries = await Promise.all(
    (["pack", "docs", "verification"] as const).map(async (kind) => {
      const schemaUrl = new URL(
        `../../../schemas/target-${kind}.schema.json`,
        import.meta.url,
      );
      const schema = JSON.parse(await readFile(schemaUrl, "utf8")) as AnySchema;
      return [
        kind === "pack" ? "target.json" : `${kind}.json`,
        ajv.compile(schema),
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as Readonly<
    Record<DocumentName, ValidateFunction>
  >;
}

function diagnosticText(file: string, error: ErrorObject): string {
  const location = `${file}${error.instancePath}`;
  const missing =
    error.keyword === "required" && "missingProperty" in error.params
      ? ` ${String(error.params.missingProperty)}`
      : "";
  const additional =
    error.keyword === "additionalProperties" &&
    "additionalProperty" in error.params
      ? ` ${String(error.params.additionalProperty)}`
      : "";
  return `${location}: ${error.keyword}${missing}${additional}: ${error.message ?? "validation failed"} (${error.schemaPath})`;
}

async function readDocument(
  directory: string,
  name: DocumentName,
  validate: ValidateFunction,
): Promise<unknown> {
  const path = join(directory, name);
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read or parse ${path}: ${(error as Error).message}`,
      {
        cause: error,
      },
    );
  }

  if (!validate(data)) {
    const diagnostics = (validate.errors ?? [])
      .map((error) => diagnosticText(path, error))
      .sort();
    throw new Error(`Invalid ${path}:\n${diagnostics.join("\n")}`);
  }
  return data;
}

function invalid(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function validateRelationships(
  path: string,
  target: TargetPack,
  docs: TargetDocs,
  verification: TargetVerification,
): void {
  if (
    !target.minecraft.releaseJsonUrl.endsWith(
      `/${target.minecraft.version}.json`,
    )
  ) {
    invalid(path, "releaseJsonUrl must end with /<minecraft.version>.json");
  }

  if (target.loader.version !== null && target.loader.coordinates !== null) {
    const version = target.loader.coordinates.split("@")[0]?.split(":")[2];
    const forgeVersion = `${target.minecraft.version}-${target.loader.version}`;
    if (
      version !== target.loader.version &&
      !(target.loader.id === "forge" && version === forgeVersion)
    ) {
      invalid(path, "loader.coordinates must agree with loader.version");
    }
  }
  for (const dependency of target.loader.apiDependencies) {
    if (
      dependency.coordinates.split("@")[0]?.split(":")[2] !== dependency.version
    ) {
      invalid(
        path,
        `apiDependencies.${dependency.id}.coordinates must agree with its declared version`,
      );
    }
  }
  const gradle = target.gradle;
  if (
    gradle !== null &&
    !["bin", "all"].some(
      (distribution) =>
        gradle.distributionUrl ===
        `https://services.gradle.org/distributions/gradle-${gradle.version}-${distribution}.zip`,
    )
  ) {
    invalid(
      path,
      "distributionUrl must be the official bin/all archive for gradle.version",
    );
  }

  for (const name of TARGET_CAPABILITIES) {
    const argv = verification.checks[name]?.argv;
    if (!argv) continue;
    if (argv[0] !== "./gradlew" || argv[1] !== "--no-daemon") {
      invalid(
        path,
        `checks.${name}.argv requires the ./gradlew executable and --no-daemon`,
      );
    }
    for (const argument of argv.slice(2)) {
      if (!(ALLOWED_GRADLE_TASKS as readonly string[]).includes(argument)) {
        invalid(
          path,
          `checks.${name}.argv contains non-allowlisted Gradle task ${argument}`,
        );
      }
    }
  }

  const needsReason =
    target.status === "unsupported" || target.status === "rejected";
  if (
    target.status !== "unsupported" &&
    (target.loader.version === null ||
      target.loader.coordinates === null ||
      target.loader.artifactSha256 === null ||
      target.gradle === null)
  ) {
    invalid(
      path,
      `${target.status} status requires non-null exact loader fields and gradle`,
    );
  }
  if (needsReason) {
    if (!target.reason)
      invalid(path, `${target.status} status requires a reason`);
    if (target.reason.evidence.length === 0) {
      invalid(path, "reason.evidence must contain primary-source evidence");
    }
    if ("template" in target)
      invalid(path, `${target.status} status forbids template`);
    if (
      Object.keys(verification.capabilities).length !== 0 ||
      verification.required.length !== 0 ||
      Object.keys(verification.checks).length !== 0 ||
      verification.testedPlatforms.length !== 0 ||
      "evidenceManifest" in verification
    ) {
      invalid(
        path,
        `${target.status} status forbids verification commands and capabilities`,
      );
    }
  } else {
    if (target.reason) invalid(path, `${target.status} status forbids reason`);
    if (!target.template)
      invalid(path, `${target.status} status requires immutable template`);
  }

  if (target.status === "supported") {
    if (target.gradle?.wrapperJarSha256 === undefined) {
      invalid(path, "supported pack requires gradle.wrapperJarSha256");
    }
    if (docs.loaderApi.length === 0)
      invalid(path, "supported pack requires loaderApi documentation");
    if (docs.gradlePlugins.length === 0 || docs.catalogs.length === 0) {
      invalid(path, "supported pack requires complete documentation evidence");
    }
    if (!verification.evidenceManifest) {
      invalid(
        path,
        "supported pack requires evidenceManifest qualification evidence",
      );
    }
    for (const name of TARGET_CAPABILITIES) {
      if (
        verification.capabilities[name] !== true ||
        !verification.required.includes(name)
      ) {
        invalid(
          path,
          `supported pack requires ${name} capability and required evidence`,
        );
      }
      const check = verification.checks[name];
      if (!check) invalid(path, `supported pack requires checks.${name}`);
    }
    if (verification.testedPlatforms.length === 0) {
      invalid(path, "supported pack requires testedPlatforms evidence");
    }
  }

  if (
    target.mappings.kind === "none" &&
    target.minecraft.obfuscation !== "unobfuscated"
  ) {
    invalid(
      path,
      "mappings.kind none is valid only for unobfuscated Minecraft",
    );
  }
  if (
    target.mappings.kind === "none" &&
    target.mappings.artifacts.length !== 0
  ) {
    invalid(path, "mappings.kind none requires an empty artifacts array");
  }

  const expectedJava = target.minecraft.obfuscation === "obfuscated" ? 21 : 25;
  if (
    target.java.gradleJvm !== expectedJava ||
    target.java.toolchain !== expectedJava ||
    target.java.release !== expectedJava
  ) {
    invalid(
      path,
      `java gradleJvm/toolchain/release must all be ${expectedJava}`,
    );
  }
}

/** Load and validate every three-file pack beneath a catalog root. */
export async function loadTargetPacks(
  catalogRoot: string,
): Promise<LoadedTargetPack[]> {
  validatorsPromise ??= compileSchemas();
  const schemaValidators = await validatorsPromise;
  let entries;
  try {
    entries = await readdir(catalogRoot, {
      recursive: true,
      withFileTypes: true,
    });
  } catch (error) {
    throw new Error(
      `Unable to read target catalog ${catalogRoot}: ${(error as Error).message}`,
      {
        cause: error,
      },
    );
  }

  const targetPaths = entries
    .filter((entry) => entry.isFile() && entry.name === "target.json")
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  if (targetPaths.length === 0) {
    throw new Error(`No target.json files found beneath ${catalogRoot}`);
  }
  const packs: LoadedTargetPack[] = [];
  const ids = new Map<string, string>();
  const coordinates = new Map<string, string>();

  for (const targetPath of targetPaths) {
    const directory = join(targetPath, "..");
    const target = (await readDocument(
      directory,
      "target.json",
      schemaValidators["target.json"],
    )) as TargetPack;
    const docs = (await readDocument(
      directory,
      "docs.json",
      schemaValidators["docs.json"],
    )) as TargetDocs;
    const verification = (await readDocument(
      directory,
      "verification.json",
      schemaValidators["verification.json"],
    )) as TargetVerification;
    const displayPath = relative(catalogRoot, targetPath).split(sep).join("/");
    const { packSha256, ...unsigned } = target;
    if (sha256(canonicalJson(unsigned)) !== packSha256) {
      invalid(displayPath, "packSha256 does not match the pack content");
    }
    validateRelationships(displayPath, target, docs, verification);

    const previousId = ids.get(target.id);
    if (previousId)
      invalid(displayPath, `duplicate id also used by ${previousId}`);
    ids.set(target.id, displayPath);
    const coordinate = `${target.edition}/${target.loader.id}/${target.minecraft.version}`;
    const previousCoordinate = coordinates.get(coordinate);
    if (previousCoordinate) {
      invalid(
        displayPath,
        `duplicate coordinate ${coordinate} also used by ${previousCoordinate}`,
      );
    }
    coordinates.set(coordinate, displayPath);
    packs.push({ ...target, docs, verification } as LoadedTargetPack);
  }

  return packs.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}
