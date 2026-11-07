import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { strToU8, zipSync } from "fflate";

import {
  createSourceFacade,
  type SourceCandidate,
  type SourceCandidateRequest,
  type SourceOperation,
  type SourceRequest,
  type SourceTarget,
} from "../../src/core/sources/source-facade.ts";

const vanillaCoordinates = "net.minecraft:minecraft";
const loaderCoordinates = "net.fabricmc:fabric-loader";
const target: SourceTarget = {
  minecraftVersion: "1.21.1",
  loader: "fabric",
  mappings: { kind: "mojang", version: "1.21.1" },
};

interface ArtifactRecord {
  readonly id: string;
  readonly root: string;
  readonly path: string;
  readonly coordinates: string;
  readonly version: string;
  readonly sha256: string;
}

interface Fixture {
  readonly root: string;
  readonly artifactRoot: string;
  readonly outsideFile: string;
  readonly artifacts: readonly ArtifactRecord[];
  readonly vanilla: ArtifactRecord;
  readonly loader: ArtifactRecord;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function addArtifact(
  artifactRoot: string,
  id: string,
  coordinates: string,
  version: string,
  bytes: Uint8Array,
): Promise<ArtifactRecord> {
  const path = `${id}.jar`;
  await writeFile(join(artifactRoot, path), bytes);
  return {
    id,
    root: artifactRoot,
    path,
    coordinates,
    version,
    sha256: sha256(bytes),
  };
}

async function setup(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-source-facade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactRoot = join(root, "artifacts");
  await mkdir(artifactRoot);

  const vanillaBytes = zipSync({
    "net/minecraft/world/item/Item.class": strToU8("vanilla-class-oracle"),
  });
  const loaderBytes = zipSync({
    "net/minecraft/world/item/Item.class": strToU8(
      "patched-loader-class-oracle",
    ),
    "net/fabricmc/impl/LoaderMarker.class": strToU8("loader-only-class"),
  });
  const vanilla = await addArtifact(
    artifactRoot,
    "vanilla",
    vanillaCoordinates,
    "1.21.1",
    vanillaBytes,
  );
  const loader = await addArtifact(
    artifactRoot,
    "loader",
    loaderCoordinates,
    "0.20.1",
    loaderBytes,
  );

  const nestedJar = zipSync({ "Nested.class": new Uint8Array(17) });
  const traversal = await addArtifact(
    artifactRoot,
    "traversal",
    "fixture:traversal",
    "1",
    zipSync({ "../outside.class": strToU8("escape") }),
  );
  const prefixed = await addArtifact(
    artifactRoot,
    "prefixed",
    "fixture:prefixed",
    "1",
    new Uint8Array([
      1,
      2,
      3,
      4,
      ...zipSync({ "../outside.class": strToU8("escape") }),
    ]),
  );
  const absolute = await addArtifact(
    artifactRoot,
    "absolute",
    "fixture:absolute",
    "1",
    zipSync({ "/outside.class": strToU8("escape") }),
  );
  const nested = await addArtifact(
    artifactRoot,
    "nested",
    "fixture:nested",
    "1",
    zipSync({ "nested.jar": nestedJar }),
  );
  const oversize = await addArtifact(
    artifactRoot,
    "oversize",
    "fixture:oversize",
    "1",
    zipSync({ "Large.class": new Uint8Array(65) }),
  );
  const wrongHash = await addArtifact(
    artifactRoot,
    "wrong-hash",
    "fixture:wrong-hash",
    "1",
    zipSync({ "Wrong.class": strToU8("wrong") }),
  );
  const directory = await addArtifact(
    artifactRoot,
    "directory",
    "fixture:directory",
    "1",
    zipSync({
      "META-INF/": new Uint8Array(0),
      "META-INF/MANIFEST.MF": strToU8("manifest"),
    }),
  );
  const emptyComponent = await addArtifact(
    artifactRoot,
    "empty-component",
    "fixture:empty-component",
    "1",
    zipSync({ "a//b.class": strToU8("x") }),
  );
  const invalidArchive = await addArtifact(
    artifactRoot,
    "invalid-archive",
    "fixture:invalid-archive",
    "1",
    new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]),
  );

  const outsideFile = join(root, "outside.jar");
  await writeFile(outsideFile, "outside-sentinel");
  const outside = {
    id: "outside",
    root: artifactRoot,
    path: "../outside.jar",
    coordinates: "fixture:outside",
    version: "1",
    sha256: sha256(new TextEncoder().encode("outside-sentinel")),
  };
  const absolutePath = { ...outside, id: "absolute-path", path: outsideFile };
  await symlink(outsideFile, join(artifactRoot, "linked.jar"));
  const linked = { ...outside, id: "linked", path: "linked.jar" };
  const unreadableRoot = {
    ...outside,
    id: "unreadable-root",
    root: outsideFile,
    path: "x.jar",
  };

  return {
    root,
    artifactRoot,
    outsideFile,
    vanilla,
    loader,
    artifacts: [
      vanilla,
      loader,
      traversal,
      prefixed,
      absolute,
      nested,
      oversize,
      { ...wrongHash, sha256: "b".repeat(64) },
      directory,
      emptyComponent,
      invalidArchive,
      outside,
      absolutePath,
      linked,
      unreadableRoot,
    ],
  };
}

