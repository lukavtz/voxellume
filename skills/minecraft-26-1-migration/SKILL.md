---
name: minecraft-26-1-migration
description: Use only when migrating a Fabric or NeoForge mod from Minecraft 1.21.x to 26.1, or between 26.1 patches.
---

# Minecraft 26.1 migration

Follow the vendored
[migration procedure](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/minecraft-26-1-migration/SKILL.md)
and its
[change map](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/minecraft-26-1-migration/references/26.1-change-map-and-sources.md).
This skill adds no other loader or destination coverage.

## Inputs

- Source Minecraft release and loader, with a pinned revision and hash.
- The 26.1 destination pin from `minecraft_target_info`, including its JDK.
- Usage rights for the source and the owned file set.

## Procedure

1. Confirm endpoints and scope: source revision, destination pin, loader, and whether
   the migration is direct or staged through intermediate releases. Stop on an
   unresolved scope question instead of guessing.
2. Inventory the project: build files, plugins, JDK, mappings, source sets, metadata,
   entrypoints, registries, persistence, networking, rendering, datagen, and mixins.
   Give every unit an id.
3. Build the ordered plan across every boundary between source and destination. Read
   the change map for each boundary; do not jump to the final guide.
4. Do mappings and toolchain first, as a reviewable step with no behaviour change.
   Bootstrap the destination with the JDK the pin names. 26.1 is unobfuscated: Fabric
   uses official names and its non-remapping Loom plugin; NeoForge uses its exact MDK
   contract.
5. Port one subsystem at a time: names, registration and lifecycle, persistence,
   networking, resources and datagen, rendering, then integrations. Rerun
   `minecraft_run` with `build` after each subsystem.
6. Prove the result with `minecraft-verification`: build, server, GameTest, client, as
   applicable. Build success alone is not a migration.

## Rules

- No target substitution, including a nearby 26.1 patch.
- Rendering and compatibility changes are never hidden inside a mechanical rename.
- Keep a drift list: source unit, destination outcome, reason.

## Output

Return endpoint decisions, the unit inventory, the boundary plan, the per-subsystem
build results, and the drift list.
