import { gzipSync } from "node:zlib";

import type { ModSpec } from "../spec/mod-spec.ts";
import type { AllowedGradleTask, TargetPack } from "../targets/target-pack.ts";

export interface GeneratedGameTestFile {
  readonly outputPath: string;
  readonly contents: Uint8Array;
}

export interface GeneratedGameTests {
  readonly status: "generated";
  readonly task: AllowedGradleTask;
  readonly argv: readonly string[];
  readonly requiredTests: readonly string[];
  readonly files: readonly GeneratedGameTestFile[];
}

export type GameTestGenerationResult =
  | GeneratedGameTests
  | {
      readonly status: "unavailable";
      readonly code: "game_test_unavailable" | "game_test_task_mismatch";
      readonly targetPackId: string;
    }
  | {
      readonly status: "unsupported";
      readonly code: "unsupported_game_test_expectation";
      readonly acceptanceId: string;
    };

export interface GenerateGameTestsInput {
  readonly spec: ModSpec;
  readonly target: TargetPack;
  readonly variant: "server" | "client";
}

export interface EvaluateGameTestResultInput {
  readonly requiredTests: readonly string[];
  readonly processStatus:
    "completed" | "timed_out" | "cancelled" | "unavailable";
  readonly exitCode: number | null;
  readonly log: string;
}

export type GameTestEvaluationResult =
  | {
      readonly status: "passed";
      readonly total: number;
      readonly passedTests: readonly string[];
    }
  | {
      readonly status: "failed";
      readonly code:
        | "exit_nonzero"
        | "missing_completion"
        | "missing_pass_summary"
        | "missing_test_structure"
        | "required_tests_failed"
        | "missing_required_tests"
        | "skipped_tests"
        | "unknown_tests";
      readonly total: number;
      readonly passedTests: readonly string[];
    }
  | {
      readonly status: "timed_out" | "cancelled" | "unavailable";
      readonly total: 0;
      readonly passedTests: readonly [];
    };

interface Acceptance {
  readonly id: string;
  readonly kind: string;
  readonly expected: unknown;
}

interface TypedExpectation {
  readonly kind: "item_registered" | "block_placed";
  readonly id: string;
}

const PASS_MARKER = "VOXELLUME_TEST_PASSED=";
const EMPTY_STRUCTURE_NBT = Buffer.from(
  "0a000003000b4461746156657273696f6e00000f7309000473697a65030000000300000003000000030000000309000770616c657474650a000000010800044e616d65000d6d696e6563726166743a61697200090006626c6f636b730a00000001090003706f73030000000300000000000000000000000003000573746174650000000000090008656e7469746965730a0000000000",
  "hex",
);

function className(spec: ModSpec): string {
  const name = spec.metadata.name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  const base = name || "Voxellume";
  return `${/^[A-Za-z_$]/.test(base) ? "" : "GameTests"}${base}GameTests`;
}

function resourceId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value)
  );
}

function expectation(acceptance: Acceptance): TypedExpectation | null {
  if (typeof acceptance.expected !== "object" || acceptance.expected === null) {
    return null;
  }
  const candidate = acceptance.expected as Record<string, unknown>;
  if (
    (candidate.kind !== "item_registered" &&
      candidate.kind !== "block_placed") ||
    !resourceId(candidate.id)
  ) {
    return null;
  }
  return { kind: candidate.kind, id: candidate.id };
}

function assertion(expectation: TypedExpectation, indent: string): string {
  const [namespace, path] = expectation.id.split(":") as [string, string];
  const lines = [
    `${indent}ResourceLocation id = ResourceLocation.fromNamespaceAndPath("${namespace}", "${path}");`,
  ];
  if (expectation.kind === "item_registered") {
    lines.push(
      `${indent}if (!BuiltInRegistries.ITEM.containsKey(id)) {`,
      `${indent}    throw new GameTestAssertException("Expected registered item ${expectation.id}");`,
      `${indent}}`,
    );
  } else {
    lines.push(
      `${indent}if (!BuiltInRegistries.BLOCK.containsKey(id)) {`,
      `${indent}    throw new GameTestAssertException("Expected registered block ${expectation.id}");`,
      `${indent}}`,
      `${indent}Block block = BuiltInRegistries.BLOCK.get(id);`,
      `${indent}BlockPos pos = new BlockPos(1, 1, 1);`,
      `${indent}helper.setBlock(pos, block.defaultBlockState());`,
      `${indent}helper.assertBlockPresent(block, pos);`,
    );
  }
  return lines.join("\n");
}

