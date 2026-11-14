// Collect live Fabric build artifacts (jar, logs, result.json) into one directory.
// Dependency-free; importable from tests and runnable as a CLI.
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const DEFAULT_PIN_ID = "java-fabric-1.21.1";

function taskOf(file) {
  const name = basename(file);
  const dash = name.indexOf("-");
  return dash === -1 ? name.replace(/\.log$/, "") : name.slice(0, dash);
}

async function findJar(projectRoot) {
  const libs = join(projectRoot, "build", "libs");
  let names;
  try {
    names = await readdir(libs);
  } catch {
    throw new Error(`no build/libs directory in ${projectRoot}`);
  }
  const jars = names
    .filter((name) => name.endsWith(".jar") && !name.includes("sources"))
    .sort();
  const jar = jars[0];
  if (jar === undefined) throw new Error(`no jar in ${libs}`);
  return join(libs, jar);
}

async function listLogs(projectRoot) {
  const dir = join(projectRoot, ".voxellume", "logs");
  const names = await readdir(dir).catch(() => []);
  return names
    .filter((name) => name.endsWith(".log"))
    .sort()
    .map((name) => join(dir, name));
}

function resolveLog(projectRoot, logPath) {
  if (logPath === undefined) return undefined;
  return isAbsolute(logPath) ? logPath : join(projectRoot, logPath);
}

async function isFile(path) {
  return stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
}

export async function collectArtifacts({
  projectRoot,
  logPath,
  serverStatus = "unknown",
  outDir,
  pinId = DEFAULT_PIN_ID,
}) {
  const root = resolve(projectRoot);
  const target = resolve(outDir ?? join(".artifacts", "live-fabric"));
  await mkdir(target, { recursive: true });

  const jar = await findJar(root);
  const jarName = basename(jar);
  const bytes = await readFile(jar);
  const jarSha256 = createHash("sha256").update(bytes).digest("hex");
  await copyFile(jar, join(target, jarName));

  const logs = await listLogs(root);
  const explicit = resolveLog(root, logPath);
  if (
    explicit !== undefined &&
    (await isFile(explicit)) &&
    !logs.includes(explicit)
  ) {
    logs.push(explicit);
  }
  const serverLog =
    explicit !== undefined && logs.includes(explicit)
      ? explicit
      : logs
          .filter((file) => basename(file).startsWith("runServer-"))
          .sort()
          .at(-1);

  const logPaths = [];
  for (const file of logs) {
    const name = file === serverLog ? "server.log" : `${taskOf(file)}.log`;
    await copyFile(file, join(target, name));
    if (!logPaths.includes(name)) logPaths.push(name);
  }

  const result = {
    pinId,
    jarSha256,
    jarBytes: bytes.byteLength,
    serverStatus,
    logPaths,
  };
  await writeFile(
    join(target, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return { ...result, outDir: target, jarPath: join(target, jarName) };
}

const USAGE = `usage: node scripts/ci/live-fabric.mjs --project-root <dir> [--log-path <file>]
       [--server-status <status>] [--out-dir <dir>] [--pin-id <id>]`;

function isMain() {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const { values } = parseArgs({
    options: {
      "project-root": { type: "string" },
      "log-path": { type: "string" },
      "server-status": { type: "string", default: "unknown" },
      "out-dir": { type: "string" },
      "pin-id": { type: "string", default: DEFAULT_PIN_ID },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help === true || values["project-root"] === undefined) {
    process.stdout.write(`${USAGE}\n`);
    process.exitCode = values.help === true ? 0 : 1;
  } else {
    const result = await collectArtifacts({
      projectRoot: values["project-root"],
      logPath: values["log-path"],
      serverStatus: values["server-status"],
      outDir: values["out-dir"],
      pinId: values["pin-id"],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
