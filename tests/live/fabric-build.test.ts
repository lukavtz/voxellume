import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectArtifacts } from "../../scripts/ci/live-fabric.mjs";
import { packageRoot } from "../../src/core/root.ts";
import { run } from "../../src/core/tools/run.ts";
import { scaffold, type ModMetadata } from "../../src/core/tools/scaffold.ts";
import { targetInfo } from "../../src/core/tools/target-info.ts";

const LIVE = process.env.VOXELLUME_LIVE === "1";
const PIN_ID = "java-fabric-1.21.1";

const mod: ModMetadata = {
  modId: "ruby_tools",
  javaPackage: "dev.voxellume.ruby",
  name: "Ruby Tools",
  version: "1.0.0",
  description: "Ruby tools for Voxellume live verification.",
  authors: ["Voxellume"],
  license: "MIT",
};

test(
  "Fabric 1.21.1 project builds and boots a dedicated server",
  { skip: LIVE ? false : "set VOXELLUME_LIVE=1 to run the live Fabric build" },
  async (t) => {
    const work = await mkdtemp(join(tmpdir(), "voxellume-live-"));
    t.after(() => rm(work, { recursive: true, force: true }));

    const info = await targetInfo(
      { id: PIN_ID },
      { packageRoot: packageRoot() },
    );
    assert.equal(info.status, "ok");
    if (info.status !== "ok") return;
    assert.equal(info.value.pins[0]?.id, PIN_ID);

    const project = "ruby";
    const projectRoot = join(work, project);
    const scaffolded = await scaffold(
      { destination: project, pinId: PIN_ID, mod },
      { packageRoot: packageRoot(), cwd: work },
    );
    assert.equal(scaffolded.status, "ok");

    const build = await run(
      { projectRoot, task: "build", timeoutSeconds: 1800 },
      { cwd: work },
    );
    assert.equal(build.status, "ok");
    if (build.status !== "ok") return;
    assert.equal(build.value.status, "exited");
    assert.equal(build.value.exitCode, 0);
    const libs = await readdir(join(projectRoot, "build", "libs"));
    assert.ok(
      libs.some((file) => file.endsWith(".jar") && !file.includes("sources")),
    );

    await mkdir(join(projectRoot, "run"), { recursive: true });
    await writeFile(join(projectRoot, "run", "eula.txt"), "eula=true\n");

    const server = await run(
      {
        projectRoot,
        task: "runServer",
        timeoutSeconds: 600,
        stopOnLog: "Done \\(",
      },
      { cwd: work },
    );
    assert.equal(server.status, "ok");
    if (server.status !== "ok") return;
    assert.equal(server.value.status, "stopped_by_log");
    assert.ok(server.value.tail.join("\n").includes("Done ("));

    const outDir = join(packageRoot(), ".artifacts", "live-fabric");
    const artifacts = await collectArtifacts({
      projectRoot,
      logPath: server.value.logPath,
      serverStatus: server.value.status,
      outDir,
      pinId: PIN_ID,
    });
    const written = JSON.parse(
      await readFile(join(outDir, "result.json"), "utf8"),
    ) as {
      pinId: string;
      jarSha256: string;
      serverStatus: string;
    };
    assert.equal(written.pinId, PIN_ID);
    assert.equal(written.serverStatus, "stopped_by_log");
    assert.match(written.jarSha256, /^[0-9a-f]{64}$/);
    assert.match(artifacts.jarSha256, /^[0-9a-f]{64}$/);
  },
);
