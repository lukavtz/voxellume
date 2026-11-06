import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { commitCandidate } from "../../src/core/spec/transactions.ts";
import {
  artifactPath,
  assertOutsideBytes,
  assertUserBytes,
  generatedSource,
  readJournal,
  type RecoveryFaults,
  setup,
  snapshotTree,
  sourcePath,
  type TestJournal,
  verifiedCandidate,
} from "../helpers/transaction-fixture.ts";

test("partial existing-project apply rolls back byte-identically and persists its journal", async (t) => {
  const fixture = await setup(t);
  const before = await snapshotTree(fixture.projectRoot);
  const candidate = await verifiedCandidate(fixture);
  const result = await commitCandidate({
    candidate,
    faults: { failAfterApplyFiles: 1 },
  });

  assert.equal(result.status, "rolled_back");
  assert.equal(result.error?.code, "apply_failed");
  assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
  const journal = JSON.parse(await readFile(candidate.journalPath, "utf8")) as {
    status: string;
    appliedFiles: unknown[];
  };
  assert.equal(journal.status, "rolled_back");
  assert.ok(
    journal.appliedFiles.length > 0,
    "journal records the partial apply",
  );
});

test("crash during partial apply recovers from the persisted journal after restart", async (t) => {
  const fixture = await setup(t);
  const before = await snapshotTree(fixture.projectRoot);
  const candidate = await verifiedCandidate(fixture);
  const crashed = await commitCandidate({
    candidate,
    faults: { crashAfterApplyFiles: 1 },
  });
  assert.equal(crashed.status, "recovery_required");
  assert.equal(crashed.error?.code, "recovery_required");

  const restarted = structuredClone(crashed);
  const recovered = await commitCandidate({ candidate: restarted });
  assert.equal(recovered.status, "rolled_back", recovered.error?.detail);
  assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
});

test("rollback failure requires recovery, then retry restores last-good byte-identically", async (t) => {
  const fixture = await setup(t);
  const before = await snapshotTree(fixture.projectRoot);
  const candidate = await verifiedCandidate(fixture);
  const failed = await commitCandidate({
    candidate,
    faults: { failAfterApplyFiles: 1, failRollback: true },
  });
  assert.equal(failed.status, "recovery_required");
  assert.equal(failed.error?.code, "rollback_failed");
  assert.notEqual(failed.status, "committed");

  const recovered = await commitCandidate({
    candidate: structuredClone(failed),
  });
  assert.equal(recovered.status, "rolled_back", recovered.error?.detail);
  assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
});

test("crash after new-project rename recovers by renaming the destination back to staging", async (t) => {
  const fixture = await setup(t, { newProject: true });
  const candidate = await verifiedCandidate(fixture, {
    transactionId: "tx-post-swap-crash",
  });
  const crashed = await commitCandidate({
    candidate,
    faults: { crashAfterDirectorySwap: true },
  });
  assert.equal(crashed.status, "recovery_required");
  assert.notEqual(
    await snapshotTree(fixture.projectRoot),
    null,
    "fault occurs after rename",
  );

  const recovered = await commitCandidate({
    candidate: structuredClone(crashed),
  });
  assert.equal(recovered.status, "rolled_back");
  assert.equal(await snapshotTree(fixture.projectRoot), null);
  assert.equal(
    await readFile(join(candidate.stagingRoot, sourcePath), "utf8"),
    generatedSource("candidate"),
  );
});

test("rejects tampered journal paths, status, backups, and base hash before recovery mutations", async (t) => {
  const forgedTemporaryPath =
    "build/libs/.ruby-blade.jar.voxellume-424242-7.tmp";
  const cases: Array<{
    name: string;
    crashAfterApplyFiles?: number;
    preexistingTemporary?: boolean;
    tamper: (journal: TestJournal) => void;
  }> = [
    {
      name: "an unowned applied path cannot delete user bytes",
      tamper: (journal) => {
        journal.appliedFiles = ["user-notes.txt"];
        journal.backups["user-notes.txt"] = { data: null };
      },
    },
    {
      name: "a forged temporary path cannot delete pre-existing user bytes",
      tamper: (journal) => {
        journal.temporaryFiles = ["user-notes.txt"];
      },
    },
    {
      name: "an owned-pattern forged temporary cannot delete pre-existing user bytes",
      preexistingTemporary: true,
      tamper: (journal) => {
        journal.temporaryFiles = [forgedTemporaryPath];
      },
    },
    {
      name: "a forged rolled_back status cannot skip recovery",
      tamper: (journal) => {
        journal.status = "rolled_back";
      },
    },
    {
      name: "a replaced backup cannot supply rollback bytes",
      tamper: (journal) => {
        journal.backups[artifactPath]!.data = Buffer.from(
          "attacker-controlled rollback\n",
        ).toString("base64");
      },
    },
    {
      name: "a missing backup cannot partially restore earlier entries",
      crashAfterApplyFiles: 2,
      tamper: (journal) => {
        delete journal.backups[artifactPath];
      },
    },
    {
      name: "a replaced base hash cannot authorize rollback",
      tamper: (journal) => {
        journal.baseProjectSha256 = "0".repeat(64);
      },
    },
  ];

  for (const {
    name,
    crashAfterApplyFiles = 1,
    preexistingTemporary = false,
    tamper,
  } of cases) {
    await t.test(name, async (t) => {
      const fixture = await setup(t);
      if (preexistingTemporary)
        await writeFile(
          join(fixture.projectRoot, forgedTemporaryPath),
          "user-owned temporary bytes\n",
        );
      const before = await snapshotTree(fixture.projectRoot);
      assert.ok(before);
      const candidate = await verifiedCandidate(fixture);
      const crashed = await commitCandidate({
        candidate,
        faults: { crashAfterApplyFiles },
      });
      assert.equal(crashed.status, "recovery_required");
      assert.equal(crashed.error.code, "recovery_required");
      const partial = await snapshotTree(fixture.projectRoot);
      assert.ok(partial);
      assert.notDeepEqual(partial, before);

      const journal = await readJournal(crashed);
      tamper(journal);
      await writeFile(
        crashed.journalPath,
        `${JSON.stringify(journal, null, 2)}\n`,
      );

      const recovered = await commitCandidate({
        candidate: structuredClone(crashed),
      });
      assert.equal(recovered.status, "recovery_required");
      assert.equal(recovered.error.code, "recovery_required");
      assert.deepEqual(
        await snapshotTree(fixture.projectRoot),
        partial,
        "journal validation must finish before any delete or restore",
      );
      if (preexistingTemporary)
        assert.equal(
          await readFile(
            join(fixture.projectRoot, forgedTemporaryPath),
            "utf8",
          ),
          "user-owned temporary bytes\n",
        );
      await assertUserBytes(fixture);
      await assertOutsideBytes(fixture);
    });
  }
});