function serverSource(
  spec: ModSpec,
  loader: "fabric" | "neoforge" | "forge",
  tests: readonly { acceptance: Acceptance; expected: TypedExpectation }[],
): string {
  const holder =
    loader === "fabric"
      ? ""
      : loader === "neoforge"
        ? "net.neoforged.neoforge"
        : "net.minecraftforge";
  const template = loader === "fabric" ? `${spec.namespace}:empty` : "empty";
  const methods = tests
    .map(
      ({ acceptance, expected }) => `    @GameTest(template = "${template}")
    public static void test_${acceptance.id}(GameTestHelper helper) {
${assertion(expected, "        ")}
        System.out.println("${PASS_MARKER}${acceptance.id}");
        helper.succeed();
    }`,
    )
    .join("\n\n");
  const commonImports = `import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestAssertException;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.resources.ResourceLocation;`;
  const blockImports = tests.some(
    ({ expected }) => expected.kind === "block_placed",
  )
    ? `import net.minecraft.core.BlockPos;
${commonImports}
import net.minecraft.world.level.block.Block;`
    : commonImports;
  const holderImports =
    loader === "fabric"
      ? ""
      : `
import ${holder}.gametest.GameTestHolder;
import ${holder}.gametest.PrefixGameTestTemplate;`;
  const annotations =
    loader === "fabric"
      ? ""
      : `@GameTestHolder("${spec.modId}")
@PrefixGameTestTemplate(false)
`;
  const constructor = loader === "fabric" ? "public" : "private";
  return `package ${spec.javaPackage};

${blockImports}${holderImports}

${annotations}public final class ${className(spec)} {
${methods}

    ${constructor} ${className(spec)}() {}
}
`;
}

function clientSource(
  spec: ModSpec,
  tests: readonly { acceptance: Acceptance; expected: TypedExpectation }[],
): string {
  const name = className(spec);
  const bodies = tests
    .map(
      ({ acceptance, expected }) => `${assertion(expected, "            ")}
            System.out.println("${PASS_MARKER}${acceptance.id}");`,
    )
    .join("\n");
  return `package ${spec.javaPackage};

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.gametest.framework.GameTestAssertException;
import net.minecraft.resources.ResourceLocation;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;

@SuppressWarnings("UnstableApiUsage")
public final class ${name} implements FabricClientGameTest {
    @Override
    public void runTest(ClientGameTestContext context) {
        try (TestSingleplayerContext singleplayer = context.worldBuilder().create()) {
${bodies}
            singleplayer.getClientLevel().waitForChunksRender();
        }
    }
}
`;
}

