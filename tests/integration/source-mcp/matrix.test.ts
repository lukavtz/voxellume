import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { unzipSync } from "fflate";

import {
  materializeMaliciousArtifacts,
  parseCliArgs,
  runBenchmark,
  validateFixtures,
  type BenchmarkDependencies,
} from "./run.ts";

const fixtureRoot = new URL("../../../fixtures/source-mcp/", import.meta.url);

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, fixtureRoot), "utf8")) as T;
}

test("matrix has exactly 68 explicit cases in nine categories", async () => {
  const targets =
    await fixture<Parameters<typeof validateFixtures>[0]>("targets.json");
  const artifacts =
    await fixture<Parameters<typeof validateFixtures>[1]>("artifacts.json");
  validateFixtures(targets, artifacts);
  assert.equal(targets.cases.length, 68);
  assert.equal(targets.caseCount, 68);
  assert.equal(new Set(targets.cases.map((entry) => entry.id)).size, 68);

  const categories: Record<string, number> = {};
  for (const entry of targets.cases) {
    categories[entry.category] = (categories[entry.category] ?? 0) + 1;
  }
  assert.deepEqual(categories, {
    routing: 8,
    symbol: 8,
    members: 8,
    mapping: 8,
    source: 8,
    search: 8,
    diff: 8,
    vanilla: 4,
    special: 8,
  });
  assert.deepEqual(
    targets.workspaces.reduce(
      (counts, workspace) => {
        counts[workspace.kind] = (counts[workspace.kind] ?? 0) + 1;
        return counts;
      },
      { loader: 0, vanilla: 0, special: 0 } as Record<string, number>,
    ),
    { loader: 8, vanilla: 4, special: 8 },
  );
  assert.deepEqual(
    targets.workspaces
      .filter((workspace) => workspace.kind === "loader")
      .map((workspace) => `${workspace.loader}:${workspace.minecraftVersion}`)
      .sort(),
    [
      "fabric:1.21.1",
      "fabric:26.3",
      "forge:1.21.1",
      "forge:26.3",
      "neoforge:1.21.1",
      "neoforge:26.3",
      "quilt:1.21.1",
      "quilt:26.3",
    ],
  );
  assert.deepEqual(
    targets.workspaces
      .filter((workspace) => workspace.kind === "vanilla")
      .map((workspace) => workspace.minecraftVersion)
      .sort(),
    ["1.21.1", "1.21.11", "26.1", "26.3"],
  );

  const features = new Set(
    targets.workspaces.flatMap((workspace) => workspace.features),
  );
  for (const feature of [
    "settings.gradle",
    "version-catalog",
    "split-sources",
    "nested-fabric-api",
    "moddevgradle",
    "forgegradle",
    "quilt-loom",
    "access-transformer",
    "access-widener",
    "client-only",
    "namespace-mismatch",
  ]) {
    assert.ok(features.has(feature), `missing ${feature}`);
  }
});

