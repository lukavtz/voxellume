import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { zipSync } from "fflate";

import { assertGradlePreflight } from "../../src/core/verification/gradle-preflight.ts";
import { recordNetworkApproval } from "../../src/core/execution/approvals.ts";
import type { TargetGradle } from "../../src/core/targets/target-pack.ts";

const wrapperBytes = zipSync({
  "META-INF/MANIFEST.MF": new TextEncoder().encode("Manifest-Version: 1.0\n"),
});
const distributionBytes = zipSync({
  "gradle-9.8.2/bin/gradle": new TextEncoder().encode("gradle launcher\n"),
});
const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

function gradle(
  overrides: Omit<Partial<TargetGradle>, "wrapperJarSha256"> & {
    wrapperJarSha256?: string | undefined;
  } = {},
): TargetGradle {
  const { wrapperJarSha256, ...rest } = overrides;
  return {
    version: "9.8.2",
    distributionUrl:
      "https://services.gradle.org/distributions/gradle-9.8.2-bin.zip",
    distributionSha256: sha256(distributionBytes),
    plugins: [{ id: "net.fabricmc.fabric-loom-remap", version: "1.20.0" }],
    ...rest,
    ...(Object.hasOwn(overrides, "wrapperJarSha256")
      ? wrapperJarSha256 === undefined
        ? {}
        : { wrapperJarSha256 }
      : { wrapperJarSha256: sha256(wrapperBytes) }),
  };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "voxellume-gradle-preflight-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  await mkdir(join(projectRoot, "gradle", "wrapper"), { recursive: true });
  await writeFile(
    join(projectRoot, "gradle", "wrapper", "gradle-wrapper.jar"),
    wrapperBytes,
  );
  const cacheRoot = join(root, "cache");
  const cacheIdentity = "fabric-1.21.1-gradle-9.8.2";
  await mkdir(join(cacheRoot, cacheIdentity), { recursive: true });
  return {
    projectRoot,
    cacheRoot,
    configRoot: join(root, "config"),
    cacheIdentity,
  };
}

function cachePath(
  cacheRoot: string,
  cacheIdentity: string,
  distributionSha256: string,
): string {
  return join(cacheRoot, cacheIdentity, `${distributionSha256}.zip`);
}

async function preseed(
  cacheRoot: string,
  cacheIdentity: string,
  distributionSha256: string,
  bytes: Uint8Array,
): Promise<void> {
  const path = cachePath(cacheRoot, cacheIdentity, distributionSha256);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, bytes);
}

