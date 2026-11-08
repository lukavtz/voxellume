import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pages = ["index.html", "ru/index.html", "zh-CN/index.html"];
const generated = new Set(["inventory.json", "SHA256SUMS"]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

async function filesBelow(directory, prefix = "") {
  const files = [];
  const entries = await readdir(join(directory, prefix), {
    withFileTypes: true,
  });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.ok(!entry.isSymbolicLink(), `Symbolic link is not allowed: ${path}`);
    if (entry.isDirectory()) files.push(...(await filesBelow(directory, path)));
    else {
      assert.ok(entry.isFile(), `Non-file site entry: ${path}`);
      files.push(path);
    }
  }
  return files;
}

function localTarget(reference, from) {
  const url = new URL(reference, `https://site.invalid/${from}`);
  const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  return {
    path: path === "" || path.endsWith("/") ? `${path}index.html` : path,
    fragment: decodeURIComponent(url.hash.slice(1)),
  };
}

function validateSite(site, sourceFiles) {
  const sourceSet = new Set(sourceFiles);
  for (const required of [...pages, "assets/styles.css", "assets/main.js"]) {
    assert.ok(
      sourceSet.has(required),
      `Missing required site content: ${required}`,
    );
  }
  const ids = new Map();
  for (const page of pages) {
    const html = readFileSync(join(site, page), "utf8");
    assert.match(html, /^\s*<!doctype\s+html\s*>/i, `${page}: missing doctype`);
    for (const tag of ["html", "head", "body", "title"]) {
      assert.match(
        html,
        new RegExp(`<${tag}(?:\\s[^>]*)?>`, "i"),
        `${page}: missing <${tag}>`,
      );
      assert.match(
        html,
        new RegExp(`</${tag}\\s*>`, "i"),
        `${page}: missing </${tag}>`,
      );
    }
    ids.set(
      page,
      new Set(
        [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(
          (match) => match[1],
        ),
      ),
    );
  }

  const fragments = [];
  function reference(raw, from, { runtime = false, data = false } = {}) {
    const value = raw.trim();
    if (runtime) assert.ok(value, `${from}: empty runtime dependency`);
    if (!value) return;
    if (value.startsWith("data:")) {
      assert.ok(data && runtime, `${from}: disallowed data URL`);
      return;
    }
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) {
      assert.ok(!runtime, `${from}: external runtime dependency: ${value}`);
      return;
    }
    const target = localTarget(value, from);
    assert.ok(
      sourceSet.has(target.path),
      `${from}: missing local target: ${value}`,
    );
    if (target.fragment)
      fragments.push({ from, page: target.path, fragment: target.fragment });
  }

  for (const page of pages) {
    const html = readFileSync(join(site, page), "utf8");
    for (const tag of html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)) {
      const element = tag[1].toLowerCase();
      for (const attribute of tag[0].matchAll(
        /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
      )) {
        const name = attribute[1].toLowerCase();
        const value = attribute[2] ?? attribute[3] ?? attribute[4];
        if (name === "href" && (element === "a" || element === "link")) {
          reference(value, page, {
            runtime: element === "link",
            data:
              element === "link" &&
              /\brel\s*=\s*["'][^"']*\bicon\b/i.test(tag[0]),
          });
        } else if (
          name === "src" &&
          ["script", "img", "source", "video", "audio", "iframe"].includes(
            element,
          )
        ) {
          reference(value, page, { runtime: true });
        } else if (name === "poster" && element === "video") {
          reference(value, page, { runtime: true });
        } else if (name === "srcset") {
          for (const candidate of value.split(","))
            reference(candidate.trim().split(/\s+/)[0], page, {
              runtime: true,
            });
        } else if (name === "style") {
          css(value, page);
        }
      }
    }
    for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi))
      css(style[1], page);
    const social = html.match(
      /<meta\b[^>]*\bproperty\s*=\s*["']og:image["'][^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*>/i,
    );
    if (social) reference(social[1], page, { runtime: true });
  }

  function css(source, from) {
    for (const match of source.matchAll(
      /url\(\s*(?:["']([^"']+)["']|([^)'"\s]+))\s*\)/gi,
    )) {
      reference(match[1] ?? match[2], from, { runtime: true, data: true });
    }
    for (const match of source.matchAll(
      /@import\s+(?:["']([^"']+)["']|url\(\s*["']?([^)'"\s]+))/gi,
    )) {
      reference(match[1] ?? match[2], from, { runtime: true });
    }
  }

  for (const file of sourceFiles.filter((path) => path.endsWith(".css"))) {
    css(readFileSync(join(site, file), "utf8"), file);
  }
  for (const file of sourceFiles.filter((path) => path.endsWith(".js"))) {
    const script = readFileSync(join(site, file), "utf8");
    for (const match of script.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g,
    )) {
      assert.ok(
        match[1].startsWith(".") || match[1].startsWith("/"),
        `${file}: external runtime dependency: ${match[1]}`,
      );
      reference(match[1], file, { runtime: true });
    }
  }
  for (const { from, page, fragment } of fragments) {
    assert.ok(
      pages.includes(page) && ids.get(page)?.has(fragment),
      `${from}: missing fragment #${fragment} in ${page}`,
    );
  }
}

async function inventory(directory, exclude = new Set()) {
  const entries = [];
  for (const path of (await filesBelow(directory)).filter(
    (path) => !exclude.has(path),
  )) {
    const bytes = await readFile(join(directory, path));
    entries.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return entries.sort(byPath);
}

async function build(output, commit, tarSha256, zipSha256) {
  const site = join(root, "site");
  const outputPath = resolve(output);
  assert.ok(
    outputPath !== resolve(root),
    "Output cannot be the repository root",
  );
  assert.ok(
    outputPath !== site && !outputPath.startsWith(`${site}${sep}`),
    "Output cannot overwrite site sources",
  );
  assert.ok(
    !resolve(root).startsWith(`${outputPath}${sep}`),
    "Output cannot contain the repository",
  );
  const sourceFiles = await filesBelow(site);
  validateSite(site, sourceFiles);

  await mkdir(dirname(outputPath), { recursive: true });
  const staging = `${outputPath}.tmp-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  try {
    await mkdir(staging, { recursive: true });
    for (const path of sourceFiles) {
      const destination = join(staging, path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(site, path), destination);
      await chmod(destination, 0o644);
    }
    execFileSync(
      process.execPath,
      [
        join(root, "scripts/ci/render-installers.mjs"),
        staging,
        commit,
        tarSha256,
        zipSha256,
      ],
      { cwd: root, stdio: "inherit" },
    );
    await writeFile(join(staging, ".nojekyll"), "");

    const files = await inventory(staging, generated);
    await writeFile(
      join(staging, "inventory.json"),
      `${JSON.stringify({ schemaVersion: "voxellume-site-inventory-1.0.0", files }, null, 2)}\n`,
    );
    const checksummed = await inventory(staging, new Set(["SHA256SUMS"]));
    await writeFile(
      join(staging, "SHA256SUMS"),
      checksummed
        .map(({ path, sha256: hash }) => `${hash}  ${path}\n`)
        .join(""),
    );
    await rm(outputPath, { recursive: true, force: true });
    await rename(staging, outputPath);
    console.log(
      `Built ${checksummed.length + 1} deterministic site files in ${relative(root, outputPath)}`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

const options = new Map();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  assert.ok(
    ["--output", "--commit", "--tar-sha256", "--zip-sha256"].includes(
      args[index],
    ),
    `Unknown argument: ${args[index]}`,
  );
  assert.ok(
    args[index + 1] && !options.has(args[index]),
    `Missing or duplicate value for ${args[index]}`,
  );
  options.set(args[index], args[index + 1]);
}
const output = options.get("--output");
const commit = options.get("--commit");
const tarSha256 = options.get("--tar-sha256");
const zipSha256 = options.get("--zip-sha256");
if (
  options.size !== 4 ||
  !output ||
  !/^[0-9a-f]{40}$/.test(commit ?? "") ||
  !/^[0-9a-f]{64}$/.test(tarSha256 ?? "") ||
  !/^[0-9a-f]{64}$/.test(zipSha256 ?? "")
) {
  console.error(
    "Usage: node scripts/ci/build-site.mjs --output <directory> --commit <40hex> --tar-sha256 <64hex> --zip-sha256 <64hex>",
  );
  process.exit(1);
}
await build(output, commit, tarSha256, zipSha256);
