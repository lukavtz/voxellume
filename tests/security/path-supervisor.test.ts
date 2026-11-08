import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  assertSafeArchiveEntry,
  grantAuthorizedRoot,
  readAuthorizedFile,
  resolveAuthorizedPath,
  writeAuthorizedFile,
  type AuthorizedRoot,
} from "../../src/core/execution/paths.ts";

interface Fixture {
  root: string;
  project: AuthorizedRoot;
  staging: AuthorizedRoot;
  stagingPath: string;
  outsidePath: string;
}

async function setup(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-paths-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectPath = join(root, "project");
  const stagingPath = join(root, "transactions", "tx-1", "staging");
  const outsidePath = join(root, "outside");
  await mkdir(projectPath, { recursive: true });
  await mkdir(stagingPath, { recursive: true });
  await mkdir(outsidePath);
  await writeFile(join(projectPath, "user.txt"), "user\n");
  await writeFile(join(stagingPath, "existing.txt"), "old\n");
  await writeFile(join(outsidePath, "sentinel.txt"), "outside\n");
  return {
    root,
    project: await grantAuthorizedRoot({ path: projectPath, kind: "project" }),
    staging: await grantAuthorizedRoot({
      path: stagingPath,
      kind: "transactionStaging",
      transactionId: "tx-1",
    }),
    stagingPath,
    outsidePath,
  };
}

function errorCode(error: unknown): unknown {
  if (error !== null && typeof error === "object" && "code" in error) {
    return error.code;
  }
  return undefined;
}

async function rejectsCode(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.equal(errorCode(error), code);
    return true;
  });
}

test("only host-granted real roots are authorities; staging alone is writable", async (t) => {
  const fixture = await setup(t);
  const alias = join(fixture.root, "staging-alias");
  await symlink(fixture.stagingPath, alias, "dir");
  const aliased = await grantAuthorizedRoot({
    path: alias,
    kind: "transactionStaging",
    transactionId: "tx-1",
  });
  assert.equal(
    await realpath(aliased.realPath),
    await realpath(fixture.stagingPath),
  );

  await rejectsCode(
    writeAuthorizedFile(fixture.project, {
      path: "user.txt",
      contents: "overwrite\n",
      expectedRevision: null,
    }),
    "read_only_root",
  );
  // Forged capability must not acquire authority without the host factory.
  const forged = {
    realPath: fixture.outsidePath,
    kind: "transactionStaging",
    transactionId: "tx-1",
  } as AuthorizedRoot;
  await rejectsCode(
    readAuthorizedFile(forged, "sentinel.txt"),
    "unauthorized_root",
  );
  assert.equal(
    await readFile(join(fixture.outsidePath, "sentinel.txt"), "utf8"),
    "outside\n",
  );
});

test("rejects traversal, absolute paths, NUL, and symlink escapes", async (t) => {
  const fixture = await setup(t);
  await symlink(
    fixture.outsidePath,
    join(fixture.stagingPath, "escape"),
    "dir",
  );
  await symlink(
    join(fixture.outsidePath, "sentinel.txt"),
    join(fixture.stagingPath, "leaf-link"),
  );
  const cases = [
    ["../outside/sentinel.txt", "path_traversal"],
    ["nested/../../outside/sentinel.txt", "path_traversal"],
    [join(fixture.outsidePath, "sentinel.txt"), "absolute_path"],
    ["safe\0.txt", "invalid_path"],
    ["escape/sentinel.txt", "unsafe_symlink"],
    ["leaf-link", "unsafe_symlink"],
  ] as const;
  for (const [path, code] of cases) {
    await t.test(JSON.stringify(path), async () => {
      await rejectsCode(resolveAuthorizedPath(fixture.staging, path), code);
      await rejectsCode(readAuthorizedFile(fixture.staging, path), code);
    });
  }
  assert.equal(
    await readFile(join(fixture.outsidePath, "sentinel.txt"), "utf8"),
    "outside\n",
  );
});

