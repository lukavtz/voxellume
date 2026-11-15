// Prove the packed tarball ships what the docs promise, and nothing banned.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const TIMEOUT_MS = 120_000;

const REQUIRED = [
  "dist/adapters/omp/index.js",
  "dist/adapters/dsh/index.js",
  "cordis.patch.yml",
  "targets/pins.json",
  "templates/fabric-1.21.1/gradlew",
  "skills/minecraft-blender/SKILL.md",
  "scripts/blender/loop_check.py",
  "docs/TOOLS.md",
];

const FORBIDDEN_PREFIXES = [
  "tests/",
  "src/",
  "node_modules/",
  ".github/",
  "templates/fabric-1.21.1/build/",
];

const INLINE_PATH = /`((?:scripts|targets|templates)\/[^`\n]*)`/g;

function packCommands() {
  const commands = [];
  const manager = process.env.npm_execpath;
  if (manager)
    commands.push([process.execPath, [manager, "pack", "--dry-run"]]);
  if (process.platform === "win32") {
    // A bare `pnpm.cmd` cannot be spawned with shell:false, so go through
    // corepack's JavaScript entry instead.
    const corepack = join(
      dirname(process.execPath),
      "node_modules",
      "corepack",
      "dist",
      "corepack.js",
    );
    if (existsSync(corepack)) {
      commands.push([
        process.execPath,
        [corepack, "pnpm", "pack", "--dry-run"],
      ]);
    }
  } else {
    commands.push(["pnpm", ["pack", "--dry-run"]]);
  }
  return commands;
}

function runPack([command, args]) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        shell: false,
        timeout: TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

// Only the "Tarball Contents" section holds paths; headers, sizes and the
// tarball summary are skipped by shape.
function parsePackList(stdout) {
  const lines = stdout.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "Tarball Contents");
  const entries = [];
  for (const raw of start === -1 ? lines : lines.slice(start + 1)) {
    const line = raw.trim();
    if (line === "") continue;
    if (
      line === "Tarball Details" ||
      /^voxellume-\d+\.\d+\.\d+\.tgz$/.test(line)
    )
      break;
    if (/\s/.test(line) || line.includes(":") || !/^[\w.@+/-]+$/.test(line))
      continue;
    entries.push(line);
  }
  return entries;
}

function resolves(entries, reference) {
  const ref = reference.replace(/[.,;:)\]!?]+$/, "");
  if (ref === "") return true;
  if (ref.includes("*")) {
    const prefix = ref.slice(0, ref.indexOf("*"));
    return entries.some((entry) => entry.startsWith(prefix));
  }
  return (
    entries.includes(ref) ||
    entries.some((entry) =>
      entry.startsWith(ref.endsWith("/") ? ref : `${ref}/`),
    )
  );
}

async function shippedSkillDocs() {
  const found = await readdir(join(root, "skills"), {
    recursive: true,
    withFileTypes: true,
  });
  return found
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath ?? join(root, "skills"), entry.name));
}

const fail = (message) => process.stderr.write(`${message}\n`);

let stdout = "";
for (const command of packCommands()) {
  try {
    stdout = await runPack(command);
    break;
  } catch (error) {
    fail(`pack command failed: ${command.join(" ")}: ${error.message}`);
  }
}

const entries = parsePackList(stdout);
const problems = [];
if (entries.length === 0) {
  problems.push("empty pack list: run this through `pnpm check:pack`");
}

for (const path of REQUIRED) {
  if (!entries.includes(path)) problems.push(`missing from tarball: ${path}`);
}

for (const entry of entries) {
  const banned = FORBIDDEN_PREFIXES.find((prefix) => entry.startsWith(prefix));
  if (banned) problems.push(`forbidden in tarball: ${entry}`);
}

for (const file of await shippedSkillDocs()) {
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(INLINE_PATH)) {
    const reference = match[1];
    if (!resolves(entries, reference)) {
      const relative = file.slice(root.length).replaceAll("\\", "/");
      problems.push(`dangling inline path: ${relative} -> ${reference}`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) fail(problem);
  process.exit(1);
}
process.stdout.write("check:pack ok\n");
