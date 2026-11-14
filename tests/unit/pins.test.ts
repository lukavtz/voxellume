import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PinsError,
  findPin,
  loadPins,
  type PinsFile,
  type TargetPin,
} from "../../src/core/pins.ts";

const fixture = fileURLToPath(
  new URL("../fixtures/pins.json", import.meta.url),
);

async function writePinsFile(
  mutate: (file: PinsFile) => unknown,
): Promise<string> {
  const file = JSON.parse(await readFile(fixture, "utf8")) as PinsFile;
  const directory = await mkdtemp(join(tmpdir(), "voxellume-pins-"));
  const path = join(directory, "pins.json");
  await writeFile(path, JSON.stringify(mutate(file)), "utf8");
  return path;
}

test("loadPins reads every pin in file order", async () => {
  const pins = await loadPins(fixture);
  assert.equal(pins.length, 3);
  assert.deepEqual(
    pins.map((pin) => pin.id),
    ["java-fabric-1.21.1", "java-fabric-1.20.1", "java-forge-1.21.1"],
  );
  assert.equal(pins[0]?.template, "fabric-1.21.1");
  assert.equal(pins[2]?.gradle, null);
});

test("loadPins rejects a foreign schema version", async () => {
  const path = await writePinsFile((file) => ({
    ...file,
    schemaVersion: "pins-0.0.1",
  }));
  await assert.rejects(loadPins(path), (error: unknown) => {
    assert.ok(error instanceof PinsError);
    assert.equal(error.code, "pins_invalid");
    return true;
  });
});

test("loadPins rejects a pin without jdk", async () => {
  const path = await writePinsFile((file) => {
    const pins = file.pins.map((pin) => ({ ...pin })) as Record<
      string,
      unknown
    >[];
    delete pins[0]!.jdk;
    return { ...file, pins };
  });
  await assert.rejects(loadPins(path), PinsError);
});

test("loadPins rejects an unsupported jdk", async () => {
  const path = await writePinsFile((file) => ({
    ...file,
    pins: file.pins.map((pin, index) =>
      index === 0 ? { ...pin, jdk: 17 } : pin,
    ),
  }));
  await assert.rejects(loadPins(path), PinsError);
});

test("loadPins rejects duplicate ids", async () => {
  const path = await writePinsFile((file) => ({
    ...file,
    pins: file.pins.map((pin, index) =>
      index === 1 ? { ...pin, id: file.pins[0]!.id } : pin,
    ),
  }));
  await assert.rejects(loadPins(path), PinsError);
});

test("loadPins rejects a missing file", async () => {
  await assert.rejects(
    loadPins(join(tmpdir(), "voxellume-absent", "pins.json")),
    PinsError,
  );
});

test("findPin matches by id, by minecraft and loader, and requires every filter", () => {
  const pins: readonly TargetPin[] = [
    {
      id: "a",
      minecraft: "1.21.1",
      loader: "fabric",
      loaderVersion: "0.20.1",
      apiVersion: null,
      gradlePlugin: null,
      gradlePluginVersion: null,
      jdk: 21,
      gradle: "9.8.2",
      mappings: "mojang",
      template: null,
    },
    {
      id: "b",
      minecraft: "1.21.1",
      loader: "forge",
      loaderVersion: "52.0.28",
      apiVersion: null,
      gradlePlugin: null,
      gradlePluginVersion: null,
      jdk: 25,
      gradle: null,
      mappings: "none",
      template: null,
    },
  ];
  assert.equal(findPin(pins, { id: "b" })?.id, "b");
  assert.equal(
    findPin(pins, { minecraft: "1.21.1", loader: "fabric" })?.id,
    "a",
  );
  assert.equal(findPin(pins, { minecraft: "1.21.1" })?.id, "a");
  assert.equal(findPin(pins, { minecraft: "1.20.1" }), undefined);
  assert.equal(
    findPin(pins, { minecraft: "1.21.1", loader: "quilt" }),
    undefined,
  );
});
