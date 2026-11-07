---
name: minecraft-26-1-migration
description: Use only when migrating Fabric or NeoForge mods from Minecraft 1.21.x to 26.1, or between 26.1 patches, with cumulative API review and subsystem evidence.
---

# Minecraft 26.1 migration

Follow the vendored [migration procedure](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/minecraft-26-1-migration/SKILL.md) within `minecraft-porting`; this skill establishes no other loader or destination coverage.

## Inputs

- Exact source release/loader revision and requested 26.1 or 26.1.x destination pack.
- Source tree, compatibility/public-API requirements, ModSpec acceptance entries, and authorized roots.

## Procedure

1. **Pass the decision gate before edits.** Confirm exact endpoints, Fabric/NeoForge scope, architecture, mappings, save/config/datapack/network/API compatibility, branch strategy, physical sides, persistence, integrations, publication, and acceptance tests. Record safe assumptions; escalate decisions changing product or compatibility scope.
   **Complete when:** each gate has an answer or explicit user decision, and out-of-scope destinations stop without edits.
2. **Perform repository reconnaissance.** Inventory build/plugins/JDK, mappings, modules/source sets, metadata/entrypoints, registries, persistence, networking, rendering, datagen/resources, Mixins/access/reflection, integrations, tests, and publication. Search string-based references separately; assign every discovered unit a stable ID and owner.
   **Complete when:** code, resources, generated inputs, tests, and string references appear once in the inventory.
3. **Build the ordered cumulative plan.** Review the [change map and sources](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/minecraft-26-1-migration/references/26.1-change-map-and-sources.md) from the exact source through every intervening boundary to the destination. For pre-1.21.11 Fabric, include exact API/Loader/Loom history. Choose direct or staged porting; create the [migration brief](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/minecraft-26-1-migration/templates/migration-brief.md) only when requested.
   **Complete when:** every applicable boundary maps to affected units and checks; no final-guide-only shortcut remains.
4. **Separate mappings and bootstrap.** Follow [Adhi's mappings-before-lifecycle rule](../../THIRD_PARTY/adhi-agent-skills.txt): make namespace conversion a reviewable old-version step where practical, before registration/lifecycle changes. Bootstrap the exact pack with JDK 25 throughout. Treat 26.1 as unobfuscated: Fabric uses official names, no mappings dependency, and its pack-specified non-remapping plugin; NeoForge uses its exact MDK contract.
   **Complete when:** mapping, toolchain, and minimal target-build diffs are distinguishable and old mapping/plugin assumptions are absent.
5. **Port vertical subsystems.** Process mechanical names, registration/lifecycle, persistence/components/templates/transfers, networking, resources/datagen/test assets, rendering, loader adapters, then integrations/publication as applicable. For each unit, adapt code plus owned data and focused tests, then recompare source inventory and destination tree before continuing.
   **Complete when:** every unit has a disposition, focused evidence, and no unexplained drift; rendering and compatibility changes are not hidden in mechanical renames.
6. **Close with observed evidence.** Hand the candidate to `minecraft-verification`; only `mod-game-worker` launches fixed pack Gradle/game tasks. Include copied-world upgrades where required, dedicated server, client, multiplayer validation, GameTests, production JAR, and visuals. Build success alone is only build evidence.
   **Complete when:** requested gates have real outcomes and failures, unavailable checks, deferred integrations, and compatibility risks remain explicit.

## Output

Return endpoint/gate decisions, reconnaissance inventory, cumulative boundary map, optional brief, subsystem/drift ledger, compatibility report, and evidence handoff.
