import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const commit = "0123456789abcdef0123456789abcdef01234567";
const tarSha256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const zipSha256 =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const posixTemplate = readFileSync(join(root, "install.sh"), "utf8");
const windowsTemplate = readFileSync(join(root, "install.ps1"), "utf8");
const renderer = join(root, "scripts/ci/render-installers.mjs");

function render(): { directory: string; sh: string; ps1: string } {
  const directory = mkdtempSync(join(tmpdir(), "voxellume-installers-"));
  execFileSync(
    process.execPath,
    [renderer, directory, commit, tarSha256, zipSha256],
    { cwd: root, stdio: "pipe" },
  );
  return {
    directory,
    sh: readFileSync(join(directory, "install.sh"), "utf8"),
    ps1: readFileSync(join(directory, "install.ps1"), "utf8"),
  };
}

test("renderer deterministically emits exact immutable downloads", (t) => {
  const first = render();
  const second = render();
  t.after(() => {
    rmSync(first.directory, { recursive: true, force: true });
    rmSync(second.directory, { recursive: true, force: true });
  });
  assert.equal(first.sh, second.sh);
  assert.equal(first.ps1, second.ps1);
  assert.match(
    first.sh,
    new RegExp(
      `https://codeload\\.github\\.com/lukavtz/voxellume/tar\\.gz/${commit}`,
    ),
  );
  assert.match(
    first.ps1,
    new RegExp(
      `https://codeload\\.github\\.com/lukavtz/voxellume/zip/${commit}`,
    ),
  );
  assert.ok(first.sh.includes(tarSha256));
  assert.ok(!first.sh.includes(zipSha256));
  assert.ok(first.ps1.includes(zipSha256));
  assert.ok(!first.ps1.includes(tarSha256));
  for (const script of [first.sh, first.ps1]) {
    assert.ok(!script.includes("__VOXELLUME_COMMIT__"));
    assert.ok(!script.includes("__VOXELLUME_TAR_SHA256__"));
    assert.ok(!script.includes("__VOXELLUME_ZIP_SHA256__"));
    assert.ok(!/codeload[^\n]*(?:main|latest)/.test(script));
  }
  assert.ok(first.sh.includes('"$commit" = "$commit_placeholder"'));
  assert.ok(first.ps1.includes("$commit -eq $commitPlaceholder"));
  assert.ok(
    first.sh.indexOf('actual="$(') < first.sh.indexOf("tar -xzf"),
    "POSIX archive must be hashed before extraction",
  );
  assert.ok(
    first.ps1.indexOf("Get-FileHash") < first.ps1.indexOf("Expand-Archive"),
    "Windows archive must be hashed before extraction",
  );
});

test("renderer rejects mutable or malformed pins", (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), "voxellume-installers-invalid-"),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const args of [
    [directory, "main", tarSha256, zipSha256],
    [directory, commit, "latest", zipSha256],
    [directory, commit, tarSha256, "latest"],
    [directory, commit, tarSha256],
    [directory],
  ]) {
    const result = spawnSync(process.execPath, [renderer, ...args], {
      cwd: root,
      stdio: "pipe",
    });
    assert.notEqual(result.status, 0);
  }
});

test("templates preserve safe local defaults and fail closed on partial rendering", () => {
  for (const [script, commitPlaceholder, hashPlaceholder] of [
    [posixTemplate, '"__VOXELLUME_COMMIT__"', '"__VOXELLUME_TAR_SHA256__"'],
    [windowsTemplate, "'__VOXELLUME_COMMIT__'", "'__VOXELLUME_ZIP_SHA256__'"],
  ] as const) {
    assert.ok(script.includes(commitPlaceholder));
    assert.ok(script.includes(hashPlaceholder));
    assert.match(
      script,
      /not rendered consistently|rendered consistently|Invalid installer pins/,
    );
  }
  assert.ok(posixTemplate.includes('package.json"'));
  assert.ok(posixTemplate.includes("pnpm-lock.yaml"));
  assert.ok(!/(?:^|\s)(?:omp|dsh)\s/.test(posixTemplate));
  assert.ok(!/(?:^|\s)(?:omp|dsh)\s/.test(windowsTemplate));
  assert.ok(!windowsTemplate.includes("&&"));
  assert.ok(!windowsTemplate.includes("??"));
  assert.ok(!windowsTemplate.includes("?."));
  assert.ok(windowsTemplate.includes("--frozen-lockfile"));
  assert.ok(posixTemplate.includes("--frozen-lockfile"));
});

test("installer shell syntax is valid", (t) => {
  execFileSync("bash", ["-n", join(root, "install.sh")]);
  const pwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], {
    stdio: "ignore",
  });
  if (pwsh.error?.code === "ENOENT") {
    t.skip("pwsh is not installed");
    return;
  }
  assert.equal(pwsh.status, 0);
  const parse = `$tokens = $null; $errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${join(root, "install.ps1").replaceAll("'", "''")}', [ref]$tokens, [ref]$errors); if ($errors.Count -ne 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }`;
  execFileSync("pwsh", ["-NoProfile", "-Command", parse], { stdio: "pipe" });
});
