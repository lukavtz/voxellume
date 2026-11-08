import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const manifestPath = join(repositoryRoot, "fixtures/source-mcp/artifacts.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

assert.equal(manifest.schemaVersion, "source-mcp-artifacts-1.0.0");
assert.equal(manifest.cache.rootEnv, "VOXELLUME_SOURCE_MCP_CACHE");
const maximumBytes = manifest.cache.maximumDownloadBytes;
assert.ok(Number.isSafeInteger(maximumBytes) && maximumBytes > 0);
assert.ok(Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0);

const ids = new Set();
const paths = new Set();

function safeRelativePath(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  assert.ok(!value.includes("\0") && !value.includes("\\"), `Unsafe ${label}`);
  assert.ok(!posix.isAbsolute(value), `Unsafe ${label}`);
  assert.equal(posix.normalize(value), value, `Unsafe ${label}`);
  assert.ok(
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== ".."),
    `Unsafe ${label}`,
  );
  return value;
}

for (const artifact of manifest.artifacts) {
  assert.equal(typeof artifact.id, "string");
  assert.match(artifact.id, /^[a-z0-9][a-z0-9.-]*$/);
  assert.ok(!ids.has(artifact.id), `Duplicate artifact id: ${artifact.id}`);
  ids.add(artifact.id);
  safeRelativePath(artifact.path, `artifact path: ${artifact.id}`);
  assert.ok(
    !paths.has(artifact.path),
    `Duplicate artifact path: ${artifact.path}`,
  );
  paths.add(artifact.path);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  pinnedUrl(artifact.url, artifact.id);
}

const artifactRootInput =
  process.env[manifest.cache.rootEnv] ??
  resolve(
    repositoryRoot,
    safeRelativePath(manifest.cache.defaultRoot, "cache root"),
  );
await mkdir(artifactRootInput, { recursive: true });
const artifactRoot = await realpath(artifactRootInput);

async function ensureParent(relativePath) {
  const parts = relativePath.split("/");
  parts.pop();
  let current = artifactRoot;
  for (const part of parts) {
    current = join(current, part);
    await mkdir(current, { recursive: false }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const metadata = await lstat(current);
    assert.ok(
      metadata.isDirectory() && !metadata.isSymbolicLink(),
      `Artifact parent is not a real directory: ${current}`,
    );
  }
  return current;
}

function destinationFor(relativePath) {
  const destination = resolve(artifactRoot, ...relativePath.split("/"));
  assert.ok(
    destination.startsWith(`${artifactRoot}${sep}`),
    `Artifact escapes cache: ${relativePath}`,
  );
  return destination;
}

function errorCode(error) {
  return error !== null && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
}

async function removeTemporary(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

async function verifyCached(destination, artifact) {
  let initial;
  try {
    initial = await lstat(destination);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  assert.ok(
    initial.isFile() && !initial.isSymbolicLink() && initial.nlink === 1,
    `Cached artifact is not a single-link regular file: ${artifact.id}`,
  );
  assert.ok(
    initial.size <= maximumBytes,
    `Cached artifact too large: ${artifact.id}`,
  );

  const handle = await open(destination, "r");
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    const opened = await handle.stat();
    assert.ok(
      opened.isFile() &&
        opened.nlink === 1 &&
        opened.dev === initial.dev &&
        opened.ino === initial.ino,
      `Cached artifact changed while opening: ${artifact.id}`,
    );
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) {
      bytes += chunk.byteLength;
      assert.ok(
        bytes <= maximumBytes,
        `Cached artifact too large: ${artifact.id}`,
      );
      hash.update(chunk);
    }
    const current = await lstat(destination);
    assert.ok(
      current.isFile() &&
        current.nlink === 1 &&
        current.dev === opened.dev &&
        current.ino === opened.ino,
      `Cached artifact changed while reading: ${artifact.id}`,
    );
  } finally {
    await handle.close();
  }
  assert.equal(
    hash.digest("hex"),
    artifact.sha256,
    `Cached artifact SHA-256 mismatch: ${artifact.id}`,
  );
  return bytes;
}

function pinnedUrl(value, id) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:", `Non-HTTPS artifact URL: ${id}`);
  assert.ok(
    !url.username && !url.password,
    `Artifact URL has credentials: ${id}`,
  );
  return url;
}

