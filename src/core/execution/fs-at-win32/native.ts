import { createRequire } from "node:module";

import type {
  CloseHandle,
  CreateFileW,
  GetLastError,
  Koffi,
  LockFileEx,
  NtCreateFile,
  NtFlushBuffersFileEx,
  NtQueryInformationFile,
  NtReadFile,
  NtSetInformationFile,
  NtWriteFile,
  StructType,
  UnlockFileEx,
  Win32Native,
  Win32Types,
} from "./types.ts";

const require = createRequire(import.meta.url);

export function loadWin32Native(): Win32Native {
  if (process.platform !== "win32") {
    throw new Error(`NTDLL backend cannot load on ${process.platform}`);
  }

  const koffiEntry = require.resolve("koffi");
  const koffiRequire = createRequire(koffiEntry);
  koffiRequire.resolve(`@koromix/koffi-${process.platform}-${process.arch}`);
  const ffi = require("koffi") as Koffi;
  const ntdll = ffi.load("ntdll.dll");
  const kernel32 = ffi.load("kernel32.dll");
  const HANDLE = ffi.pointer("HANDLE", ffi.opaque());
  const UNICODE_STRING = ffi.struct("UNICODE_STRING", {
    Length: "uint16",
    MaximumLength: "uint16",
    Buffer: "uint16_t *",
  });
  const OBJECT_ATTRIBUTES = ffi.struct("OBJECT_ATTRIBUTES", {
    Length: "uint32",
    RootDirectory: HANDLE,
    ObjectName: ffi.pointer(UNICODE_STRING),
    Attributes: "uint32",
    SecurityDescriptor: "void *",
    SecurityQualityOfService: "void *",
  });
  const IO_STATUS_BLOCK = ffi.struct("IO_STATUS_BLOCK", {
    Status: "int32",
    Information: "uintptr_t",
  });
  const FILE_ATTRIBUTE_TAG_INFORMATION = ffi.struct(
    "FILE_ATTRIBUTE_TAG_INFORMATION",
    {
      FileAttributes: "uint32",
      ReparseTag: "uint32",
    },
  );
  const FILE_STANDARD_INFORMATION = ffi.struct("FILE_STANDARD_INFORMATION", {
    AllocationSize: "int64_t",
    EndOfFile: "int64_t",
    NumberOfLinks: "uint32",
    DeletePending: "uint8_t",
    Directory: "uint8_t",
  });
  const FILE_BASIC_INFORMATION = ffi.struct("FILE_BASIC_INFORMATION", {
    CreationTime: "int64_t",
    LastAccessTime: "int64_t",
    LastWriteTime: "int64_t",
    ChangeTime: "int64_t",
    FileAttributes: "uint32",
  });
  const FILE_ID_INFORMATION = ffi.struct("FILE_ID_INFORMATION", {
    VolumeSerialNumber: "uint64_t",
    FileId: ffi.array("uint8_t", 16),
  });
  const FILE_DISPOSITION_INFORMATION_EX = ffi.struct(
    "FILE_DISPOSITION_INFORMATION_EX",
    {
      Flags: "uint32",
    },
  );
  const FILE_RENAME_INFORMATION_HEAD = ffi.struct(
    "FILE_RENAME_INFORMATION_HEAD",
    {
      Flags: "uint32",
      RootDirectory: HANDLE,
      FileNameLength: "uint32",
    },
  );
  const types: Win32Types = {
    UNICODE_STRING,
    OBJECT_ATTRIBUTES,
    IO_STATUS_BLOCK,
    FILE_ATTRIBUTE_TAG_INFORMATION,
    FILE_STANDARD_INFORMATION,
    FILE_BASIC_INFORMATION,
    FILE_ID_INFORMATION,
    FILE_DISPOSITION_INFORMATION_EX,
    FILE_RENAME_INFORMATION_HEAD,
  };

  const sizes: readonly [StructType, number][] = [
    [UNICODE_STRING, 16],
    [OBJECT_ATTRIBUTES, 48],
    [IO_STATUS_BLOCK, 16],
    [FILE_ATTRIBUTE_TAG_INFORMATION, 8],
    [FILE_STANDARD_INFORMATION, 24],
    [FILE_BASIC_INFORMATION, 40],
    [FILE_ID_INFORMATION, 24],
    [FILE_DISPOSITION_INFORMATION_EX, 4],
    [FILE_RENAME_INFORMATION_HEAD, 24],
  ];
  for (const [type, expected] of sizes) {
    if (ffi.sizeof(type) !== expected) {
      throw new Error(`${type.name} size ${ffi.sizeof(type)} != ${expected}`);
    }
  }
  const offsets: readonly [StructType, string, number][] = [
    [UNICODE_STRING, "Buffer", 8],
    [OBJECT_ATTRIBUTES, "RootDirectory", 8],
    [OBJECT_ATTRIBUTES, "ObjectName", 16],
    [OBJECT_ATTRIBUTES, "Attributes", 24],
    [OBJECT_ATTRIBUTES, "SecurityDescriptor", 32],
    [OBJECT_ATTRIBUTES, "SecurityQualityOfService", 40],
    [IO_STATUS_BLOCK, "Information", 8],
    [FILE_STANDARD_INFORMATION, "NumberOfLinks", 16],
    [FILE_STANDARD_INFORMATION, "DeletePending", 20],
    [FILE_STANDARD_INFORMATION, "Directory", 21],
    [FILE_BASIC_INFORMATION, "FileAttributes", 32],
    [FILE_ID_INFORMATION, "FileId", 8],
    [FILE_RENAME_INFORMATION_HEAD, "RootDirectory", 8],
    [FILE_RENAME_INFORMATION_HEAD, "FileNameLength", 16],
  ];
  for (const [type, member, expected] of offsets) {
    if (ffi.offsetof(type, member) !== expected) {
      throw new Error(
        `${type.name}.${member} offset ${ffi.offsetof(type, member)} != ${expected}`,
      );
    }
  }

  return {
    ffi,
    types,
    NtCreateFile: ntdll.func(
      "int32 __stdcall NtCreateFile(_Out_ HANDLE *FileHandle, uint32_t DesiredAccess, OBJECT_ATTRIBUTES *ObjectAttributes, _Out_ IO_STATUS_BLOCK *IoStatusBlock, int64_t *AllocationSize, uint32_t FileAttributes, uint32_t ShareAccess, uint32_t CreateDisposition, uint32_t CreateOptions, void *EaBuffer, uint32_t EaLength)",
    ) as NtCreateFile,
    NtQueryInformationFile: ntdll.func(
      "int32 __stdcall NtQueryInformationFile(HANDLE FileHandle, _Out_ IO_STATUS_BLOCK *IoStatusBlock, void *FileInformation, uint32_t Length, uint32_t FileInformationClass)",
    ) as NtQueryInformationFile,
    NtSetInformationFile: ntdll.func(
      "int32 __stdcall NtSetInformationFile(HANDLE FileHandle, _Out_ IO_STATUS_BLOCK *IoStatusBlock, void *FileInformation, uint32_t Length, uint32_t FileInformationClass)",
    ) as NtSetInformationFile,
    NtReadFile: ntdll.func(
      "int32 __stdcall NtReadFile(HANDLE FileHandle, HANDLE Event, void *ApcRoutine, void *ApcContext, _Out_ IO_STATUS_BLOCK *IoStatusBlock, void *Buffer, uint32_t Length, int64_t *ByteOffset, uint32_t *Key)",
    ) as NtReadFile,
    NtWriteFile: ntdll.func(
      "int32 __stdcall NtWriteFile(HANDLE FileHandle, HANDLE Event, void *ApcRoutine, void *ApcContext, _Out_ IO_STATUS_BLOCK *IoStatusBlock, void *Buffer, uint32_t Length, int64_t *ByteOffset, uint32_t *Key)",
    ) as NtWriteFile,
    NtFlushBuffersFileEx: ntdll.func(
      "int32 __stdcall NtFlushBuffersFileEx(HANDLE FileHandle, uint32_t Flags, void *Parameters, uint32_t ParametersSize, _Out_ IO_STATUS_BLOCK *IoStatusBlock)",
    ) as NtFlushBuffersFileEx,
    CreateFileW: kernel32.func(
      "HANDLE __stdcall CreateFileW(const char16_t *lpFileName, uint32_t dwDesiredAccess, uint32_t dwShareMode, void *lpSecurityAttributes, uint32_t dwCreationDisposition, uint32_t dwFlagsAndAttributes, HANDLE hTemplateFile)",
    ) as CreateFileW,
    CloseHandle: kernel32.func(
      "bool __stdcall CloseHandle(HANDLE hObject)",
    ) as CloseHandle,
    GetLastError: kernel32.func(
      "uint32 __stdcall GetLastError()",
    ) as GetLastError,
    LockFileEx: kernel32.func(
      "bool __stdcall LockFileEx(HANDLE hFile, uint32 dwFlags, uint32 dwReserved, uint32 nNumberOfBytesToLockLow, uint32 nNumberOfBytesToLockHigh, void *lpOverlapped)",
    ) as LockFileEx,
    UnlockFileEx: kernel32.func(
      "bool __stdcall UnlockFileEx(HANDLE hFile, uint32 dwReserved, uint32 nNumberOfBytesToUnlockLow, uint32 nNumberOfBytesToUnlockHigh, void *lpOverlapped)",
    ) as UnlockFileEx,
  };
}
