/** Ordered printf placeholder letters, ignoring literal `%%`. */
export function extractPlaceholders(value: string): string[] {
  const result: string[] = [];
  const pattern = /%(?:(\d+)\$)?([a-zA-Z%])/g;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    if (match[2] !== "%") result.push(match[2]!);
  }
  return result;
}

/** Flatten a Minecraft lang file into dotted keys. */
export function flattenLang(
  value: unknown,
  prefix = "",
  into = new Map<string, string>(),
): Map<string, string> {
  if (typeof value === "string") {
    into.set(prefix, value);
    return into;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      flattenLang(nested, prefix === "" ? key : `${prefix}.${key}`, into);
    }
  }
  return into;
}
