import assert from "node:assert/strict";
import test from "node:test";

import {
  createSourceFacade,
  type SourceCandidate,
  type SourceCandidateRequest,
  type SourceOperation,
  type SourceRequest,
  type SourceTarget,
} from "../../src/core/sources/source-facade.ts";

const artifactSha256 = "a".repeat(64);
const candidateRevision = "f".repeat(40);

const obfuscatedTarget: SourceTarget = {
  minecraftVersion: "1.21.1",
  loader: "fabric",
  mappings: { kind: "mojang", version: "1.21.1" },
};

const unobfuscatedTarget: SourceTarget = {
  minecraftVersion: "26.3",
  loader: "fabric",
  mappings: { kind: "none" },
};

const artifact = {
  coordinates: "net.fabricmc:fabric-loader",
  version: "0.20.1",
  sha256: artifactSha256,
} as const;

const positiveValues: Readonly<Record<SourceOperation, unknown>> = {
  resolve_artifact: {
    coordinates: artifact.coordinates,
    version: artifact.version,
    sha256: artifact.sha256,
  },
  find_class: {
    name: "net.minecraft.world.item.Item",
    artifactSha256,
  },
  get_members: {
    className: "net.minecraft.world.item.Item",
    members: [
      {
        name: "getDefaultInstance",
        descriptor: "()Lnet/minecraft/world/item/ItemStack;",
      },
    ],
  },
  map_symbol: {
    from: "net.minecraft.world.item.Item",
    to: "net.minecraft.world.item.Item",
    mapping: "mojang",
  },
  read_source: {
    className: "net.minecraft.world.item.Item",
    source: "public class Item { /* independently fixed fixture */ }",
  },
  search_source: {
    matches: [
      {
        className: "net.minecraft.world.item.Item",
        line: 1,
        text: "public class Item { /* independently fixed fixture */ }",
      },
    ],
  },
  diff_classes: {
    left: "net.minecraft.world.item.Item",
    right: "net.minecraft.world.item.Item",
    added: [],
    removed: [],
    changed: ["getDefaultInstance"],
  },
};

function request(
  operation: SourceOperation,
  extra: Record<string, unknown> = {},
): SourceRequest {
  return {
    operation,
    target: obfuscatedTarget,
    artifact,
    className: "net.minecraft.world.item.Item",
    symbol: "net.minecraft.world.item.Item",
    query: "getDefaultInstance",
    ...extra,
  } as SourceRequest;
}

class FakeCandidate implements SourceCandidate {
  readonly id = "fake-adhi";
  readonly revision = candidateRevision;
  readonly calls: SourceCandidateRequest[] = [];
  readonly contexts: { offline: boolean; signal?: AbortSignal }[] = [];
  disposed = 0;
  private readonly handler: (
    request: SourceCandidateRequest,
    context: { offline: boolean; signal?: AbortSignal },
  ) => unknown | Promise<unknown>;

  constructor(
    handler: (
      request: SourceCandidateRequest,
      context: { offline: boolean; signal?: AbortSignal },
    ) => unknown | Promise<unknown> = (candidateRequest) =>
      positiveValues[candidateRequest.operation],
  ) {
    this.handler = handler;
  }

  async invoke(
    candidateRequest: SourceCandidateRequest,
    context: { offline: boolean; signal?: AbortSignal },
  ): Promise<unknown> {
    this.calls.push(structuredClone(candidateRequest));
    this.contexts.push(context);
    return this.handler(candidateRequest, context);
  }

  async dispose(): Promise<void> {
    this.disposed += 1;
  }
}

function candidateError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

test("forwards exact Minecraft and mapping coordinates without workspace inference or latest fallback", async (t) => {
  const candidate = new FakeCandidate();
  const facade = createSourceFacade({ candidates: [candidate] });
  t.after(() => facade.dispose());

  const result = await facade.invoke(request("find_class"), { offline: true });

  assert.deepEqual(result, {
    status: "ok",
    operation: "find_class",
    value: positiveValues.find_class,
  });
  assert.equal(candidate.calls.length, 1);
  assert.deepEqual(candidate.calls[0]?.target, obfuscatedTarget);
  assert.equal(candidate.contexts[0]?.offline, true);

  const invalidTargets = [
    ["latest Minecraft", { ...obfuscatedTarget, minecraftVersion: "latest" }],
    [
      "latest mappings",
      {
        ...obfuscatedTarget,
        mappings: { kind: "mojang", version: "latest" },
      },
    ],
    ["inferred mappings", { minecraftVersion: "1.21.1", loader: "fabric" }],
  ] as const;
  for (const [name, target] of invalidTargets) {
    await t.test(name, async () => {
      assert.deepEqual(await facade.invoke(request("find_class", { target })), {
        status: "failed",
        operation: "find_class",
        code: "exact_target_required",
      });
    });
  }
  assert.equal(candidate.calls.length, 1);
});

