export { probeWin32NativeDirFd } from "./fs-at-win32/probe.ts";
export { closeWin32Root, openWin32Root } from "./fs-at-win32/traversal.ts";
export {
  readWin32RootFile,
  resolveWin32RootPath,
  statWin32RootFile,
} from "./fs-at-win32/read.ts";
export { writeWin32RootFileAtomic } from "./fs-at-win32/write.ts";
