import { Buffer } from "node:buffer";

export interface TinyMappingDirection {
  readonly fromNamespace: string;
  readonly toNamespace: string;
}

export interface TinyMappings {
  mapClass(
    name: string,
    fromNamespace: string,
    toNamespace: string,
  ): string | undefined;
  mapMember(
    owner: string,
    name: string,
    descriptor: string,
    fromNamespace: string,
    toNamespace: string,
  ): { owner: string; name: string; descriptor: string } | undefined;
}

interface ClassRow {
  readonly names: string[];
}

interface MemberRow {
  readonly owner: ClassRow;
  readonly kind: "f" | "m";
  readonly names: string[];
  readonly descriptors: string[];
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 1_000_000;
const CLASS_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\/[A-Za-z_$][A-Za-z0-9_$]*)*$/;
const MEMBER_NAME = /^(?:[A-Za-z_$][A-Za-z0-9_$]*|<init>|<clinit>)$/;
const NAMESPACE = /^[A-Za-z0-9_.-]+$/;

function invalid(message: string): never {
  throw new Error(`Invalid Tiny v2 mappings: ${message}`);
}

function assertClassName(name: string): void {
  if (!CLASS_NAME.test(name))
    invalid(`invalid class name ${JSON.stringify(name)}`);
}

function assertMemberName(name: string): void {
  if (!MEMBER_NAME.test(name))
    invalid(`invalid member name ${JSON.stringify(name)}`);
}

/** Parse and optionally remap one JVM field or method descriptor. */
function convertDescriptor(
  descriptor: string,
  kind: "f" | "m",
  remap: (name: string) => string,
): string {
  let offset = 0;

  function fieldType(allowVoid: boolean): string {
    const token = descriptor[offset++];
    if (token === undefined) invalid("truncated descriptor");
    if ("BCDFIJSZ".includes(token)) return token;
    if (token === "V") {
      if (!allowVoid) invalid("void in field descriptor");
      return token;
    }
    if (token === "L") {
      const end = descriptor.indexOf(";", offset);
      if (end < 0) invalid("unterminated object descriptor");
      const name = descriptor.slice(offset, end);
      assertClassName(name);
      offset = end + 1;
      return `L${remap(name)};`;
    }
    if (token === "[") {
      let dimensions = 1;
      while (descriptor[offset] === "[") {
        dimensions++;
        offset++;
      }
      if (dimensions > 255) invalid("too many array dimensions");
      return "[".repeat(dimensions) + fieldType(false);
    }
    invalid(`invalid descriptor ${JSON.stringify(descriptor)}`);
  }

  let result: string;
  if (kind === "m") {
    if (descriptor[offset++] !== "(")
      invalid("method descriptor must start with (");
    result = "(";
    while (descriptor[offset] !== ")") {
      if (offset >= descriptor.length)
        invalid("unterminated method descriptor");
      result += fieldType(false);
    }
    offset++;
    result += ")" + fieldType(true);
  } else {
    result = fieldType(false);
  }
  if (offset !== descriptor.length) invalid("trailing descriptor data");
  return result;
}

