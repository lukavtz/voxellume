export interface ModMetadata {
  readonly modId: string;
  readonly javaPackage: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly authors: readonly string[];
  readonly license: string;
}

const TEXT_EXTENSIONS: Record<string, true> = {
  ".java": true,
  ".json": true,
  ".gradle": true,
  ".properties": true,
  ".md": true,
  ".yml": true,
  ".yaml": true,
  ".txt": true,
  ".bat": true,
  ".sh": true,
};

const TEXT_BASENAMES: Record<string, true> = {
  gradlew: true,
  ".gitignore": true,
  ".gitattributes": true,
  LICENSE: true,
};

export function isTextPath(relativePath: string): boolean {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  if (Object.hasOwn(TEXT_BASENAMES, name)) return true;
  const dot = name.lastIndexOf(".");
  return dot > 0 && Object.hasOwn(TEXT_EXTENSIONS, name.slice(dot));
}

/** Ordered token rewrite used on every text file copied from the template. */
export function applySubstitutions(text: string, mod: ModMetadata): string {
  const replacements: readonly (readonly [string, string])[] = [
    ["com.example.client.", `${mod.javaPackage}.client.`],
    ["com.example", mod.javaPackage],
    ["modid.client.mixins.json", `${mod.modId}.client.mixins.json`],
    ["modid.mixins.json", `${mod.modId}.mixins.json`],
    ["assets/modid", `assets/${mod.modId}`],
    ['"modid"', `"${mod.modId}"`],
    ["modid", mod.modId],
    ['"name": "Example Mod"', `"name": ${JSON.stringify(mod.name)}`],
    ["Example Mod", mod.name],
    [
      "This is an example description! Tell everyone what your mod is about!",
      JSON.stringify(mod.description).slice(1, -1),
    ],
    ['"Me!"', JSON.stringify(mod.authors[0] ?? "")],
    ['"license": "CC0-1.0"', `"license": ${JSON.stringify(mod.license)}`],
    ["version=1.0.0", `version=${mod.version}`],
  ];
  let result = text;
  for (const [token, value] of replacements) {
    result = result.split(token).join(value);
  }
  return result;
}

/** Template-relative path -> destination-relative path for the given metadata. */
export function renamePath(relativePath: string, mod: ModMetadata): string {
  const packagePath = mod.javaPackage.split(".").join("/");
  const prefixes: readonly (readonly [string, string])[] = [
    ["src/main/java/com/example/", `src/main/java/${packagePath}/`],
    [
      "src/client/java/com/example/client/",
      `src/client/java/${packagePath}/client/`,
    ],
    [
      "src/main/resources/assets/modid/",
      `src/main/resources/assets/${mod.modId}/`,
    ],
    [
      "src/client/resources/modid.client.mixins.json",
      `src/client/resources/${mod.modId}.client.mixins.json`,
    ],
    [
      "src/main/resources/modid.mixins.json",
      `src/main/resources/${mod.modId}.mixins.json`,
    ],
  ];
  for (const [prefix, replacement] of prefixes) {
    if (relativePath === prefix.replace(/\/$/, ""))
      return replacement.replace(/\/$/, "");
    if (relativePath.startsWith(prefix))
      return replacement + relativePath.slice(prefix.length);
  }
  return relativePath;
}

/** Normalize to LF; Windows batch files keep CRLF. */
export function normalizeNewlines(text: string, relativePath: string): string {
  const unified = text.replace(/\r\n/g, "\n");
  return relativePath.endsWith(".bat")
    ? unified.replace(/\n/g, "\r\n")
    : unified;
}