test("normalizes all seven positive operations without changing independently fixed values", async (t) => {
  const candidate = new FakeCandidate();
  const facade = createSourceFacade({ candidates: [candidate] });
  t.after(() => facade.dispose());

  for (const operation of Object.keys(positiveValues) as SourceOperation[]) {
    await t.test(operation, async () => {
      assert.deepEqual(await facade.invoke(request(operation)), {
        status: "ok",
        operation,
        value: positiveValues[operation],
      });
    });
  }
  assert.deepEqual(
    candidate.calls.map((call) => call.operation),
    Object.keys(positiveValues),
  );
});

test("normalizes not_found, unsupported, and unavailable without fabricating values", async (t) => {
  const cases = [
    ["not_found", "not_found", "not_found"],
    ["unsupported", "unsupported", "unsupported_operation"],
    ["unavailable", "unavailable", "candidate_unavailable"],
  ] as const;

  for (const [thrownCode, status, code] of cases) {
    await t.test(thrownCode, async () => {
      const candidate = new FakeCandidate(() => {
        throw candidateError(thrownCode);
      });
      const facade = createSourceFacade({ candidates: [candidate] });
      t.after(() => facade.dispose());
      assert.deepEqual(await facade.invoke(request("find_class")), {
        status,
        operation: "find_class",
        code,
      });
    });
  }
});

test("26.x with mappings none never invents Yarn or Intermediary names", async (t) => {
  const candidate = new FakeCandidate((candidateRequest) => {
    if (candidateRequest.symbol === "unknown.example.Missing") {
      throw candidateError("not_found");
    }
    return {
      from: "net.minecraft.world.item.Item",
      to: "net.minecraft.world.item.Item",
      mapping: "none",
    };
  });
  const facade = createSourceFacade({ candidates: [candidate] });
  t.after(() => facade.dispose());

  assert.deepEqual(
    await facade.invoke(request("map_symbol", { target: unobfuscatedTarget })),
    {
      status: "ok",
      operation: "map_symbol",
      value: {
        from: "net.minecraft.world.item.Item",
        to: "net.minecraft.world.item.Item",
        mapping: "none",
      },
    },
  );
  assert.deepEqual(
    await facade.invoke(
      request("map_symbol", {
        target: unobfuscatedTarget,
        symbol: "unknown.example.Missing",
      }),
    ),
    { status: "not_found", operation: "map_symbol", code: "not_found" },
  );

  for (const mapping of ["yarn", "intermediary"]) {
    assert.deepEqual(
      await facade.invoke(
        request("map_symbol", { target: unobfuscatedTarget, mapping }),
      ),
      {
        status: "unsupported",
        operation: "map_symbol",
        code: "mapping_unavailable",
      },
    );
  }
  assert.equal(candidate.calls.length, 2);
});

test("forbidden upstream mutations and raw JAR paths never reach a candidate", async (t) => {
  const candidate = new FakeCandidate();
  const facade = createSourceFacade({ candidates: [candidate] });
  t.after(() => facade.dispose());

  for (const operation of [
    "delete_cache",
    "delete_source",
    "upload_source",
    "apply_patch",
    "run_game",
    "generate_registry_data",
  ]) {
    assert.deepEqual(
      await facade.invoke(request("find_class", { operation })),
      {
        status: "unsupported",
        operation,
        code: "unsupported_operation",
      },
    );
  }

  for (const [field, value] of [
    ["outputFile", "generated.java"],
    ["jarPath", "/tmp/arbitrary.jar"],
    ["rawJarPath", "../outside.jar"],
    ["delete", true],
    ["upload", true],
    ["runtime", { command: "gradle runClient" }],
    ["cacheDelete", true],
  ] as const) {
    await t.test(field, async () => {
      assert.deepEqual(
        await facade.invoke(request("read_source", { [field]: value })),
        {
          status: "failed",
          operation: "read_source",
          code: "forbidden_argument",
        },
      );
    });
  }
  assert.equal(candidate.calls.length, 0);
});

