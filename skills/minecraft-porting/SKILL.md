---
name: minecraft-porting
description: Use when porting a Minecraft mod from one immutable source revision to an exact destination target with traceable adaptations and drift audits.
---

# Minecraft porting

Read the [porting method](../../docs/research/universal-modder.md#porting-method), [target policy](../../docs/research/minecraft-targets.md#explicit-support-policy), and [acceptance scenarios](../../docs/TEST_PLAN.md#4-end-to-end-mod-scenarios).

## Use when

An existing mod or subsystem must move across Minecraft versions, loaders, or both while preserving traceability to its source behavior.

## Inputs

- One immutable source revision, content hash, license/provenance, and private reference checkout.
- Exact destination request, ModSpec acceptance entries, and any existing destination files owned by the user.
- Pinned extraction tooling and target-local documentation. The source facade remains disabled.

## Procedure

1. **Pin both endpoints.**
   - Record the source revision/hash and usage rights.
   - Resolve the destination with `minecraft_target_resolve`; keep the returned pack ID and revision unchanged throughout the port.
   - **Done:** source and destination are exact, authorized, and free of floating branches or substitute targets.
2. **Choose the migration path.**
   - For a Fabric/NeoForge port from 1.21.x to 26.1, or between 26.1 patches, complete `minecraft-26-1-migration` before bootstrap or subsystem edits.
   - Other destinations use their exact pack documentation and this porting inventory; the specialist establishes no additional coverage.
   - **Done:** applicable migration decisions and ordered subsystem boundaries are recorded.
3. **Inventory and map every source unit.**
   - Enumerate code, build configuration, dependencies, resources, data, editable assets, and tests.
   - Give each unit a stable source ID and map its symbols, behavior, destination API, resources/data, and acceptance IDs.
   - Assign exactly one disposition: `reusable`, `adapted`, `replaced`, `deferred`, or `unsupported`, with reason and owner.
   - **Done:** every discovered source unit appears once in the adaptation matrix and every retained behavior maps to acceptance coverage.
4. **Port vertical units.**
   - Extract structured data with pinned scripts/parsers and independently diff extraction input/output instead of manually transcribing it.
   - Implement each unit through `minecraft-implementation`; route editable art through `minecraft-assets`. Preserve unrelated destination files.
   - **Done:** each unit has a reviewed code/data diff, reproducible extraction record where applicable, and passing focused checks before the next unit starts.
5. **Audit drift after each unit.**
   - Recompare the pinned source inventory, adaptation matrix, extracted data, and destination tree.
   - Investigate omissions, extra behavior, stale generated data, and unintended semantic changes; record resolution or an explicit deferred/unsupported disposition.
   - **Done:** no unexplained source-to-destination difference remains.
6. **Verify and close.**
   - Run `minecraft-verification` and report only the highest completed level in its evidence ladder.
   - Update provenance, known limitations, and adaptation dispositions from observed results.
   - **Done:** every source unit has a final disposition, requested acceptance checks have evidence, and unresolved differences are visible in the release handoff.

## Output

Return the pinned endpoints, source inventory, adaptation matrix, extraction records, drift log, updated provenance/limitations, and verification report. Hand the complete trace and explicit blockers to `minecraft-release`; never equate a successful build with runtime or visual parity.
