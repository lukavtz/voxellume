// Guard the slim layout: a retired subsystem must not creep back in.
import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const ALLOWED_TOP_LEVEL = new Set([
  ".artifacts",
  ".git",
  ".github",
  ".gitattributes",
  ".gitignore",
  ".metrics",
  ".oxlintrc.json",
  ".prettierignore",
  "LICENSE",
  "README.md",
  "README.ru.md",
  "THIRD_PARTY",
  "agents",
  "commands",
  "cordis.patch.yml",
  "dist",
  "docs",
  "node_modules",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts",
  "skills",
  "src",
  "targets",
  "templates",
  "tests",
  "tsconfig.build.json",
  "tsconfig.json",
]);

const FORBIDDEN_CORE_DIRS = new Set([
  "execution",
  "integrations",
  "mcp",
  "operations.ts",
  "projects",
  "setup",
  "sources",
  "spec",
  "targets",
  "verification",
]);

const problems = [];

const entries = await readdir(root, { withFileTypes: true });
for (const entry of entries) {
  if (!ALLOWED_TOP_LEVEL.has(entry.name)) {
    problems.push(`unexpected top-level entry: ${entry.name}`);
  }
}

const coreRoot = join(root, "src", "core");
const coreEntries = await readdir(coreRoot, { withFileTypes: true });
for (const entry of coreEntries) {
  if (FORBIDDEN_CORE_DIRS.has(entry.name)) {
    problems.push(`retired subsystem present: src/core/${entry.name}`);
  }
}

const adaptersRoot = join(root, "src", "adapters");
const adapterEntries = await readdir(adaptersRoot, { withFileTypes: true });
for (const entry of adapterEntries) {
  const allowed = ["dsh", "omp", "shared.ts"];
  if (!allowed.includes(entry.name)) {
    problems.push(`unexpected adapter entry: src/adapters/${entry.name}`);
  }
}

const templateRoot = join(root, "templates");
const templates = await readdir(templateRoot, { withFileTypes: true });
for (const entry of templates) {
  if (!entry.isDirectory()) {
    problems.push(`template must be a directory: templates/${entry.name}`);
    continue;
  }
  const wrapper = entry.name === "fabric-1.21.1" ? "gradlew" : null;
  if (wrapper !== null) {
    const info = await stat(join(templateRoot, entry.name, wrapper)).catch(
      () => undefined,
    );
    if (info === undefined)
      problems.push(`templates/${entry.name} lacks ${wrapper}`);
  }
}

const serverFiles = await readdir(join(root, "src"), { withFileTypes: true });
for (const entry of serverFiles) {
  if (entry.name === "server.ts") problems.push("src/server.ts must not exist");
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.stderr.write(`\ncheck:structure failed in ${dirname(root)}\n`);
  process.exit(1);
}

process.stdout.write("check:structure ok\n");
