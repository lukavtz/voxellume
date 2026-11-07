---
name: minecraft-blockbench
description: Use when creating, revising, exporting, or round-trip checking editable Blockbench models and bone animations for an exact Minecraft target.
---

# Minecraft Blockbench

Read the [editable asset contract](../../docs/ARCHITECTURE.md#adr-008-typed-editable-assets-behind-one-execution-facade) and vendored research linking the [pinned Blockbench primary sources](../../docs/research/asset-generation.md#s8-jasonjgardner-blockbench-baseline). Exact target `docs.json` and `verification.json` outrank examples.

## Inputs

- Supported target pack ID/revision, `resources.blockbench`, and target-local model documentation.
- Target-bound `AnimationSpec` and `AnimationModel`, stable asset/feature/acceptance IDs, and approved visual scenarios.
- Authorized transaction-staging root, existing `.bbmodel` revision when editing, and asset manifest.
- Host-approved Blockbench tool identity, including executable, entry point, SHA-256, version, and revision.

## Procedure

1. **Bind model and animation contracts.** Validate the `AnimationSpec` target ID/revision, rig hierarchy, bone roles/pivots, orientation, texture hashes, clips, tick timing, interpolation, root-motion policy, transitions, and acceptance links. Match the model kind and target `resources.blockbench.projectFormat` before editing.
   **Complete when:** one exact target and asset contract owns every bone, clip, texture, and export; ambiguous format or clip/state mapping returns `clarification_required`.
2. **Select the noninterchangeable format.** Use `java_block_item` for Java Block/Item JSON and display transforms; use `modded_entity` for entity Java/geometry and bone animation. Java Block/Item models never acquire entity bone animation. Cross-format export, unsupported target animation, or an invalid contract returns `unsupported_request` or `invalid` without export.
   **Complete when:** project format, runtime format, and acceptance states agree.
3. **Materialize and export through approved boundaries.** For direct model/runtime generation, use `generateAnimation` and `exportAnimation` and keep their outputs on the direct path; do not pass its `{sourceFormat, model, spec}` wrapper to Blockbench. Invoke `createBlockbenchExporter` only for an existing Blockbench-native `.bbmodel` supplied by the user or a previous native edit. A request to create a new Blockbench-native editable master is `unavailable` until a native serializer exists. Only `mod-game-worker` launches the host-approved exporter, requiring plugin `1.10.1` at `97a8a80d3a37bf95c5e136d93d2c7da399fff753`, matching entry-point hash, transaction-staging roots, `riskyEval: false`, and `desktopHost: "127.0.0.1"`. Keep scripts, arbitrary paths, and non-loopback access outside the request. Missing tool, sandbox, or renderer is `unavailable`.
   **Complete when:** the selected direct or native-exporter route returns a source-class result with explicit status and provenance; unavailable native creation remains explicit.
4. **Preserve editable revisions and provenance.** Store `.bbmodel` masters outside production resources. Use expected-revision atomic edits and record source/export SHA-256, application/plugin versions, export settings, generation route, licenses/notices, target formats, and visual scenario IDs in the asset manifest.
   **Complete when:** every export traces to exactly one immutable editable-source revision.
5. **Round-trip and validate.** Re-import exports and independently compare geometry, UVs, orientation, joints, bone parents, clip states, timing, and transitions. Regenerate deterministically, then call `minecraft_assets_validate`; repair stale or semantically different exports rather than ignoring editor metadata.
   **Complete when:** round-trip differences are explained and validation passes.
6. **Separate preview from game evidence.** Label Blockbench renders/contact sheets as previews. Hand masters, exports, manifest, and scenarios to `minecraft-verification` for production-JAR real-client states and independent human aesthetic review.
   **Complete when:** no preview is reported as Minecraft runtime or aesthetic approval.

## Output

Return editable revisions, exports, manifest, round-trip/validation findings, labeled previews, and explicit `failed`, `unsupported_request`, `unavailable`, `cancelled`, or `timed_out` outcomes. Runtime approval remains with `minecraft-verification`.
