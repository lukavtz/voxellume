---
name: minecraft-26-1-migration
description: Migrate Minecraft mods from 1.21.x to 26.1.x.
license: MIT
compatibility: Minecraft Java Edition mods moving from any 1.21.x release to 26.1 or a 26.1 patch on Fabric, NeoForge, or a multi-loader architecture; exact loader, plugin, dependency, mapping, and patch versions are version-sensitive.
metadata:
  version: "1.1.0"
  author: "minecraft-modding-skills contributors"
---

# Minecraft 1.21.x → 26.1 Mod Migration

Use this skill when porting a Java mod from any Minecraft 1.21.x release to 26.1 or a 26.1 patch. This is a cumulative platform migration, not a dependency bump.

Read `references/26.1-change-map-and-sources.md` for the researched change map and authoritative URLs. Copy `templates/migration-brief.md` into the project or issue only when the user wants a durable artifact; otherwise answer it in chat.

## Non-negotiable gate: decide before editing

Do not modify source code until the questions below have answers or explicitly recorded assumptions. Inspect the repository first so you do not ask the user for facts that the build and source tree already reveal.

### Questions the agent must resolve

1. **Exact endpoints:** What exact source version and loader patch are in the repository? Is the target original 26.1 or a named 26.1.x patch?
2. **Loader scope:** Fabric, NeoForge, both, or a legacy loader to drop? Is the current architecture common modules, Architectury, Stonecutter, per-loader branches, or duplicated projects?
3. **Mappings:** Does the old project use Yarn, Mojang mappings, Parchment, or a remapping abstraction? For Fabric, will Yarn→official migration be a separate reviewable commit before the version port?
4. **Compatibility policy:** Must old saves, config files, IDs, datapacks, network peers, APIs, or add-ons remain compatible? Which identifiers are public/stable?
5. **Branch policy:** Direct port, staged incremental port, or a dedicated port branch fed by merges from the maintained old branch?
6. **Client/server contract:** Universal, client-only, or server-only? Must the artifact launch on a headless dedicated server? Which classes and Mixins are physically client-only?
7. **Persistence model:** For every stored value, should it be a data component, data attachment, global server `SavedData`, dimension-owned `SavedData`, codec-backed config, datapack registry entry, or runtime-only state? Which existing file identifiers and locations must migrate?
8. **Item representation:** Is each item-like value a runtime mutable `ItemStack` or an immutable `ItemStackTemplate` whose component binding is deferred until registry/world context exists?
9. **Networking:** For every payload, which phase and direction apply? Must the wire format remain compatible? What server-side validation and thread model are required?
10. **Rendering:** Which renderers are HUD/GUI, entity, block entity, world/level, baked model, fluid, or direct GPU/OpenGL code? Can JSON/model APIs replace custom rendering?
11. **Datagen/resources:** Are generated resources committed? Is datagen client-only, unified, or split? Which custom resource schemas and test structures exist?
12. **Integrations:** Which optional mods, APIs, access wideners/transformers, Mixins, reflection targets, and published extension APIs must work on day one? Which may be temporarily disabled?
13. **Toolchain and publication:** Required JDK/Gradle/IDE/CI versions, artifact names/classifiers, Maven coordinates, signing, and reproducibility requirements?
14. **Acceptance tests:** What proves success: build, datagen, GameTests, client launch, dedicated server launch, world upgrade, multiplayer, and integration matrix?

If an answer changes architecture, save compatibility, public API, loader support, or release scope, ask the user. For low-risk implementation details, state the assumption and proceed.

## Phase 1 — Repository reconnaissance

Collect evidence before planning:

- build system, wrapper, plugins, dependency catalog, Java toolchain, mappings, and publication tasks;
- module/source-set graph and loader boundaries, canonical/VCS source state, per-version overrides, and processed outputs;
- mod metadata, entrypoints, Mixins, access wideners, access transformers, coremods, reflection, and generated sources;
- registries, custom codecs, components, attachments, NBT/value I/O, recipes, loot, tags, worldgen, configs, and saved data;
- packet definitions, codecs, handlers, phases, directions, permissions, and threading;
- rendering and GUI classes, raw OpenGL/GPU calls, custom models, shaders, fluids, and particles;
- datagen providers, generated outputs, GameTests/test structures, run configurations, and CI;
- third-party integrations and the availability of target-version artifacts.

