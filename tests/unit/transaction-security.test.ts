import assert from "node:assert/strict";
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  buildCandidate,
  commitCandidate,
} from "../../src/core/spec/transactions.ts";
import {
  artifactPath,
  assertOutsideBytes,
  assertUserBytes,
  generatedSource,
  makeOptions,
  readJournal,
  type RecoveryHooks,
  setup,
  snapshotTree,
  sourcePath,
  verifiedCandidate,
} from "../helpers/transaction-fixture.ts";

for (const transition of ["proposed", "validated", "staged"] as const) {
  test(`cancellation after ${transition} prevents the next transition and preserves last-good`, async (t) => {
    const fixture = await setup(t);
    const before = await snapshotTree(fixture.projectRoot);
    const controller = new AbortController();
    const visited: string[] = [];
    const result = await buildCandidate(
      makeOptions(fixture, {
        signal: controller.signal,
        hooks: {
          onTransition: (status) => {
            visited.push(status);
            if (status === transition) controller.abort();
          },
        },
      }),
    );
    assert.equal(result.status, "cancelled");
    assert.equal(result.error?.code, "cancelled");
    assert.equal(visited.at(-1), transition);
    assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
  });
}

test("cancellation after verified prevents commit and preserves last-good", async (t) => {
  const fixture = await setup(t);
  const before = await snapshotTree(fixture.projectRoot);
  const candidate = await verifiedCandidate(fixture);
  const controller = new AbortController();
  controller.abort();
  const result = await commitCandidate({
    candidate,
    signal: controller.signal,
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.error?.code, "cancelled");
  assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
});

test("cancellation is checked after generator and verifier callbacks even when they ignore the signal", async (t) => {
  for (const phase of ["generate", "verify"] as const) {
    await t.test(phase, async (t) => {
      const fixture = await setup(t);
      const before = await snapshotTree(fixture.projectRoot);
      const controller = new AbortController();
      const options = makeOptions(fixture, { signal: controller.signal });
      if (phase === "generate") {
        const generate = options.generate;
        options.generate = async (context) => {
          const result = await generate(context);
          controller.abort();
          return result;
        };
      } else {
        options.verify = async () => {
          controller.abort();
          return { status: "passed" };
        };
      }
      const result = await buildCandidate(options);
      assert.equal(result.status, "cancelled");
      assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
    });
  }
});

test("rejects forged verification and post-verification manifest tampering", async (t) => {
  const fixture = await setup(t);
  const before = await snapshotTree(fixture.projectRoot);
  const failed = await buildCandidate(
    makeOptions(fixture, {
      transactionId: "tx-forged-verification",
      verify: async () => ({ status: "failed", detail: "failed GameTest" }),
    }),
  );
  failed.status = "verified";
  const forged = await commitCandidate({ candidate: failed });
  assert.equal(forged.status, "failed");
  assert.equal(forged.error?.code, "verification_required");
  assert.deepEqual(await snapshotTree(fixture.projectRoot), before);

  const verified = await verifiedCandidate(fixture, {
    transactionId: "tx-manifest-tamper",
  });
  verified.manifest.files[0]!.sha256 = "0".repeat(64);
  const tampered = await commitCandidate({ candidate: verified });
  assert.equal(tampered.status, "failed");
  assert.equal(tampered.error?.code, "candidate_tampered");
  assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
});

for (const target of ["destination", "source", "new-project"] as const) {
  test(`rejects ${target} symlink swap without exposing outside bytes`, async (t) => {
    const fixture = await setup(t, { newProject: target === "new-project" });
    const outside = join(fixture.root, `outside-${target}`);
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "ruby-blade.jar"), "outside-sentinel\n");
    await writeFile(join(outside, "sentinel.txt"), "outside-sentinel\n");
    const outsideBefore = await snapshotTree(outside);
    const candidate = await verifiedCandidate(fixture, {
      transactionId: `tx-symlink-${target}`,
    });
    const root =
      target === "source" ? candidate.stagingRoot : fixture.projectRoot;
    const libraries = join(root, "build", "libs");
    let swapped = false;
    const swap = async () => {
      if (target === "new-project") {
        await rename(candidate.stagingRoot, `${candidate.stagingRoot}-real`);
        await symlink(outside, candidate.stagingRoot, "dir");
      } else {
        await rename(libraries, `${libraries}-original`);
        await symlink(outside, libraries, "dir");
      }
      swapped = true;
    };
    const result = await commitCandidate({
      candidate,
      hooks:
        target === "new-project"
          ? { beforeDirectorySwap: swap }
          : {
              beforeApplyFile: async ({ path }) => {
                if (path === artifactPath && !swapped) await swap();
              },
            },
    });
    assert.equal(swapped, true);
    assert.equal(result.status, "rolled_back");
    assert.equal(result.error?.code, "unsafe_path");
    assert.deepEqual(await snapshotTree(outside), outsideBefore);
    if (target === "new-project")
      assert.equal(await snapshotTree(fixture.projectRoot), null);
    if (target === "source")
      assert.equal(
        await readFile(join(fixture.projectRoot, artifactPath), "utf8"),
        "last-good-production-artifact\n",
      );
  });
}