test("missing outputs resolve lexically only beneath an existing real parent", async (t) => {
  const fixture = await setup(t);
  await mkdir(join(fixture.stagingPath, "real"));
  const output = await resolveAuthorizedPath(
    fixture.staging,
    "real/output.txt",
  );
  assert.equal(
    await realpath(dirname(output)),
    join(await realpath(fixture.stagingPath), "real"),
  );
  assert.equal(basename(output), "output.txt");
  await rejectsCode(
    resolveAuthorizedPath(fixture.staging, "missing/output.txt"),
    "missing_parent",
  );
  await symlink(
    fixture.outsidePath,
    join(fixture.stagingPath, "linked"),
    "dir",
  );
  await rejectsCode(
    resolveAuthorizedPath(fixture.staging, "linked/output.txt"),
    "unsafe_symlink",
  );
});

test("a granted root cannot be redirected by a real directory swap", async (t) => {
  const fixture = await setup(t);
  const retired = join(fixture.root, "retired-staging");
  await rename(fixture.stagingPath, retired);
  await rename(fixture.outsidePath, fixture.stagingPath);

  const result = await readAuthorizedFile(fixture.staging, "existing.txt");
  assert.equal(result.contents.toString("utf8"), "old\n");
  await rejectsCode(
    readAuthorizedFile(fixture.staging, "sentinel.txt"),
    "not_found",
  );
  assert.equal(
    await readFile(join(fixture.stagingPath, "sentinel.txt"), "utf8"),
    "outside\n",
  );
});

test("a parent-directory swap during rename cannot redirect output outside staging", async (t) => {
  const fixture = await setup(t);
  const parent = join(fixture.stagingPath, "parent");
  const retired = join(fixture.stagingPath, "retired-parent");
  const outsideParent = join(fixture.outsidePath, "parent");
  await mkdir(parent);
  await mkdir(outsideParent);
  await writeFile(join(outsideParent, "sentinel.txt"), "outside\n");

  const outcome = await writeAuthorizedFile(fixture.staging, {
    path: "parent/output.txt",
    contents: "candidate\n",
    expectedRevision: null,
    hooks: {
      beforeRename: async () => {
        await rename(parent, retired);
        await rename(outsideParent, parent);
      },
    },
  }).then(
    () => "written",
    (error: unknown) => {
      if (process.platform === "win32") {
        assert.ok(["EPERM", "path_swap"].includes(String(errorCode(error))));
      } else {
        assert.equal(errorCode(error), "path_swap");
      }
      return "rejected";
    },
  );
  if (outcome === "written") {
    assert.equal(
      await readFile(join(retired, "output.txt"), "utf8"),
      "candidate\n",
    );
  }
  assert.equal(
    await readFile(join(parent, "sentinel.txt"), "utf8"),
    "outside\n",
  );
  await assert.rejects(readFile(join(parent, "output.txt")), {
    code: "ENOENT",
  });
});

test("hard-linked files and archive hardlinks fail closed without outside mutation", async (t) => {
  const fixture = await setup(t);
  const outside = join(fixture.outsidePath, "sentinel.txt");
  const inside = join(fixture.stagingPath, "hard-link.txt");
  await link(outside, inside);
  const original = await readAuthorizedFile(fixture.staging, "hard-link.txt");
  await rejectsCode(
    writeAuthorizedFile(fixture.staging, {
      path: "hard-link.txt",
      contents: "attack\n",
      expectedRevision: original.revision,
    }),
    "hard_linked_file",
  );
  await rejectsCode(
    Promise.resolve().then(() =>
      assertSafeArchiveEntry({
        path: "assets/texture.png",
        kind: "hardlink",
        linkPath: "../../../outside/sentinel.txt",
      }),
    ),
    "archive_hardlink",
  );
  assert.equal(await readFile(outside, "utf8"), "outside\n");
});