Search string-based references separately. Symbol migration does not reliably update Mixin descriptors, JSON metadata, access widener/transformer entries, reflection strings, service files, or generated source templates.

Produce a feature inventory grouped into: build, common gameplay, persistence/data, networking, resources/datagen, client/rendering, loader adapters, integrations, public API, tests, and publication.

## Phase 2 — Build the migration brief

Complete `templates/migration-brief.md`. The brief must include:

- discovered source state and exact target;
- decisions and assumptions;
- stable IDs/data/API that may not break;
- source and module strategy;
- ordered change boundaries from the official primers;
- risks and temporarily disabled integrations;
- verification matrix and completion criteria.

Do not treat the official 1.21.11→26.1 guide as complete for a 1.21.1 source. Review every intervening NeoForge release/primer or equivalent vanilla/API changes in order: 1.21.2, 1.21.4, 1.21.5, 1.21.6, 1.21.7, 1.21.8, 1.21.9, 1.21.10, 1.21.11, then 26.1.

For Fabric sources earlier than 1.21.11, also record the exact Fabric API, Loader, and Loom versions at each maintained source boundary and review their tag history, Loader changelog, Loom releases, and source diffs. The Fabric 1.21.11→26.1 guide and vanilla primers do not cover cumulative Fabric API/Loader changes from early 1.21.x.

## Phase 3 — Choose the port strategy

### Prefer a direct target port when

- only 26.1 will ship;
- the project is small or well-covered by tests;
- intermediate dependencies are unavailable;
- changes can be bucketed cleanly using official primers and upstream examples.

Even a direct port must process the documented boundaries conceptually in order.

### Prefer staged, reviewable commits when

- starting from early 1.21.x;
- mapping migration can be separated from API migration;
- rendering, persistence, or loader architecture is extensive;
- public APIs/add-ons need controlled breakage;
- upstream has useful version-port commits to compare.

Good commit boundaries are: baseline tests; mapping namespace; clean target build; mechanical names; registration/data; serialization; networking; resources/datagen; rendering; integrations; stabilization.

Never combine a mapping conversion, loader redesign, public API redesign, and behavior rewrite into one unreviewable mass change unless repository history already forces it.

## Phase 4 — Bootstrap the 26.1 build

1. Inspect the official template for the exact target patch; do not hard-code release-day dependency versions.
2. Use Java 25 throughout local builds, CI, IDE configuration, test launchers, and tools requiring `jmods`.
3. Compare against a clean official template; rebuild only the affected target configuration. In a maintained multiversion tree retain old nodes, their remapping plugins/toolchains, shared module graph, and publication contracts. Do not replace the entire build with a single-version MDK.
4. On Fabric 26.1+, use official unobfuscated names, remove the mappings dependency, use the non-remapping Loom plugin, ordinary dependency configurations, normal `jar`, and `official` access-widener namespace. Convert Yarn while still on the old version when practical.
5. On NeoForge, use a current 26.1 MDK/ModDevGradle contract and review ModDevGradle 2 breaking changes. Parchment is optional for documentation, not required for names.
6. Preserve artifact coordinates and consumers unless the migration brief approves a breaking publication change.

Get an empty/minimal target project compiling before reintroducing feature code. Keep old and new workspaces side by side for vanilla usage comparisons.

## Phase 5 — Port by subsystem, not random compiler order

### Mechanical namespace pass

Handle official-name and API renames separately from behavior changes. Audit `ResourceLocation`→`Identifier`, JSpecify nullability, registry lookup methods, Fabric API official-name renames, access files, Mixin strings, JSON, and reflection. Do not blindly replace `ResourceKey<T>` with `Identifier`.

### Registration and lifecycle

- Ensure item/block properties receive resource keys; use loader helpers that supply IDs.
- Rework removed builders and registry wrapper types only after identifying the target registry contract.
- Keep common gameplay registration out of dedicated-server-only entrypoints.
- Do not query registries during registration.
- Do not access client singletons during early client mod construction.

### Persistence and data

