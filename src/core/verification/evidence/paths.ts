import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

import { fail } from "./types.ts";

export function component(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    fail("invalid_evidence_path", `Invalid ${label}.`);
  }
}

export function transactionComponent(value: string): void {
  component(value, "transaction ID");
  if (resolve(value) !== value && basename(value) !== value) {
    fail("invalid_transaction_id", "Invalid transaction ID.");
  }
}

function resolvedWithExistingAncestor(path: string): Promise<string> {
  const missing: string[] = [];
  let current = resolve(path);
  const search = async (): Promise<string> => {
    for (;;) {
      try {
        const existing = await realpath(current);
        return join(existing, ...missing.reverse());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = dirname(current);
        if (parent === current) throw error;
        missing.push(basename(current));
        current = parent;
      }
    }
  };
  return search();
}

export async function assertEvidenceRoot(
  evidenceRoot: string,
  agentWritableRoots: string[],
): Promise<void> {
  const destination = await resolvedWithExistingAncestor(evidenceRoot);
  for (const agentRoot of agentWritableRoots) {
    const root = await realpath(agentRoot);
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    if (destination === root || destination.startsWith(prefix)) {
      fail(
        "unauthorized_evidence_root",
        "Evidence must be stored outside every agent-writable root.",
      );
    }
  }
}