test("writes use sibling temporaries, expected revisions, and no implicit overwrite", async (t) => {
  const fixture = await setup(t);
  const original = await readAuthorizedFile(fixture.staging, "existing.txt");
  let temporaryObserved = false;
  const updated = await writeAuthorizedFile(fixture.staging, {
    path: "existing.txt",
    contents: "new\n",
    expectedRevision: original.revision,
    hooks: {
      beforeRename: async ({ targetPath, temporaryPath }) => {
        temporaryObserved = true;
        assert.equal(dirname(temporaryPath), dirname(targetPath));
        assert.notEqual(temporaryPath, targetPath);
        assert.equal(await readFile(temporaryPath, "utf8"), "new\n");
      },
    },
  });
  assert.equal(temporaryObserved, true);
  assert.notEqual(updated.revision, original.revision);
  assert.deepEqual(await readdir(fixture.stagingPath), ["existing.txt"]);

  await rejectsCode(
    writeAuthorizedFile(fixture.staging, {
      path: "existing.txt",
      contents: "stale\n",
      expectedRevision: original.revision,
    }),
    "revision_conflict",
  );
  await writeAuthorizedFile(fixture.staging, {
    path: "created.txt",
    contents: "first\n",
    expectedRevision: null,
  });
  await rejectsCode(
    writeAuthorizedFile(fixture.staging, {
      path: "created.txt",
      contents: "second\n",
      expectedRevision: null,
    }),
    "revision_conflict",
  );
});

test("concurrent writers with one revision have one winner and never mix bytes", async (t) => {
  const fixture = await setup(t);
  const original = await readAuthorizedFile(fixture.staging, "existing.txt");
  const left = "left\n".repeat(1024);
  const right = "right\n".repeat(1024);
  const results = await Promise.allSettled([
    writeAuthorizedFile(fixture.staging, {
      path: "existing.txt",
      contents: left,
      expectedRevision: original.revision,
    }),
    writeAuthorizedFile(fixture.staging, {
      path: "existing.txt",
      contents: right,
      expectedRevision: original.revision,
    }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected);
  assert.equal(errorCode(rejected.reason), "revision_conflict");
  const contents = await readFile(
    join(fixture.stagingPath, "existing.txt"),
    "utf8",
  );
  assert.ok(contents === left || contents === right);
});

test("independent processes sharing one revision have exactly one writer", async (t) => {
  const fixture = await setup(t);
  const original = await readAuthorizedFile(fixture.staging, "existing.txt");
  const moduleUrl = new URL(
    "../../src/core/execution/paths.ts",
    import.meta.url,
  ).href;
  const source = `
import { grantAuthorizedRoot, writeAuthorizedFile } from ${JSON.stringify(moduleUrl)};
const [root, revision, contents] = process.argv.slice(1);
try {
  const staging = await grantAuthorizedRoot({ path: root, kind: "transactionStaging", transactionId: "tx-1" });
  await writeAuthorizedFile(staging, { path: "existing.txt", contents, expectedRevision: revision });
} catch (error) {
  if (error !== null && typeof error === "object" && "code" in error && error.code === "revision_conflict")
    process.exit(20);
  throw error;
}
`;
  const runWriter = (contents: string): Promise<number | null> => {
    const { promise, resolve, reject } = Promise.withResolvers<number | null>();
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        source,
        fixture.stagingPath,
        original.revision,
        contents,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || code === 20) resolve(code);
      else reject(new Error(`writer exited ${code}: ${stderr}`));
    });
    return promise;
  };

  const left = "left-child\n";
  const right = "right-child\n";
  const exitCodes = await Promise.all([runWriter(left), runWriter(right)]);
  assert.deepEqual(exitCodes.sort(), [0, 20]);
  const contents = await readFile(
    join(fixture.stagingPath, "existing.txt"),
    "utf8",
  );
  assert.ok(contents === left || contents === right);
});
