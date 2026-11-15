import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const MARKDOWN_ROOTS = [
  "skills",
  "agents",
  "commands",
  "docs",
  "README.md",
  "README.ru.md",
];

const INLINE_PATH_PREFIXES = [
  "skills/",
  "docs/",
  "targets/",
  "templates/",
  "scripts/",
  "src/",
];

// Paths inside a scaffolded mod project, not inside this repository.
const PROJECT_RELATIVE = ["src/main/", "src/test/", "src/client/"];

const LINK = /\[[^\]]*\]\(([^()\s]+)\)/g;
const INLINE = /`([^`\n]+)`/g;

async function collectMarkdown(
  path: string,
  found: string[] = [],
): Promise<string[]> {
  const info = await stat(path);
  if (info.isDirectory()) {
    for (const entry of await readdir(path)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      await collectMarkdown(join(path, entry), found);
    }
    return found;
  }
  if (path.endsWith(".md"))
    found.push(relative(repoRoot, path).split(sep).join("/"));
  return found;
}

function skipped(target: string): boolean {
  return (
    target === "" ||
    target.startsWith("#") ||
    target.startsWith("/") ||
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:") ||
    PROJECT_RELATIVE.some((prefix) => target.startsWith(prefix)) ||
    target.includes("*") ||
    target.includes("?")
  );
}

function targetFromLink(raw: string): string | undefined {
  const withoutFragment = raw.split("#")[0] ?? "";
  if (skipped(withoutFragment)) return undefined;
  return withoutFragment;
}

interface Target {
  readonly value: string;
  readonly fromRepoRoot: boolean;
}

function targetsOf(source: string): Target[] {
  const targets: Target[] = [];
  for (const match of source.matchAll(LINK)) {
    const captured = match[1];
    if (captured === undefined) continue;
    const target = targetFromLink(captured);
    if (target !== undefined)
      targets.push({ value: target, fromRepoRoot: false });
  }
  for (const match of source.matchAll(INLINE)) {
    const captured = match[1];
    if (captured === undefined) continue;
    const candidate = captured.trim();
    if (!INLINE_PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix)))
      continue;
    if (skipped(candidate)) continue;
    targets.push({ value: candidate, fromRepoRoot: true });
  }
  return targets;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("capability docs", () => {
  it("resolves every relative link and inline repo path", async () => {
    const files: string[] = [];
    for (const root of MARKDOWN_ROOTS)
      await collectMarkdown(join(repoRoot, root), files);

    assert.ok(files.length > 0, "no markdown files discovered");

    const missing: string[] = [];
    for (const file of files) {
      const source = await readFile(join(repoRoot, file), "utf8");
      for (const target of targetsOf(source)) {
        const base = target.fromRepoRoot
          ? target.value
          : posix.join(posix.dirname(file), target.value);
        const resolved = posix.normalize(base);
        if (resolved.startsWith("..")) {
          missing.push(`${file}: ${target.value} escapes the repository`);
          continue;
        }
        if (!(await exists(join(repoRoot, resolved)))) {
          missing.push(`${file}: ${target.value}`);
        }
      }
    }

    assert.deepEqual(
      missing,
      [],
      `unresolved references:\n${missing.join("\n")}`,
    );
  });

  it("resolves the tool reference the architecture points at", async () => {
    assert.equal(await exists(join(repoRoot, "docs", "TOOLS.md")), true);
    assert.equal(await exists(join(repoRoot, "docs", "BLOCKBENCH.md")), true);
  });

  it("keeps one H1 heading per skill", async () => {
    const skills = await collectMarkdown(join(repoRoot, "skills"));
    assert.ok(skills.length > 0);
    for (const file of skills) {
      const source = await readFile(join(repoRoot, file), "utf8");
      const headings = source
        .split("\n")
        .filter((line) => line.startsWith("# "));
      assert.equal(headings.length, 1, `${file} must have exactly one H1`);
      assert.ok(
        source.trimStart().includes("\n# "),
        `${file} must start with a heading`,
      );
    }
  });

  it("keeps blender script names discoverable from the scripts directory", async () => {
    const scripts = await readdir(join(repoRoot, "scripts", "blender"));
    for (const name of ["loop_check.py", "contact_sheet.py", "qa_report.py"]) {
      assert.ok(scripts.includes(name), `${name} missing from scripts/blender`);
    }
    assert.equal(
      dirname(join(repoRoot, "docs", "TOOLS.md")),
      join(repoRoot, "docs"),
    );
  });
});
