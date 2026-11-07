---
name: minecraft-implementation
description: Implement validated Minecraft Java ModSpecs in owned vertical red-green slices using exact target-local APIs while preserving existing user work.
---

# Minecraft implementation

## Use when

Use for validated ModSpec implementation or port units in new and existing mods. Route design gaps to `minecraft-design` and target selection to `minecraft-targets`.

References: [implementation requirements](../../docs/SPEC.md#44-implement), [transaction boundaries](../../docs/ARCHITECTURE.md#adr-009-decompose-transactions-behind-two-public-entry-points), and [TDD rules](../../docs/SPEC.md#9-testing-strategy).

## Inputs

- Validated ModSpec with requirement/feature/acceptance traceability and implementation-unit IDs.
- One supported target decision with exact pack ID, revision, hash, capability evidence, and version-local documentation.
- Authorized project root, existing-project inspection when applicable, and a transaction staging workspace.
- Focused public-interface checks and declared file ownership for each implementation unit.

## Procedure

1. **Establish the baseline.** For an existing project, call `minecraft_project_inspect` and resolve its exact coordinates through `minecraft-targets`. For a new project, call `minecraft_project_scaffold` with the selected supported pack into transaction staging. Record base hashes, source sets, dependencies, user-owned files, target mismatches, and owned paths.
   **Complete when:** the baseline and owned change set are recorded. Unsupported targets, malformed inspection, or ownership conflicts produce diagnostics and no canonical-project writes.

2. **Assign vertical-slice ownership.** Group behavior into the smallest independently checkable vertical slices. Give each slice implementation-unit IDs, acceptance IDs, dependencies, owned files, and one focused public-interface check. Route editable assets to `minecraft-assets`; retain their references in the slice rather than reproducing the asset procedure.
   **Complete when:** every requested acceptance entry has one owning slice, all slice dependencies are ordered, and every anticipated edit has an owner.

3. **Apply loader-local guidance conditionally.** For Fabric, use `minecraft-fabric`; for NeoForge, use `minecraft-neoforge`. Other loaders use their exact pack documentation. These specialists establish no Quilt or Forge 1.21+ coverage. Exact pack `docs.json` and `verification.json` always outrank examples. Ports follow `minecraft-porting` and complete the [Adhi mapping-namespace pass](../../THIRD_PARTY/adhi-agent-skills.txt) before lifecycle or registration edits.
   **Complete when:** each loader-specific decision cites the pack or an applicable specialist, with no cross-loader substitution.

4. **Run each slice red-green.** The orchestrator dispatches `mod-game-worker` to observe the focused public-interface check fail for the missing behavior; an initially green check requires a corrected test or fixture. `mod-offline-worker` implements minimally with the pack's exact loader APIs, mappings, and documentation, then updates associated data, localization, resources, and documentation. The orchestrator dispatches the same check and deterministic static checks to `mod-game-worker` again, using fixed commands from `verification.json`.
   **Complete when:** the game worker's returned evidence shows the check red before implementation and green afterward, plus passing deterministic static checks; the offline worker never launches those processes.

5. **Review staging and base drift.** After each slice, review the complete staged diff and confirm unrelated user files remain byte-identical. Before handoff, recheck canonical base and staging-tree hashes through the transaction boundary. Base drift or an ownership conflict stops commit for journaled recovery; never bypass staging or use destructive recovery.
   **Complete when:** the diff contains only reviewed owned changes and base hashes match, or a structured conflict/recovery result preserves the last verified state.

6. **Hand off the candidate.** Record slice checks, static results, owned files, staged-tree hash, and unresolved diagnostics for `minecraft-verification`, which owns `minecraft_project_verify` and all runtime stages.
   **Complete when:** all slices pass their focused public and static checks and no ownership conflict remains. Compilation alone does not establish runtime, production-JAR, or visual success.

## Output

Return staged candidate, base/staged hashes, slice check ledger, owned paths, diagnostics, and verification handoff. Failure or drift returns the preserved candidate with recovery state, not verification claims.