test("artifact and oracle pins contain no floating or fabricated values", async () => {
  const artifacts =
    await fixture<Parameters<typeof validateFixtures>[1]>("artifacts.json");
  assert.equal(artifacts.artifacts.length, 19);
  for (const artifact of artifacts.artifacts) {
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.match(artifact.url, /^https:\/\//);
    assert.doesNotMatch(artifact.version, /latest|snapshot/i);
  }
  assert.equal(artifacts.oracleTools.vineflower.version, "1.11.1");
  assert.equal(
    artifacts.artifacts.find((artifact) => artifact.id === "vineflower-1.11.1")
      ?.sha256,
    "a615d07ddbbcd489369674f40e42df639c32be95410890b38f173d5c1e2ea39c",
  );
  assert.equal(artifacts.oracles["vanilla-item-1.21.1"]?.mapping.to, "cul");
  assert.equal(artifacts.oracles["vanilla-item-1.21.11"]?.mapping.to, "dlp");
  for (const [id, oracle] of Object.entries(artifacts.oracles)) {
    assert.ok(oracle.member.name.length > 0, id);
    assert.ok(oracle.member.descriptor.length > 0, id);
    assert.ok(oracle.sourceSnippet.length > 0, id);
    assert.ok(oracle.search.line > 0, id);
    assert.deepEqual(oracle.diff.added, [], id);
    assert.deepEqual(oracle.diff.removed, [], id);
    assert.deepEqual(oracle.diff.changed, [], id);
  }
});

test("permanent CLI parses every supported flag and rejects moving revisions", () => {
  assert.deepEqual(
    parseCliArgs([
      "--candidate=modlens",
      "--revision=ba2020c226b51858d157bc943ed13f1c6b578514",
      "--suite=perf-warm",
      "--network=offline",
      "--derived-cache=empty",
      "--warmup=5",
      "--samples=30",
    ]),
    {
      candidate: "modlens",
      revision: "ba2020c226b51858d157bc943ed13f1c6b578514",
      suite: "perf-warm",
      network: "offline",
      derivedCache: "empty",
      warmup: 5,
      samples: 30,
    },
  );
  assert.throws(() => parseCliArgs(["--candidate=adhi", "--revision=latest"]), {
    code: "revision_mismatch",
  });
  assert.throws(() => parseCliArgs(["--samples=0"]), {
    code: "invalid_arguments",
  });
});

test("malicious JARs are generated at runtime without giant binaries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "voxellume-malicious-fixtures-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifacts =
    await fixture<Parameters<typeof validateFixtures>[1]>("artifacts.json");
  const generated = await materializeMaliciousArtifacts(root, artifacts);
  assert.equal(generated.length, 5);
  for (const artifact of generated) {
    const info = await stat(join(root, artifact.path));
    assert.ok(info.size < 1024, `${artifact.kind} is ${info.size} bytes`);
  }
  assert.deepEqual(
    Object.keys(
      unzipSync(await readFile(join(root, "malicious-traversal.jar"))),
    ),
    ["../outside.class"],
  );
  assert.deepEqual(
    Object.keys(
      unzipSync(await readFile(join(root, "malicious-absolute.jar"))),
    ),
    ["/outside.class"],
  );
  assert.equal(
    generated.find((artifact) => artifact.kind === "wrong-hash")?.sha256,
    "0".repeat(64),
  );
});

function harnessInvoker(
  targets: Parameters<typeof validateFixtures>[0],
  artifacts: Parameters<typeof validateFixtures>[1],
  corrupt = false,
): NonNullable<BenchmarkDependencies["invoke"]> {
  const workspaces = new Map(
    targets.workspaces.map((workspace) => [workspace.id, workspace]),
  );
  return async (request) => {
    if (request.mapping === "yarn" || request.mapping === "intermediary") {
      return {
        status: "unsupported",
        operation: request.operation,
        code: "mapping_unavailable",
      };
    }
    if (
      request.className.includes("Missing26") ||
      request.className.includes("NamespaceMismatch")
    ) {
      if (corrupt) {
        return {
          status: "ok",
          operation: request.operation,
          value: { name: request.className },
        };
      }
      return {
        status: "not_found",
        operation: request.operation,
        code: "not_found",
      };
    }
    const workspace = workspaces.get(request.workspaceId);
    assert.ok(workspace);
    const oracle = workspace.oracleId
      ? artifacts.oracles[workspace.oracleId]
      : undefined;
    const value = (() => {
      switch (request.operation) {
        case "resolve_artifact":
          return { ...request.artifact };
        case "find_class":
          return {
            name: request.className,
            artifactSha256:
              request.runtimeArtifact?.sha256 ?? request.artifact.sha256,
          };
        case "get_members":
          return {
            className: request.className,
            members: oracle
              ? [
                  {
                    name: oracle.member.name,
                    descriptor: oracle.member.descriptor,
                  },
                ]
              : [],
          };
        case "map_symbol":
          return oracle
            ? {
                from: oracle.mapping.from,
                to: oracle.mapping.to,
                mapping: oracle.mapping.kind,
              }
            : {};
        case "read_source": {
          const patch =
            !corrupt &&
            oracle?.patchedFromVanilla &&
            request.artifactId !== oracle.oracleArtifactId
              ? "/* independently observed loader patch */\n"
              : "";
          return {
            className: request.className,
            source: `${patch}${oracle?.sourceSnippet ?? ""}`,
          };
        }
        case "search_source":
          return {
            matches: oracle
              ? [
                  {
                    className: oracle.className,
                    line: oracle.search.line,
                    text: oracle.search.mappedText ?? oracle.search.text,
                  },
                ]
              : [],
          };
        case "diff_classes":
          return {
            left: request.className,
            right: request.rightClassName,
            added: [],
            removed: [],
            changed: [],
          };
      }
    })();
    return { status: "ok", operation: request.operation, value };
  };
}

