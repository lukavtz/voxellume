import { NativeDirFdError } from "../fs-at.ts";
import { checkStatus, errorDetail, nativeCall } from "./probe.ts";
import {
  FILE_ATTRIBUTE_DIRECTORY,
  FILE_ATTRIBUTE_REPARSE_POINT,
  FILE_DISPOSITION_DELETE,
  FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
  FILE_DISPOSITION_POSIX_SEMANTICS,
  FileAttributeTagInformation,
  FileDispositionInformationEx,
  type Handle,
  type IoStatus,
  type Win32Native,
} from "./types.ts";

export function utf16Units(value: string): number[] {
  return Array.from({ length: value.length }, (_, index) =>
    value.charCodeAt(index),
  );
}

export function withObjectAttributes<T>(
  owner: Win32Native,
  parent: Handle,
  name: string,
  call: (attributes: unknown) => T,
): T {
  const units = utf16Units(name);
  const namePointer = owner.ffi.alloc("uint16_t", units.length + 1);
  let unicodeString: unknown;
  let attributes: unknown;
  try {
    owner.ffi.encode(namePointer, "uint16_t", units, units.length);
    unicodeString = owner.ffi.alloc(owner.types.UNICODE_STRING, 1);
    owner.ffi.encode(unicodeString, owner.types.UNICODE_STRING, {
      Length: units.length * 2,
      MaximumLength: units.length * 2,
      Buffer: namePointer,
    });
    attributes = owner.ffi.alloc(owner.types.OBJECT_ATTRIBUTES, 1);
    owner.ffi.encode(attributes, owner.types.OBJECT_ATTRIBUTES, {
      Length: 48,
      RootDirectory: parent,
      ObjectName: unicodeString,
      Attributes: 0,
      SecurityDescriptor: null,
      SecurityQualityOfService: null,
    });
    return call(attributes);
  } finally {
    if (attributes !== undefined) owner.ffi.free(attributes);
    if (unicodeString !== undefined) owner.ffi.free(unicodeString);
    owner.ffi.free(namePointer);
  }
}

export function queryInformation(
  owner: Win32Native,
  handle: Handle,
  informationClass: number,
  size: number,
  path: string,
): Buffer {
  const information = Buffer.alloc(size);
  const ioStatus: IoStatus = { Status: 0, Information: 0 };
  const status = nativeCall("NtQueryInformationFile", path, () =>
    owner.NtQueryInformationFile(
      handle,
      ioStatus,
      information,
      size,
      informationClass,
    ),
  );
  checkStatus("NtQueryInformationFile", path, status);
  return information;
}

export function validateOpenedHandle(
  owner: Win32Native,
  handle: Handle,
  path: string,
  directory: boolean | null,
): void {
  const tag = queryInformation(
    owner,
    handle,
    FileAttributeTagInformation,
    8,
    path,
  );
  const attributes = tag.readUInt32LE(0);
  if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0) {
    throw new NativeDirFdError(
      "unsafe_symlink",
      `Reparse point is not allowed: ${path}`,
    );
  }
  if (
    directory !== null &&
    ((attributes & FILE_ATTRIBUTE_DIRECTORY) !== 0) !== directory
  ) {
    throw new NativeDirFdError(
      directory ? "not_directory" : "not_regular_file",
      directory ? `Not a directory: ${path}` : `Not a regular file: ${path}`,
    );
  }
}

export function setDisposition(
  owner: Win32Native,
  handle: Handle,
  path: string,
): void {
  const information = Buffer.alloc(4);
  information.writeUInt32LE(
    FILE_DISPOSITION_DELETE |
      FILE_DISPOSITION_POSIX_SEMANTICS |
      FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
  );
  const ioStatus: IoStatus = { Status: 0, Information: 0 };
  const status = nativeCall(
    "NtSetInformationFile(FileDispositionInformationEx)",
    path,
    () =>
      owner.NtSetInformationFile(
        handle,
        ioStatus,
        information,
        information.length,
        FileDispositionInformationEx,
      ),
  );
  checkStatus(
    "NtSetInformationFile(FileDispositionInformationEx)",
    path,
    status,
  );
}

export function splitRootPath(realPath: string): {
  prefix: string;
  parts: string[];
} {
  const extendedDrive = /^([A-Za-z]:\\)(.*)$/.exec(
    realPath.replace(/^\\\\\?\\/i, ""),
  );
  if (extendedDrive !== null) {
    return {
      prefix: `\\\\?\\${extendedDrive[1]}`,
      parts: extendedDrive[2]!.split("\\").filter(Boolean),
    };
  }
  const unc = /^(?:\\\\\?\\UNC\\|\\\\)([^\\]+\\[^\\]+)\\?(.*)$/i.exec(realPath);
  if (unc !== null) {
    return {
      prefix: `\\\\?\\UNC\\${unc[1]}\\`,
      parts: unc[2]!.split("\\").filter(Boolean),
    };
  }
  throw new NativeDirFdError(
    "invalid_root",
    `Unsupported Windows root path: ${realPath}`,
  );
}

export function wrapNodeError(
  error: unknown,
  operation: string,
  path: string,
): NativeDirFdError {
  if (error instanceof NativeDirFdError) return error;
  const nodeError = error as NodeJS.ErrnoException;
  const code =
    nodeError.code === "ENOENT"
      ? "not_found"
      : nodeError.code === "ELOOP"
        ? "unsafe_symlink"
        : nodeError.code === "EEXIST"
          ? "already_exists"
          : nodeError.code === "ENOTDIR"
            ? "not_directory"
            : "native_io_error";
  return new NativeDirFdError(
    code,
    `${operation} failed for ${path}: ${code}`,
    errorDetail(error),
  );
}
