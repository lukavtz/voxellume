---
name: minecraft-fabric
description: Use when implementing or reviewing a Fabric mod slice: Loom build, source sets, metadata, entrypoints, events, networking, and datagen.
---

# Fabric implementation

The project layout comes from `templates/fabric-1.21.1`. Vendored procedure:
[Fabric modding](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/fabric-modding/SKILL.md)
and its
[version contracts](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/fabric-modding/references/version-contracts.md).
The pin from `minecraft_target_info` outranks any example.

## Inputs

- The pin chosen by `minecraft-targets`, and a project created with
  `minecraft_project_scaffold`.
- One behaviour to add, stated as a check you can run.

## Procedure

1. Read `gradle.properties`, `build.gradle`, and `settings.gradle` before editing.
   Record the Loom plugin, the Java toolchain, mappings, and loader versions. Change
   them only to match the pin.
2. Wire source sets and metadata. With split source sets, client classes belong in the
   client set. Keep `fabric.mod.json` `id`, entrypoints, mixin configs, and the access
   widener consistent with the files that exist.
3. Use the narrowest hook. Prefer Fabric API events and vanilla extension points.
   Add a mixin only for behaviour nothing else covers, with minimal injection and the
   config scoped to the right side.
4. Separate sides. Client-only imports never load on a dedicated server. Register
   payload codecs and directional receivers explicitly, and validate identifiers,
   counts, ranges, and positions on the server before trusting a packet.
5. Keep resources owned. Assets go under `src/main/resources/assets/<modid>/`; data
   under `src/main/resources/data/<modid>/`. Generated files are written by datagen
   providers, never hand-edited.
6. Prove the slice with `minecraft_run`: `build` for compilation, then the task that
   exercises the behaviour (`runServer`, `runGametest`, or `runClient`). See
   `minecraft-verification` for the proof table.

## Rules

- One build change at a time; rerun `build` after each.
- Never edit `build/` or `.gradle/`.
- Versions come from the pin. Do not copy a version from a tutorial.

## Output

Return the files changed, the loader decisions with their reason, and the
`minecraft_run` results that prove the slice.