export function parseTinyMappings(
  text: string,
  options: { maxBytes?: number; maxEntries?: number } = {},
): TinyMappings {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    invalid("maxBytes must be a positive integer");
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    invalid("maxEntries must be a positive integer");
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes)
    invalid("input exceeds maxBytes");

  const lines = text.split("\n");
  const header = lines[0]?.replace(/\r$/, "").split("\t") ?? [];
  if (
    header.length < 5 ||
    header[0] !== "tiny" ||
    header[1] !== "2" ||
    header[2] !== "0"
  ) {
    invalid("header must be tiny 2.0 with at least two namespaces");
  }
  const namespaces = header.slice(3);
  const namespaceIndexes = new Map<string, number>();
  namespaces.forEach((namespace, index) => {
    if (!NAMESPACE.test(namespace))
      invalid(`invalid namespace ${JSON.stringify(namespace)}`);
    if (namespaceIndexes.has(namespace))
      invalid(`duplicate namespace ${namespace}`);
    namespaceIndexes.set(namespace, index);
  });

  const classes: ClassRow[] = [];
  const members: MemberRow[] = [];
  const classNames = new Set<string>();
  const classLookups = new Map<string, number>();
  const sourceMembers = new Map<string, number>();
  let entries = 0;
  let currentClass: ClassRow | undefined;

  for (let lineNumber = 1; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber]!.replace(/\r$/, "");
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const columns = line.split("\t");
    const indented = columns[0] === "";
    const tag = indented ? columns[1] : columns[0];
    if (tag !== "c" && tag !== "f" && tag !== "m")
      invalid(`unknown row at line ${lineNumber + 1}`);
    const expectedColumns =
      tag === "c" ? namespaces.length + 1 : namespaces.length + 3;
    if (columns.length !== expectedColumns || indented === (tag === "c")) {
      invalid(`malformed ${tag} row at line ${lineNumber + 1}`);
    }
    if (++entries > maxEntries) invalid("input exceeds maxEntries");

    if (tag === "c") {
      const names = columns.slice(1);
      assertClassName(names[0]!);
      for (const name of names) {
        if (name !== "") {
          assertClassName(name);
          classNames.add(name);
        }
      }
      const row: ClassRow = { names };
      const rowIndex = classes.length;
      let duplicate = false;
      for (let from = 0; from < namespaces.length; from++) {
        if (names[from] === "") continue;
        const key = `${from}\0${names[from]}`;
        const existing = classLookups.get(key);
        if (existing !== undefined) {
          const previous = classes[existing]!;
          if (previous.names.some((name, index) => name !== names[index])) {
            invalid(`conflicting class mapping at line ${lineNumber + 1}`);
          }
          duplicate = true;
          continue;
        }
        classLookups.set(key, rowIndex);
      }
      if (!duplicate) classes.push(row);
      currentClass = duplicate
        ? classes[classLookups.get(`0\0${names[0]}`)!]!
        : row;
      continue;
    }

    if (
      !indented ||
      columns.length !== namespaces.length + 3 ||
      currentClass === undefined
    ) {
      invalid(`malformed member row at line ${lineNumber + 1}`);
    }
    const descriptor = columns[2]!;
    const names = columns.slice(3);
    assertMemberName(names[0]!);
    for (const name of names) if (name !== "") assertMemberName(name);
    convertDescriptor(descriptor, tag, (name) => name);
    const identity = `${tag}\0${currentClass.names[0]}\0${names[0]}\0${descriptor}`;
    const existing = sourceMembers.get(identity);
    if (existing !== undefined) {
      const previous = members[existing]!;
      if (previous.names.some((name, index) => name !== names[index])) {
        invalid(`conflicting member mapping at line ${lineNumber + 1}`);
      }
      continue;
    }
    sourceMembers.set(identity, members.length);
    members.push({
      owner: currentClass,
      kind: tag,
      names,
      descriptors: [descriptor],
    });
  }

  for (const member of members) {
    for (let to = 1; to < namespaces.length; to++) {
      member.descriptors[to] = convertDescriptor(
        member.descriptors[0]!,
        member.kind,
        (name) => {
          const index = classLookups.get(`0\0${name}`);
          return index === undefined ? name : classes[index]!.names[to] || name;
        },
      );
    }
  }

  const memberLookups = new Map<string, number>();
  for (let index = 0; index < members.length; index++) {
    const member = members[index]!;
    for (let from = 0; from < namespaces.length; from++) {
      const owner = member.owner.names[from]!;
      const name = member.names[from]!;
      if (owner === "" || name === "") continue;
      const key = `${from}\0${owner}\0${name}\0${member.descriptors[from]}`;
      const existing = memberLookups.get(key);
      if (existing !== undefined && existing !== index) {
        invalid(`ambiguous member mapping for ${owner}.${name}`);
      }
      memberLookups.set(key, index);
    }
  }

  function direction(
    fromNamespace: string,
    toNamespace: string,
  ): [number, number] {
    const from = namespaceIndexes.get(fromNamespace);
    const to = namespaceIndexes.get(toNamespace);
    if (from === undefined || to === undefined) {
      invalid(
        `unknown namespace ${from === undefined ? fromNamespace : toNamespace}`,
      );
    }
    return [from, to];
  }

  return {
    mapClass(name, fromNamespace, toNamespace) {
      assertClassName(name);
      if (!classNames.has(name)) return undefined;
      const [from, to] = direction(fromNamespace, toNamespace);
      const index = classLookups.get(`${from}\0${name}`);
      if (index === undefined) return undefined;
      return classes[index]!.names[to] || undefined;
    },
    mapMember(owner, name, descriptor, fromNamespace, toNamespace) {
      const [from, to] = direction(fromNamespace, toNamespace);
      assertClassName(owner);
      assertMemberName(name);
      const kind = descriptor.startsWith("(") ? "m" : "f";
      convertDescriptor(descriptor, kind, (className) => className);
      const index = memberLookups.get(
        `${from}\0${owner}\0${name}\0${descriptor}`,
      );
      if (index === undefined) return undefined;
      const member = members[index]!;
      const mappedOwner = member.owner.names[to]!;
      const mappedName = member.names[to]!;
      if (mappedOwner === "" || mappedName === "") return undefined;
      return {
        owner: mappedOwner,
        name: mappedName,
        descriptor: member.descriptors[to]!,
      };
    },
  };
}
