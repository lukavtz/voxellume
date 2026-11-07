import assert from "node:assert/strict";
import test from "node:test";

import { parseTinyMappings } from "../../src/core/sources/tiny-mappings.ts";

const quiltItem = `tiny\t2\t0\tintermediary\tnamed
# Quilt 1.21.1 maps class_1792 to item/Item, not world/item/Item.
c\tnet/minecraft/class_1792\tnet/minecraft/item/Item
\tm\t(Lnet/minecraft/class_1793;)Lnet/minecraft/class_1792;\tmethod_1\tuse
\tf\tLnet/minecraft/class_1792;\tfield_1\tINSTANCE
c\tnet/minecraft/class_1793\tnet/minecraft/item/ItemStack
`;

test("maps the pinned Quilt Item class in both directions", () => {
  const mappings = parseTinyMappings(quiltItem);
  assert.equal(
    mappings.mapClass("net/minecraft/class_1792", "intermediary", "named"),
    "net/minecraft/item/Item",
  );
  assert.equal(
    mappings.mapClass("net/minecraft/item/Item", "named", "intermediary"),
    "net/minecraft/class_1792",
  );
  assert.notEqual(
    mappings.mapClass("net/minecraft/class_1792", "intermediary", "named"),
    "net/minecraft/world/item/Item",
  );
});

test("maps methods and fields and converts every class in descriptors", () => {
  const mappings = parseTinyMappings(quiltItem);
  assert.deepEqual(
    mappings.mapMember(
      "net/minecraft/class_1792",
      "method_1",
      "(Lnet/minecraft/class_1793;)Lnet/minecraft/class_1792;",
      "intermediary",
      "named",
    ),
    {
      owner: "net/minecraft/item/Item",
      name: "use",
      descriptor: "(Lnet/minecraft/item/ItemStack;)Lnet/minecraft/item/Item;",
    },
  );
  assert.deepEqual(
    mappings.mapMember(
      "net/minecraft/item/Item",
      "use",
      "(Lnet/minecraft/item/ItemStack;)Lnet/minecraft/item/Item;",
      "named",
      "intermediary",
    ),
    {
      owner: "net/minecraft/class_1792",
      name: "method_1",
      descriptor: "(Lnet/minecraft/class_1793;)Lnet/minecraft/class_1792;",
    },
  );
  assert.deepEqual(
    mappings.mapMember(
      "net/minecraft/class_1792",
      "field_1",
      "Lnet/minecraft/class_1792;",
      "intermediary",
      "named",
    ),
    {
      owner: "net/minecraft/item/Item",
      name: "INSTANCE",
      descriptor: "Lnet/minecraft/item/Item;",
    },
  );
});

test("returns undefined for missing symbols", () => {
  const mappings = parseTinyMappings(quiltItem);
  assert.equal(
    mappings.mapClass("example/Missing", "intermediary", "named"),
    undefined,
  );
  assert.equal(
    mappings.mapMember(
      "net/minecraft/class_1792",
      "missing",
      "()V",
      "intermediary",
      "named",
    ),
    undefined,
  );
  assert.equal(
    mappings.mapMember(
      "example/Missing",
      "method_1",
      "()V",
      "intermediary",
      "named",
    ),
    undefined,
  );
});

test("accepts comments, blank lines, CRLF, constructors, and identical duplicates", () => {
  const mappings = parseTinyMappings(
    "tiny\t2\t0\ta\tb\r\n\r\n# comment\r\nc\ta/A\tb/B\r\n" +
      "\tm\t()V\t<init>\t<init>\r\n\tm\t()V\t<init>\t<init>\r\n",
  );
  assert.deepEqual(mappings.mapMember("a/A", "<init>", "()V", "a", "b"), {
    owner: "b/B",
    name: "<init>",
    descriptor: "()V",
  });
});

