---
name: minecraft-fabric
description: Implement or review Fabric vertical slices using project-local Loom, mappings, source sets, metadata, entrypoints, events, networking, and datagen.
---

# Fabric implementation

Read the vendored [Fabric procedure](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/fabric-modding/SKILL.md) and [version contracts](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/fabric-modding/references/version-contracts.md). Pack `target.json`, `docs.json`, and `verification.json` outrank examples; never copy versions or API shapes without target evidence. Apply [Jahrome's Fabric notes](../../THIRD_PARTY/jahrome-minecraft-agent-skills/.agents/skills/minecraft-modding/references/fabric-api.md) only when its labeled release and mappings match. `minecraft-targets` owns support; `minecraft-verification` owns execution and evidence.

## Inputs

- Validated ModSpec slice, acceptance IDs, owned paths, and staging root.
- Supported exact pack ID/revision/hash and existing-project inspection.
- Focused public check and pack-owned verification contract.

## Procedure

1. **Bind the project contract.** Inspect effective Gradle properties, catalogs, convention plugins, and build scripts. Record version owners, Loom plugin, Java toolchain, mappings, dependencies, modules, and source sets. Preserve working compatibility wrappers and the remapping boundary.
   **Complete when:** decisions cite pack/project evidence and version owners remain singular.
2. **Wire source sets and metadata.** Discover `splitEnvironmentSourceSets()` and `loom.mods` before placing code. Align `fabric.mod.json` ID, namespace, environment, dependencies, `main`/`client`/optional `fabric-datagen` entrypoints, mixin configs, and access widener with actual files. Keep client classes out of common initialization.
   **Complete when:** every declaration resolves to an owned file in the correct source set.
3. **Use the narrowest behavior hook.** Register mapping-appropriate identifiers and singleton objects during initialization with target-required keys. Prefer Fabric API callbacks and vanilla extension points. Add a mixin only for named uncovered behavior, with minimal injection and side-correct config.
   **Complete when:** each acceptance names its registry/event/mixin hook; each mixin records why callbacks cannot cover it.
4. **Separate sides and validate networking.** Distinguish physical classloading from logical state. Register payload codecs and directional receivers with the exact API; isolate client receivers. On the logical server, authorize senders and validate identifiers, counts, ranges, distances, positions, loaded chunks, and entities before main-thread mutation.
   **Complete when:** every payload documents direction, codec, receiver side, thread handoff, and server validation.
5. **Connect resources and datagen.** Keep editable assets outside runtime resources, generated output in its configured source set, and handwritten JSON separate. Wire configured datagen providers; trace models, blockstates, lang, recipes, loot, tags, and registry data to acceptance IDs.
   **Complete when:** every runtime reference has one source/generator owner; generated files remain unedited.
6. **Run focused red-green.** The orchestrator dispatches `mod-game-worker` for the red public check, `mod-offline-worker` implements minimally, then the game worker reruns focused and static checks using pack-fixed commands. Only the game worker launches Gradle or games.
   **Complete when:** red/green evidence exists, or a preserved diagnostic blocks success.

## Output

Return evidence-linked implementation decisions, owned files, registry/event/side/network/datagen choices, and a ledger of acceptance ID, check ID, requested/executed status, and diagnostics. Hand the staged candidate to `minecraft-verification`; focused checks establish no build, runtime, production-JAR, or visual support.
