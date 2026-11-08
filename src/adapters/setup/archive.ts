import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep, win32 } from "node:path";
import { createGunzip } from "node:zlib";

export class ArchiveError extends Error {
  readonly code: string;

  constructor(code: string, detail = "") {
    super(detail === "" ? code : `${code}: ${detail}`);
    this.name = "ArchiveError";
    this.code = code;
  }
}

export async function downloadVerified(
  url: string,
  expectedSha256: string,
  destination: string,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
  maximumBytes: number,
): Promise<void> {
  const response = await fetchImplementation(url, {
    redirect: "follow",
    signal,
  });
  if (!response.ok || response.body === null) {
    throw new ArchiveError("download_failed", String(response.status));
  }
  const hash = createHash("sha256");
  let bytes = 0;
  const file = await open(destination, "wx", 0o600);
  try {
    for await (const value of response.body) {
      signal.throwIfAborted();
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maximumBytes) throw new ArchiveError("archive_too_large");
      hash.update(chunk);
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
  const actual = hash.digest("hex");
  if (actual !== expectedSha256) {
    throw new ArchiveError("archive_hash_mismatch", actual);
  }
}

function archiveNumber(header: Buffer, offset: number, length: number): number {
  const text = header
    .subarray(offset, offset + length)
    .toString("ascii")
    .replaceAll("\0", "")
    .trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new ArchiveError("archive_invalid");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ArchiveError("archive_invalid");
  }
  return value;
}

function archiveText(header: Buffer, offset: number, length: number): string {
  const nul = header.indexOf(0, offset);
  const end = nul >= offset && nul < offset + length ? nul : offset + length;
  return header.subarray(offset, end).toString("utf8");
}

function safeArchivePath(path: string): string {
  if (
    path === "" ||
    path.includes("\0") ||
    path.includes("\\") ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    /^[A-Za-z]:/.test(path)
  ) {
    throw new ArchiveError("archive_traversal", path);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new ArchiveError("archive_traversal", path);
  }
  return parts.join("/");
}