test("rejects malformed headers and rows", () => {
  const malformed = [
    "",
    "tiny\t1\t0\ta\tb",
    "tiny\t2\t1\ta\tb",
    "tiny\t2\t0\ta",
    "tiny\t2\t0\ta\ta",
    "tiny\t2\t0\ta\tb\nc\ta/A",
    "tiny\t2\t0\ta\tb\nc\ta/A\tb/B\textra",
    "tiny\t2\t0\ta\tb\n\tm\t()V\tmethod",
    "tiny\t2\t0\ta\tb\nc\ta/A\tb/B\n\tf\tV\tfield\tfield",
    "tiny\t2\t0\ta\tb\nx\ta/A\tb/B",
    "tiny\t2\t0\ta\tb\nc\ta/A\tb/B\n\tm\t()V\tmethod",
  ];
  for (const text of malformed) assert.throws(() => parseTinyMappings(text));
});

test("rejects conflicting and ambiguous duplicate mappings", () => {
  assert.throws(() =>
    parseTinyMappings("tiny\t2\t0\ta\tb\nc\ta/A\tb/B\nc\ta/A\tb/C"),
  );
  assert.throws(() =>
    parseTinyMappings("tiny\t2\t0\ta\tb\nc\ta/A\tb/B\nc\ta/C\tb/B"),
  );
  assert.throws(() =>
    parseTinyMappings(
      "tiny\t2\t0\ta\tb\nc\ta/A\tb/B\n\tm\t()V\tone\tone\n\tm\t()V\tone\ttwo",
    ),
  );
  assert.throws(() =>
    parseTinyMappings(
      "tiny\t2\t0\ta\tb\nc\ta/A\tb/B\n\tm\t()V\tone\tsame\n\tm\t()V\ttwo\tsame",
    ),
  );
});

test("rejects unknown namespaces and invalid names or descriptors", () => {
  const mappings = parseTinyMappings(quiltItem);
  assert.throws(() =>
    mappings.mapClass("net/minecraft/class_1792", "official", "named"),
  );
  assert.throws(() =>
    mappings.mapClass("net/minecraft/class_1792", "intermediary", "official"),
  );
  assert.throws(() =>
    mappings.mapClass("net.minecraft.class_1792", "intermediary", "named"),
  );
  assert.throws(() =>
    mappings.mapMember(
      "net/minecraft/class_1792",
      "bad name",
      "()V",
      "intermediary",
      "named",
    ),
  );
  assert.throws(() =>
    mappings.mapMember(
      "net/minecraft/class_1792",
      "method_1",
      "(V)V",
      "intermediary",
      "named",
    ),
  );
  assert.throws(() => parseTinyMappings("tiny\t2\t0\ta\tb\nc\ta//A\tb/B"));
  assert.throws(() =>
    parseTinyMappings("tiny\t2\t0\ta\tb\nc\ta/A\tb/B\n\tm\t(La/Missing\tm\tm"),
  );
});

test("enforces UTF-8 byte and mapping-entry limits", () => {
  assert.throws(() => parseTinyMappings(quiltItem, { maxBytes: 16 }));
  assert.throws(() => parseTinyMappings(quiltItem, { maxEntries: 3 }));
  assert.equal(
    parseTinyMappings(quiltItem, { maxEntries: 4 }).mapClass("a/A", "a", "b"),
    undefined,
  );
  assert.throws(() => parseTinyMappings(quiltItem, { maxBytes: Number.NaN }));
  assert.throws(() => parseTinyMappings(quiltItem, { maxEntries: 1.5 }));
});

test("remaps arrays, multi-argument methods, and preserves primitives", () => {
  const mappings = parseTinyMappings(`tiny\t2\t0\ta\tb
c\ta/A\tb/B
\tm\t(I[[La/A;[J)[[La/A;\tgo\tgo
`);
  assert.deepEqual(
    mappings.mapMember("b/B", "go", "(I[[Lb/B;[J)[[Lb/B;", "b", "a"),
    {
      owner: "a/A",
      name: "go",
      descriptor: "(I[[La/A;[J)[[La/A;",
    },
  );
});
