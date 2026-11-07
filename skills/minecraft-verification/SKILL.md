---
name: minecraft-verification
description: Use when deriving and executing Minecraft acceptance checks, repairing failed checks, or issuing build, runtime, production-JAR, and visual evidence.
---

# Minecraft verification

Read [verification order](../../docs/SPEC.md#46-verify), [evidence architecture](../../docs/ARCHITECTURE.md#adr-005-verification-is-a-staged-evidence-pipeline), and the [visual contract](../../docs/TEST_PLAN.md#52-real-minecraft-and-design-review-gates).

## Use when

A staged mod candidate needs acceptance verification, bounded repair, delivery evidence, or an explicit blocked/unsupported result.

## Inputs

- ModSpec acceptance entries, resolved target pack and exact `verification.json`, and staged candidate hashes.
- Required verification profile, fixtures, visual rubric, and declared support matrix.
- Existing runtime/network approvals and authorized project/evidence roots. Never auto-accept the EULA.

## Procedure

1. **Build the acceptance-to-check matrix.**
   - For every acceptance entry, record acceptance ID, stable check ID/kind, implementation unit, fixture, independently stated expected result, pack-owned command, and evidence output.
   - Mark each check required or optional from the ModSpec and pack.
   - Use the [Adhi evidence levels](../../THIRD_PARTY/adhi-agent-skills.txt) to distinguish specification, generated files, build, runtime behavior, production JAR, and real-client visuals.
   - **Done:** every acceptance has behavior evidence where required, every required check is executable or explicitly `unsupported`/`unavailable`, and no screenshot substitutes for a behavior assertion.
2. **Prepare loader-native test wiring.**
   - For pack-qualified Fabric/NeoForge native GameTests, consult [Jahrome testing](../../THIRD_PARTY/jahrome-minecraft-agent-skills/.agents/skills/minecraft-testing/SKILL.md) and [test layouts](../../THIRD_PARTY/jahrome-minecraft-agent-skills/.agents/skills/minecraft-testing/references/test-layouts.md) for source sets, registration, metadata, structures, and test instances.
   - Only when Testiarium is already configured on a qualified 1.21.1 Fabric/NeoForge project, follow its [vendored procedure](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/testiarium-gametest/SKILL.md).
   - Keep Testiarium test-only; do not add it or extend it to other loaders/releases.
   - **Done:** applicable test layout matches the exact pack and all integrations remain outside production output.
3. **Run stages in exact order.**
   - Call `minecraft_project_verify` through `mod-game-worker`.
   - Execute core stages `static → build → server → gameTest → client → productionJar → visual → package`. Static includes unit, resource, dependency/license, and security checks; package includes final package/evidence validation.
   - Use only fixed pack-owned commands. Record requested/executed checks, exact commands, exit codes, statuses, environment, bounded logs, and artifact hashes in finalized evidence outside the project.
   - Stop dependent stages after failure.
   - **Done:** each executed stage passed before any downstream stage claimed success.
4. **Handle outcomes and repair.**
   - Preserve original diagnostics and diff. For a repairable failure, make one vertical code change and rerun the failed public check.
   - Restore the last verified state after an unsuccessful attempt. Stop after three attempts without weakening assertions.
   - Mark cancellation `cancelled`, timeout `timed_out`, and missing capability `unavailable` or `unsupported`; none is a pass.
   - **Done:** the original failure, every attempt/diff, and final status are retained, with no fourth attempt.
5. **Enforce delivery gates.**
   - In a clean instance, test the packaged production JAR for declared behavior, dependencies, restart persistence, and multiplayer synchronization; assert test-only classes/resources are absent.
   - For each visual scenario, fix resolution, GUI scale, camera, seed/state, time, weather, deterministic ticks, inputs, OS/renderer/GPU, baseline, and tolerance.
   - Pair captures with behavior assertions. A trusted human reviewer records an `approved` or `rejected` rubric result bound to the scenario, artifact hashes, reviewer identity, and review revision; agents cannot approve their own output.
   - **Done:** production and required visual evidence pass; required unavailable real-client/visual evidence blocks `supported` status.
6. **Issue the evidence report.**
   - List every matrix row, requested versus executed check, final status, artifact hash, evidence path, and limitation.
   - **Done:** completion is claimed only when every required check passed; failed, unrun, cancelled, timed-out, unsupported, and unavailable rows remain visible.

## Output

Return the acceptance matrix, evidence report, production results, human visual-rubric record, and repair history. Hand only a passing required matrix to `minecraft-release`; otherwise return blockers without success.
