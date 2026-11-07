---
name: minecraft-neoforge
description: Implement or review NeoForge vertical slices using exact ModDevGradle conventions, registration, lifecycle buses, sides, networking, resources, and datagen.
---

# NeoForge implementation

Read the vendored [NeoForge procedure](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/neoforge-modding/SKILL.md) and [version contracts](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/neoforge-modding/references/version-contracts.md). Pack `target.json`, `docs.json`, and `verification.json` outrank examples; never copy versions or API shapes without target evidence. Apply [Jahrome's NeoForge notes](../../THIRD_PARTY/jahrome-minecraft-agent-skills/.agents/skills/minecraft-modding/references/neoforge-api.md) only when its labeled release and API contract match. `minecraft-targets` owns support; `minecraft-verification` owns execution and evidence.

## Inputs

- Validated ModSpec slice, acceptance IDs, owned paths, staging root.
- Supported pack ID/revision/hash and project inspection.
- Focused public check and verification contract.

## Procedure

1. **Bind the ModDevGradle contract.** Inspect effective Gradle configuration, source sets, metadata expansion, and runs. Preserve MDK property ownership, plugin, toolchain, mappings, dependencies, and modules; never substitute ForgeGradle or invent tasks.
   **Complete when:** decisions cite evidence; checks use declared node-qualified commands.
2. **Wire metadata and lifecycle.** Align the target metadata descriptor, mod ID, package, dependencies, and `@Mod` entrypoint. Attach registration/lifecycle listeners to the injected mod bus and gameplay listeners to `NeoForge.EVENT_BUS`. Use concrete events, documented cancellation/results, and `enqueueWork` for required main-thread lifecycle work.
   **Complete when:** every listener names its bus, event, thread contract, and acceptance ID.
3. **Register target-local objects.** Prefer target `DeferredRegister` helpers and holder types; register each registry once and keep singleton entries. Supply item/block IDs through exact target helpers or properties; add required block items and creative-tab wiring.
   **Complete when:** every entry has a namespaced path, holder, initialization path, and evidenced construction contract.
4. **Separate sides and validate networking.** Keep rendering imports in physically client-gated classes; logical checks govern game-state branches only. Register payload types, stream codecs, protocol version, direction, and handlers with the exact API. Isolate client handlers/senders. Validate serverbound permissions, identifiers, counts, distances, positions, loaded chunks, and entities before enqueued main-thread mutation; respect payload bounds.
   **Complete when:** every payload documents direction, registration, containment, threading, bounds, and server authority.
5. **Connect resources and datagen.** Preserve generated-resource roots and run wiring. Register providers through the target's actual gather-data event split and helpers. Trace assets, data, dynamic registries, localization, recipes, loot, and tags to acceptance IDs without editing generated output.
   **Complete when:** every runtime reference has one source/generator owner and enters the declared resource root.
6. **Run focused red-green.** The orchestrator dispatches `mod-game-worker` for the red public check, `mod-offline-worker` implements minimally, then the game worker reruns focused and static checks using pack-fixed commands. Only the game worker launches Gradle or games.
   **Complete when:** red/green evidence exists, or a preserved diagnostic blocks success.

## Output

Return evidence-linked decisions, owned files, loader choices, and a ledger of acceptance ID, check ID, requested/executed status, and diagnostics. Hand the staged candidate to `minecraft-verification`; focused checks establish no build, runtime, production-JAR, or visual support.
