---
name: minecraft-gametest
description: Use when choosing between JUnit and loader-native Minecraft GameTests, wiring test fixtures and registration, or validating required GameTest execution and reports.
---

# Minecraft GameTest

## Inputs

- ModSpec acceptance entries with stable check IDs and independent expected outcomes.
- Exact target pack `docs.json` and `verification.json`, existing test wiring, fixtures, and authorized project/evidence roots.

## Procedure

1. **Classify each acceptance.** Use pure JUnit for deterministic logic that needs no registry or game lifecycle. Use loader-native GameTest for registered content, world/tick behavior, blocks, entities, and real loader lifecycle. Record route, required status, fixture, and expected result for every check.
   **Complete when:** every acceptance has one justified route; game-dependent behavior is not relabeled as a pure unit test.
2. **Inspect the exact pack.** Read its fixed test task, source sets, metadata, registration mechanism, and resource layout. Consult [Jahrome testing](../../THIRD_PARTY/jahrome-minecraft-agent-skills/.agents/skills/minecraft-testing/SKILL.md) and [test layouts](../../THIRD_PARTY/jahrome-minecraft-agent-skills/.agents/skills/minecraft-testing/references/test-layouts.md); pack documents outrank examples.
   **Complete when:** task and layout are observed, not guessed, and match the selected pack revision.
3. **Wire deterministic tests.** Place referenced structures with exact namespace/path, deterministic setup, tick bounds, and behavior assertions. Register tests before the loader's scan/event and keep fixtures, entrypoints, and dependencies test-only. Keep ordinary JUnit in `src/test`; its `test` task never substitutes for GameTest execution.
   **Complete when:** every required test is discoverable, every template reference resolves, and production-output exclusion is checkable.
4. **Gate Testiarium narrowly.** Use [SirEdvin's procedure](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/testiarium-gametest/SKILL.md) only when Testiarium already exists in a qualified 1.21.1 Fabric/NeoForge project. Preserve its existing registration, groups, fixtures, and reports; add no new Testiarium dependency or target coverage.
   **Complete when:** applicability is proven from project and pack, or native GameTest remains the route.
5. **Prove discovery with a negative control.** In test fixtures only, run a deliberately failing test through the same registration and reporting path; retain its separate expected-failure evidence outside the required passing selection.
   **Complete when:** the control is discovered and reported failed; a passing or missing control invalidates the harness.
6. **Execute and account.** Only `mod-game-worker` launches the pack-owned fixed task through `minecraft_project_verify`. Parse the pack-designated report/output for every required check ID, result, failure, and error; exit code zero alone is insufficient. Missing reports/tests remain failed or unavailable, never passed.
   **Complete when:** every required ID is accounted for and ordinary JUnit and GameTest evidence remain distinct.

## Output

Return the acceptance/test matrix, layout and registration record, fixture hashes, negative-control evidence, exact executed task, parsed required-test results, and explicit gaps to `minecraft-verification`.
