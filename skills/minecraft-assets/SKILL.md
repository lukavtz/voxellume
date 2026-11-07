---
name: minecraft-assets
description: Use when creating, editing, exporting, or validating editable Minecraft textures, models, or animations with reproducible provenance.
---

# Minecraft assets

Read the [asset workflow](../../docs/SPEC.md#45-create-assets), [editable-source contract](../../docs/ARCHITECTURE.md#adr-008-typed-editable-assets-behind-one-execution-facade), and [asset gates](../../docs/TEST_PLAN.md#5-visual-and-gameplay-verification).

## Use when

A feature needs new or changed runtime art, editable masters, export provenance, or asset validation. Use `minecraft-verification` for in-game behavior and aesthetic approval.

## Inputs

- Approved style board, reference images, usage rights, and target-bound `TextureSpec`/`AnimationSpec` contracts.
- Resolved target pack, ModSpec feature/acceptance IDs, and authorized asset roots.
- Approved generation route and any existing editable sources or asset manifest.

## Procedure

1. **Inventory contracts.**
   - Give every requested asset a stable asset ID; add clip/state IDs where relevant.
   - Bind its feature and acceptance IDs, editable master, runtime exports, and provenance record.
   - Return `clarification_required` for missing behavioral or appearance decisions.
   - **Done:** every requested runtime file belongs to one complete asset contract.
2. **Select one authorized route.**

   | Need                          | Route and required record                                                                                                                                                                                                                                                                        |
   | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | Existing-art cleanup          | `mod-game-worker` runs pinned `runMcAsset` under the approved execution policy; record input/output hashes and transformation.                                                                                                                                                                   |
   | Concept or texture generation | The orchestrator invokes core `requestAsset` through an available trusted-host provider operation: native host image tool, explicitly approved fal, or reviewed local ComfyUI workflow. Record request, model/seed when applicable, references, and output hash; record fal cost when available. |
   | Model or bone animation       | `mod-game-worker` runs the host-approved tool behind `createBlockbenchExporter`: pinned, root-restricted Blockbench with `risky_eval` disabled and loopback-only access. Record application version, project format, and export settings.                                                        |
   - Keep secrets outside the repository and evidence.
   - If the named host operation or approved provider callback is not exposed, return `unavailable`; use no remote-workflow, direct-shell, or invented-art fallback.
   - **Done:** the selected route, authorization, immutable references, and generation record are stored.

3. **Preserve masters and exports.**
   - Keep `.grid`/`.mcpx` texture masters and `.bbmodel` models outside production resources.
   - Use only `.bbmodel → JSON/Java/PNG` or direct JSON/PNG/Java export routes.
   - Select the pack-declared Java Block/Item or Modded Entity format; these formats are not interchangeable.
   - Link every export to its source/export hashes, editable format, generation route, license/author/source URL/modifications/notices, target formats, and visual scenario IDs in the asset manifest.
   - **Done:** no runtime export lacks an editable source and complete manifest entry.
4. **Validate deterministically.**
   - Call `minecraft_assets_validate` on the staged project.
   - Check schemas, identifiers, dimensions, alpha, tiling, UV/orientation/scale, animation timing/states, model round trips, cross-file references, and stale exports.
   - Regenerate exports and compare hashes.
   - For resource-pack references, consult the [Jahrome procedure](../../THIRD_PARTY/jahrome-minecraft-agent-skills/.agents/skills/minecraft-resource-pack/SKILL.md) and [conditional-asset rules](../../THIRD_PARTY/jahrome-minecraft-agent-skills/.agents/skills/minecraft-resource-pack/references/conditional-assets.md); exact pack `docs.json` and resource formats outrank examples.
   - **Done:** validation passes and repeated generation produces identical exports.
5. **Separate previews from game evidence.**
   - Label Blockbench/Blender captures as previews.
   - Hand masters, exports, manifest, preview labels, visual scenario IDs, and rubric to `minecraft-verification`; a trusted human reviewer, not an agent self-approval, records the final aesthetic decision.
   - **Done:** no preview, hash match, or pixel diff is presented as in-game behavior or aesthetic approval.

## Output

Return validated exports, editable masters, the completed asset manifest, deterministic validation results, and labeled previews. Report failed or unavailable routes explicitly; hand runtime and visual review to `minecraft-verification`.
