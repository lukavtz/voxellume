// One-shot migration: target-packs/**/target.json -> targets/pins.json.
// Run before target-packs/ is deleted. Not part of the shipped package.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PACKS = join(ROOT, "target-packs", "java");
const OUT = join(ROOT, "targets", "pins.json");
const TEMPLATE_PIN = "java-fabric-1.21.1";
const TEMPLATE_DIR = "fabric-1.21.1";

const LOADERS = ["fabric", "forge", "neoforge", "quilt"];
const MAPPINGS = ["mojang", "none", "parchment-layer", "quilt"];

function text(value, field, optional) {
  if (value === null || value === undefined) {
    if (optional) return null;
    throw new Error(`missing ${field}`);
  }
  if (typeof value !== "string" || value.trim() === "") {
    if (optional) return null;
    throw new Error(`invalid ${field}`);
  }
  return value;
}

function pick(value, allowed, field) {
  if (!allowed.includes(value)) throw new Error(`invalid ${field}: ${String(value)}`);
  return value;
}

async function readPacks() {
  const pins = [];
  for (const loader of LOADERS) {
    let versions;
    try {
      versions = await readdir(join(PACKS, loader), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of versions.filter((item) => item.isDirectory())) {
      const file = join(PACKS, loader, entry.name, "target.json");
      let pack;
      try {
        pack = JSON.parse(await readFile(file, "utf8"));
      } catch (error) {
        throw new Error(`cannot read ${file}: ${error.message}`);
      }
      const id = text(pack.id, `${file} id`).replace(/-r\d+$/, "");
      const plugin = pack.gradle?.plugins?.[0] ?? {};
      pins.push({
        id,
        minecraft: text(pack.minecraft?.version, `${file} minecraft.version`),
        loader,
        loaderVersion: text(pack.loader?.version, `${file} loader.version`, true),
        apiVersion: text(pack.loader?.apiDependencies?.[0]?.version, `${file} api`, true),
        gradlePlugin: text(plugin.id, `${file} gradle plugin id`, true),
        gradlePluginVersion: text(plugin.version, `${file} gradle plugin version`, true),
        jdk: pick(pack.java?.gradleJvm, [21, 25], `${file} java.gradleJvm`),
        gradle: text(pack.gradle?.version, `${file} gradle.version`, true),
        mappings: pick(pack.mappings?.kind, MAPPINGS, `${file} mappings.kind`),
        template: id === TEMPLATE_PIN ? TEMPLATE_DIR : null,
      });
    }
  }
  pins.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return pins;
}

const pins = await readPacks();
const seen = new Set();
for (const pin of pins) {
  if (seen.has(pin.id)) throw new Error(`duplicate pin id after revision strip: ${pin.id}`);
  seen.add(pin.id);
}
if (pins.length !== 68) throw new Error(`expected 68 pins, produced ${pins.length}`);
if (!seen.has(TEMPLATE_PIN)) throw new Error(`missing template pin ${TEMPLATE_PIN}`);

await writeFile(
  OUT,
  `${JSON.stringify({ schemaVersion: "voxellume-pins-1.0.0", pins }, null, 2)}\n`,
  "utf8",
);
console.log(`wrote ${pins.length} pins to ${OUT}`);