class LocalFakeCandidate implements SourceCandidate {
  readonly id = "fake-local-candidate";
  readonly revision = "e".repeat(40);
  readonly calls: SourceCandidateRequest[] = [];
  readonly offline: boolean[] = [];

  async dispose(): Promise<void> {}
  private readonly failNext = false;

  async invoke(
    request: SourceCandidateRequest,
    context: { offline: boolean; signal?: AbortSignal },
  ): Promise<unknown> {
    this.calls.push(structuredClone(request));
    this.offline.push(context.offline);
    if (this.failNext) throw new Error("synthetic candidate failure");
    if (request.operation === "resolve_artifact") {
      return {
        artifactId: request.artifactId,
        coordinates: request.artifact?.coordinates,
        version: request.artifact?.version,
        sha256: request.artifact?.sha256,
      };
    }
    if (request.operation === "find_class") {
      return { name: request.className, artifactId: request.artifactId };
    }
    if (request.operation === "read_source") {
      return {
        className: request.className,
        source:
          request.artifactId === "loader"
            ? "public class Item { /* loader patch */ }"
            : "public class Item { /* vanilla */ }",
      };
    }
    if (request.operation === "search_source") {
      return { matches: [{ className: request.className, line: 1 }] };
    }
    if (request.operation === "get_members") {
      return { className: request.className, members: [] };
    }
    if (request.operation === "map_symbol") {
      return { from: request.symbol, to: request.symbol, mapping: "mojang" };
    }
    return { left: request.className, right: request.className, changed: [] };
  }
}

function operationRequest(
  operation: SourceOperation,
  artifact: ArtifactRecord,
  extra: Record<string, unknown> = {},
): SourceRequest {
  return {
    operation,
    target,
    artifactId: artifact.id,
    artifact: {
      coordinates: artifact.coordinates,
      version: artifact.version,
      sha256: artifact.sha256,
    },
    className: "net.minecraft.world.item.Item",
    symbol: "net.minecraft.world.item.Item",
    query: "Item",
    ...extra,
  } as SourceRequest;
}

function facadeFor(
  fixture: Fixture,
  candidate: SourceCandidate = new LocalFakeCandidate(),
) {
  return createSourceFacade({
    candidates: [candidate],
    artifacts: fixture.artifacts,
    limits: {
      artifactBytes: 1024 * 1024,
      archiveEntryBytes: 64,
      nestedEntryBytes: 16,
      responseBytes: 256 * 1024,
      sourceBytes: 64 * 1024,
      processLogBytes: 1024 * 1024,
    },
  });
}

test("exact artifact identity and SHA-256 produce equivalent cold and warm offline results", async (t) => {
  const fixture = await setup(t);
  const candidate = new LocalFakeCandidate();
  const facade = facadeFor(fixture, candidate);
  t.after(() => facade.dispose());
  const request = operationRequest("resolve_artifact", fixture.vanilla);

  const cold = await facade.invoke(request, { offline: true });
  const warm = await facade.invoke(request, { offline: true });

  const expected = {
    status: "ok",
    operation: "resolve_artifact",
    value: {
      artifactId: "vanilla",
      coordinates: vanillaCoordinates,
      version: "1.21.1",
      sha256: fixture.vanilla.sha256,
    },
  };
  assert.deepEqual(cold, expected);
  assert.deepEqual(warm, expected);
  assert.deepEqual(candidate.offline, [true, true]);

  assert.deepEqual(
    await facade.invoke(
      operationRequest("resolve_artifact", {
        ...fixture.vanilla,
        sha256: "c".repeat(64),
      }),
      { offline: true },
    ),
    {
      status: "not_found",
      operation: "resolve_artifact",
      code: "artifact_not_found",
    },
  );
});

test("a catalog hash that differs from local bytes fails closed", async (t) => {
  const fixture = await setup(t);
  const candidate = new LocalFakeCandidate();
  const facade = facadeFor(fixture, candidate);
  t.after(() => facade.dispose());
  const wrongHash = fixture.artifacts.find(
    (artifact) => artifact.id === "wrong-hash",
  );
  assert.ok(wrongHash);

  assert.deepEqual(
    await facade.invoke(operationRequest("find_class", wrongHash)),
    {
      status: "failed",
      operation: "find_class",
      code: "artifact_sha256_mismatch",
    },
  );
  assert.equal(candidate.calls.length, 0);
});

