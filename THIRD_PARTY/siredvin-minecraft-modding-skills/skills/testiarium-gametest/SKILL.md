---
name: testiarium-gametest
description: Build cross-loader GameTests with Testiarium.
license: MIT
compatibility: Minecraft 1.20.1 with Java 17 and Forge 47.x/Fabric; Minecraft 1.21.1 with Java 21 and NeoForge 21.1.x/Fabric.
metadata:
  version: "1.1.0"
  author: Hermes
---

# Testiarium GameTest

Use this skill for the Testiarium cross-loader GameTest framework. Testiarium supplies loader-neutral test registration, grouping, assertions, client automation, fixture commands, reports, and an optional CC:Tweaked harness for Minecraft 1.20.1 and 1.21.1.

## First Checks

- Confirm the Minecraft line before changing code: 1.20.1 uses Java 17 and Forge 47.x/Fabric, while 1.21.1 uses Java 21 and NeoForge 21.1.x/Fabric.
- Identify the loader and test source sets before editing Gradle: core/shared tests should remain loader-neutral, while Forge, NeoForge, and Fabric bootstrap code belongs in their loader modules.
- Determine which Testiarium layer is actually available. Registration, grouping, generic assertions, and reporting are in the main artifacts. Fixture commands, client helpers, structure mixins, and CC:Tweaked helpers are testmod facilities and require corresponding test-only outputs and dependencies.
- Inspect the project's existing testmod source-set wiring and run configurations. Do not assume adding the production Testiarium artifact exposes testmod or CCT packages.
- Keep Testiarium and all test-only integrations out of published runtime dependencies unless the mod intentionally exposes them.
- Prefer explicit structure names and test groups. Generated names use only `<SimpleClassName>.<methodName>` and can collide across packages.

## Load Detailed Workflows

- [Loader runs and source-set integration](references/loader-runs.md): load before choosing dependencies, tasks, or copying loader DSL.
- [Structures and fixtures](references/fixtures.md): SNBT import/export and version-specific mixins.
- [Automated client tests](references/client-tests.md): graphics prerequisites, external deadlines, screenshots, and exit codes.
- [Optional CCT harness](references/cct-harness.md): lifecycle, Lua fixtures, scheduler synchronization, and terminal success.

## Architecture

Testiarium is split into these responsibilities:

| Layer | Responsibility |
|---|---|
| Core main API | `Testiarium`, annotations, groups, sequences, assertions, and reporters |
| Forge 1.20 adapter | Forge lifecycle and `RegisterGameTestsEvent` integration |
| NeoForge adapter | NeoForge lifecycle and `RegisterGameTestsEvent` integration |
| Fabric adapter | Fabric lifecycle and vanilla `GameTestRegistry` integration |
| Generic testmod tooling | Fixture commands, structure mixins, client runner, screenshots |
| CCT testmod tooling | CC:Tweaked computer actions, Lua markers, assertions, and fixture import |

Keep generic tests in a shared test source set. Put loader entrypoints, event registration, metadata, and client bootstrap in matching Forge, NeoForge, or Fabric test source sets.

## Register Tests

Always collect classes before the loader scans or emits its GameTest registration event.

Fabric on both versions scans immediately:

```kotlin
Testiarium.register(MyGameTests::class.java)
FabricTestiarium.registerTests()
```

```java
Testiarium.register(MyGameTests.class);
// Minecraft 1.20.1 Forge only:
ForgeTestiarium.registerTests();
```

Registration is one-shot per process:

- Fabric scans immediately when `FabricTestiarium.registerTests()` is called. Classes added afterward are not discovered.
- Forge 1.20 installs its listener when `ForgeTestiarium.registerTests()` is called. Call it after collecting classes and before `RegisterGameTestsEvent`.
- NeoForge installs its `RegisterGameTestsEvent` listener when the Testiarium mod is constructed. Testmods only call `Testiarium.register(...)`; all mod constructors run before the event.
- Register all Fabric classes before the first adapter call. Repeated Fabric and Forge 1.20 adapter calls are no-ops. NeoForge classes may be contributed by multiple testmod constructors before the registration event.
- Non-static test methods require a public zero-argument constructor. Kotlin classes with no constructor parameters satisfy this by default.
- Keep unrelated helper methods outside registered classes when practical. Testiarium passes enabled, unrecognized declared methods to the loader's fallback GameTest registrar.

Loader-specific entrypoint examples are in the [loader integration reference](references/loader-runs.md).

## Write Server GameTests

Use vanilla `@GameTest` with Testiarium's sequence and assertion extensions:

```kotlin
@TestGroup("example")
class ExampleGameTests {
    @GameTest(template = "examplegametests.places_block")
    fun placesBlock(helper: GameTestHelper) = helper.sequence {
        thenExecuteFailFast {
            helper.assertBlock(BlockPos(1, 1, 1), { !it.isAir }, "Expected a block")
        }
    }
}
```

`helper.sequence { ... }` creates a sequence and automatically appends `thenSucceed()`. Do not add another terminal success step to that wrapper. A raw `helper.startSequence()` or `helper.thenLua()` instead needs its own terminal success step.

Use `helper.immediate { ... }` for synchronous assertions followed by immediate success:

```kotlin
@GameTest(template = "empty")
fun recipeExists(helper: GameTestHelper) = helper.immediate {
    helper.assertCraftable(inputs, expectedOutput)
}
```