test("late per-file drift and post-apply edits are never overwritten", async (t) => {
  await t.test("before apply", async (t) => {
    const fixture = await setup(t);
    const candidate = await verifiedCandidate(fixture, {
      transactionId: "tx-per-file-drift",
    });
    const result = await commitCandidate({
      candidate,
      hooks: {
        beforeApplyFile: async ({ path, projectRoot }) => {
          if (path === sourcePath)
            await writeFile(join(projectRoot, sourcePath), "late user edit\n");
        },
      },
    });
    assert.equal(result.status, "rolled_back");
    assert.equal(result.error?.code, "base_drift");
    assert.equal(
      await readFile(join(fixture.projectRoot, sourcePath), "utf8"),
      "late user edit\n",
    );
  });
  await t.test("during rollback", async (t) => {
    const fixture = await setup(t);
    const candidate = await verifiedCandidate(fixture, {
      transactionId: "tx-rollback-user-edit",
    });
    const result = await commitCandidate({
      candidate,
      faults: { failAfterApplyFiles: 1 },
      hooks: {
        afterApplyFile: async ({ path, projectRoot }) => {
          if (path === artifactPath)
            await writeFile(
              join(projectRoot, artifactPath),
              "post-apply user edit\n",
            );
        },
      },
    });
    assert.equal(result.status, "recovery_required");
    assert.equal(result.error?.code, "rollback_conflict");
    assert.equal(
      await readFile(join(fixture.projectRoot, artifactPath), "utf8"),
      "post-apply user edit\n",
    );
    assert.equal(
      await readFile(join(fixture.projectRoot, sourcePath), "utf8"),
      generatedSource("last-good"),
    );
  });
});

test("cancellation after final apply and new-project rename rolls back instead of committing", async (t) => {
  await t.test("final afterApplyFile", async (t) => {
    const fixture = await setup(t);
    const before = await snapshotTree(fixture.projectRoot);
    assert.ok(before);
    const candidate = await verifiedCandidate(fixture);
    const finalPath = [
      ...new Set([
        ...candidate.manifest.files.map((file) => file.path),
        "mod-spec.json",
      ]),
    ]
      .sort((left, right) => left.localeCompare(right))
      .at(-1);
    assert.ok(finalPath);
    const controller = new AbortController();

    const result = await commitCandidate({
      candidate,
      signal: controller.signal,
      hooks: {
        afterApplyFile: ({ path }) => {
          if (path === finalPath) controller.abort();
        },
      },
    });

    assert.equal(result.status, "rolled_back");
    assert.equal(result.error.code, "cancelled");
    assert.notEqual(result.status, "committed");
    assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
    assert.equal((await readJournal(candidate)).status, "rolled_back");
    await assertUserBytes(fixture);
    await assertOutsideBytes(fixture);
  });

  await t.test("after new-project directory rename", async (t) => {
    const fixture = await setup(t, { newProject: true });
    const candidate = await verifiedCandidate(fixture);
    const staged = await snapshotTree(candidate.stagingRoot);
    assert.ok(staged);
    const controller = new AbortController();
    let afterRenameCalled = false;
    const hooks: RecoveryHooks = {
      afterDirectorySwap: async ({ stagingRoot, projectRoot }) => {
        afterRenameCalled = true;
        assert.deepEqual(await snapshotTree(projectRoot), staged);
        assert.equal(await snapshotTree(stagingRoot), null);
        controller.abort();
      },
    };

    const result = await commitCandidate({
      candidate,
      signal: controller.signal,
      hooks,
    });

    assert.equal(afterRenameCalled, true);
    assert.equal(result.status, "rolled_back");
    assert.equal(result.error.code, "cancelled");
    assert.notEqual(result.status, "committed");
    assert.equal(await snapshotTree(fixture.projectRoot), null);
    assert.deepEqual(await snapshotTree(candidate.stagingRoot), staged);
    assert.equal((await readJournal(candidate)).status, "rolled_back");
    await assertOutsideBytes(fixture);
  });
});
