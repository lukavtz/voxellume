import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";

import {
  buildCandidate,
  commitCandidate,
} from "../../src/core/spec/transactions.ts";
import {
  artifactPath,
  type Candidate,
  canonicalJson,
  generatedSource,
  makeOptions,
  packSha256,
  setup,
  sha256,
  snapshotTree,
  sourcePath,
  verifiedCandidate,
} from "../helpers/transaction-fixture.ts";

test("flows through proposed, validated, staged, verified, and committed with a complete manifest", async (t) => {
  const fixture = await setup(t);
  const baseTree = await snapshotTree(fixture.projectRoot);
  assert.ok(baseTree);
  const transitions: string[] = [];
  const candidate = await buildCandidate(
    makeOptions(fixture, {
      hooks: { onTransition: (status) => transitions.push(status) },
    }),
  );

  assert.equal(candidate.status, "verified", candidate.error?.detail);
  assert.deepEqual(transitions, [
    "proposed",
    "validated",
    "staged",
    "verified",
  ]);
  assert.deepEqual(
    await snapshotTree(fixture.projectRoot),
    baseTree,
    "building and verification must not write the canonical project",
  );
  assert.equal(
    await readFile(join(candidate.stagingRoot, sourcePath), "utf8"),
    generatedSource("candidate"),
  );

  const { manifest } = candidate;
  assert.equal(
    manifest.base.modSpecSha256,
    sha256(canonicalJson(fixture.modSpec)),
  );
  assert.equal(
    manifest.base.projectSha256,
    sha256(canonicalJson(Object.entries(baseTree))),
  );
  assert.equal(manifest.base.packSha256, packSha256);
  assert.ok(manifest.files.length >= 2);
  assert.ok(manifest.files.every((file) => file.owner === "generated"));
  assert.ok(!manifest.files.some((file) => file.path === "user-notes.txt"));

  const generatedEntries: Array<[string, string]> = [];
  for (const file of manifest.files) {
    assert.equal(
      file.path,
      relative(candidate.stagingRoot, join(candidate.stagingRoot, file.path)),
    );
    assert.ok(!file.path.startsWith("..") && !file.path.startsWith("/"));
    assert.equal(
      file.sha256,
      sha256(await readFile(join(candidate.stagingRoot, file.path))),
    );
    generatedEntries.push([file.path, file.sha256]);
  }
  generatedEntries.sort(([left], [right]) => left.localeCompare(right));
  assert.equal(
    manifest.stagingTreeSha256,
    sha256(canonicalJson(generatedEntries)),
    "staging hash covers generated content, not journal or selector state",
  );
  assert.deepEqual(
    manifest.artifacts,
    [
      {
        path: artifactPath,
        sha256: sha256("production:candidate\n"),
      },
    ],
    "artifact identity is a SHA-256 of its actual bytes",
  );

  const committed = await commitCandidate({
    candidate,
    hooks: { onTransition: (status) => transitions.push(status) },
  });
  assert.equal(committed.status, "committed", committed.error?.detail);
  assert.deepEqual(transitions, [
    "proposed",
    "validated",
    "staged",
    "verified",
    "committed",
  ]);
  assert.equal(
    await readFile(join(fixture.projectRoot, sourcePath), "utf8"),
    generatedSource("candidate"),
  );
  assert.equal(
    await readFile(join(fixture.projectRoot, "user-notes.txt"), "utf8"),
    "These user-owned bytes must survive every transaction outcome.\n",
  );
});

test("validation is side-effect-free and rejects an unsupported operation before generation", async (t) => {
  const fixture = await setup(t);
  const before = await snapshotTree(fixture.root);
  const originalSpec = structuredClone(fixture.modSpec);
  let generated = false;
  let verified = false;
  const result = await buildCandidate(
    makeOptions(fixture, {
      operations: [
        {
          type: "execute_command",
          featureId: "missing",
          command: "rm -rf /",
        } as never,
      ],
      generate: async () => {
        generated = true;
        return { artifacts: [] };
      },
      verify: async () => {
        verified = true;
        return { status: "passed" };
      },
    }),
  );

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "unsupported_request");
  assert.equal(generated, false);
  assert.equal(verified, false);
  assert.deepEqual(
    fixture.modSpec,
    originalSpec,
    "validation must not mutate its input",
  );
  assert.deepEqual(
    await snapshotTree(fixture.root),
    before,
    "validation creates neither staging files nor canonical writes",
  );
});

test("rejects target ID and revision drift before staging or generation", async (t) => {
  for (const drift of ["id", "revision"] as const) {
    await t.test(drift, async (t) => {
      const fixture = await setup(t);
      const before = await snapshotTree(fixture.root);
      let generated = false;
      const options = makeOptions(fixture, {
        generate: async () => {
          generated = true;
          return { artifacts: [] };
        },
      });
      options.targetPack = {
        ...options.targetPack,
        ...(drift === "id" ? { id: "java-fabric-1.21.1-r2" } : { revision: 2 }),
      };
      const result = await buildCandidate(options);
      assert.equal(result.status, "failed");
      assert.equal(result.error?.code, "target_mismatch");
      assert.equal(generated, false);
      assert.deepEqual(await snapshotTree(fixture.root), before);
    });
  }
});

