import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";

import { strToU8, zipSync } from "fflate";

import {
  ADHI_CANDIDATE_REVISION,
  createCandidate,
  type AdhiCandidate,
} from "../../src/core/sources/adhi-candidate.ts";
import {
  createSourceFacade,
  type SourceCandidateRequest,
  type SourceTarget,
} from "../../src/core/sources/source-facade.ts";

const execFileAsync = promisify(execFile);
const target: SourceTarget = {
  minecraftVersion: "26.3",
  loader: "vanilla",
  mappings: { kind: "none" },
};

interface FixtureArtifact {
  id: string;
  root: string;
  path: string;
  coordinates: string;
  version: string;
  sha256: string;
}

async function compileArtifact(
  root: string,
  id: string,
  source: string,
): Promise<FixtureArtifact> {
  const sourceRoot = join(root, `${id}-src`);
  const classes = join(root, `${id}-classes`);
  await mkdir(join(sourceRoot, "fixture"), { recursive: true });
  await mkdir(classes);
  const sourcePath = join(sourceRoot, "fixture", "Greeter.java");
  await writeFile(sourcePath, source);
  await execFileAsync("javac", ["-d", classes, sourcePath]);
  const path = `${id}.jar`;
  const bytes = zipSync({
    "META-INF/MANIFEST.MF": strToU8("Manifest-Version: 1.0\n"),
    "fixture/Greeter.class": await readFile(
      join(classes, "fixture", "Greeter.class"),
    ),
  });
  await writeFile(join(root, path), bytes);
  return {
    id,
    root,
    path,
    coordinates: "fixture:greeter",
    version: "1.0.0",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function request(
  operation: SourceCandidateRequest["operation"],
  artifact: FixtureArtifact,
  extra: Partial<SourceCandidateRequest> = {},
): SourceCandidateRequest {
  return {
    operation,
    target,
    artifactId: artifact.id,
    artifact: {
      coordinates: artifact.coordinates,
      version: artifact.version,
      sha256: artifact.sha256,
    },
    className: "fixture.Greeter",
    symbol: "fixture.Greeter",
    query: "label",
    ...extra,
  };
}

async function processGone(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
      return;
    }
    if (Date.now() >= deadline)
      assert.fail(`upstream process ${pid} survived cleanup`);
    // Real PID reaping needs the platform clock; fake timers cannot reap a child.
    const delay = Promise.withResolvers<void>();
    setTimeout(delay.resolve, 20);
    await delay.promise;
  }
}

async function setup(t: TestContext): Promise<{
  root: string;
  derivedCacheRoot: string;
  left: FixtureArtifact;
  right: FixtureArtifact;
}> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-adhi-candidate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const derivedCacheRoot = join(root, "derived");
  await mkdir(derivedCacheRoot);
  const left = await compileArtifact(
    root,
    "left",
    `package fixture;
public class Greeter {
    private String label = "hello";
    public String greet(String name) {
        return "hello " + name;
    }
}
`,
  );
  const right = await compileArtifact(
    root,
    "right",
    `package fixture;
public class Greeter {
    private String label = "hello";
    public String greet(String name) {
        return "hello " + name;
    }
    public int extra() {
        return 42;
    }
    public String greet(Integer number) {
        return "hello " + number;
    }
}
`,
  );
  return { root, derivedCacheRoot, left, right };
}

async function assertWindowsCandidateUnavailable(fixture: {
  left: FixtureArtifact;
}): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const facade = createSourceFacade({
    candidates: [
      {
        id: "adhi",
        revision: ADHI_CANDIDATE_REVISION,
        async invoke() {
          throw Object.assign(new Error("Windows cleanup is unqualified"), {
            code: "unavailable",
          });
        },
        async dispose() {},
      },
    ],
    artifacts: [fixture.left],
  });
  const result = await facade.invoke(request("find_class", fixture.left), {
    offline: true,
  });
  await facade.dispose();
  assert.deepEqual(result, {
    status: "unavailable",
    operation: "find_class",
    code: "candidate_unavailable",
  });
  return true;
}

