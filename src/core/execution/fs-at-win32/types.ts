import type koffi from "koffi";
import type { TypeObject } from "koffi";

import { NativeDirFdError, type NativeRoot } from "../fs-at.ts";

export type Koffi = typeof koffi;
export type StructType = TypeObject;
export type Handle = bigint;
export type IoStatus = { Status: number; Information: number | bigint };

export type NtCreateFile = (
  fileHandle: [Handle | null],
  desiredAccess: number,
  objectAttributes: unknown,
  ioStatusBlock: IoStatus,
  allocationSize: null,
  fileAttributes: number,
  shareAccess: number,
  createDisposition: number,
  createOptions: number,
  eaBuffer: null,
  eaLength: number,
) => number;
export type NtQueryInformationFile = (
  fileHandle: Handle,
  ioStatusBlock: IoStatus,
  fileInformation: Buffer,
  length: number,
  fileInformationClass: number,
) => number;
export type NtSetInformationFile = (
  fileHandle: Handle,
  ioStatusBlock: IoStatus,
  fileInformation: Buffer,
  length: number,
  fileInformationClass: number,
) => number;
export type NtReadFile = (
  fileHandle: Handle,
  event: null,
  apcRoutine: null,
  apcContext: null,
  ioStatusBlock: IoStatus,
  buffer: Buffer,
  length: number,
  byteOffset: BigInt64Array,
  key: null,
) => number;
export type NtWriteFile = NtReadFile;
export type NtFlushBuffersFileEx = (
  fileHandle: Handle,
  flags: number,
  parameters: null,
  parametersSize: number,
  ioStatusBlock: IoStatus,
) => number;
export type CreateFileW = (
  fileName: string,
  desiredAccess: number,
  shareMode: number,
  securityAttributes: null,
  creationDisposition: number,
  flagsAndAttributes: number,
  templateFile: null,
) => Handle | null;
export type CloseHandle = (handle: Handle) => boolean;
export type GetLastError = () => number;
export type LockFileEx = (
  handle: Handle,
  flags: number,
  reserved: number,
  numberOfBytesLow: number,
  numberOfBytesHigh: number,
  overlapped: Buffer,
) => boolean;
export type UnlockFileEx = (
  handle: Handle,
  reserved: number,
  numberOfBytesLow: number,
  numberOfBytesHigh: number,
  overlapped: Buffer,
) => boolean;

export interface Win32Types {
  readonly UNICODE_STRING: StructType;
  readonly OBJECT_ATTRIBUTES: StructType;
  readonly IO_STATUS_BLOCK: StructType;
  readonly FILE_ATTRIBUTE_TAG_INFORMATION: StructType;
  readonly FILE_STANDARD_INFORMATION: StructType;
  readonly FILE_BASIC_INFORMATION: StructType;
  readonly FILE_ID_INFORMATION: StructType;
  readonly FILE_DISPOSITION_INFORMATION_EX: StructType;
  readonly FILE_RENAME_INFORMATION_HEAD: StructType;
}

export interface Win32Native {
  readonly ffi: Koffi;
  readonly types: Win32Types;
  readonly NtCreateFile: NtCreateFile;
  readonly NtQueryInformationFile: NtQueryInformationFile;
  readonly NtSetInformationFile: NtSetInformationFile;
  readonly NtReadFile: NtReadFile;
  readonly NtWriteFile: NtWriteFile;
  readonly NtFlushBuffersFileEx: NtFlushBuffersFileEx;
  readonly CreateFileW: CreateFileW;
  readonly CloseHandle: CloseHandle;
  readonly GetLastError: GetLastError;
  readonly LockFileEx: LockFileEx;
  readonly UnlockFileEx: UnlockFileEx;
}

export const FILE_READ_DATA = 0x0001;
export const FILE_WRITE_DATA = 0x0002;
export const FILE_APPEND_DATA = 0x0004;
export const FILE_TRAVERSE = 0x0020;
export const FILE_READ_ATTRIBUTES = 0x0080;
export const DELETE = 0x00010000;
export const GENERIC_READ = 0x80000000;
export const SYNCHRONIZE = 0x00100000;
export const LOCKFILE_EXCLUSIVE_LOCK = 0x2;
export const FILE_SHARE_READ_WRITE_DELETE = 0x7;
export const FILE_ATTRIBUTE_DIRECTORY = 0x10;
export const FILE_ATTRIBUTE_DEVICE = 0x40;
export const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
export const FILE_CREATE = 2;
export const FILE_OPEN = 1;
export const OPEN_EXISTING = 3;
export const FILE_NON_DIRECTORY_FILE = 0x40;
export const FILE_SYNCHRONOUS_IO_NONALERT = 0x20;
export const FILE_OPEN_REPARSE_POINT = 0x00200000;
export const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
export const FILE_DISPOSITION_DELETE = 0x1;
export const FILE_DISPOSITION_POSIX_SEMANTICS = 0x2;
export const FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE = 0x10;
export const FILE_RENAME_REPLACE_IF_EXISTS = 0x1;
export const FILE_RENAME_POSIX_SEMANTICS = 0x2;
export const FILE_RENAME_IGNORE_READONLY_ATTRIBUTE = 0x40;
export const FileBasicInformation = 4;
export const FileStandardInformation = 5;
export const FileAttributeTagInformation = 35;
export const FileIdInformation = 59;
export const FileDispositionInformationEx = 64;
export const FileRenameInformationEx = 65;
export const STATUS_END_OF_FILE = 0xc0000011;
export const STATUS_OBJECT_NAME_NOT_FOUND = 0xc0000034;
export const IO_CHUNK_SIZE = 1024 * 1024;
export const INVALID_HANDLE_VALUES = new Set<Handle>([
  -1n,
  0n,
  0xffffffffffffffffn,
]);

export class Win32Root {
  readonly realPath: string;
  readonly handle: Handle;
  closed = false;

  constructor(realPath: string, handle: Handle) {
    this.realPath = realPath;
    this.handle = handle;
  }
}

export function root(value: NativeRoot): Win32Root {
  if (!(value instanceof Win32Root)) {
    throw new NativeDirFdError(
      "unauthorized_root",
      "Root was not opened by openRoot",
    );
  }
  if (value.closed) {
    throw new NativeDirFdError("root_closed", "Root directory is closed");
  }
  return value;
}
