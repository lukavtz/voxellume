import assert from "node:assert/strict";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import {
  buildCandidate,
  commitCandidate,
} from "../../src/core/spec/transactions.ts";
import {
  generatedSource,
  makeOptions,
  setup,
  snapshotTree,
  sourcePath,
  verifiedCandidate,
} from "../helpers/transaction-fixture.ts";

test("base drift is a conflict and preserves both the user's drift and all other last-good bytes", async (t) => {
  const fixture = await setup(t);
  const candidate = await verifiedCandidate(fixture);
  await writeFile(
    join(fixture.projectRoot, "user-notes.txt"),
    "concurrent user edit\n",
  );
  const driftedTree = await snapshotTree(fixture.projectRoot);

  const result = await commitCandidate({ candidate });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "base_drift");
  assert.deepEqual(await snapshotTree(fixture.projectRoot), driftedTree);
  assert.equal(
    await readFile(join(fixture.projectRoot, "user-notes.txt"), "utf8"),
    "concurrent user edit\n",
  );
});

test("publishes a new project by same-filesystem directory swap", async (t) => {
  const fixture = await setup(t, { newProject: true });
  const candidate = await verifiedCandidate(fixture);
  assert.equal(await snapshotTree(fixture.projectRoot), null);
  const swaps: Array<{ stagingRoot: string; projectRoot: string }> = [];
  const result = await commitCandidate({
    candidate,
    hooks: {
      beforeDirectorySwap: (event) => {
        swaps.push(event);
      },
    },
  });
  assert.equal(result.status, "committed", result.error?.detail);
  assert.deepEqual(swaps, [
    { stagingRoot: candidate.stagingRoot, projectRoot: fixture.projectRoot },
  ]);
  assert.equal(
    await readFile(join(fixture.projectRoot, sourcePath), "utf8"),
    generatedSource("candidate"),
  );
});

test("a failed new-project directory swap leaves no partial canonical project", async (t) => {
  const fixture = await setup(t, { newProject: true });
  const candidate = await verifiedCandidate(fixture);
  const result = await commitCandidate({
    candidate,
    faults: { failBeforeDirectorySwap: true },
  });
  assert.equal(result.status, "rolled_back");
  assert.equal(result.error?.code, "directory_swap_failed");
  assert.equal(await snapshotTree(fixture.projectRoot), null);
});

test("per-project lock serializes candidate writers and game verification", async (t) => {
  const fixture = await setup(t);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let secondStarted = false;
  let active = 0;
  let maximumActive = 0;

  const firstOptions = makeOptions(fixture, { transactionId: "tx-lock-a" });
  const firstGenerate = firstOptions.generate;
  firstOptions.generate = async (context) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    entered.resolve();
    await release.promise;
    try {
      return await firstGenerate(context);
    } finally {
      active -= 1;
    }
  };
  firstOptions.verify = async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    try {
      await yieldToEventLoop();
      return { status: "passed" };
    } finally {
      active -= 1;
    }
  };
  const firstPromise = buildCandidate(firstOptions);
  await entered.promise;

  const secondOptions = makeOptions(fixture, { transactionId: "tx-lock-b" });
  const secondGenerate = secondOptions.generate;
  secondOptions.generate = async (context) => {
    secondStarted = true;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    try {
      return await secondGenerate(context);
    } finally {
      active -= 1;
    }
  };
  secondOptions.verify = async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    try {
      await yieldToEventLoop();
      return { status: "passed" };
    } finally {
      active -= 1;
    }
  };
  const secondPromise = buildCandidate(secondOptions);
  await yieldToEventLoop();
  assert.equal(
    secondStarted,
    false,
    "second writer waits for the project lock",
  );
  release.resolve();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(first.status, "verified", first.error?.detail);
  assert.equal(second.status, "verified", second.error?.detail);
  assert.equal(maximumActive, 1);
});

test("concurrent commits serialize; loser reports base drift without damaging the winner", async (t) => {
  const fixture = await setup(t);
  const first = await verifiedCandidate(fixture, {
    transactionId: "tx-commit-a",
    marker: "winner-a",
  });
  const second = await verifiedCandidate(fixture, {
    transactionId: "tx-commit-b",
    marker: "winner-b",
  });
  let active = 0;
  let maximumActive = 0;
  const hooks = {
    beforeApplyFile: () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
    },
    afterApplyFile: async () => {
      await yieldToEventLoop();
      active -= 1;
    },
  };

  const results = await Promise.all([
    commitCandidate({ candidate: first, hooks }),
    commitCandidate({ candidate: second, hooks }),
  ]);
  const committed = results.filter((result) => result.status === "committed");
  const conflicts = results.filter(
    (result) => result.error?.code === "base_drift",
  );
  assert.equal(committed.length, 1);
  assert.equal(conflicts.length, 1);
  assert.equal(maximumActive, 1, "project apply sections never overlap");

  const marker =
    committed[0]?.transactionId === first.transactionId
      ? "winner-a"
      : "winner-b";
  assert.equal(
    await readFile(join(fixture.projectRoot, sourcePath), "utf8"),
    generatedSource(marker),
  );
  assert.equal(
    await readFile(join(fixture.projectRoot, "user-notes.txt"), "utf8"),
    "These user-owned bytes must survive every transaction outcome.\n",
  );
});

test("real path and symlink alias share one lock and cannot double commit", async (t) => {
  const fixture = await setup(t);
  await symlink(
    fixture.projectRoot,
    join(fixture.root, "project-alias"),
    "dir",
  );
  const first = await verifiedCandidate(fixture, {
    transactionId: "tx-alias-real",
    marker: "real-path",
  });
  const options = makeOptions(fixture, {
    transactionId: "tx-alias-link",
    marker: "symlink-alias",
  });
  options.projectRoot = join(fixture.root, "project-alias");
  const second = await buildCandidate(options);
  assert.equal(second.status, "verified", second.error?.detail);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let active = 0;
  let maximumActive = 0;
  let secondStarted = false;
  const firstPromise = commitCandidate({
    candidate: first,
    hooks: {
      beforeApplyFile: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        entered.resolve();
        await release.promise;
      },
      afterApplyFile: () => {
        active -= 1;
      },
    },
  });
  await entered.promise;
  const secondPromise = commitCandidate({
    candidate: second,
    hooks: {
      beforeApplyFile: () => {
        secondStarted = true;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
      },
      afterApplyFile: () => {
        active -= 1;
      },
    },
  });
  await yieldToEventLoop();
  await yieldToEventLoop();
  assert.equal(secondStarted, false);
  release.resolve();
  const results = await Promise.all([firstPromise, secondPromise]);
  assert.equal(
    results.filter((result) => result.status === "committed").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.error?.code === "base_drift").length,
    1,
  );
  assert.equal(maximumActive, 1);
});
