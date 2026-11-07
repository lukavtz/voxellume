import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { validateModSpec, type ModSpec } from "../../src/core/spec/mod-spec.ts";
import type { TargetPack } from "../../src/core/targets/target-pack.ts";
import {
  evaluateGameTestResult,
  generateGameTests,
  type GameTestGenerationResult,
  type GeneratedGameTests,
} from "../../src/core/verification/gametest.ts";

const javaPath =
  "src/main/java/dev/voxellume/ruby_tools/RubyToolsGameTests.java";
const structurePath = "src/main/resources/data/ruby_tools/structure/empty.nbt";
const fabricMetadataPath = "src/main/resources/fabric.mod.json";
const fabricClientMetadataPath = "src/client/resources/fabric.mod.json";
const requiredTests = [
  "accept_ruby_blade_damage",
  "accept_ruby_block_drops",
] as const;

const fabricServerSource = `package dev.voxellume.ruby_tools;

import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestAssertException;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.block.Block;

public final class RubyToolsGameTests {
    @GameTest(template = "ruby_tools:empty")
    public static void test_accept_ruby_blade_damage(GameTestHelper helper) {
        ResourceLocation id = ResourceLocation.fromNamespaceAndPath("ruby_tools", "ruby_blade");
        if (!BuiltInRegistries.ITEM.containsKey(id)) {
            throw new GameTestAssertException("Expected registered item ruby_tools:ruby_blade");
        }
        System.out.println("VOXELLUME_TEST_PASSED=accept_ruby_blade_damage");
        helper.succeed();
    }

    @GameTest(template = "ruby_tools:empty")
    public static void test_accept_ruby_block_drops(GameTestHelper helper) {
        ResourceLocation id = ResourceLocation.fromNamespaceAndPath("ruby_tools", "ruby_block");
        if (!BuiltInRegistries.BLOCK.containsKey(id)) {
            throw new GameTestAssertException("Expected registered block ruby_tools:ruby_block");
        }
        Block block = BuiltInRegistries.BLOCK.get(id);
        BlockPos pos = new BlockPos(1, 1, 1);
        helper.setBlock(pos, block.defaultBlockState());
        helper.assertBlockPresent(block, pos);
        System.out.println("VOXELLUME_TEST_PASSED=accept_ruby_block_drops");
        helper.succeed();
    }

    public RubyToolsGameTests() {}
}
`;

const neoForgeSource = `package dev.voxellume.ruby_tools;

import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestAssertException;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.block.Block;
import net.neoforged.neoforge.gametest.GameTestHolder;
import net.neoforged.neoforge.gametest.PrefixGameTestTemplate;

@GameTestHolder("ruby_tools")
@PrefixGameTestTemplate(false)
public final class RubyToolsGameTests {
    @GameTest(template = "empty")
    public static void test_accept_ruby_blade_damage(GameTestHelper helper) {
        ResourceLocation id = ResourceLocation.fromNamespaceAndPath("ruby_tools", "ruby_blade");
        if (!BuiltInRegistries.ITEM.containsKey(id)) {
            throw new GameTestAssertException("Expected registered item ruby_tools:ruby_blade");
        }
        System.out.println("VOXELLUME_TEST_PASSED=accept_ruby_blade_damage");
        helper.succeed();
    }

    @GameTest(template = "empty")
    public static void test_accept_ruby_block_drops(GameTestHelper helper) {
        ResourceLocation id = ResourceLocation.fromNamespaceAndPath("ruby_tools", "ruby_block");
        if (!BuiltInRegistries.BLOCK.containsKey(id)) {
            throw new GameTestAssertException("Expected registered block ruby_tools:ruby_block");
        }
        Block block = BuiltInRegistries.BLOCK.get(id);
        BlockPos pos = new BlockPos(1, 1, 1);
        helper.setBlock(pos, block.defaultBlockState());
        helper.assertBlockPresent(block, pos);
        System.out.println("VOXELLUME_TEST_PASSED=accept_ruby_block_drops");
        helper.succeed();
    }

    private RubyToolsGameTests() {}
}
`;

