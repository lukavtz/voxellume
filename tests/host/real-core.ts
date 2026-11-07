import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { createHostCoreOperations } from "../../src/adapters/shared.ts";
import type { CoreOperations } from "../../src/core/operations.ts";

export const target = {
  edition: "java",
  minecraftVersion: "1.21.1",
  loader: "fabric",
} as const;

export const mod = {
  modId: "ruby_tools",
  namespace: "ruby_tools",
  javaPackage: "dev.voxellume.ruby_tools",
  name: "Ruby Tools",
  version: "1.2.3",
  description: "Ruby tools for cross-host tests.",
  authors: ["Voxellume Tests"],
  license: "MIT",
} as const;

export interface RealCoreFixture {
  root: string;
  catalogRoot: string;
  projectRoot: string;
  stagingRoot: string;
  operations: CoreOperations;
}

export async function createRealCoreFixture(
  t: TestContext,
  options: { templates?: boolean } = {},
): Promise<RealCoreFixture> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-real-host-core-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  const stagingRoot = join(projectRoot, ".voxellume", "staging");
  await mkdir(projectRoot);

  const validCatalog = fileURLToPath(
    new URL("../../fixtures/target-packs/valid/", import.meta.url),
  );
  let catalogRoot = validCatalog;
  if (options.templates) {
    catalogRoot = join(root, "catalog");
    const packRoot = join(catalogRoot, "java", "fabric", "1.21.1");
    await mkdir(packRoot, { recursive: true });
    await cp(join(validCatalog, "java", "fabric", "1.21.1"), packRoot, {
      recursive: true,
    });
    await cp(
      fileURLToPath(
        new URL(
          "../../target-packs/java/fabric/1.21.1/templates/",
          import.meta.url,
        ),
      ),
      join(packRoot, "templates"),
      { recursive: true },
    );
  }

  const operations = createHostCoreOperations({
    catalogRoot,
    authorizedProjectRoot: projectRoot,
    transactionStagingRoot: stagingRoot,
  });
  return { root, catalogRoot, projectRoot, stagingRoot, operations };
}