test("68-case runner enforces routing, positive oracles, warm equivalence, and negative 26.x gates", async () => {
  const targets =
    await fixture<Parameters<typeof validateFixtures>[0]>("targets.json");
  const artifacts =
    await fixture<Parameters<typeof validateFixtures>[1]>("artifacts.json");
  const requests: unknown[] = [];
  const baseInvoke = harnessInvoker(targets, artifacts);
  const report = await runBenchmark(
    parseCliArgs([
      "--candidate=adhi",
      "--revision=552489550c9d652dbfacee67df6f6b816fe12034",
      "--suite=matrix",
      "--network=offline",
      "--derived-cache=empty",
    ]),
    {
      invoke: async (request, context) => {
        assert.equal(context.offline, true);
        assert.notEqual(request.target.minecraftVersion, "latest");
        requests.push(request);
        return baseInvoke(request, context);
      },
      // Harness self-test only. A preseeded CI cache also revalidates every oracle.
      ...(process.env.VOXELLUME_SOURCE_MCP_CACHE
        ? {}
        : { verifyOracle: async () => {} }),
    },
  );
  assert.equal(
    report.status,
    "passed",
    JSON.stringify(
      report.cases.flatMap((entry) =>
        entry.operations
          .filter((operation) => operation.status === "failed")
          .map((operation) => ({ case: entry.id, ...operation })),
      ),
    ),
  );
  assert.equal(report.total, 68);
  assert.equal(report.passed, 68);
  assert.equal(report.failed, 0);
  assert.equal(report.falsePositives, 0);
  assert.equal(report.patchedSourceFailures, 0);
  assert.equal(report.failedOperations, 0);
  assert.ok(requests.length > 136);
});

test("runner rejects false positives and vanilla substituted for patched loader source", async () => {
  const targets =
    await fixture<Parameters<typeof validateFixtures>[0]>("targets.json");
  const artifacts =
    await fixture<Parameters<typeof validateFixtures>[1]>("artifacts.json");
  const report = await runBenchmark(
    parseCliArgs([
      "--candidate=modlens",
      "--revision=ba2020c226b51858d157bc943ed13f1c6b578514",
      "--suite=matrix",
      "--network=offline",
    ]),
    {
      invoke: harnessInvoker(targets, artifacts, true),
      verifyOracle: async () => {},
    },
  );
  assert.equal(report.status, "failed");
  assert.ok(report.falsePositives > 0);
  assert.equal(report.patchedSourceFailures, 4);
  assert.ok(report.failedOperations > 0);
});

test("security suite routes every generated malicious JAR to its fail-closed code", async () => {
  const artifacts =
    await fixture<Parameters<typeof validateFixtures>[1]>("artifacts.json");
  const expected = new Map(
    artifacts.maliciousArtifacts.map((artifact) => [
      artifact.id,
      artifact.expectedCode,
    ]),
  );
  const report = await runBenchmark(
    parseCliArgs([
      "--candidate=adhi",
      "--revision=552489550c9d652dbfacee67df6f6b816fe12034",
      "--suite=security",
      "--network=offline",
    ]),
    {
      invoke: async (request) => {
        const code = expected.get(request.artifactId);
        assert.ok(code);
        return {
          status: "failed",
          operation: request.operation,
          code,
        };
      },
      verifyOracle: async () => {},
    },
  );
  assert.equal(report.status, "passed");
  assert.equal(report.total, 5);
  assert.equal(report.passed, 5);
  assert.equal(report.falsePositives, 0);
});