test("canonical content hashes exclude transaction IDs, timestamps, random IDs, and selectors", async (t) => {
  const fixture = await setup(t);
  const first = await verifiedCandidate(fixture, {
    transactionId: "tx-content-a",
    bookkeeping: {
      createdAt: "2026-01-01T00:00:00.000Z",
      randomId: "random-a",
      selector: { displayName: "first selector" },
    },
  });
  const second = await verifiedCandidate(fixture, {
    transactionId: "tx-content-b",
    bookkeeping: {
      createdAt: "2030-12-31T23:59:59.999Z",
      randomId: "random-b",
      selector: { displayName: "unrelated selector", row: 99 },
    },
  });

  assert.notEqual(first.transactionId, second.transactionId);
  assert.notEqual(first.stagingRoot, second.stagingRoot);
  assert.equal(
    first.manifest.base.modSpecSha256,
    second.manifest.base.modSpecSha256,
  );
  assert.equal(
    first.manifest.stagingTreeSha256,
    second.manifest.stagingTreeSha256,
  );
  assert.deepEqual(first.manifest.files, second.manifest.files);
  assert.deepEqual(first.manifest.artifacts, second.manifest.artifacts);
});

test("regenerates byte-identical owned content for identical ModSpec and target inputs", async (t) => {
  const fixture = await setup(t);
  const first = await verifiedCandidate(fixture, {
    transactionId: "tx-repeat-a",
  });
  const second = await verifiedCandidate(fixture, {
    transactionId: "tx-repeat-b",
  });

  for (const file of first.manifest.files) {
    assert.deepEqual(
      await readFile(join(first.stagingRoot, file.path)),
      await readFile(join(second.stagingRoot, file.path)),
      file.path,
    );
  }
  for (const artifact of first.manifest.artifacts) {
    assert.deepEqual(
      await readFile(join(first.stagingRoot, artifact.path)),
      await readFile(join(second.stagingRoot, artifact.path)),
      artifact.path,
    );
  }
});

test("generation and verification failures retain every last-good canonical byte", async (t) => {
  await t.test("generation failure", async (t) => {
    const fixture = await setup(t);
    const before = await snapshotTree(fixture.projectRoot);
    const result = await buildCandidate(
      makeOptions(fixture, {
        generate: async () => {
          throw new Error("injected generator failure");
        },
      }),
    );
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "generation_failed");
    assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
  });

  await t.test("verification failure", async (t) => {
    const fixture = await setup(t);
    const before = await snapshotTree(fixture.projectRoot);
    const result = await buildCandidate(
      makeOptions(fixture, {
        verify: async () => ({
          status: "failed",
          detail: "injected GameTest failure",
        }),
      }),
    );
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "verification_failed");
    assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
  });
});

test("commit accepts only a verified candidate and never promotes failed verification", async (t) => {
  const fixture = await setup(t);
  const before = await snapshotTree(fixture.projectRoot);
  const verified = await verifiedCandidate(fixture);

  for (const status of [
    "proposed",
    "validated",
    "staged",
    "failed",
    "cancelled",
    "rolled_back",
    "recovery_required",
  ] as const) {
    const candidate: Candidate = { ...structuredClone(verified), status };
    const result = await commitCandidate({ candidate });
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "invalid_transition", status);
    assert.deepEqual(await snapshotTree(fixture.projectRoot), before, status);
  }

  const failed = await buildCandidate(
    makeOptions(fixture, {
      transactionId: "tx-unverified",
      verify: async () => ({ status: "failed", detail: "not verified" }),
    }),
  );
  assert.equal(failed.status, "failed");
  const rejected = await commitCandidate({ candidate: failed });
  assert.equal(rejected.error?.code, "invalid_transition");
  assert.deepEqual(await snapshotTree(fixture.projectRoot), before);

  assert.equal(
    (await commitCandidate({ candidate: verified })).status,
    "committed",
  );
});

test("rejects generator writes to user-owned files without changing canonical bytes", async (t) => {
  const fixture = await setup(t);
  const before = await snapshotTree(fixture.projectRoot);
  const result = await buildCandidate(
    makeOptions(fixture, {
      transactionId: "tx-ownership-rejection",
      generate: async ({ stagingRoot }) => {
        await writeFile(
          join(stagingRoot, "user-notes.txt"),
          "not generator owned\n",
        );
        return { artifacts: [artifactPath] };
      },
    }),
  );
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "ownership_violation");
  assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
});

test("records and applies owned base-file deletion with a rollback backup", async (t) => {
  const fixture = await setup(t);
  const originalSource = await readFile(join(fixture.projectRoot, sourcePath));
  const candidate = await buildCandidate(
    makeOptions(fixture, {
      transactionId: "tx-owned-deletion",
      generate: async ({ stagingRoot }) => {
        await rm(join(stagingRoot, sourcePath));
        return { artifacts: [artifactPath] };
      },
    }),
  );
  assert.equal(candidate.status, "verified", candidate.error?.detail);
  assert.equal(
    candidate.manifest.files.find((file) => file.path === sourcePath)?.sha256,
    null,
  );
  const result = await commitCandidate({ candidate });
  assert.equal(result.status, "committed", result.error?.detail);
  await assert.rejects(readFile(join(fixture.projectRoot, sourcePath)), {
    code: "ENOENT",
  });
  const journal = JSON.parse(await readFile(candidate.journalPath, "utf8")) as {
    backups: Record<string, { data: string | null }>;
  };
  assert.equal(
    Buffer.from(journal.backups[sourcePath]?.data ?? "", "base64").toString(
      "utf8",
    ),
    originalSource.toString("utf8"),
  );
  assert.equal(
    await readFile(join(fixture.projectRoot, "user-notes.txt"), "utf8"),
    "These user-owned bytes must survive every transaction outcome.\n",
  );
});