test("a mismatched right diff artifact never reaches the candidate", async (t) => {
  const fixture = await setup(t);
  const candidate = new LocalFakeCandidate();
  const facade = facadeFor(fixture, candidate);
  t.after(() => facade.dispose());

  assert.deepEqual(
    await facade.invoke(
      operationRequest("diff_classes", fixture.vanilla, {
        rightArtifactId: fixture.loader.id,
        rightArtifact: {
          coordinates: fixture.loader.coordinates,
          version: fixture.loader.version,
          sha256: "0".repeat(64),
        },
      }),
    ),
    {
      status: "not_found",
      operation: "diff_classes",
      code: "artifact_not_found",
    },
  );
  assert.equal(candidate.calls.length, 0);
});

test("patched loader source is distinct from vanilla for the same class", async (t) => {
  const fixture = await setup(t);
  const facade = facadeFor(fixture);
  t.after(() => facade.dispose());

  const vanilla = await facade.invoke(
    operationRequest("read_source", fixture.vanilla),
  );
  const loader = await facade.invoke(
    operationRequest("read_source", fixture.loader),
  );

  assert.deepEqual(vanilla, {
    status: "ok",
    operation: "read_source",
    value: {
      className: "net.minecraft.world.item.Item",
      source: "public class Item { /* vanilla */ }",
    },
  });
  assert.deepEqual(loader, {
    status: "ok",
    operation: "read_source",
    value: {
      className: "net.minecraft.world.item.Item",
      source: "public class Item { /* loader patch */ }",
    },
  });
  assert.notDeepEqual(loader, vanilla);
});

test("outside roots, absolute paths, and symlink escapes never reach the candidate", async (t) => {
  const fixture = await setup(t);
  const candidate = new LocalFakeCandidate();
  const facade = facadeFor(fixture, candidate);
  t.after(() => facade.dispose());
  const cases = [
    ["outside", "outside_artifact_root"],
    ["absolute-path", "absolute_artifact_path"],
    ["linked", "unsafe_symlink"],
  ] as const;

  for (const [artifactId, code] of cases) {
    await t.test(artifactId, async () => {
      const artifact = fixture.artifacts.find(
        (entry) => entry.id === artifactId,
      );
      assert.ok(artifact);
      assert.deepEqual(
        await facade.invoke(operationRequest("find_class", artifact)),
        { status: "failed", operation: "find_class", code },
      );
    });
  }
  assert.equal(candidate.calls.length, 0);
  assert.equal(await readFile(fixture.outsideFile, "utf8"), "outside-sentinel");
});

test("malicious archive paths, nested entries, and oversized classes are rejected before source operations", async (t) => {
  const fixture = await setup(t);
  const candidate = new LocalFakeCandidate();
  const facade = facadeFor(fixture, candidate);
  t.after(() => facade.dispose());
  const cases = [
    ["traversal", "archive_traversal"],
    ["prefixed", "archive_traversal"],
    ["absolute", "archive_absolute_path"],
    ["nested", "nested_entry_too_large"],
    ["oversize", "archive_entry_too_large"],
  ] as const;

  for (const [artifactId, code] of cases) {
    await t.test(artifactId, async () => {
      const artifact = fixture.artifacts.find(
        (entry) => entry.id === artifactId,
      );
      assert.ok(artifact);
      assert.deepEqual(
        await facade.invoke(operationRequest("find_class", artifact)),
        { status: "failed", operation: "find_class", code },
      );
    });
  }
  assert.equal(candidate.calls.length, 0);
  assert.equal(await readFile(fixture.outsideFile, "utf8"), "outside-sentinel");
});

test("local artifact operations leave project and upstream bytes unchanged", async (t) => {
  const fixture = await setup(t);
  const facade = facadeFor(fixture);
  t.after(() => facade.dispose());
  const before = await Promise.all(
    [fixture.vanilla, fixture.loader].map(async (artifact) =>
      sha256(await readFile(join(artifact.root, artifact.path))),
    ),
  );

  for (const operation of [
    "find_class",
    "get_members",
    "map_symbol",
    "read_source",
    "search_source",
    "diff_classes",
  ] as const) {
    const result = await facade.invoke(
      operationRequest(operation, fixture.loader),
      { offline: true },
    );
    assert.equal(result.status, "ok");
  }

  const after = await Promise.all(
    [fixture.vanilla, fixture.loader].map(async (artifact) =>
      sha256(await readFile(join(artifact.root, artifact.path))),
    ),
  );
  assert.deepEqual(after, before);
  assert.equal(await readFile(fixture.outsideFile, "utf8"), "outside-sentinel");
});