const forgeSource = `package dev.voxellume.ruby_tools;

import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestAssertException;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.block.Block;
import net.minecraftforge.gametest.GameTestHolder;
import net.minecraftforge.gametest.PrefixGameTestTemplate;

@GameTestHolder("ruby_tools")
@PrefixGameTestTemplate(false)
public final class RubyToolsGameTests {
    @GameTest(template = "empty")
    public static void test_accept_ruby_blade_damage(GameTestHelper helper) {
        ResourceLocation id = ResourceLocation.fromNamespaceAndPath("ruby_tools", "ruby_blade");
        if (!BuiltInRegistries.ITEM.containsKey(id)) {
            throw new GameTestAssertException("Expected registered item ruby_tools:ruby_blade");
        }
        System.out.println("VOXELLUME_TEST_PASSED=accept_ruby_blade_damage");
        helper.succeed();
    }

    @GameTest(template = "empty")
    public static void test_accept_ruby_block_drops(GameTestHelper helper) {
        ResourceLocation id = ResourceLocation.fromNamespaceAndPath("ruby_tools", "ruby_block");
        if (!BuiltInRegistries.BLOCK.containsKey(id)) {
            throw new GameTestAssertException("Expected registered block ruby_tools:ruby_block");
        }
        Block block = BuiltInRegistries.BLOCK.get(id);
        BlockPos pos = new BlockPos(1, 1, 1);
        helper.setBlock(pos, block.defaultBlockState());
        helper.assertBlockPresent(block, pos);
        System.out.println("VOXELLUME_TEST_PASSED=accept_ruby_block_drops");
        helper.succeed();
    }

    private RubyToolsGameTests() {}
}
`;

const fabricClientSource = `package dev.voxellume.ruby_tools;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.gametest.framework.GameTestAssertException;
import net.minecraft.resources.ResourceLocation;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;

@SuppressWarnings("UnstableApiUsage")
public final class RubyToolsGameTests implements FabricClientGameTest {
    @Override
    public void runTest(ClientGameTestContext context) {
        try (TestSingleplayerContext singleplayer = context.worldBuilder().create()) {
            ResourceLocation id = ResourceLocation.fromNamespaceAndPath("ruby_tools", "ruby_blade");
            if (!BuiltInRegistries.ITEM.containsKey(id)) {
                throw new GameTestAssertException("Expected registered item ruby_tools:ruby_blade");
            }
            System.out.println("VOXELLUME_TEST_PASSED=accept_ruby_blade_damage");
            singleplayer.getClientLevel().waitForChunksRender();
        }
    }
}
`;

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function specFixture(options?: {
  clientOnly?: boolean;
  reverse?: boolean;
}): Promise<ModSpec> {
  const document = await readJson(
    new URL("../../fixtures/mod-spec/valid.json", import.meta.url).pathname,
  );
  const acceptance = document.acceptance as Record<string, unknown>[];
  acceptance[0]!.expected = {
    kind: "item_registered",
    id: "ruby_tools:ruby_blade",
  };
  acceptance[1]!.expected = {
    kind: "block_placed",
    id: "ruby_tools:ruby_block",
  };
  if (options?.clientOnly) acceptance[1]!.kind = "server";
  if (options?.reverse) document.acceptance = acceptance.reverse();
  const result = validateModSpec(document);
  assert.equal(result.status, "valid");
  if (result.status !== "valid") throw new Error("Invalid test ModSpec");
  return result.spec;
}

async function targetFixture(
  loader: "fabric" | "neoforge" | "forge" | "quilt",
  task?: "runGametest" | "runClientGameTest" | "runGameTestServer",
): Promise<TargetPack> {
  const directory = new URL(
    `../../target-packs/java/${loader}/1.21.1/`,
    import.meta.url,
  );
  const [pack, docs, verification] = await Promise.all([
    readJson(new URL("target.json", directory).pathname),
    readJson(new URL("docs.json", directory).pathname),
    readJson(new URL("verification.json", directory).pathname),
  ]);
  const checks = verification.checks as Record<string, unknown>;
  if (task !== undefined) {
    checks.gameTest = {
      argv: ["./gradlew", "--no-daemon", task],
      assertions: [],
      artifactGlobs: [],
    };
  }
  return {
    ...pack,
    status: "supported",
    docs,
    verification: {
      ...verification,
      capabilities: {
        ...(verification.capabilities as Record<string, unknown>),
        gameTest: task !== undefined,
      },
      checks,
      evidenceManifest: {
        path: `qualification/${String(pack.id)}/result.json`,
        sha256: "f".repeat(64),
      },
    },
  } as unknown as TargetPack;
}