test("execution without an exact wrapper JAR hash is unavailable before I/O", async (t) => {
  const roots = await fixture(t);
  for (const wrapperJarSha256 of [undefined, "ABC", "0".repeat(63)]) {
    const result = await assertGradlePreflight({
      target: { gradle: gradle({ wrapperJarSha256 }) },
      ...roots,
      mode: "offline",
      fetch: async () => {
        throw new Error("network must not be used");
      },
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.code, "wrapper_jar_hash_required");
    assert.equal(result.networkUsed, false);
  }
});

test("wrapper JAR tampering fails before distribution or network access", async (t) => {
  const roots = await fixture(t);
  await writeFile(
    join(roots.projectRoot, "gradle", "wrapper", "gradle-wrapper.jar"),
    zipSync({
      "gradle-wrapper.properties": new TextEncoder().encode("tampered"),
    }),
  );
  const target = { gradle: gradle() };
  const result = await assertGradlePreflight({
    target,
    ...roots,
    mode: "offline",
    fetch: async () => {
      throw new Error("network must not be used");
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "wrapper_jar_sha256_mismatch");
  assert.notEqual(result.wrapperJarSha256, target.gradle.wrapperJarSha256);
  assert.equal(result.networkUsed, false);
});

test("offline preflight passes only with exact preseed wrapper and distribution", async (t) => {
  const roots = await fixture(t);
  const target = { gradle: gradle() };
  await preseed(
    roots.cacheRoot,
    roots.cacheIdentity,
    target.gradle.distributionSha256,
    distributionBytes,
  );
  const result = await assertGradlePreflight({
    target,
    ...roots,
    mode: "offline",
    fetch: async () => {
      throw new Error("network must not be used");
    },
  });
  assert.deepEqual(result, {
    status: "passed",
    code: "ok",
    networkUsed: false,
    wrapperJarSha256: target.gradle.wrapperJarSha256,
    distributionSha256: target.gradle.distributionSha256,
    distributionPath: cachePath(
      roots.cacheRoot,
      roots.cacheIdentity,
      target.gradle.distributionSha256,
    ),
  });
});

test("offline preflight never downloads a missing cache", async (t) => {
  const roots = await fixture(t);
  const result = await assertGradlePreflight({
    target: { gradle: gradle() },
    ...roots,
    mode: "offline",
    fetch: async () => {
      throw new Error("network must not be used");
    },
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.code, "distribution_cache_missing");
  assert.equal(result.networkUsed, false);
});

test("cached distribution tampering fails closed without replacement", async (t) => {
  const roots = await fixture(t);
  const target = { gradle: gradle() };
  const tampered = zipSync({ "gradle-9.8.2/bin/gradle": new Uint8Array([0]) });
  await preseed(
    roots.cacheRoot,
    roots.cacheIdentity,
    target.gradle.distributionSha256,
    tampered,
  );
  const result = await assertGradlePreflight({
    target,
    ...roots,
    mode: "offline",
    fetch: async () => {
      throw new Error("network must not be used");
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "distribution_sha256_mismatch");
  assert.equal(result.distributionSha256, sha256(tampered));
  assert.equal(result.networkUsed, false);
});

test("cold download requires exact host, purpose, and cache approval", async (t) => {
  const roots = await fixture(t);
  let fetches = 0;
  const fetch = async (): Promise<Response> => {
    fetches += 1;
    return new Response(distributionBytes);
  };
  const target = { gradle: gradle() };
  const unapproved = await assertGradlePreflight({
    target,
    ...roots,
    mode: "cold",
    fetch,
  });
  assert.equal(unapproved.status, "unavailable");
  assert.equal(unapproved.code, "network_not_approved");

  for (const override of [
    { host: "downloads.gradle.org" },
    { purpose: "gradle-dependencies" },
    { cacheIdentity: "another-cache" },
  ]) {
    await recordNetworkApproval({
      configRoot: roots.configRoot,
      host: "services.gradle.org",
      purpose: "gradle-distribution",
      cacheIdentity: roots.cacheIdentity,
      approvedAt: "2026-11-07T00:00:00.000Z",
      ...override,
    });
    const result = await assertGradlePreflight({
      target,
      ...roots,
      mode: "cold",
      fetch,
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.code, "network_not_approved");
  }
  assert.equal(fetches, 0);
});

test("approved cold download uses redirect error and atomically seeds exact cache", async (t) => {
  const roots = await fixture(t);
  await recordNetworkApproval({
    configRoot: roots.configRoot,
    host: "services.gradle.org",
    purpose: "gradle-distribution",
    cacheIdentity: roots.cacheIdentity,
    approvedAt: "2026-11-07T00:00:00.000Z",
  });
  const target = { gradle: gradle() };
  let redirect: RequestRedirect | undefined;
  const result = await assertGradlePreflight({
    target,
    ...roots,
    mode: "cold",
    fetch: async (url, init) => {
      assert.equal(String(url), target.gradle.distributionUrl);
      redirect = init?.redirect;
      return new Response(distributionBytes);
    },
  });
  assert.equal(redirect, "error");
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.equal(result.code, "ok");
  assert.equal(result.networkUsed, true);
  const path = cachePath(
    roots.cacheRoot,
    roots.cacheIdentity,
    target.gradle.distributionSha256,
  );
  assert.deepEqual(new Uint8Array(await readFile(path)), distributionBytes);

  const warm = await assertGradlePreflight({
    target,
    ...roots,
    mode: "offline",
    fetch: async () => {
      throw new Error("seeded cache must not fetch");
    },
  });
  assert.equal(warm.status, "passed");
});

test("redirects are rejected without publishing a distribution", async (t) => {
  const roots = await fixture(t);
  await recordNetworkApproval({
    configRoot: roots.configRoot,
    host: "services.gradle.org",
    purpose: "gradle-distribution",
    cacheIdentity: roots.cacheIdentity,
    approvedAt: "2026-11-07T00:00:00.000Z",
  });
  const target = { gradle: gradle() };
  const result = await assertGradlePreflight({
    target,
    ...roots,
    mode: "cold",
    fetch: async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.invalid/gradle.zip" },
      }),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "redirect_forbidden");
  assert.equal(result.networkUsed, true);
  await assert.rejects(stat(result.distributionPath!));
});

test("declared distributions cannot exceed 512 MiB", async (t) => {
  const roots = await fixture(t);
  await recordNetworkApproval({
    configRoot: roots.configRoot,
    host: "services.gradle.org",
    purpose: "gradle-distribution",
    cacheIdentity: roots.cacheIdentity,
    approvedAt: "2026-11-07T00:00:00.000Z",
  });
  const target = { gradle: gradle() };
  const result = await assertGradlePreflight({
    target,
    ...roots,
    mode: "cold",
    fetch: async () =>
      new Response(new Uint8Array([1]), {
        headers: { "content-length": String(512 * 1024 * 1024 + 1) },
      }),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "distribution_size_limit");
  assert.equal(result.networkUsed, true);
  await assert.rejects(stat(result.distributionPath!));
});

test("downloaded distribution tampering fails without cache publication", async (t) => {
  const roots = await fixture(t);
  await recordNetworkApproval({
    configRoot: roots.configRoot,
    host: "services.gradle.org",
    purpose: "gradle-distribution",
    cacheIdentity: roots.cacheIdentity,
    approvedAt: "2026-11-07T00:00:00.000Z",
  });
  const target = { gradle: gradle() };
  const tampered = zipSync({ "gradle-9.8.2/bin/gradle": new Uint8Array([0]) });
  const result = await assertGradlePreflight({
    target,
    ...roots,
    mode: "cold",
    fetch: async () => new Response(tampered),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "distribution_sha256_mismatch");
  assert.equal(result.distributionSha256, sha256(tampered));
  await assert.rejects(stat(result.distributionPath!));
});

test("unsafe distribution entry paths are rejected before cache publication", async (t) => {
  const roots = await fixture(t);
  await recordNetworkApproval({
    configRoot: roots.configRoot,
    host: "services.gradle.org",
    purpose: "gradle-distribution",
    cacheIdentity: roots.cacheIdentity,
    approvedAt: "2026-11-07T00:00:00.000Z",
  });
  const unsafe = zipSync({ "../outside": new Uint8Array([1]) });
  const target = {
    gradle: gradle({ distributionSha256: sha256(unsafe) }),
  };
  const result = await assertGradlePreflight({
    target,
    ...roots,
    mode: "cold",
    fetch: async () => new Response(unsafe),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "archive_unsafe_path");
  await assert.rejects(stat(result.distributionPath!));
});

test("cache identity traversal is rejected without network access", async (t) => {
  const roots = await fixture(t);
  const result = await assertGradlePreflight({
    target: { gradle: gradle() },
    ...roots,
    cacheIdentity: "../outside",
    mode: "cold",
    fetch: async () => {
      throw new Error("network must not be used");
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "invalid_cache_identity");
  assert.equal(result.networkUsed, false);
});

test("cold mode never overwrites a tampered preseed cache", async (t) => {
  const roots = await fixture(t);
  const target = { gradle: gradle() };
  const tampered = zipSync({ tampered: new Uint8Array([1]) });
  await preseed(
    roots.cacheRoot,
    roots.cacheIdentity,
    target.gradle.distributionSha256,
    tampered,
  );
  const result = await assertGradlePreflight({
    target,
    ...roots,
    mode: "cold",
    fetch: async () => {
      throw new Error("existing cache must not be replaced");
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "distribution_sha256_mismatch");
  assert.deepEqual(
    new Uint8Array(await readFile(result.distributionPath!)),
    tampered,
  );
});

test("cache root and cache identity symlinks cannot redirect cold writes", async (t) => {
  for (const component of ["cacheRoot", "cacheIdentity"] as const) {
    await t.test(component, async (t) => {
      const roots = await fixture(t);
      const target = { gradle: gradle() };
      const outside = join(dirname(roots.cacheRoot), `outside-${component}`);
      await mkdir(outside);
      if (component === "cacheRoot") {
        await rename(roots.cacheRoot, `${roots.cacheRoot}-real`);
        await symlink(outside, roots.cacheRoot, "dir");
      } else {
        const identity = join(roots.cacheRoot, roots.cacheIdentity);
        await rm(identity, { recursive: true });
        await symlink(outside, identity, "dir");
      }
      await recordNetworkApproval({
        configRoot: roots.configRoot,
        host: "services.gradle.org",
        purpose: "gradle-distribution",
        cacheIdentity: roots.cacheIdentity,
        approvedAt: "2026-11-07T00:00:00.000Z",
      });
      let fetches = 0;
      const result = await assertGradlePreflight({
        target,
        ...roots,
        mode: "cold",
        fetch: async () => {
          fetches += 1;
          return new Response(distributionBytes);
        },
      });
      assert.equal(result.status, "failed");
      assert.equal(result.code, "distribution_cache_unavailable");
      assert.equal(result.networkUsed, false);
      assert.equal(fetches, 0);
      assert.deepEqual(await readdir(outside), []);
    });
  }
});

test("cached distribution symlinks are not read as preseed files", async (t) => {
  const roots = await fixture(t);
  const target = { gradle: gradle() };
  const outside = join(dirname(roots.cacheRoot), "outside.zip");
  await writeFile(outside, distributionBytes);
  await symlink(
    outside,
    cachePath(
      roots.cacheRoot,
      roots.cacheIdentity,
      target.gradle.distributionSha256,
    ),
  );
  const result = await assertGradlePreflight({
    target,
    ...roots,
    mode: "offline",
    fetch: async () => {
      throw new Error("network must not be used");
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "distribution_cache_unavailable");
  assert.equal(result.networkUsed, false);
});

test("cancellation after archive validation cannot publish or pass", async (t) => {
  const roots = await fixture(t);
  const target = { gradle: gradle() };
  await recordNetworkApproval({
    configRoot: roots.configRoot,
    host: "services.gradle.org",
    purpose: "gradle-distribution",
    cacheIdentity: roots.cacheIdentity,
    approvedAt: "2026-11-07T00:00:00.000Z",
  });
  const controller = new AbortController();
  const response = new Response(distributionBytes);
  Object.defineProperty(response, "body", {
    value: {
      [Symbol.asyncIterator]() {
        let sent = false;
        return {
          next(): Promise<IteratorResult<Uint8Array>> {
            if (!sent) {
              sent = true;
              return Promise.resolve({ done: false, value: distributionBytes });
            }
            controller.abort();
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
  });
  const result = await assertGradlePreflight({
    target,
    ...roots,
    mode: "cold",
    signal: controller.signal,
    fetch: async () => response,
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.code, "cancelled");
  await assert.rejects(stat(result.distributionPath!));
});

test("central-directory limits and nested archives fail before cache use", async (t) => {
  const defaults = {
    maxEntries: 10,
    maxEntryUncompressedBytes: 1024 * 1024,
    maxTotalUncompressedBytes: 2 * 1024 * 1024,
    maxCompressionRatio: 100,
  };
  const cases = [
    {
      name: "entry count",
      bytes: zipSync({
        first: new Uint8Array([1]),
        second: new Uint8Array([2]),
      }),
      limits: { ...defaults, maxEntries: 1 },
      code: "archive_entry_count_limit",
    },
    {
      name: "entry size",
      bytes: zipSync({ first: new Uint8Array(16) }),
      limits: { ...defaults, maxEntryUncompressedBytes: 15 },
      code: "archive_entry_size_limit",
    },
    {
      name: "aggregate size",
      bytes: zipSync({ first: new Uint8Array(16), second: new Uint8Array(16) }),
      limits: { ...defaults, maxTotalUncompressedBytes: 31 },
      code: "archive_total_size_limit",
    },
    {
      name: "compression ratio",
      bytes: zipSync({ first: new Uint8Array(16 * 1024) }),
      limits: { ...defaults, maxCompressionRatio: 1 },
      code: "archive_compression_ratio_limit",
    },
    {
      name: "nested archive",
      bytes: zipSync({ "lib/nested.jar": new Uint8Array([1]) }),
      limits: defaults,
      code: "nested_archive_forbidden",
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async (t) => {
      const roots = await fixture(t);
      const target = {
        gradle: gradle({ distributionSha256: sha256(entry.bytes) }),
      };
      await preseed(
        roots.cacheRoot,
        roots.cacheIdentity,
        target.gradle.distributionSha256,
        entry.bytes,
      );
      const result = await assertGradlePreflight({
        target,
        ...roots,
        mode: "offline",
        archiveLimits: entry.limits,
      });
      assert.equal(result.status, "failed");
      assert.equal(result.code, entry.code);
    });
  }
});

test("only genuine redirect failures use redirect_forbidden", async (t) => {
  const roots = await fixture(t);
  const target = { gradle: gradle() };
  await recordNetworkApproval({
    configRoot: roots.configRoot,
    host: "services.gradle.org",
    purpose: "gradle-distribution",
    cacheIdentity: roots.cacheIdentity,
    approvedAt: "2026-11-07T00:00:00.000Z",
  });
  const dns = await assertGradlePreflight({
    target,
    ...roots,
    mode: "cold",
    fetch: async () => {
      throw new TypeError("fetch failed", {
        cause: new Error("getaddrinfo ENOTFOUND services.gradle.org"),
      });
    },
  });
  assert.equal(dns.status, "failed");
  assert.equal(dns.code, "distribution_download_failed");

  const redirect = await assertGradlePreflight({
    target,
    ...roots,
    mode: "cold",
    fetch: async () => {
      throw new TypeError("fetch failed", {
        cause: new Error("redirect mode is set to error"),
      });
    },
  });
  assert.equal(redirect.status, "failed");
  assert.equal(redirect.code, "redirect_forbidden");
});

test("local ZIP metadata and actual inflate output must match central declarations", async (t) => {
  const cases = [
    {
      name: "local size mismatch",
      code: "archive_entry_mismatch",
      mutate(bytes: Buffer, central: number) {
        bytes.writeUInt32LE(1, central + 24);
      },
    },
    {
      name: "local name mismatch",
      code: "archive_entry_mismatch",
      mutate(bytes: Buffer) {
        bytes.write("X", 30, 1, "ascii");
      },
    },
    {
      name: "local method mismatch",
      code: "archive_entry_mismatch",
      mutate(bytes: Buffer) {
        bytes.writeUInt16LE(0, 8);
      },
    },
    {
      name: "underdeclared inflate output",
      code: "archive_entry_size_mismatch",
      mutate(bytes: Buffer, central: number) {
        bytes.writeUInt32LE(1, 22);
        bytes.writeUInt32LE(1, central + 24);
      },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async (t) => {
      const roots = await fixture(t);
      const bytes = Buffer.from(
        zipSync({ "gradle-9.8.2/bin/gradle": new Uint8Array(16 * 1024) }),
      );
      const central = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      assert.ok(central > 0);
      entry.mutate(bytes, central);
      const target = {
        gradle: gradle({ distributionSha256: sha256(bytes) }),
      };
      await recordNetworkApproval({
        configRoot: roots.configRoot,
        host: "services.gradle.org",
        purpose: "gradle-distribution",
        cacheIdentity: roots.cacheIdentity,
        approvedAt: "2026-11-07T00:00:00.000Z",
      });
      const result = await assertGradlePreflight({
        target,
        ...roots,
        mode: "cold",
        fetch: async () => new Response(bytes),
      });
      assert.equal(result.status, "failed");
      assert.equal(result.code, entry.code);
      await assert.rejects(stat(result.distributionPath!));
    });
  }
});

test("target schema accepts an optional exact hash and baselines pin actual wrapper hashes", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../../schemas/target-pack.schema.json", import.meta.url),
      "utf8",
    ),
  ) as AnySchema;
  const validate = new Ajv2020({ strict: true }).compile(schema);
  for (const [loader, expected] of [
    [
      "fabric",
      "3b8a25775a69158b5ad2b1d17a80a88dc7b40a352a73eb27d06c612a7ce68e98",
    ],
    [
      "neoforge",
      "7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172",
    ],
  ] as const) {
    const pack = JSON.parse(
      await readFile(
        new URL(
          `../../target-packs/java/${loader}/1.21.1/target.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { gradle: { wrapperJarSha256?: string } };
    assert.equal(pack.gradle.wrapperJarSha256, expected);
    assert.equal(validate(pack), true, JSON.stringify(validate.errors));
    const withoutHash = structuredClone(pack);
    delete withoutHash.gradle.wrapperJarSha256;
    assert.equal(validate(withoutHash), true, JSON.stringify(validate.errors));
    const malformed = structuredClone(pack);
    malformed.gradle.wrapperJarSha256 = expected.toUpperCase();
    assert.equal(validate(malformed), false);
  }
});
