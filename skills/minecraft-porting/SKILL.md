---
name: minecraft-porting
description: Use when moving an existing mod from one Minecraft or loader version to another, keeping a record of every adapted unit.
---

# Minecraft porting

A port is a sequence of small, provable moves. Pin both endpoints first; nothing else
is trustworthy until they are fixed.

## Procedure

1. Pin the source. Record the source revision, its hash, and its usage rights. Copy it
   into a private working directory; never edit the reference copy.
2. Pin the destination with `minecraft_target_info`. Record the pin id and its exact
   loader, API, JDK, and Gradle versions. If the pin has `template: null`, the project
   must be created from the loader's own MDK; scaffolding it returns
   `template_missing`.
3. Inventory the source: build files, dependencies, registries, entrypoints, resources,
   data, tests. Give every unit a stable id and one disposition — keep, adapt, replace,
   defer, drop — with a reason.
4. For a 1.21.x → 26.1 move, read the vendored
   [26.1 migration procedure](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/minecraft-26-1-migration/SKILL.md)
   and complete the mapping and toolchain step before any lifecycle edit.
5. Port one unit at a time. After each unit, run `minecraft_run` with `build`, and
   rerun the check that covered that unit. A unit is done when its check passes, not
   when it compiles.
6. Re-read the source inventory after every few units. A unit that vanished from the
   plan is a bug in the plan.
7. When the destination builds and its tests pass, hand it to
   `minecraft-verification` for the runtime and visual claims.

## Rules

- Never substitute a nearby Minecraft or loader version.
- Never copy version numbers from the source project into the destination.
- Keep the adaptation table in your report; it is the only trace of the decisions.

## Output

Return the pinned endpoints, the unit table with dispositions, the per-unit
`minecraft_run` evidence, and the list of unresolved differences.