function parsePax(payload: Buffer): Record<string, string> {
  const values: Record<string, string> = {};
  let offset = 0;
  while (offset < payload.length) {
    const space = payload.indexOf(32, offset);
    if (space < 0) throw new ArchiveError("archive_invalid");
    const length = Number(payload.subarray(offset, space).toString("ascii"));
    if (!Number.isInteger(length) || length <= space - offset + 1) {
      throw new ArchiveError("archive_invalid");
    }
    const record = payload
      .subarray(space + 1, offset + length - 1)
      .toString("utf8");
    const equals = record.indexOf("=");
    if (equals < 1 || offset + length > payload.length) {
      throw new ArchiveError("archive_invalid");
    }
    values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

export async function extractTarGz(
  archivePath: string,
  destination: string,
  signal: AbortSignal,
  options: { allowSafeSymlinks?: boolean; maximumBytes?: number } = {},
): Promise<string> {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const source = createReadStream(archivePath);
  const gzip = createGunzip();
  source.pipe(gzip);
  const iterator = gzip[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  let finished = false;
  let totalBytes = 0;
  let archiveRoot: string | undefined;

  const take = async (length: number): Promise<Buffer> => {
    while (pending.length < length && !finished) {
      signal.throwIfAborted();
      const next = await iterator.next();
      if (next.done === true) {
        finished = true;
      } else {
        pending =
          pending.length === 0
            ? Buffer.from(next.value)
            : Buffer.concat([pending, next.value]);
      }
    }
    if (pending.length < length) throw new ArchiveError("archive_truncated");
    const result = pending.subarray(0, length);
    pending = pending.subarray(length);
    return result;
  };

  const readMetadata = async (length: number): Promise<Buffer> => {
    if (length > 1024 * 1024) throw new ArchiveError("archive_too_large");
    const value = await take(length);
    await take((512 - (length % 512)) % 512);
    return value;
  };

  try {
    let nextPath: string | undefined;
    let nextLinkPath: string | undefined;
    for (;;) {
      signal.throwIfAborted();
      const header = await take(512);
      if (header.every((byte) => byte === 0)) break;
      const expectedChecksum = archiveNumber(header, 148, 8);
      let checksum = 0;
      for (let index = 0; index < header.length; index += 1) {
        checksum +=
          index >= 148 && index < 156 ? 32 : (header[index] as number);
      }
      if (checksum !== expectedChecksum)
        throw new ArchiveError("archive_invalid");

      const size = archiveNumber(header, 124, 12);
      const type = header[156] as number;
      const prefix = archiveText(header, 345, 155);
      const plainName = archiveText(header, 0, 100);
      const headerPath = prefix === "" ? plainName : `${prefix}/${plainName}`;
      const headerLink = archiveText(header, 157, 100);

      if (type === 120 || type === 103) {
        const pax = parsePax(await readMetadata(size));
        if (type === 120) {
          nextPath = pax.path;
          nextLinkPath = pax.linkpath;
        } else if (pax.path !== undefined || pax.linkpath !== undefined) {
          throw new ArchiveError("archive_invalid");
        }
        continue;
      }
      if (type === 76 || type === 75) {
        const value = (await readMetadata(size))
          .toString("utf8")
          .replace(/\0.*$/s, "");
        if (type === 76) nextPath = value;
        else nextLinkPath = value;
        continue;
      }

      const rawName = nextPath ?? headerPath;
      const name = safeArchivePath(
        rawName.endsWith("/") ? rawName.slice(0, -1) : rawName,
      );
      const linkName = nextLinkPath ?? headerLink;
      nextPath = undefined;
      nextLinkPath = undefined;
      const root = name.split("/")[0] as string;
      if (archiveRoot === undefined) archiveRoot = root;
      if (archiveRoot !== root)
        throw new ArchiveError("archive_multiple_roots");
      const output = join(destination, ...name.split("/"));
      totalBytes += size;
      if (totalBytes > (options.maximumBytes ?? 512 * 1024 * 1024)) {
        throw new ArchiveError("archive_too_large");
      }

      if (type === 53) {
        if (size !== 0) throw new ArchiveError("archive_invalid");
        await mkdir(output, { recursive: true, mode: 0o755 });
        continue;
      }
      await mkdir(dirname(output), { recursive: true, mode: 0o755 });
      if (type === 50) {
        if (size !== 0 || options.allowSafeSymlinks !== true) {
          throw new ArchiveError("archive_symlink", name);
        }
        if (
          isAbsolute(linkName) ||
          win32.isAbsolute(linkName) ||
          linkName.includes("\0")
        ) {
          throw new ArchiveError("archive_symlink", name);
        }
        const target = resolve(dirname(output), linkName);
        const relative = target.slice(resolve(destination).length + 1);
        if (
          !target.startsWith(`${resolve(destination)}${sep}`) ||
          relative.split(sep)[0] !== archiveRoot
        ) {
          throw new ArchiveError("archive_symlink", name);
        }
        await symlink(linkName, output);
        continue;
      }
      if (type !== 0 && type !== 48) {
        throw new ArchiveError(
          type === 49 ? "archive_hardlink" : "archive_special",
          `${type}:${name}`,
        );
      }

      const file = await open(
        output,
        "wx",
        archiveNumber(header, 100, 8) & 0o777,
      );
      try {
        let remaining = size;
        while (remaining > 0) {
          signal.throwIfAborted();
          const chunk = await take(Math.min(64 * 1024, remaining));
          await file.write(chunk);
          remaining -= chunk.length;
        }
      } finally {
        await file.close();
      }
      await take((512 - (size % 512)) % 512);
    }
  } finally {
    source.destroy();
    gzip.destroy();
  }
  if (archiveRoot === undefined) throw new ArchiveError("archive_empty");
  return archiveRoot;
}

export async function validateZip(archivePath: string): Promise<void> {
  const data = await readFile(archivePath);
  let eocd = -1;
  for (
    let offset = data.length - 22;
    offset >= Math.max(0, data.length - 65_557);
    offset -= 1
  ) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new ArchiveError("archive_invalid");
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    if (data.readUInt32LE(offset) !== 0x02014b50) {
      throw new ArchiveError("archive_invalid");
    }
    const flags = data.readUInt16LE(offset + 8);
    const method = data.readUInt16LE(offset + 10);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const external = data.readUInt32LE(offset + 38);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    safeArchivePath(name.endsWith("/") ? name.slice(0, -1) : name);
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) {
      throw new ArchiveError("archive_invalid");
    }
    if (((external >>> 16) & 0o170000) === 0o120000) {
      throw new ArchiveError("archive_symlink", name);
    }
    if (
      localOffset + 30 > data.length ||
      data.readUInt32LE(localOffset) !== 0x04034b50 ||
      data
        .subarray(localOffset + 30, localOffset + 30 + nameLength)
        .toString("utf8") !== name
    ) {
      throw new ArchiveError("archive_invalid");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
}
