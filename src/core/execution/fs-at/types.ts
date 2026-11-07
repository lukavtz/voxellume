export const NATIVE_DIRFD_UNAVAILABLE =
  "execution.native_dirfd_unavailable" as const;

export type NativeDirFdProbe =
  | {
      ok: true;
      backend: "koffi";
      platform: "darwin" | "linux" | "win32";
      architecture: string;
    }
  | {
      ok: false;
      code: typeof NATIVE_DIRFD_UNAVAILABLE;
      detail: string;
    };

export interface NativeRoot {
  readonly realPath: string;
}

export type RootEntryKind = "file" | "directory" | "other";

export interface RootStat {
  readonly kind: RootEntryKind;
  readonly revision: string;
  readonly nlink: number;
  readonly size: number;
}

export interface RootFile {
  readonly contents: Buffer;
  readonly revision: string;
  readonly stat: RootStat;
}

export interface RootRenamePaths {
  readonly targetPath: string;
  readonly temporaryPath: string;
}

export interface WriteRootFileRequest {
  readonly path: string;
  readonly contents: Buffer;
  readonly expectedRevision: string | null;
  readonly mode?: number;
  readonly beforeRename?: (paths: RootRenamePaths) => void | Promise<void>;
}

export class NativeDirFdError extends Error {
  readonly code: string;
  readonly detail: string | undefined;
  readonly errno: number | undefined;

  constructor(code: string, message: string, detail?: string, errno?: number) {
    super(message);
    this.name = "NativeDirFdError";
    this.code = code;
    this.detail = detail;
    this.errno = errno;
  }
}
