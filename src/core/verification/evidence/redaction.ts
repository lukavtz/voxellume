import { fail } from "./types.ts";

const REDACTED = "[REDACTED]";

export function redactText(value: string, secrets: string[]): string {
  let redacted = value;
  for (const secret of secrets)
    redacted = redacted.split(secret).join(REDACTED);
  return redacted;
}

export function redactValue(
  value: unknown,
  secrets: string[],
  seen = new Set<object>(),
): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") {
    fail("invalid_evidence", "Evidence values must be JSON-serializable.");
  }
  if (seen.has(value))
    fail("invalid_evidence", "Evidence values cannot be cyclic.");
  seen.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((entry) => redactValue(entry, secrets, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("invalid_evidence", "Evidence values must be plain JSON objects.");
    }
    result = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        redactText(key, secrets),
        redactValue(entry, secrets, seen),
      ]),
    );
  }
  seen.delete(value);
  return result;
}