function generateFor(
  spec: ModSpec,
  target: TargetPack,
  variant: "server" | "client" = "server",
): GameTestGenerationResult {
  spec.targetPackId = target.id;
  spec.targetPackRevision = target.revision;
  return generateGameTests({ spec, target, variant });
}

function expectGenerated(result: GameTestGenerationResult): GeneratedGameTests {
  assert.equal(result.status, "generated");
  if (result.status !== "generated") throw new Error("Generation unavailable");
  return result;
}

function generatedFile(plan: GeneratedGameTests, path: string): Buffer {
  const file = plan.files.find((candidate) => candidate.outputPath === path);
  assert.ok(file, `Missing generated file ${path}`);
  return Buffer.from(file.contents);
}

function passingLog(ids: readonly string[] = requiredTests): string {
  const markers = ids
    .map((id) => `[Server thread/INFO]: VOXELLUME_TEST_PASSED=${id}`)
    .join("\n");
  return `${markers}\n[Server thread/INFO]: ========= ${ids.length} GAME TESTS COMPLETE IN 182.8 ms ==============\n[Server thread/INFO]: All ${ids.length} required tests passed :)`;
}

test("Fabric server generation is deterministic and emits exact Java and structure NBT", async () => {
  const spec = await specFixture({ reverse: true });
  const target = await targetFixture("fabric", "runGametest");
  const plan = expectGenerated(generateFor(spec, target));

  assert.equal(plan.task, "runGametest");
  assert.deepEqual(plan.argv, ["./gradlew", "--no-daemon", "runGametest"]);
  assert.deepEqual(plan.requiredTests, requiredTests);
  assert.deepEqual(
    plan.files.map((file) => file.outputPath),
    [javaPath, structurePath, fabricMetadataPath],
  );
  assert.equal(
    generatedFile(plan, javaPath).toString("utf8"),
    fabricServerSource,
  );
  assert.deepEqual(
    JSON.parse(generatedFile(plan, fabricMetadataPath).toString("utf8")),
    {
      entrypoints: {
        "fabric-gametest": ["dev.voxellume.ruby_tools.RubyToolsGameTests"],
      },
    },
  );

  const structure = generatedFile(plan, structurePath);
  assert.deepEqual([...structure.subarray(0, 2)], [0x1f, 0x8b]);
  assert.equal(
    gunzipSync(structure).toString("hex"),
    "0a000003000b4461746156657273696f6e00000f7309000473697a65030000000300000003000000030000000309000770616c657474650a000000010800044e616d65000d6d696e6563726166743a61697200090006626c6f636b730a00000001090003706f73030000000300000000000000000000000003000573746174650000000000090008656e7469746965730a0000000000",
  );
  assert.equal(structurePath.includes("/structures/"), false);

  const repeated = expectGenerated(generateFor(spec, target));
  assert.deepEqual(
    repeated.files.map((file) => [file.outputPath, [...file.contents]]),
    plan.files.map((file) => [file.outputPath, [...file.contents]]),
  );
});

test("NeoForge uses its holder annotations and runGameTestServer", async () => {
  const plan = expectGenerated(
    generateFor(
      await specFixture(),
      await targetFixture("neoforge", "runGameTestServer"),
    ),
  );
  assert.equal(plan.task, "runGameTestServer");
  assert.equal(generatedFile(plan, javaPath).toString("utf8"), neoForgeSource);
  assert.ok(generatedFile(plan, structurePath).length > 0);
});

test("Forge uses Forge holder annotations without NeoForge substitution", async () => {
  const plan = expectGenerated(
    generateFor(
      await specFixture(),
      await targetFixture("forge", "runGameTestServer"),
    ),
  );
  assert.equal(plan.task, "runGameTestServer");
  assert.equal(generatedFile(plan, javaPath).toString("utf8"), forgeSource);
  assert.equal(forgeSource.includes("neoforged"), false);
});