test("one unexpected candidate failure disables the facade and prevents restart loops", async (t) => {
  let attempts = 0;
  const candidate = new FakeCandidate(() => {
    attempts += 1;
    throw new Error("candidate crashed");
  });
  const facade = createSourceFacade({ candidates: [candidate] });
  t.after(() => facade.dispose());

  assert.deepEqual(await facade.invoke(request("find_class")), {
    status: "unavailable",
    operation: "find_class",
    code: "candidate_failed",
  });
  assert.deepEqual(await facade.invoke(request("find_class")), {
    status: "unavailable",
    operation: "find_class",
    code: "source_facade_disabled",
  });
  assert.equal(attempts, 1);
});

test("simultaneous candidate pilots fail closed before either is called", async () => {
  const first = new FakeCandidate();
  const second = new FakeCandidate();
  assert.throws(() => createSourceFacade({ candidates: [first, second] }), {
    code: "multiple_source_candidates",
  });
  assert.equal(first.calls.length, 0);
  assert.equal(second.calls.length, 0);
});

test("zero selected candidates is explicitly disabled, not an implicit upstream fallback", async (t) => {
  const facade = createSourceFacade({ candidates: [] });
  t.after(() => facade.dispose());
  assert.deepEqual(await facade.invoke(request("find_class")), {
    status: "unavailable",
    operation: "find_class",
    code: "source_facade_disabled",
  });
});

test("response and source limits fail closed instead of truncating into a plausible answer", async (t) => {
  const candidate = new FakeCandidate((candidateRequest) =>
    candidateRequest.operation === "read_source"
      ? { className: candidateRequest.className, source: "x".repeat(65) }
      : { text: "x".repeat(257) },
  );
  const facade = createSourceFacade({
    candidates: [candidate],
    limits: { responseBytes: 256, sourceBytes: 64 },
  });
  t.after(() => facade.dispose());

  assert.deepEqual(await facade.invoke(request("read_source")), {
    status: "failed",
    operation: "read_source",
    code: "source_response_too_large",
  });
  assert.deepEqual(await facade.invoke(request("search_source")), {
    status: "failed",
    operation: "search_source",
    code: "response_too_large",
  });
});

test("cancellation is acknowledged within one second and candidate disposal remains idempotent", async (t) => {
  let cleanedUp = false;
  const candidate = new FakeCandidate((_candidateRequest, context) => {
    const { promise, reject } = Promise.withResolvers<never>();
    context.signal?.addEventListener(
      "abort",
      () => {
        cleanedUp = true;
        reject(candidateError("cancelled"));
      },
      { once: true },
    );
    return promise;
  });
  const facade = createSourceFacade({ candidates: [candidate] });
  t.after(() => facade.dispose());
  const controller = new AbortController();
  const started = performance.now();
  const pending = facade.invoke(request("read_source"), {
    signal: controller.signal,
  });
  controller.abort();

  assert.deepEqual(await pending, {
    status: "cancelled",
    operation: "read_source",
    code: "cancelled",
  });
  assert.ok(performance.now() - started < 1_000);
  assert.equal(cleanedUp, true);
  await Promise.all([facade.dispose(), facade.dispose()]);
  assert.equal(candidate.disposed, 1);
});

test("a pre-aborted request returns cancelled without invoking the candidate", async (t) => {
  const candidate = new FakeCandidate();
  const facade = createSourceFacade({ candidates: [candidate] });
  t.after(() => facade.dispose());
  const controller = new AbortController();
  controller.abort();

  assert.deepEqual(
    await facade.invoke(request("find_class"), { signal: controller.signal }),
    { status: "cancelled", operation: "find_class", code: "cancelled" },
  );
  assert.equal(candidate.calls.length, 0);
});

test("candidates receive only the exact artifact identity fields", async (t) => {
  const candidate = new FakeCandidate();
  const facade = createSourceFacade({ candidates: [candidate] });
  t.after(() => facade.dispose());

  const result = await facade.invoke(
    request("find_class", {
      artifact: {
        ...artifact,
        jarPath: "/tmp/arbitrary.jar",
        outputFile: "generated.java",
        delete: true,
      },
    }),
  );

  assert.deepEqual(result, {
    status: "ok",
    operation: "find_class",
    value: positiveValues.find_class,
  });
  assert.deepEqual(candidate.calls[0]?.artifact, artifact);
  assert.equal(candidate.calls.length, 1);
});

test("malformed artifact identity fails closed before the candidate", async (t) => {
  const candidate = new FakeCandidate();
  const facade = createSourceFacade({ candidates: [candidate] });
  t.after(() => facade.dispose());

  assert.deepEqual(
    await facade.invoke(
      request("find_class", {
        artifact: { ...artifact, sha256: "not-a-hash" },
      }),
    ),
    { status: "failed", operation: "find_class", code: "artifact_invalid" },
  );
  assert.equal(candidate.calls.length, 0);
});
