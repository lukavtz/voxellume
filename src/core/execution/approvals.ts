import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export interface EulaApproval {
  url: string;
  approvedAt: string;
}

export interface NetworkApproval {
  host: string;
  purpose: string;
  cacheIdentity: string;
  approvedAt: string;
}

export interface Approvals {
  schemaVersion: "approvals-1.0.0";
  eula: EulaApproval | null;
  network: NetworkApproval[];
}

interface ConfigRoot {
  configRoot: string;
}

const approvalLocks = new Map<string, Promise<void>>();

async function withApprovalLock<T>(
  configRoot: string,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(configRoot, { recursive: true });
  const canonicalRoot = await realpath(configRoot);
  const previous = approvalLocks.get(canonicalRoot) ?? Promise.resolve();
  const current = Promise.withResolvers<void>();
  const tail = previous.then(() => current.promise);
  approvalLocks.set(canonicalRoot, tail);
  await previous;
  try {
    return await action();
  } finally {
    current.resolve();
    if (approvalLocks.get(canonicalRoot) === tail)
      approvalLocks.delete(canonicalRoot);
  }
}

class ApprovalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function emptyApprovals(): Approvals {
  return { schemaVersion: "approvals-1.0.0", eula: null, network: [] };
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApprovalError("invalid_approvals", "Invalid approvals file.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, i) => key !== expected[i])
  ) {
    throw new ApprovalError("invalid_approvals", "Invalid approvals file.");
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseApprovals(value: unknown): Approvals {
  const root = record(value);
  exactKeys(root, ["schemaVersion", "eula", "network"]);
  if (
    root.schemaVersion !== "approvals-1.0.0" ||
    !Array.isArray(root.network)
  ) {
    throw new ApprovalError("invalid_approvals", "Invalid approvals file.");
  }

  let eula: EulaApproval | null = null;
  if (root.eula !== null) {
    const entry = record(root.eula);
    exactKeys(entry, ["url", "approvedAt"]);
    if (!nonEmptyString(entry.url) || !nonEmptyString(entry.approvedAt)) {
      throw new ApprovalError("invalid_approvals", "Invalid EULA approval.");
    }
    eula = { url: entry.url, approvedAt: entry.approvedAt };
  }

  const network = root.network.map((value) => {
    const entry = record(value);
    exactKeys(entry, ["host", "purpose", "cacheIdentity", "approvedAt"]);
    if (
      !nonEmptyString(entry.host) ||
      !nonEmptyString(entry.purpose) ||
      !nonEmptyString(entry.cacheIdentity) ||
      !nonEmptyString(entry.approvedAt)
    ) {
      throw new ApprovalError("invalid_approvals", "Invalid network approval.");
    }
    return {
      host: entry.host,
      purpose: entry.purpose,
      cacheIdentity: entry.cacheIdentity,
      approvedAt: entry.approvedAt,
    };
  });
  return { schemaVersion: "approvals-1.0.0", eula, network };
}

export async function loadApprovals(options: ConfigRoot): Promise<Approvals> {
  try {
    const text = await readFile(
      join(options.configRoot, "approvals.json"),
      "utf8",
    );
    return parseApprovals(JSON.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return emptyApprovals();
    if (error instanceof SyntaxError) {
      throw new ApprovalError("invalid_approvals", "Invalid approvals JSON.");
    }
    throw error;
  }
}

async function saveApprovals(
  configRoot: string,
  approvals: Approvals,
): Promise<void> {
  await mkdir(configRoot, { recursive: true });
  const path = join(configRoot, "approvals.json");
  const temporary = join(configRoot, `.approvals.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(approvals, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function recordEulaApproval(
  options: ConfigRoot & { eulaUrl: string; approvedAt: string },
): Promise<void> {
  const eulaUrl = options.eulaUrl;
  if (!nonEmptyString(eulaUrl) || !nonEmptyString(options.approvedAt)) {
    throw new ApprovalError(
      "invalid_approval",
      "EULA URL and approval time are required.",
    );
  }
  await withApprovalLock(options.configRoot, async () => {
    const approvals = await loadApprovals(options);
    approvals.eula = { url: eulaUrl, approvedAt: options.approvedAt };
    await saveApprovals(options.configRoot, approvals);
  });
}

export async function recordNetworkApproval(
  options: ConfigRoot & NetworkApproval,
): Promise<void> {
  if (
    !nonEmptyString(options.host) ||
    !nonEmptyString(options.purpose) ||
    !nonEmptyString(options.cacheIdentity) ||
    !nonEmptyString(options.approvedAt)
  ) {
    throw new ApprovalError(
      "invalid_approval",
      "Complete network approval scope is required.",
    );
  }
  await withApprovalLock(options.configRoot, async () => {
    const approvals = await loadApprovals(options);
    const approval = {
      host: options.host,
      purpose: options.purpose,
      cacheIdentity: options.cacheIdentity,
      approvedAt: options.approvedAt,
    };
    const index = approvals.network.findIndex(
      (entry) =>
        entry.host === approval.host &&
        entry.purpose === approval.purpose &&
        entry.cacheIdentity === approval.cacheIdentity,
    );
    if (index === -1) approvals.network.push(approval);
    else approvals.network[index] = approval;
    await saveApprovals(options.configRoot, approvals);
  });
}

export async function assertEulaApproved(
  options: ConfigRoot & { eulaUrl: string },
): Promise<void> {
  const approvals = await loadApprovals(options);
  if (approvals.eula?.url !== options.eulaUrl) {
    throw new ApprovalError(
      "eula_not_approved",
      "Minecraft EULA approval is required.",
    );
  }
}

export async function assertNetworkApproved(
  options: ConfigRoot & Omit<NetworkApproval, "approvedAt">,
): Promise<void> {
  const approvals = await loadApprovals(options);
  const approved = approvals.network.some(
    (entry) =>
      entry.host === options.host &&
      entry.purpose === options.purpose &&
      entry.cacheIdentity === options.cacheIdentity,
  );
  if (!approved) {
    throw new ApprovalError(
      "network_not_approved",
      "Network approval is required for this host, purpose, and cache.",
    );
  }
}