test("Fabric client generation uses the client task, source set, and native API", async () => {
  const plan = expectGenerated(
    generateFor(
      await specFixture({ clientOnly: true }),
      await targetFixture("fabric", "runClientGameTest"),
      "client",
    ),
  );
  const clientJavaPath =
    "src/client/java/dev/voxellume/ruby_tools/RubyToolsGameTests.java";
  assert.equal(plan.task, "runClientGameTest");
  assert.deepEqual(plan.requiredTests, ["accept_ruby_blade_damage"]);
  assert.deepEqual(
    plan.files.map((file) => file.outputPath),
    [clientJavaPath, fabricClientMetadataPath],
  );
  assert.equal(
    generatedFile(plan, clientJavaPath).toString("utf8"),
    fabricClientSource,
  );
  assert.deepEqual(
    JSON.parse(generatedFile(plan, fabricClientMetadataPath).toString("utf8")),
    {
      entrypoints: {
        "fabric-client-gametest": [
          "dev.voxellume.ruby_tools.RubyToolsGameTests",
        ],
      },
    },
  );
});

test("Java identifiers stay valid even when an acceptance ID is a Java keyword", async () => {
  const spec = await specFixture({ clientOnly: true });
  spec.acceptance[0]!.id = "class";
  const target = await targetFixture("fabric", "runGametest");
  const source = generatedFile(
    expectGenerated(generateFor(spec, target)),
    javaPath,
  ).toString("utf8");
  assert.match(source, /public static void test_class\(/);
  assert.doesNotMatch(source, /public static void class\(/);
});

test("numeric metadata names still produce a valid Java class", async () => {
  const spec = await specFixture({ clientOnly: true });
  spec.metadata.name = "123 Ruby";
  const plan = expectGenerated(
    generateFor(spec, await targetFixture("fabric", "runGametest")),
  );
  const numericJavaPath =
    "src/main/java/dev/voxellume/ruby_tools/GameTests123RubyGameTests.java";
  const source = generatedFile(plan, numericJavaPath).toString("utf8");
  assert.match(source, /public final class GameTests123RubyGameTests \{/);
  assert.match(source, /public GameTests123RubyGameTests\(\) \{\}/);
  assert.deepEqual(
    JSON.parse(generatedFile(plan, fabricMetadataPath).toString("utf8")),
    {
      entrypoints: {
        "fabric-gametest": [
          "dev.voxellume.ruby_tools.GameTests123RubyGameTests",
        ],
      },
    },
  );
});

test("a missing block cannot fall back to the registry's AIR default", async () => {
  const source = generatedFile(
    expectGenerated(
      generateFor(
        await specFixture(),
        await targetFixture("fabric", "runGametest"),
      ),
    ),
    javaPath,
  ).toString("utf8");
  const guard = source.indexOf("if (!BuiltInRegistries.BLOCK.containsKey(id))");
  const lookup = source.indexOf(
    "Block block = BuiltInRegistries.BLOCK.get(id);",
  );
  assert.ok(guard >= 0, "Missing block registry membership guard");
  assert.ok(lookup > guard, "Block lookup must follow the membership guard");
  assert.doesNotMatch(source, /if \(block == null\)/);
});

test("GameTestHolder uses modId rather than the resource namespace", async () => {
  const spec = await specFixture();
  spec.modId = "ruby_mod";
  spec.namespace = "ruby_tools";
  const source = generatedFile(
    expectGenerated(
      generateFor(spec, await targetFixture("neoforge", "runGameTestServer")),
    ),
    javaPath,
  ).toString("utf8");
  assert.match(source, /@GameTestHolder\("ruby_mod"\)/);
  assert.doesNotMatch(source, /@GameTestHolder\("ruby_tools"\)/);
});

test("generation never injects behavior, fixture, or arbitrary expectation code", async () => {
  const spec = await specFixture();
  const attack = '"; System.exit(0); // arbitrary model code';
  spec.acceptance[0]!.behavior = attack;
  spec.acceptance[0]!.fixture = attack;
  const target = await targetFixture("fabric", "runGametest");
  const source = generatedFile(
    expectGenerated(generateFor(spec, target)),
    javaPath,
  ).toString("utf8");
  assert.equal(source.includes(attack), false);
  assert.equal(source.includes("System.exit"), false);

  spec.acceptance[0]!.expected = {
    kind: "java",
    code: "throw new RuntimeException(modelSuppliedCode);",
  };
  assert.deepEqual(generateFor(spec, target), {
    status: "unsupported",
    code: "unsupported_game_test_expectation",
    acceptanceId: "accept_ruby_blade_damage",
  });
});

test("Quilt is unavailable without explicit pack GameTest proof", async () => {
  const spec = await specFixture();
  const target = await targetFixture("quilt");
  assert.deepEqual(generateFor(spec, target), {
    status: "unavailable",
    code: "game_test_unavailable",
    targetPackId: target.id,
  });
});

test("a loader cannot borrow another loader's task", async () => {
  const spec = await specFixture();
  for (const [loader, task] of [
    ["fabric", "runGameTestServer"],
    ["neoforge", "runGametest"],
    ["forge", "runClientGameTest"],
  ] as const) {
    const target = await targetFixture(loader, task);
    assert.deepEqual(generateFor(spec, target), {
      status: "unavailable",
      code: "game_test_task_mismatch",
      targetPackId: target.id,
    });
  }
});

test("extra Gradle tasks in the pack argv are rejected", async () => {
  const target = await targetFixture("fabric", "runGametest");
  const check = target.verification.checks.gameTest;
  assert.ok(check);
  const contaminated: TargetPack = {
    ...target,
    verification: {
      ...target.verification,
      checks: {
        ...target.verification.checks,
        gameTest: {
          ...check,
          argv: [
            "./gradlew",
            "--no-daemon",
            "runGameTestServer",
            "runGametest",
          ],
        },
      },
    },
  };
  assert.deepEqual(generateFor(await specFixture(), contaminated), {
    status: "unavailable",
    code: "game_test_task_mismatch",
    targetPackId: target.id,
  });
});

test("log evaluation requires exit zero, completion, summary, and every required test", () => {
  assert.deepEqual(
    evaluateGameTestResult({
      requiredTests,
      processStatus: "completed",
      exitCode: 0,
      log: passingLog(),
    }),
    {
      status: "passed",
      total: 2,
      passedTests: requiredTests,
    },
  );
});

test("a passing log cannot hide a nonzero exit", () => {
  assert.deepEqual(
    evaluateGameTestResult({
      requiredTests,
      processStatus: "completed",
      exitCode: 1,
      log: passingLog(),
    }),
    {
      status: "failed",
      code: "exit_nonzero",
      total: 2,
      passedTests: requiredTests,
    },
  );
});

test("completion without the required-tests-passed summary fails", () => {
  const log = passingLog().replace("All 2 required tests passed :)", "Done");
  assert.deepEqual(
    evaluateGameTestResult({
      requiredTests,
      processStatus: "completed",
      exitCode: 0,
      log,
    }),
    {
      status: "failed",
      code: "missing_pass_summary",
      total: 2,
      passedTests: requiredTests,
    },
  );
});

test("full-line parsing rejects marker and pass-summary lookalikes", () => {
  const fixtures = [
    {
      name: "prefixed negative marker",
      log: passingLog().replace(
        "VOXELLUME_TEST_PASSED=accept_ruby_blade_damage",
        "NOT_VOXELLUME_TEST_PASSED=accept_ruby_blade_damage",
      ),
      code: "missing_required_tests",
      passedTests: ["accept_ruby_block_drops"],
    },
    {
      name: "negated pass summary",
      log: passingLog().replace(
        "All 2 required tests passed :)",
        "Not All 2 required tests passed :)",
      ),
      code: "missing_pass_summary",
      passedTests: requiredTests,
    },
  ] as const;

  for (const fixture of fixtures) {
    assert.deepEqual(
      evaluateGameTestResult({
        requiredTests,
        processStatus: "completed",
        exitCode: 0,
        log: fixture.log,
      }),
      {
        status: "failed",
        code: fixture.code,
        total: 2,
        passedTests: fixture.passedTests,
      },
      fixture.name,
    );
  }
});

test("pass summary without GAME TESTS COMPLETE fails", () => {
  const log = passingLog().replace(/.*GAME TESTS COMPLETE.*\n/, "");
  assert.deepEqual(
    evaluateGameTestResult({
      requiredTests,
      processStatus: "completed",
      exitCode: 0,
      log,
    }),
    {
      status: "failed",
      code: "missing_completion",
      total: 0,
      passedTests: requiredTests,
    },
  );
});

test("Missing test structure is rejected even with passing markers and summaries", () => {
  assert.deepEqual(
    evaluateGameTestResult({
      requiredTests,
      processStatus: "completed",
      exitCode: 0,
      log: `java.lang.IllegalStateException: Missing test structure: ruby_tools:empty\n${passingLog()}`,
    }),
    {
      status: "failed",
      code: "missing_test_structure",
      total: 2,
      passedTests: requiredTests,
    },
  );
});

test("deliberate failing negative control cannot pass verification", () => {
  const negativeControl = ["voxellume_negative_control"] as const;
  const log = `[Server thread/INFO]: VOXELLUME_TEST_FAILED=voxellume_negative_control\n[Server thread/INFO]: ========= 1 GAME TESTS COMPLETE IN 20 ms ==============\n[Server thread/INFO]: 1 required tests failed :(`;
  assert.deepEqual(
    evaluateGameTestResult({
      requiredTests: negativeControl,
      processStatus: "completed",
      exitCode: 1,
      log,
    }),
    {
      status: "failed",
      code: "required_tests_failed",
      total: 1,
      passedTests: [],
    },
  );
});

test("missing, skipped, and unknown tests never pass", () => {
  const cases = [
    {
      name: "missing required marker",
      log: `[Server thread/INFO]: VOXELLUME_TEST_PASSED=accept_ruby_blade_damage\n[Server thread/INFO]: ========= 2 GAME TESTS COMPLETE IN 20 ms ==============\n[Server thread/INFO]: All 2 required tests passed :)`,
      code: "missing_required_tests",
      passedTests: ["accept_ruby_blade_damage"],
    },
    {
      name: "skipped required test",
      log: `[Server thread/INFO]: VOXELLUME_TEST_PASSED=accept_ruby_blade_damage\n[Server thread/INFO]: VOXELLUME_TEST_SKIPPED=accept_ruby_block_drops\n[Server thread/INFO]: ========= 2 GAME TESTS COMPLETE IN 20 ms ==============\n[Server thread/INFO]: 1 required tests skipped`,
      code: "skipped_tests",
      passedTests: ["accept_ruby_blade_damage"],
    },
    {
      name: "unknown passed test",
      log: `${passingLog()}\n[Server thread/INFO]: VOXELLUME_TEST_PASSED=model_invented_test`,
      code: "unknown_tests",
      passedTests: requiredTests,
    },
    {
      name: "summary contains an unaccounted test",
      log: passingLog()
        .replace("========= 2 GAME TESTS", "========= 3 GAME TESTS")
        .replace("All 2 required", "All 3 required"),
      code: "unknown_tests",
      passedTests: requiredTests,
    },
  ] as const;

  for (const fixture of cases) {
    assert.deepEqual(
      evaluateGameTestResult({
        requiredTests,
        processStatus: "completed",
        exitCode: 0,
        log: fixture.log,
      }),
      {
        status: "failed",
        code: fixture.code,
        total: fixture.name === "summary contains an unaccounted test" ? 3 : 2,
        passedTests: fixture.passedTests,
      },
      fixture.name,
    );
  }
});

test("timeout, cancellation, and unavailable execution preserve their status", () => {
  for (const processStatus of [
    "timed_out",
    "cancelled",
    "unavailable",
  ] as const) {
    assert.deepEqual(
      evaluateGameTestResult({
        requiredTests,
        processStatus,
        exitCode: null,
        log: passingLog(),
      }),
      {
        status: processStatus,
        total: 0,
        passedTests: [],
      },
    );
  }
});