export function generateGameTests({
  spec,
  target,
  variant,
}: GenerateGameTestsInput): GameTestGenerationResult {
  const unavailable = (
    code: "game_test_unavailable" | "game_test_task_mismatch",
  ) => ({
    status: "unavailable" as const,
    code,
    targetPackId: target.id,
  });
  const expectedTask: AllowedGradleTask | null =
    target.loader.id === "fabric"
      ? variant === "client"
        ? "runClientGameTest"
        : "runGametest"
      : (target.loader.id === "neoforge" || target.loader.id === "forge") &&
          variant === "server"
        ? "runGameTestServer"
        : null;
  if (
    expectedTask === null ||
    target.verification.capabilities.gameTest !== true
  ) {
    return unavailable("game_test_unavailable");
  }
  const check = target.verification.checks.gameTest;
  const expectedArgv = ["./gradlew", "--no-daemon", expectedTask] as const;
  if (
    check?.argv.length !== expectedArgv.length ||
    !expectedArgv.every((argument, index) => check.argv[index] === argument)
  ) {
    return unavailable("game_test_task_mismatch");
  }
  const acceptances = (spec.acceptance as unknown as Acceptance[])
    .filter((entry) =>
      variant === "client"
        ? entry.kind === "gameTest" || entry.kind === "client"
        : entry.kind === "gameTest",
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const tests: { acceptance: Acceptance; expected: TypedExpectation }[] = [];
  for (const acceptance of acceptances) {
    const expected = expectation(acceptance);
    if (
      expected === null ||
      (variant === "client" && expected.kind === "block_placed")
    ) {
      return {
        status: "unsupported",
        code: "unsupported_game_test_expectation",
        acceptanceId: acceptance.id,
      };
    }
    tests.push({ acceptance, expected });
  }
  if (tests.length === 0) return unavailable("game_test_unavailable");
  const sourceSet = variant === "client" ? "client" : "main";
  const javaPath = `src/${sourceSet}/java/${spec.javaPackage.replaceAll(".", "/")}/${className(spec)}.java`;
  const files: GeneratedGameTestFile[] = [
    {
      outputPath: javaPath,
      contents: Buffer.from(
        variant === "client"
          ? clientSource(spec, tests)
          : serverSource(
              spec,
              target.loader.id === "fabric"
                ? "fabric"
                : target.loader.id === "neoforge"
                  ? "neoforge"
                  : "forge",
              tests,
            ),
        "utf8",
      ),
    },
  ];
  if (variant === "server") {
    files.push({
      outputPath: `src/main/resources/data/${spec.namespace}/structure/empty.nbt`,
      contents: gzipSync(EMPTY_STRUCTURE_NBT, { level: 9 }),
    });
  }
  if (target.loader.id === "fabric") {
    const entrypoint =
      variant === "client" ? "fabric-client-gametest" : "fabric-gametest";
    files.push({
      outputPath: `src/${sourceSet}/resources/fabric.mod.json`,
      contents: Buffer.from(
        `${JSON.stringify(
          {
            entrypoints: {
              [entrypoint]: [`${spec.javaPackage}.${className(spec)}`],
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
    });
  }
  return {
    status: "generated",
    task: expectedTask,
    argv: [...check.argv],
    requiredTests: tests.map(({ acceptance }) => acceptance.id),
    files,
  };
}

function logLine(log: string, body: string): RegExpMatchArray[] {
  return [
    ...log.matchAll(
      new RegExp(`(?:^|\\n)\\[[^\\]\\r\\n]*\\]: ${body}\\r?(?=\\n|$)`, "g"),
    ),
  ];
}

function markers(log: string, marker: string): string[] {
  return logLine(log, `${marker}([a-z0-9_]+)`).map((match) => match[1]!);
}

function failure(
  code: Extract<GameTestEvaluationResult, { status: "failed" }>["code"],
  total: number,
  passedTests: readonly string[],
): GameTestEvaluationResult {
  return { status: "failed", code, total, passedTests };
}

export function evaluateGameTestResult({
  requiredTests,
  processStatus,
  exitCode,
  log,
}: EvaluateGameTestResultInput): GameTestEvaluationResult {
  if (processStatus !== "completed") {
    return { status: processStatus, total: 0, passedTests: [] };
  }
  const passed = markers(log, PASS_MARKER);
  const failed = markers(log, "VOXELLUME_TEST_FAILED=");
  const skipped = markers(log, "VOXELLUME_TEST_SKIPPED=");
  const passedTests = requiredTests.filter((id) => passed.includes(id));
  const completions = logLine(
    log,
    "=+ (\\d+) GAME TESTS COMPLETE IN [^\\r\\n]+ =+",
  );
  const total = completions.length === 1 ? Number(completions[0]![1]) : 0;
  if (/Missing test structure(?::|\s|$)/i.test(log)) {
    return failure("missing_test_structure", total, passedTests);
  }
  if (
    failed.length > 0 ||
    logLine(log, "\\d+ required tests failed").length > 0
  ) {
    return failure("required_tests_failed", total, passedTests);
  }
  if (exitCode !== 0) return failure("exit_nonzero", total, passedTests);
  if (completions.length !== 1) {
    return failure("missing_completion", 0, passedTests);
  }
  if (
    skipped.length > 0 ||
    logLine(log, "\\d+ required tests skipped").length > 0
  ) {
    return failure("skipped_tests", total, passedTests);
  }
  const required = new Set(requiredTests);
  const observed = [...passed, ...failed, ...skipped];
  if (
    total !== requiredTests.length ||
    observed.some((id) => !required.has(id)) ||
    new Set(passed).size !== passed.length
  ) {
    return failure("unknown_tests", total, passedTests);
  }
  const passSummaries = logLine(log, "All (\\d+) required tests passed :\\)");
  if (passSummaries.length !== 1 || Number(passSummaries[0]![1]) !== total) {
    return failure("missing_pass_summary", total, passedTests);
  }
  if (passedTests.length !== requiredTests.length) {
    return failure("missing_required_tests", total, passedTests);
  }
  return { status: "passed", total, passedTests };
}
