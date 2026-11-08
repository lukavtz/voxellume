import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const commit = "0123456789abcdef0123456789abcdef01234567";
const tarSha256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const zipSha256 =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

function fixture(t: test.TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "voxellume-site-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(join(repository, "site"), join(directory, "site"), {
    recursive: true,
  });
  mkdirSync(join(directory, "scripts/ci"), { recursive: true });
  for (const script of ["build-site.mjs", "render-installers.mjs"]) {
    cpSync(
      join(repository, "scripts/ci", script),
      join(directory, "scripts/ci", script),
    );
  }
  for (const installer of ["install.sh", "install.ps1"]) {
    cpSync(join(repository, installer), join(directory, installer));
  }
  return directory;
}

function build(root: string, output: string) {
  return spawnSync(
    process.execPath,
    [
      join(root, "scripts/ci/build-site.mjs"),
      "--output",
      output,
      "--commit",
      commit,
      "--tar-sha256",
      tarSha256,
      "--zip-sha256",
      zipSha256,
    ],
    { cwd: root, encoding: "utf8", timeout: 30_000 },
  );
}

function snapshot(directory: string, prefix = ""): [string, string][] {
  return readdirSync(join(directory, prefix), { withFileTypes: true })
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory()
        ? snapshot(directory, path)
        : ([[path, readFileSync(join(directory, path)).toString("base64")]] as [
            string,
            string,
          ][]);
    });
}

test("site build is reproducible and emits verified local artifacts", (t) => {
  const root = fixture(t);
  const first = join(root, "first");
  const second = join(root, "second");
  for (const output of [first, second]) {
    const result = build(root, output);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(snapshot(first), snapshot(second));
  assert.equal(readFileSync(join(first, ".nojekyll"), "utf8"), "");
  for (const page of ["index.html", "ru/index.html", "zh-CN/index.html"]) {
    assert.ok(readFileSync(join(first, page), "utf8").includes("</html>"));
  }
  const sh = readFileSync(join(first, "install.sh"), "utf8");
  const ps1 = readFileSync(join(first, "install.ps1"), "utf8");
  assert.ok(sh.includes(commit) && sh.includes(tarSha256));
  assert.ok(ps1.includes(commit) && ps1.includes(zipSha256));

  const inventory = JSON.parse(
    readFileSync(join(first, "inventory.json"), "utf8"),
  );
  const paths = inventory.files.map((file: { path: string }) => file.path);
  assert.deepEqual(paths, paths.toSorted());
  for (const file of inventory.files) {
    const bytes = readFileSync(join(first, file.path));
    assert.equal(file.bytes, bytes.length);
    assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex"));
  }
  const sums = readFileSync(join(first, "SHA256SUMS"), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => {
      const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
      assert.ok(match, `Malformed SHA256SUMS line: ${line}`);
      const hash = match[1];
      const path = match[2];
      assert.ok(hash && path);
      return { sha256: hash, path };
    });
  assert.deepEqual(
    sums.map((file) => file.path),
    [...paths, "inventory.json"].toSorted(),
  );
  for (const file of sums) {
    assert.equal(
      file.sha256,
      createHash("sha256")
        .update(readFileSync(join(first, file.path)))
        .digest("hex"),
    );
  }
});

test("site build fails closed on missing, malformed, and external content", (t) => {
  const cases = [
    {
      name: "missing referenced asset",
      mutate(root: string) {
        rmSync(join(root, "site/assets/images/fabric-main.png"));
      },
      error: /missing local target|Missing required site content/,
    },
    {
      name: "malformed localized HTML",
      mutate(root: string) {
        const page = join(root, "site/ru/index.html");
        writeFileSync(
          page,
          readFileSync(page, "utf8").replace(/<\/html\s*>/i, ""),
        );
      },
      error: /ru\/index\.html: missing <\/html>/,
    },
    {
      name: "external runtime dependency",
      mutate(root: string) {
        const page = join(root, "site/index.html");
        writeFileSync(
          page,
          readFileSync(page, "utf8").replace(
            '<script src="./assets/main.js"',
            '<script src="https://cdn.example.com/main.js"',
          ),
        );
      },
      error: /external runtime dependency/,
    },
  ];
  for (const { name, mutate, error } of cases) {
    const root = fixture(t);
    mutate(root);
    const output = join(root, "output");
    const result = build(root, output);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, error, name);
    assert.equal(readdirSync(root).includes("output"), false, name);
  }
});
