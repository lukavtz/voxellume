import { canonicalJson, sha256 } from "../../targets/canonical-json.ts";
import type { ModSpec } from "../mod-spec.ts";
import type {
  TransactionCandidate,
  TransactionFile,
  TreeSnapshot,
} from "../transaction-types.ts";
import { safeRelativePath } from "./paths.ts";
import { MOD_SPEC_PATH, TransactionFault } from "./state.ts";

export function applyPaths(candidate: TransactionCandidate): string[] {
  return [
    ...new Set([
      ...candidate.manifest.files.map((file) => file.path),
      MOD_SPEC_PATH,
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

export function expectedBaseHash(
  candidate: TransactionCandidate,
  path: string,
): string | null {
  if (path === MOD_SPEC_PATH) {
    return candidate.manifest.baseFileSha256[path] ?? null;
  }
  const file = candidate.manifest.files.find((entry) => entry.path === path);
  if (!file)
    throw new TransactionFault(
      "recovery_required",
      `Unowned journal path: ${path}`,
    );
  return file.baseSha256;
}

export function expectedStagedHash(
  candidate: TransactionCandidate,
  path: string,
): string | null {
  if (path === MOD_SPEC_PATH) return sha256(canonicalJson(candidate.modSpec));
  const file = candidate.manifest.files.find((entry) => entry.path === path);
  if (!file)
    throw new TransactionFault(
      "recovery_required",
      `Unowned journal path: ${path}`,
    );
  return file.sha256 as string | null;
}

export function generatedFiles(
  base: TreeSnapshot | null,
  staging: TreeSnapshot,
  modSpec: ModSpec,
  artifacts: ReadonlySet<string>,
): TransactionFile[] {
  const owned = new Set<string>();
  for (const unit of modSpec.implementationUnits) {
    const sourcePaths = unit.sourcePaths;
    if (Array.isArray(sourcePaths)) {
      for (const path of sourcePaths) {
        if (typeof path === "string") owned.add(safeRelativePath(path));
      }
    }
  }
  const assets = modSpec.assets;
  if (Array.isArray(assets)) {
    for (const entry of assets) {
      if (entry === null || typeof entry !== "object") continue;
      const asset = entry as Record<string, unknown>;
      for (const key of ["source", "generated"]) {
        const path = asset[key];
        if (typeof path === "string") owned.add(safeRelativePath(path));
      }
    }
  }

  const paths = new Set([...Object.keys(base ?? {}), ...Object.keys(staging)]);
  const files: TransactionFile[] = [];
  for (const path of paths) {
    if (path === MOD_SPEC_PATH) continue;
    const baseHash = base?.[path] ?? null;
    const stagedHash = staging[path] ?? null;
    if (baseHash === stagedHash) continue;
    if (!owned.has(path) && !artifacts.has(path)) {
      throw new TransactionFault(
        "ownership_violation",
        `Generator changed an unowned path: ${path}`,
      );
    }
    files.push({
      path,
      sha256: stagedHash as string,
      baseSha256: baseHash,
      owner: "generated",
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
