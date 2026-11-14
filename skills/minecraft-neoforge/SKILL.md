---
name: minecraft-neoforge
description: Use when implementing or reviewing a NeoForge mod slice: ModDevGradle build, registration, lifecycle buses, sides, networking, resources, and datagen.
---

# NeoForge implementation

No NeoForge template is shipped: `targets/pins.json` has `template: null` for every
NeoForge pin, so `minecraft_project_scaffold` returns `template_missing`. Build the
project from the official MDK at the exact pin versions and say so in your report.
Vendored procedure:
[NeoForge modding](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/neoforge-modding/SKILL.md)
and its
[version contracts](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/neoforge-modding/references/version-contracts.md).

## Inputs

- The pin chosen by `minecraft-targets`, including its JDK and Gradle versions.
- An MDK-derived project, or an existing one whose Gradle files you have read.

## Procedure

1. Bind the ModDevGradle contract: plugin id, plugin version, toolchain, mappings, and
   source sets. Never substitute ForgeGradle or invent a task.
2. Align `neoforge.mods.toml`, the mod id, the package, and the `@Mod` entrypoint with
   the files that exist.
3. Attach registration and lifecycle listeners to the mod bus, gameplay listeners to
   `NeoForge.EVENT_BUS`. Use concrete event types and documented cancellation; move
   required main-thread work through `enqueueWork`.
4. Register content through `DeferredRegister` and holder types, once per registry,
   with namespaced ids. Add block items and creative-tab entries explicitly.
5. Separate sides. Rendering imports stay in client-gated classes; logical-side checks
   govern game state only. Register payload types, stream codecs, and handlers with
   direction and thread contract documented, and validate serverbound payload fields
   before mutation.
6. Keep resources and datagen owned: assets under `src/main/resources/assets/<modid>/`,
   data under `data/<modid>/`, generated output produced by gather-data providers.
7. Prove the slice with `minecraft_run`: `build`, then the task that exercises it.
   No NeoForge project is proven by anything else.

## Rules

- Versions come from the pin, never from an example.
- If the pin's JDK is absent, report the blocked build instead of switching JDKs
  silently.

## Output

Return files changed, bus/event/registration decisions, and the `minecraft_run`
results, including `template_missing` if you had to build the project by hand.