test("crash after sibling temporary creation removes only the tracked temporary and restores last-good", async (t) => {
  const fixture = await setup(t);
  const untrackedTemporaryPath =
    "build/libs/.ruby-blade.jar.voxellume-424242-7.tmp";
  const untrackedTemporaryBytes = "user-owned temporary bytes\n";
  await writeFile(
    join(fixture.projectRoot, untrackedTemporaryPath),
    untrackedTemporaryBytes,
  );
  const before = await snapshotTree(fixture.projectRoot);
  assert.ok(before);
  const candidate = await verifiedCandidate(fixture);
  const faults: RecoveryFaults = { crashBeforeApplyRename: 1 };

  const crashed = await commitCandidate({ candidate, faults });
  assert.equal(crashed.status, "recovery_required");
  assert.equal(crashed.error.code, "recovery_required");
  const duringCrash = await snapshotTree(fixture.projectRoot);
  assert.ok(duringCrash);
  const createdTemporaryPaths = Object.keys(duringCrash).filter(
    (path) =>
      before[path] === undefined &&
      path.includes(".voxellume-") &&
      path.endsWith(".tmp"),
  );
  assert.equal(
    createdTemporaryPaths.length,
    1,
    "the fault stops after creating one apply temporary and before rename",
  );
  assert.equal(
    duringCrash[artifactPath],
    before[artifactPath],
    "the destination still has its last-good bytes before rename",
  );
  assert.equal(
    await readFile(join(fixture.projectRoot, untrackedTemporaryPath), "utf8"),
    untrackedTemporaryBytes,
  );
  await assertUserBytes(fixture);
  await assertOutsideBytes(fixture);

  const recovered = await commitCandidate({
    candidate: structuredClone(crashed),
  });
  assert.equal(recovered.status, "rolled_back", recovered.error.detail);
  assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
  assert.equal(
    await readFile(join(fixture.projectRoot, sourcePath), "utf8"),
    generatedSource("last-good"),
  );
  assert.equal(
    await readFile(join(fixture.projectRoot, artifactPath), "utf8"),
    "last-good-production-artifact\n",
  );
  assert.equal(
    await readFile(join(fixture.projectRoot, untrackedTemporaryPath), "utf8"),
    untrackedTemporaryBytes,
  );
  await assertUserBytes(fixture);
  await assertOutsideBytes(fixture);
});

test("cancellation during finalization rolls back and never remains committed", async (t) => {
  await t.test("during the final journal write", async (t) => {
    const fixture = await setup(t);
    const before = await snapshotTree(fixture.projectRoot);
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
          if (path === finalPath) setImmediate(() => controller.abort());
        },
      },
    });
    assert.equal(result.status, "rolled_back");
    assert.equal(result.error.code, "cancelled");
    assert.notEqual(result.status, "committed");
    assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
    assert.equal((await readJournal(candidate)).status, "rolled_back");
  });

  await t.test("after the committed transition hook", async (t) => {
    const fixture = await setup(t);
    const before = await snapshotTree(fixture.projectRoot);
    const candidate = await verifiedCandidate(fixture);
    const controller = new AbortController();
    const result = await commitCandidate({
      candidate,
      signal: controller.signal,
      hooks: {
        onTransition: (status) => {
          if (status === "committed") controller.abort();
        },
      },
    });
    assert.equal(result.status, "rolled_back");
    assert.equal(result.error.code, "cancelled");
    assert.notEqual(result.status, "committed");
    assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
    assert.equal((await readJournal(candidate)).status, "rolled_back");
  });
});
