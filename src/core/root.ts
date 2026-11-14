import { fileURLToPath } from "node:url";

/** Absolute path of the package root (the directory that holds `package.json`). */
export function packageRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}