test("directory entries are allowed while empty interior components are rejected", async (t) => {
  const fixture = await setup(t);
  const candidate = new LocalFakeCandidate();
  const facade = facadeFor(fixture, candidate);
  t.after(() => facade.dispose());
  const directory = fixture.artifacts.find((entry) => entry.id === "directory");
  const emptyComponent = fixture.artifacts.find(
    (entry) => entry.id === "empty-component",
  );
  assert.ok(directory);
  assert.ok(emptyComponent);

  assert.equal(
    (await facade.invoke(operationRequest("find_class", directory))).status,
    "ok",
  );
  assert.deepEqual(
    await facade.invoke(operationRequest("find_class", emptyComponent)),
    { status: "failed", operation: "find_class", code: "archive_traversal" },
  );
  assert.equal(candidate.calls.length, 1);
});

test("a PK-signature archive that cannot be decoded fails closed", async (t) => {
  const fixture = await setup(t);
  const candidate = new LocalFakeCandidate();
  const facade = facadeFor(fixture, candidate);
  t.after(() => facade.dispose());
  const invalid = fixture.artifacts.find(
    (entry) => entry.id === "invalid-archive",
  );
  assert.ok(invalid);

  assert.deepEqual(
    await facade.invoke(operationRequest("find_class", invalid)),
    { status: "failed", operation: "find_class", code: "archive_invalid" },
  );
  assert.equal(candidate.calls.length, 0);
});

test("swapped artifact bytes are revalidated instead of served from cache", async (t) => {
  const fixture = await setup(t);
  const candidate = new LocalFakeCandidate();
  const facade = facadeFor(fixture, candidate);
  t.after(() => facade.dispose());
  const request = operationRequest("find_class", fixture.vanilla);

  assert.equal((await facade.invoke(request)).status, "ok");
  await writeFile(
    join(fixture.vanilla.root, fixture.vanilla.path),
    zipSync({ "Swapped.class": strToU8("swapped-bytes") }),
  );
  assert.deepEqual(await facade.invoke(request), {
    status: "failed",
    operation: "find_class",
    code: "artifact_sha256_mismatch",
  });
  assert.equal(candidate.calls.length, 1);
});

test("artifact directory failures return artifact_unreadable", async (t) => {
  const fixture = await setup(t);
  const candidate = new LocalFakeCandidate();
  const facade = facadeFor(fixture, candidate);
  t.after(() => facade.dispose());
  const unreadable = fixture.artifacts.find(
    (entry) => entry.id === "unreadable-root",
  );
  assert.ok(unreadable);

  assert.deepEqual(
    await facade.invoke(operationRequest("find_class", unreadable)),
    { status: "failed", operation: "find_class", code: "artifact_unreadable" },
  );
  assert.equal(candidate.calls.length, 0);
});

test(
  "abort acknowledges within one second and kills candidate children within five seconds",
  {
    skip: process.platform === "win32" ? "POSIX process-group fixture" : false,
  },
  async (t) => {
    const fixture = await setup(t);
    let child: ChildProcess | undefined;
    const started = Promise.withResolvers<void>();
    const candidate: SourceCandidate = {
      id: "fake-process-candidate",
      revision: "d".repeat(40),
      dispose: async () => {},
      invoke(request, context) {
        assert.equal(request.operation, "read_source");
        const { promise, reject } = Promise.withResolvers<never>();
        child = spawn(
          process.execPath,
          ["-e", "require('node:net').createServer().listen(0)"],
          { detached: true, stdio: "ignore" },
        );
        assert.ok(child.pid);
        const exited = once(child, "exit");
        context.signal?.addEventListener(
          "abort",
          () => {
            if (child?.pid !== undefined) process.kill(-child.pid, "SIGKILL");
            void exited.then(() =>
              reject(
                Object.assign(new Error("cancelled"), { code: "cancelled" }),
              ),
            );
          },
          { once: true },
        );
        started.resolve();
        return promise;
      },
    };
    const facade = facadeFor(fixture, candidate);
    t.after(async () => {
      if (child?.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The candidate already reaped its fixture child.
        }
      }
      await facade.dispose();
    });
    const controller = new AbortController();
    const pending = facade.invoke(
      operationRequest("read_source", fixture.vanilla),
      { signal: controller.signal, offline: true },
    );
    await started.promise;

    // Real process-group lifetime is the behavior under test; fake timers cannot reap it.
    const abortedAt = performance.now();
    controller.abort();
    assert.deepEqual(await pending, {
      status: "cancelled",
      operation: "read_source",
      code: "cancelled",
    });
    assert.ok(performance.now() - abortedAt < 1_000);
    assert.ok(child);
    const pid = child.pid;
    assert.ok(pid);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.ok(performance.now() - abortedAt < 5_000);
  },
);
