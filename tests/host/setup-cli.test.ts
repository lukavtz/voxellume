import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createServer, type Server } from "node:http";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  runSetupCli,
  type CommandResult,
  type SetupCliDependencies,
} from "../../src/adapters/setup/cli.ts";

const fixtureRoot = "blockbench-mcp-plugin-fixture";
const pluginManifest = JSON.stringify({
  name: "blockbench-mcp",
  version: "1.10.1",
  bin: { "blockbench-mcp-headless": "bin/blockbench-mcp-headless.mjs" },
});

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function tarEntry(
  name: string,
  data: Uint8Array,
  options: { mode?: number; type?: number; linkName?: string } = {},
): Uint8Array {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write((options.mode ?? 0o644).toString(8).padStart(7, "0"), 100);
  header.write("0000000", 108);
  header.write("0000000", 116);
  header.write(data.length.toString(8).padStart(11, "0"), 124);
  header.write("00000000000", 136);
  header.write("        ", 148);
  header[156] = options.type ?? 0;
  if (options.linkName !== undefined) header.write(options.linkName, 157, 100);
  header.write("ustar", 257);
  header.write("00", 263);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

function pluginArchive(
  entries: {
    name: string;
    data: Uint8Array;
    type?: number;
    linkName?: string;
  }[] = [
    { name: `${fixtureRoot}/`, data: Buffer.alloc(0), type: 53 },
    { name: `${fixtureRoot}/package.json`, data: Buffer.from(pluginManifest) },
    {
      name: `${fixtureRoot}/bin/blockbench-mcp-headless.mjs`,
      data: Buffer.from("#!/usr/bin/env node\n"),
    },
    {
      name: `${fixtureRoot}/pnpm-lock.yaml`,
      data: Buffer.from("lockfileVersion: '9.0'\n"),
    },
  ],
): Uint8Array {
  return gzipSync(
    Buffer.concat([
      ...entries.map((entry) =>
        tarEntry(entry.name, entry.data, {
          ...(entry.type === undefined ? {} : { type: entry.type }),
          ...(entry.linkName === undefined ? {} : { linkName: entry.linkName }),
        }),
      ),
      Buffer.alloc(1024),
    ]),
  );
}

interface Fixture {
  directory: string;
  root: string;
  archive: Uint8Array;
  archiveUrl: string;
  archiveSha256: string;
  close: () => Promise<void>;
}

async function serveFixture(
  t: test.TestContext,
  entries?: Parameters<typeof pluginArchive>[0],
): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), "voxellume-setup-test-"));
  const root = join(directory, "models");
  const archive = pluginArchive(entries);
  const server: Server = createServer((request, response) => {
    if (request.url !== "/plugin.tar.gz") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/gzip" });
    response.end(archive);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    root,
    archive,
    archiveUrl: `http://127.0.0.1:${address.port}/plugin.tar.gz`,
    archiveSha256: sha256(archive),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function installedDependencies(
  fixture: Fixture,
  overrides: Partial<SetupCliDependencies> = {},
): SetupCliDependencies {
  const commands: string[][] = [];
  return {
    platform: "linux",
    arch: "x64",
    home: fixture.directory,
    dataHome: join(fixture.directory, "data"),
    tempRoot: join(fixture.directory, "tmp"),
    env: { JAVA_HOME_21: "/jdk21", JAVA_HOME_25: "/jdk25" },
    archive: { url: fixture.archiveUrl, sha256: fixture.archiveSha256 },
    stdout: { write: () => true },
    stderr: { write: () => true },
    checkFile: async () => "/fake/blockbench",
    runCommand: async (command, args): Promise<CommandResult> => {
      commands.push([command, ...args]);
      if (command.endsWith("java") || command === "java") {
        const release = command.includes("jdk21") ? "21" : "25";
        return {
          code: 0,
          stdout: "",
          stderr: `openjdk version "${release}.0.1"`,
        };
      }
      if (command.endsWith("node") || command === "node") {
        return { code: 0, stdout: "v24.9.0", stderr: "" };
      }
      return { code: 0, stdout: "1.0.0", stderr: "" };
    },
    ...overrides,
  };
}

test("doctor localizes installed and missing reports in all supported languages", async (t) => {
  const fixture = await serveFixture(t);
  for (const [lang, expected] of [
    ["en", "Voxellume environment check"],
    ["ru", "Проверка окружения Voxellume"],
    ["zh-CN", "Voxellume 环境检查"],
  ] as const) {
    let output = "";
    const result = await runSetupCli(["doctor", "--lang", lang], {
      ...installedDependencies(fixture),
      nodeVersion: "v20.0.0",
      env: {},
      checkFile: async () => null,
      runCommand: async (command) => ({
        code: command === "node" ? 0 : 1,
        stdout: command === "node" ? "v20.0.0" : "",
        stderr: "",
      }),
      stdout: { write: (text: string) => ((output += text), true) },
    });
    assert.equal(result, 1);
    assert.ok(output.includes(expected));
    assert.match(output, /Node\.js/);
    assert.match(output, /Docker/);
    assert.match(output, /JDK 21/);
    assert.match(output, /JDK 25/);
    assert.match(output, /Blockbench/);
    assert.match(output, /Blender/);
    assert.match(output, /ffmpeg/);
    assert.match(output, /https:\/\/nodejs\.org\/dist\/v24\.9\.0\//);
  }
});

test("setup installs the exact MCP archive and prints local stdio configuration", async (t) => {
  const fixture = await serveFixture(t);
  let output = "";
  const commands: string[][] = [];
  const base = installedDependencies(fixture);
  const runCommand: NonNullable<SetupCliDependencies["runCommand"]> = async (
    command,
    args,
    options,
  ) => {
    commands.push([command, ...args]);
    assert.ok(options?.cwd === undefined || !options.cwd.includes(".."));
    return (base.runCommand as NonNullable<SetupCliDependencies["runCommand"]>)(
      command,
      args,
      options,
    );
  };
  const result = await runSetupCli(
    ["setup", "--lang", "en", "--yes", "--blockbench-mcp-root", fixture.root],
    {
      ...base,
      runCommand,
      stdout: { write: (text: string) => ((output += text), true) },
    },
  );
  assert.equal(result, 0, output);
  const install = commands.find((argv) => argv.includes("corepack@0.34.5"));
  assert.ok(install);
  assert.deepEqual(install.slice(1), [
    "--yes",
    "corepack@0.34.5",
    "pnpm",
    "install",
    "--ignore-scripts",
  ]);
  const installRoot = join(
    fixture.directory,
    "data",
    "tools",
    "blockbench-mcp",
    "97a8a80d3a37bf95c5e136d93d2c7da399fff753",
  );
  assert.equal(
    JSON.parse(readFileSync(join(installRoot, "package.json"), "utf8")).version,
    "1.10.1",
  );
  assert.ok(existsSync(join(installRoot, "bin/blockbench-mcp-headless.mjs")));
  assert.match(output, /"mcpServers"/);
  assert.match(output, /"blockbench-headless"/);
  assert.match(output, /risky_eval: disabled/);
  assert.ok(output.includes(fixture.root));
  assert.ok(!existsSync(join(fixture.directory, "tmp")));
});

test("setup defaults to ~/models and requires consent before writing", async (t) => {
  const fixture = await serveFixture(t);
  const defaultRoot = join(fixture.directory, "models");
  let output = "";
  const result = await runSetupCli(["setup", "--lang", "en"], {
    ...installedDependencies(fixture),
    prompt: async () => "n",
    stdout: { write: (text: string) => ((output += text), true) },
  });
  assert.equal(result, 0);
  assert.equal(existsSync(defaultRoot), false);
  assert.match(output, /cancelled/i);

  const accepted = await runSetupCli(["setup", "--lang", "en"], {
    ...installedDependencies(fixture),
    prompt: async () => "y",
  });
  assert.equal(accepted, 0);
  assert.ok(existsSync(defaultRoot));
});

test("setup verifies SHA-256 before extraction and cleans temporary files", async (t) => {
  const fixture = await serveFixture(t);
  let errors = "";
  let installCalled = false;
  const base = installedDependencies(fixture);
  const result = await runSetupCli(
    ["setup", "--lang", "en", "--yes", "--blockbench-mcp-root", fixture.root],
    {
      ...base,
      archive: { url: fixture.archiveUrl, sha256: "0".repeat(64) },
      runCommand: async (command, args, options) => {
        if (args.includes("corepack@0.34.5")) installCalled = true;
        return (
          base.runCommand as NonNullable<SetupCliDependencies["runCommand"]>
        )(command, args, options);
      },
      stderr: { write: (text: string) => ((errors += text), true) },
    },
  );
  assert.equal(result, 1);
  assert.equal(installCalled, false);
  assert.match(errors, /SHA-256/);
  assert.equal(
    existsSync(join(fixture.directory, "data", "blockbench-mcp")),
    false,
  );
  assert.ok(!existsSync(join(fixture.directory, "tmp")));
});

test("setup rejects archive traversal and symlinks before installation", async (t) => {
  for (const entries of [
    [
      { name: "../outside", data: Buffer.from("escape") },
      {
        name: `${fixtureRoot}/package.json`,
        data: Buffer.from(pluginManifest),
      },
    ],
    [
      {
        name: `${fixtureRoot}/package.json`,
        data: Buffer.alloc(0),
        type: 50,
        linkName: "/etc/passwd",
      },
    ],
    [
      {
        name: `${fixtureRoot}/hardlink`,
        data: Buffer.alloc(0),
        type: 49,
        linkName: `${fixtureRoot}/package.json`,
      },
    ],
  ]) {
    const fixture = await serveFixture(t, entries);
    let installCalled = false;
    const base = installedDependencies(fixture);
    const result = await runSetupCli(
      ["setup", "--lang", "en", "--yes", "--blockbench-mcp-root", fixture.root],
      {
        ...base,
        runCommand: async (command, args, options) => {
          if (args.includes("corepack@0.34.5")) installCalled = true;
          return (
            base.runCommand as NonNullable<SetupCliDependencies["runCommand"]>
          )(command, args, options);
        },
      },
    );
    assert.equal(result, 1);
    assert.equal(installCalled, false);
    assert.equal(existsSync(join(fixture.directory, "outside")), false);
  }
});

test("setup installs missing prerequisites before MCP with per-OS commands", async (t) => {
  const cases = [
    {
      platform: "darwin" as const,
      arch: "arm64",
      manager: "brew",
      installer: "ditto",
    },
    {
      platform: "linux" as const,
      arch: "x64",
      manager: "sudo",
      installer: "apt-get",
    },
    {
      platform: "win32" as const,
      arch: "x64",
      manager: "winget",
      installer: "winget",
    },
  ];
  for (const item of cases) {
    const fixture = await serveFixture(t);
    const commands: string[][] = [];
    let prerequisitesInstalled = false;
    let javaCalls = 0;
    let output = "";
    const result = await runSetupCli(
      ["setup", "--lang", "en", "--yes", "--blockbench-mcp-root", fixture.root],
      {
        ...installedDependencies(fixture),
        platform: item.platform,
        arch: item.arch,
        env: {},
        osRelease: "ID=ubuntu",
        blockbenchArchive: {
          url: fixture.archiveUrl,
          sha256: fixture.archiveSha256,
        },
        checkFile: async () =>
          prerequisitesInstalled ? "/fake/blockbench" : null,
        stdout: { write: (text: string) => ((output += text), true) },
        runCommand: async (command, args) => {
          commands.push([command, ...args]);
          if (
            (command === item.installer || args.includes(item.installer)) &&
            args[0] !== "--version"
          ) {
            prerequisitesInstalled = true;
          }
          if (command === "java") {
            javaCalls += 1;
            return prerequisitesInstalled
              ? {
                  code: 0,
                  stdout: "",
                  stderr: `openjdk version "${javaCalls % 2 === 1 ? 21 : 25}.0.1"`,
                }
              : { code: 1, stdout: "", stderr: "" };
          }
          if (
            prerequisitesInstalled ||
            command === "node" ||
            command === "npx" ||
            args.includes("corepack@0.34.5")
          ) {
            return {
              code: 0,
              stdout: command === "node" ? "v24.9.0" : "1.0.0",
              stderr: "",
            };
          }
          if (
            command === "hdiutil" ||
            ((command === "brew" ||
              command === "winget" ||
              command === "sudo") &&
              args[0] === "--version")
          ) {
            return { code: 0, stdout: "1", stderr: "" };
          }
          return { code: 1, stdout: "", stderr: "" };
        },
      },
    );
    assert.equal(result, 0, `${item.platform}: ${output}`);
    const mcpIndex = commands.findIndex((argv) =>
      argv.includes("corepack@0.34.5"),
    );
    assert.ok(mcpIndex > 0, `${item.platform}: missing MCP install`);
    assert.ok(
      commands.slice(0, mcpIndex).some((argv) => argv.includes(item.installer)),
    );
    assert.ok(
      commands.slice(0, mcpIndex).some((argv) => argv.includes("ffmpeg")),
    );
    assert.ok(
      commands
        .slice(0, mcpIndex)
        .some(
          (argv) =>
            argv.includes("docker") || argv.includes("Docker.DockerDesktop"),
        ),
    );
    if (item.platform === "darwin") {
      assert.ok(
        commands.some(
          (argv) => argv[0] === "hdiutil" && argv.includes("attach"),
        ),
      );
      assert.ok(
        commands.some(
          (argv) => argv[0] === "hdiutil" && argv.includes("detach"),
        ),
      );
      assert.ok(
        !commands.some(
          (argv) => argv.includes("blockbench") && argv.includes("--cask"),
        ),
      );
    }
    if (item.platform === "win32") {
      assert.ok(
        commands.some(
          (argv) =>
            argv.includes("JannisX11.Blockbench") && argv.includes("5.2.2"),
        ),
      );
    }
  }
});

test("setup reports unsupported Linux distributions without installing MCP", async (t) => {
  const fixture = await serveFixture(t);
  const commands: string[][] = [];
  let errors = "";
  const result = await runSetupCli(["setup", "--lang", "en", "--yes"], {
    ...installedDependencies(fixture),
    platform: "linux",
    osRelease: "ID=fedora",
    env: {},
    checkFile: async () => null,
    runCommand: async (command, args) => {
      commands.push([command, ...args]);
      return { code: command === "node" ? 0 : 1, stdout: "", stderr: "" };
    },
    stderr: { write: (text: string) => ((errors += text), true) },
  });
  assert.equal(result, 1);
  assert.match(errors, /Unsupported Linux distribution: fedora/);
  assert.equal(
    commands.some((argv) => argv.includes("apt-get")),
    false,
  );
  assert.equal(
    commands.some((argv) => argv.includes("corepack@0.34.5")),
    false,
  );
});

test("setup rejects a desktop asset hash mismatch before mounting it", async (t) => {
  const fixture = await serveFixture(t);
  const commands: string[][] = [];
  let errors = "";
  const result = await runSetupCli(["setup", "--lang", "en", "--yes"], {
    ...installedDependencies(fixture),
    platform: "darwin",
    arch: "arm64",
    env: {},
    checkFile: async () => null,
    blockbenchArchive: { url: fixture.archiveUrl, sha256: "0".repeat(64) },
    runCommand: async (command, args) => {
      commands.push([command, ...args]);
      if (command === "node") return { code: 0, stdout: "v24.9.0", stderr: "" };
      if (
        command === "npx" ||
        (command === "brew" && args[0] === "--version")
      ) {
        return { code: 0, stdout: "1", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    },
    stderr: { write: (text: string) => ((errors += text), true) },
  });
  assert.equal(result, 1);
  assert.match(errors, /SHA-256/);
  assert.equal(
    commands.some((argv) => argv[0] === "hdiutil"),
    false,
  );
  assert.equal(
    commands.some((argv) => argv.includes("corepack@0.34.5")),
    false,
  );
});

test("strict argv rejects unknown, duplicate, missing, and relative arguments", async (t) => {
  const fixture = await serveFixture(t);
  for (const args of [
    [],
    ["unknown", "--lang", "en"],
    ["doctor", "--lang", "de"],
    ["doctor", "--lang"],
    ["doctor", "--lang", "en", "--yes"],
    ["setup", "--lang", "en", "--lang", "ru"],
    ["setup", "--lang", "en", "--unknown"],
    ["setup", "--lang", "en", "--blockbench-mcp-root", "models"],
  ]) {
    const result = await runSetupCli(args, installedDependencies(fixture));
    assert.equal(result, 2, args.join(" "));
  }
  assert.equal(
    readFileSync("src/adapters/setup/cli.ts", "utf8").startsWith(
      "#!/usr/bin/env node\n",
    ),
    true,
  );
});