Useful generic helpers include:

- `thenExecuteFailFast { ... }`: executes an assertion without allowing later sequence steps to hide its failure. On 1.21, the generic testmod must load `GameTestSequenceMixin` and inspect the parent `GameTestInfo.error`; retain the existing 1.20 implementation when targeting 1.20.1.
- `assertBlock(pos, predicate, message)` and `assertBlockProperty(pos, property, expected)`.
- `getContainer(pos)` and `assertContainer(pos, expectedStacks)`.
- `getBlockEntity(pos, type)` and `getEntity(type)`.
- `assertItemCount(item, expected)` and `assertCraftable(inputs, expected)`.

Be precise with their scopes:

- `getEntity` requires exactly one matching entity within 64 blocks of the test origin.
- `assertItemCount` counts all matching dropped items in that radius.
- `assertContainer` checks actual slots and treats omitted expected slots as empty; it does not detect expected entries beyond the real container size.
- On 1.21, `thenExecuteFailFast` checks the parent `GameTestInfo.error`; use meaningful assertion messages because that failure is propagated to the report.

## Groups And Properties

Apply `@TestGroup("name")` to a class or method. A method annotation overrides its class annotation. Ungrouped vanilla tests default to `common`; `@ClientGameTest` defaults to `client`.

Enable groups with an exact comma-separated JVM property:

```text
-Dtestiarium.tags=common,example
```

Tag names are case-sensitive, whitespace is not trimmed, and the property is read once. Use `common,client`, not `common, client`. Enabling `client` does not implicitly enable `common`.

Other properties:

| Property | Purpose |
|---|---|
| `testiarium.structures` | Runtime SNBT structure directory |
| `testiarium.fixture-source` | Editable/source SNBT directory used by fixture commands |
| `testiarium.gametest-report` | JUnit XML output; Testiarium also writes sibling HTML |
| `testiarium.client` | Enables the automated client runner when the property is present |
| `testiarium.screenshots` | Client screenshot output directory |
| `testiarium.cct-fixtures` | CC:Tweaked computer fixture root |

## Reports And CI

Set a report destination in the run configuration:

```text
-Dtestiarium.gametest-report=build/test-results/gametest.xml
```

Testiarium writes JUnit XML plus an HTML file with the same basename. Required failures are failures; non-required vanilla GameTest failures are reported as skipped. Reports finish during server shutdown or client completion, so a forcibly killed process may not produce one.

GameTest runs are Minecraft `JavaExec` tasks, not JUnit `Test` tasks. `./gradlew test` does not replace running the configured GameTest server/client task. CI must invoke the relevant loader task and preserve its exit status and report files.

## Debugging Checklist

- No tests discovered: verify class registration occurs before Fabric scanning, Forge 1.20 listener installation, or NeoForge's `RegisterGameTestsEvent`, and verify the group is enabled.
- Structure missing: check the explicit template name, namespace, `testiarium.structures`, fixture import, and stale runtime files.
- Reflection failure: make the test method static or give its class a public zero-argument constructor.
- Client run hangs: verify client hooks and mixins are loaded, use `xvfb-run`, inspect rendering logs, and retain an external timeout.
- Client run exits 1: the `client` group probably selected no registered tests.
- Report missing: set `testiarium.gametest-report` and allow orderly server/client shutdown.
- CCT test never completes: verify early `CctComputers.initialize()`, server-start reset/import, computer label, fixture directory, Lua `test.ok()`, a sufficient `timeoutTicks`, and the CCT `GameTestServerMixin`.
- CCT error is logged but the test passes: verify `GameTestSequenceMixin` and 1.21 `thenExecuteFailFast` semantics are active. A terminal `thenSucceed()` must not overwrite a Lua or sequence failure.
- NeoForge peripheral is missing: verify the mod has an `@Mod` entrypoint, deferred registries attach to the mod bus, and the CC:Tweaked peripheral `BlockCapability` is registered before testing discovery.
- Fabric-only registration issue: ensure every class is registered before the first `FabricTestiarium.registerTests()` call.
- Dedicated server classloading failure: move all client fixture references behind loader-specific physical-client boundaries.

## Validation

- Run the smallest affected server GameTest task first.
- Run both loader targets for the selected Minecraft line: Forge/Fabric on 1.20.1 or NeoForge/Fabric on 1.21.1.
- Run CCT tasks when changing computer fixtures, labels, Lua scripts, peripherals, or CCT lifecycle wiring.
- Run client tasks under `xvfb-run` with a timeout after changing screens, menus, rendering, screenshots, or client hooks.
- Inspect generated XML and HTML reports, not only process output.
- Verify test-only dependencies and source-set outputs do not leak into published runtime artifacts.

## Pinned Source Scope

This skill is checked against [Minecraft-Modding-Libs at 86bfe0b75d0dceb26e713a6c3bdcc91ec74eac2c](https://github.com/SirEdvin/Minecraft-Modding-Libs/tree/86bfe0b75d0dceb26e713a6c3bdcc91ec74eac2c/projects/testiarium), whose `gradle.properties` declares Testiarium `2.0.0`. This is a source baseline, not proof that all feature artifacts are published or compatible with older releases. Historical `testiarium-core`/`testiarium-forge`/`testiarium-fabric` module paths have moved to `projects/testiarium` and its loader branches. See the loader reference for exact pinned paths and run configurations.
