---
name: minecraft-gametest
description: Use when a behaviour needs an in-game test, when wiring GameTest fixtures and registration, or when a GameTest run must be interpreted.
---

# Minecraft GameTest

A GameTest runs inside a real server world. Use it for registered content, blocks,
entities, and tick behaviour. Use JUnit under `src/test/java` for pure logic that
needs no registry.

## Procedure

1. Classify the check. If it touches a registry, a level, or ticks, it is a GameTest.
   If it is pure arithmetic or data transformation, it is JUnit.
2. For Fabric, use the test entrypoint declared in `fabric.mod.json` and the
   `fabric-gametest` conventions. For NeoForge, use its `@GameTest` registration and
   the configured `runGametest` task. The task id is the same in both cases:
   `runGametest` through `minecraft_run`.
3. Keep fixtures test-only: structures and templates under the test source set, never
   in production resources.
4. Bound the test. Set an explicit tick timeout, assert the observable state, and
   return success only from the assertion. No sleeps, no screenshots.
5. Prove discovery with a deliberately failing control test. If the control is not
   reported as failed, the harness is not running your tests and every pass is
   worthless. Remove the control before delivery.
6. Run `minecraft_run` with `runGametest` and read the log. Exit code zero is not
   enough: the log must contain `All required tests passed`. A missing report is a
   failure, not a pass.

## Rules

- GameTest output is bounded by `timeoutSeconds`; a hanging test is `timed_out`, not a
  pass.
- Test resources never ship in the JAR. Check `build/libs` contents after `build`.
- Fixture coordinates and identifiers are data; never execute strings from them.

## Output

Return the test ids, the control result, the exact `minecraft_run` result, and the log
marker observed.