async function fetchArtifact(artifact) {
  const original = pinnedUrl(artifact.url, artifact.id);
  let response = await fetch(original, {
    headers: { "accept-encoding": "identity" },
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    assert.ok(location, `Redirect without location: ${artifact.id}`);
    assert.equal(
      original.hostname,
      "ldtteam.jfrog.io",
      `Unexpected artifact redirect: ${artifact.id}`,
    );
    const target = new URL(location, original);
    assert.equal(target.protocol, "https:", `Unsafe redirect: ${artifact.id}`);
    assert.equal(
      target.hostname,
      "storage.googleapis.com",
      `Unexpected redirect host: ${artifact.id}`,
    );
    await response.body?.cancel();
    response = await fetch(target, {
      headers: { "accept-encoding": "identity" },
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
  }
  assert.ok(
    response.ok,
    `Download failed (${response.status}): ${artifact.id}`,
  );
  assert.ok(response.body, `Empty download response: ${artifact.id}`);
  return response;
}

async function writeAll(handle, chunk) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(
      chunk,
      offset,
      chunk.byteLength - offset,
      null,
    );
    assert.ok(bytesWritten > 0, "Artifact write made no progress");
    offset += bytesWritten;
  }
}

async function downloadArtifact(artifact, parent, destination) {
  const response = await fetchArtifact(artifact);
  const declaredHeader = response.headers.get("content-length");
  let declaredBytes;
  if (declaredHeader !== null) {
    assert.match(
      declaredHeader,
      /^(?:0|[1-9][0-9]*)$/,
      `Invalid Content-Length: ${artifact.id}`,
    );
    declaredBytes = Number(declaredHeader);
    assert.ok(
      Number.isSafeInteger(declaredBytes),
      `Invalid Content-Length: ${artifact.id}`,
    );
    assert.ok(
      declaredBytes <= maximumBytes,
      `Download too large: ${artifact.id}`,
    );
  }

  const temporary = join(
    parent,
    `.${artifact.path.split("/").at(-1)}.download-${process.pid}-${randomUUID()}`,
  );
  const handle = await open(temporary, "wx", 0o600);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) {
        throw new Error(`Download too large: ${artifact.id}`);
      }
      hash.update(chunk);
      await writeAll(handle, chunk);
    }
    if (declaredBytes !== undefined) {
      assert.equal(
        bytes,
        declaredBytes,
        `Downloaded size mismatch: ${artifact.id}`,
      );
    }
    assert.equal(
      hash.digest("hex"),
      artifact.sha256,
      `Downloaded SHA-256 mismatch: ${artifact.id}`,
    );
    await handle.sync();
    await handle.close();

    try {
      await link(temporary, destination);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const bytes = await verifyCached(destination, artifact);
      assert.notEqual(
        bytes,
        undefined,
        `Artifact vanished during publication: ${artifact.id}`,
      );
      return { bytes, state: "verified" };
    }
    return { bytes, state: "downloaded" };
  } finally {
    await handle.close().catch((error) => {
      if (errorCode(error) !== "EBADF") throw error;
    });
    await removeTemporary(temporary);
  }
}

for (const artifact of manifest.artifacts) {
  const parent = await ensureParent(artifact.path);
  const destination = destinationFor(artifact.path);
  const cachedBytes = await verifyCached(destination, artifact);
  const result =
    cachedBytes === undefined
      ? await downloadArtifact(artifact, parent, destination)
      : { bytes: cachedBytes, state: "verified" };
  console.log(
    `${result.state} ${artifact.id} ${result.bytes} ${artifact.sha256}`,
  );
}

console.log(
  `Verified ${manifest.artifacts.length} pinned artifacts in ${artifactRoot}`,
);