- Migrate hardcoded item behavior to target data components where applicable.
- Use immutable component values with stable equality and appropriate persistent/network codecs.
- Migrate direct NBT serialization to target `ValueInput`/`ValueOutput` patterns when crossing the 1.21.6 boundary.
- Preserve stable IDs and add explicit migration/alias/data-fixer handling when save compatibility requires it.
- Classify `SavedData` as global or dimension-owned. In 26.1, global data belongs in `MinecraftServer#getDataStorage`; dimension data remains level-scoped. Preserve stable `SavedDataType` identifiers and decide how old file locations move.
- Treat File Fixer Upper as an irreversible world-layout migration risk: test only on copied worlds, require backups, and document the downgrade policy before custom file moves or deletions.
- Replace definition-time/static `ItemStack` construction with `ItemStackTemplate`, suppliers, or reload/world-time resolution. Do not inspect template components before registry/world context binds them.
- For NeoForge transfer APIs, design around transactional `ResourceHandler`, `ItemAccess`, and `EnergyHandler`; do not mechanically wrap old handlers without defining transaction semantics.

### Networking

Inventory each payload's phase, direction, codec buffer type, registration side, handler thread, permission checks, and size limits. Keep payload types/codecs in common code; keep client handlers physically client-only. Validate all client-controlled identifiers, entity IDs, positions, counts, and actions on the server.

### Resources and datagen

Port providers first, regenerate output, then review the resource diff. Include test assets and directory renames. Validate client item definitions, models, tags, recipes/displays, loot codecs, datapack registries, and language files. Compilation alone does not validate data.

### Rendering

Treat rendering as a separate workstream. Classify each renderer before changing it. Move toward extracted render state and submission APIs, material-aware models/quads, `GuiGraphicsExtractor`, and loader-supported model/fluid/HUD APIs. Eliminate raw OpenGL where possible. Never read live mutable game state during a submission phase that expects extracted state.

For unstable optional rendering integrations, it is acceptable to disable them temporarily only when the migration brief records the scope, user approves the release policy, and dedicated follow-up verification exists.

### Loader boundaries and shims

Keep loader/version differences behind coarse typed services or adapters. Temporary generated source rewriting can bootstrap a port but must not become the final architecture. Do not place shims inside `net.minecraft` packages. Test common code on a dedicated server even when it compiles under split source sets.

## Phase 6 — Verification gates

Run the real tasks defined by the repository; discover names rather than assuming them. Minimum gates for a universal mod:

1. clean build with Java 25;
2. unit tests and static checks;
3. datagen, followed by a clean-tree or reviewed generated-resource diff check;
4. GameTests, including migrated structure assets;
5. dedicated-server startup until the normal ready signal, then clean shutdown;
6. client startup to title screen and a world join;
7. new-world functional smoke test;
8. copy-based upgrade test of a representative old world/save/config when compatibility is required;
9. multiplayer packet tests, including invalid client input;
10. each supported loader and required integration combination;
11. published JAR inspection for metadata, access files, nested dependencies, classifiers, and client-class reachability (a universal JAR legitimately contains gated client classes);
12. Mixin verification against actual target bytecode plus runtime launch.

Capture exact commands and real outcomes, including each supported node and restoration of the canonical/VCS source state. If the project has no GameTests or unavailable dependencies, record that gap rather than inventing a task or claiming the gate passed. A successful compile is not a completed migration.

## Completion report

Report:

- target patch and dependency/toolchain versions actually used;
- architecture and compatibility decisions;
- changed subsystems;
- disabled/deferred integrations;
- commands run and observed results;
- save/world/network/API compatibility status;
- remaining risks and follow-ups.

## Pitfalls

- Treating 1.21.1→26.1 as the documented 1.21.11→26.1 delta.
- Hard-coding versions copied from an announcement instead of the exact target template/metadata.
- Mixing Yarn→official conversion with all behavioral changes.
- Assuming unobfuscated means Mixins/access files/reflection no longer need auditing.
- Constructing `ItemStack` statically before registries/worlds are available.
- Calling client classes from common code that only happened to work on an integrated client.
- Mechanical rendering renames without adopting extraction/submission semantics.
- Keeping regex-generated compatibility sources as permanent architecture.
- Ignoring generated resources, test structures, dedicated-server launch, or old-world loading.
- Declaring success after the first green build instead of after stabilization and runtime gates.