test("real Adhi stdio candidate covers local compiled-JAR operations with exact identity", async (t) => {
  const fixture = await setup(t);
  if (await assertWindowsCandidateUnavailable(fixture)) return;
  let candidate: AdhiCandidate | undefined;
  t.after(async () => {
    await candidate?.dispose();
  });
  candidate = await createCandidate({
    revision: ADHI_CANDIDATE_REVISION,
    artifactRoot: fixture.root,
    derivedCacheRoot: fixture.derivedCacheRoot,
    network: "offline",
    vineflowerJarPath: join(
      process.cwd(),
      ".artifacts/source-mcp/artifacts/vineflower-1.11.1.jar",
    ),
  });
  assert.ok(candidate !== undefined);
  assert.equal(candidate.id, "adhi");
  assert.equal(candidate.revision, "552489550c9d652dbfacee67df6f6b816fe12034");
  const partial = await compileArtifact(
    fixture.root,
    "partial",
    "package fixture;\npublic interface Greeter {}\n",
  );
  await writeFile(
    join(fixture.root, "partial-sources.jar"),
    zipSync({
      "fixture/Greeter.java": strToU8(
        "package fixture;\npublic interface Greeter {\n    String greet(String name);\n}\n",
      ),
    }),
  );
  const facade = createSourceFacade({
    candidates: [candidate],
    artifacts: [fixture.left, fixture.right, partial],
  });
  t.after(() => facade.dispose());

  const resolved = await facade.invoke(
    request("resolve_artifact", fixture.left),
    {
      offline: true,
    },
  );
  assert.deepEqual(resolved, {
    status: "ok",
    operation: "resolve_artifact",
    value: {
      artifactId: "left",
      coordinates: "fixture:greeter",
      version: "1.0.0",
      sha256: fixture.left.sha256,
      target,
    },
  });
  const otherTarget = { ...target, minecraftVersion: "26.2" };
  assert.deepEqual(
    await facade.invoke(
      request("resolve_artifact", fixture.left, { target: otherTarget }),
      {
        offline: true,
      },
    ),
    {
      status: "ok",
      operation: "resolve_artifact",
      value: {
        artifactId: "left",
        coordinates: "fixture:greeter",
        version: "1.0.0",
        sha256: fixture.left.sha256,
        target: otherTarget,
      },
    },
  );

  const found = await facade.invoke(request("find_class", fixture.left), {
    offline: true,
  });
  assert.deepEqual(found, {
    status: "ok",
    operation: "find_class",
    value: {
      name: "fixture.Greeter",
      artifactId: "left",
      artifactSha256: fixture.left.sha256,
    },
  });

  const members = await facade.invoke(request("get_members", fixture.left), {
    offline: true,
  });
  assert.equal(members.status, "ok");
  if (members.status !== "ok") return;
  assert.ok(
    members.value !== null &&
      typeof members.value === "object" &&
      "members" in members.value,
  );
  assert.ok(Array.isArray(members.value.members));
  const memberList = members.value.members.map((member) => {
    assert.ok(member !== null && typeof member === "object");
    return Object.fromEntries(Object.entries(member));
  });
  assert.ok(
    memberList.some(
      (member) =>
        member.name === "greet" &&
        member.descriptor === "(Ljava/lang/String;)Ljava/lang/String;",
    ),
  );
  assert.ok(
    memberList.some(
      (member) =>
        member.name === "label" && member.descriptor === "Ljava/lang/String;",
    ),
  );
  assert.deepEqual(
    await facade.invoke(request("get_members", partial), { offline: true }),
    {
      status: "unsupported",
      operation: "get_members",
      code: "unsupported_operation",
    },
  );

  const mapped = await facade.invoke(request("map_symbol", fixture.left), {
    offline: true,
  });
  assert.deepEqual(mapped, {
    status: "ok",
    operation: "map_symbol",
    value: { from: "fixture.Greeter", to: "fixture.Greeter", mapping: "none" },
  });
  assert.deepEqual(
    await facade.invoke(
      request("map_symbol", fixture.left, {
        symbol: "fixture.Greeter#greet(Ljava/lang/String;)Ljava/lang/String;",
      }),
      { offline: true },
    ),
    {
      status: "ok",
      operation: "map_symbol",
      value: {
        from: "fixture.Greeter#greet(Ljava/lang/String;)Ljava/lang/String;",
        to: "fixture.Greeter#greet(Ljava/lang/String;)Ljava/lang/String;",
        mapping: "none",
      },
    },
  );
  assert.deepEqual(
    await facade.invoke(
      request("map_symbol", fixture.left, { symbol: "fixture.Missing" }),
      {
        offline: true,
      },
    ),
    { status: "not_found", operation: "map_symbol", code: "not_found" },
  );
  assert.deepEqual(
    await facade.invoke(
      request("map_symbol", fixture.left, {
        symbol: "fixture.Greeter#missing()V",
      }),
      { offline: true },
    ),
    { status: "not_found", operation: "map_symbol", code: "not_found" },
  );
  for (const mappings of [
    { kind: "parchment", version: "2024.11.17" },
    { kind: "mojang", version: "1.21.1" },
  ] as const) {
    assert.deepEqual(
      await facade.invoke(
        request("map_symbol", fixture.left, {
          target: { ...target, mappings },
          mapping: mappings.kind,
        }),
        { offline: true },
      ),
      {
        status: "unsupported",
        operation: "map_symbol",
        code: "unsupported_operation",
      },
    );
  }
  await assert.rejects(
    candidate.invoke(
      request("map_symbol", fixture.left, {
        target: { ...target, mappings: { kind: "none", version: "unpinned" } },
      }),
      { offline: true },
    ),
    { code: "unsupported" },
  );

  const source = await facade.invoke(request("read_source", fixture.left), {
    offline: true,
  });
  assert.equal(source.status, "ok");
  if (source.status !== "ok") return;
  const sourceValue = source.value;
  assert.ok(
    sourceValue !== null &&
      typeof sourceValue === "object" &&
      "source" in sourceValue &&
      "className" in sourceValue,
  );
  assert.equal(sourceValue.className, "fixture.Greeter");
  assert.ok(typeof sourceValue.source === "string");
  assert.match(sourceValue.source, /public String greet\(String /);

  const searched = await facade.invoke(request("search_source", fixture.left), {
    offline: true,
  });
  assert.equal(searched.status, "ok");
  assert.match(JSON.stringify(searched.value), /private String label = /);

  const diff = await facade.invoke(
    request("diff_classes", fixture.left, {
      rightArtifactId: fixture.right.id,
      rightArtifact: {
        coordinates: fixture.right.coordinates,
        version: fixture.right.version,
        sha256: fixture.right.sha256,
      },
    }),
    { offline: true },
  );
  assert.deepEqual(diff, {
    status: "ok",
    operation: "diff_classes",
    value: {
      left: "fixture.Greeter",
      right: "fixture.Greeter",
      added: [
        "method:extra()I",
        "method:greet(Ljava/lang/Integer;)Ljava/lang/String;",
      ],
      removed: [],
      changed: [],
    },
  });

  assert.deepEqual(
    await facade.invoke(
      request("find_class", fixture.left, { className: "fixture.Missing" }),
      {
        offline: true,
      },
    ),
    { status: "not_found", operation: "find_class", code: "not_found" },
  );
  await assert.rejects(
    candidate.invoke(
      request("resolve_artifact", {
        ...fixture.left,
        sha256: "0".repeat(64),
      }),
      { offline: true },
    ),
    { code: "not_found" },
  );

  assert.equal(
    createHash("sha256")
      .update(await readFile(join(fixture.root, fixture.left.path)))
      .digest("hex"),
    fixture.left.sha256,
  );
  const pid = candidate.pid;
  await facade.dispose();
  await processGone(pid);
});

test("revision pin, in-flight cancellation, and idempotent cleanup fail closed", async (t) => {
  const fixture = await setup(t);
  if (await assertWindowsCandidateUnavailable(fixture)) return;
  await assert.rejects(
    createCandidate({
      revision: "0".repeat(40),
      artifactRoot: fixture.root,
      derivedCacheRoot: fixture.derivedCacheRoot,
      network: "offline",
    }),
    { code: "unsupported" },
  );

  let candidate: AdhiCandidate | undefined;
  t.after(async () => {
    await candidate?.dispose();
  });
  candidate = await createCandidate({
    revision: ADHI_CANDIDATE_REVISION,
    artifactRoot: fixture.root,
    derivedCacheRoot: fixture.derivedCacheRoot,
    network: "offline",
  });
  assert.ok(candidate !== undefined);

  const controller = new AbortController();
  const pending = candidate.invoke(request("read_source", fixture.left), {
    offline: true,
    signal: controller.signal,
  });
  // Abort during cold artifact discovery, before any cached resolution or tools/call.
  await Promise.resolve();
  const abortedAt = performance.now();
  controller.abort();
  await assert.rejects(pending, { code: "cancelled" });
  assert.ok(performance.now() - abortedAt < 1_000);
  await processGone(candidate.pid);

  await assert.rejects(
    candidate.invoke(request("find_class", fixture.left), { offline: true }),
    {
      code: "unavailable",
    },
  );
  await candidate.dispose();
  await candidate.dispose();
});

test("tools/list obeys the same bounded response budget", async (t) => {
  const fixture = await setup(t);
  if (await assertWindowsCandidateUnavailable(fixture)) return;
  await assert.rejects(
    (async () => {
      const candidate = await createCandidate({
        revision: ADHI_CANDIDATE_REVISION,
        artifactRoot: fixture.root,
        derivedCacheRoot: fixture.derivedCacheRoot,
        network: "offline",
        responseBytes: 2_048,
      });
      await candidate.dispose();
    })(),
    { code: "unavailable" },
  );
});

test("a completed JSON-RPC header cannot exceed the header cap", async (t) => {
  const fixture = await setup(t);
  if (await assertWindowsCandidateUnavailable(fixture)) return;
  const entryPoint = join(fixture.root, "oversized-header-upstream.mjs");
  await writeFile(
    entryPoint,
    `process.stdin.once("data", () => {
  const body = "{}";
  process.stdout.write("Content-Length: " + body.length + "\\r\\nX-Fill: " + "x".repeat(9000) + "\\r\\n\\r\\n" + body);
});
`,
  );
  await assert.rejects(
    createCandidate({
      revision: ADHI_CANDIDATE_REVISION,
      artifactRoot: fixture.root,
      derivedCacheRoot: fixture.derivedCacheRoot,
      network: "offline",
      entryPoint,
      allowFixtureEntryPoint: true,
    }),
    { code: "unavailable" },
  );
});

test("two bounded JSON-RPC frames may share one chunk above the aggregate cap", async (t) => {
  const fixture = await setup(t);
  if (await assertWindowsCandidateUnavailable(fixture)) return;
  const entryPoint = join(fixture.root, "coalesced-upstream.mjs");
  await writeFile(
    entryPoint,
    `let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const newline = input.indexOf("\\n");
    if (newline === -1) return;
    const message = JSON.parse(input.slice(0, newline));
    input = input.slice(newline + 1);
    if (message.method === "initialize") {
      const padding = "x".repeat(140000);
      const notification = { jsonrpc: "2.0", method: "notifications/progress", params: { padding } };
      const response = { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fixture", version: "1" }, padding } };
      process.stdout.write(JSON.stringify(notification) + "\\n" + JSON.stringify(response) + "\\n");
    } else if (message.method === "tools/list") {
      const tools = ["resolve-artifact", "find-class", "get-class-members", "find-mapping", "get-class-source", "search-class-source"].map((name) => ({ name }));
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools } }) + "\\n");
    } else if (message.method === "tools/call") {
      const result = { structuredContent: { error: { code: "ERR_CLASS_NOT_FOUND" } }, content: [], isError: true };
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
    }
  }
});
`,
  );
  let candidate: AdhiCandidate | undefined;
  t.after(async () => {
    await candidate?.dispose();
  });
  candidate = await createCandidate({
    revision: ADHI_CANDIDATE_REVISION,
    artifactRoot: fixture.root,
    derivedCacheRoot: fixture.derivedCacheRoot,
    network: "offline",
    entryPoint,
    allowFixtureEntryPoint: true,
  });
  assert.ok(candidate !== undefined);
  await assert.rejects(
    candidate.invoke(request("find_class", fixture.left), { offline: true }),
    {
      code: "not_found",
    },
  );
});

test("offline requests and external manifests fail before upstream work", async (t) => {
  const fixture = await setup(t);
  if (await assertWindowsCandidateUnavailable(fixture)) return;
  const candidate = await createCandidate({
    revision: ADHI_CANDIDATE_REVISION,
    artifactRoot: fixture.root,
    derivedCacheRoot: fixture.derivedCacheRoot,
    network: "online",
  });
  t.after(() => candidate.dispose());
  await assert.rejects(
    candidate.invoke(request("resolve_artifact", fixture.left), {
      offline: true,
    }),
    { code: "unsupported" },
  );
  await assert.rejects(
    createCandidate({
      revision: ADHI_CANDIDATE_REVISION,
      artifactRoot: fixture.root,
      derivedCacheRoot: fixture.derivedCacheRoot,
      network: "offline",
      versionManifestUrl:
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    }),
    { code: "unsupported" },
  );
});

test("Windows is rejected before spawning an unqualified upstream", async (t) => {
  const fixture = await setup(t);
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(descriptor !== undefined);
  Object.defineProperty(process, "platform", { ...descriptor, value: "win32" });
  t.after(() => Object.defineProperty(process, "platform", descriptor));
  await assert.rejects(
    (async () => {
      const candidate = await createCandidate({
        revision: ADHI_CANDIDATE_REVISION,
        artifactRoot: fixture.root,
        derivedCacheRoot: fixture.derivedCacheRoot,
        network: "offline",
      });
      await candidate.dispose();
    })(),
    { code: "unsupported" },
  );
});
