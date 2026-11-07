---
name: minecraft-resource-pack
description: Use when authoring or debugging exact-version Minecraft resource-pack metadata, models, textures, item definitions, sounds, fonts, namespaces, or conditional client assets.
---

# Minecraft resource pack

Follow the vendored [Jahrome resource-pack procedure](../../THIRD_PARTY/jahrome-minecraft-agent-skills/.agents/skills/minecraft-resource-pack/SKILL.md) and its [conditional-asset rules](../../THIRD_PARTY/jahrome-minecraft-agent-skills/.agents/skills/minecraft-resource-pack/references/conditional-assets.md). Exact target `docs.json`, `resourcePackVersion`, and `verification.json` outrank vendored examples.

## Inputs

- Supported target pack ID/revision, exact resource format, and version-local documentation.
- Authorized staging tree, asset/acceptance references, editable-source manifest, and declared dependencies.
- Requested textures, models, item definitions, sounds, fonts, language entries, and conditional client assets.

## Procedure

1. **Pin pack metadata.** Copy the exact target resource format into `pack.mcmeta`. Formats below 65 use integer `pack_format`; later formats use exact `min_format` and `max_format` `[major, minor]` arrays, including `.0`, never decimal JSON numbers. Use `supported_formats` only for ranges crossing into legacy formats.
   **Complete when:** metadata denotes exactly the resolved target.
2. **Build namespace-correct references.** Use lowercase identifiers beneath `assets/<namespace>/`. Reference model textures and GUI sprites without `.png`; retain `.png` in bitmap-font provider `file`. Keep animated-texture `.png.mcmeta` beside its PNG and match target frame/tick rules.
   **Complete when:** every same-namespace reference resolves without extension or path ambiguity.
3. **Choose the target’s item system.** For 1.21.4+, use `assets/<namespace>/items/` definitions; current `custom_model_data` selectors use component strings. For 1.21.3 and earlier, use model `overrides` with numeric `predicate.custom_model_data`. Never mix them. Use later sprite-object forms only when target documentation supports them.
   **Complete when:** each definition and fixture uses one target-correct representation.
4. **Validate sounds, fonts, and conditional assets.** The namespace containing `sounds.json` owns the event; extensionless file names resolve to `.ogg`, while `type: "event"` aliases another event. Keep fonts under `font/`, with deliberate private-use characters. OptiFine CIT and Iris shaders are conditional client-mod formats, not vanilla assets; Iris shader packs remain separate. Missing required capability returns `unavailable` or `unsupported_request`.
   **Complete when:** aliases, sound sources, font cells, replacement intent, and conditional ownership are explicit.
5. **Run static validation.** Call `minecraft_assets_validate` with exact target revision/formats, registry, animations, language keys, and datagen hashes. Missing same-namespace assets fail. External namespaces outside `minecraft` and the mod namespace currently fail with `namespace_mismatch`; declared dependency namespaces must not be described as warnings until core supports them. Return `invalid` or `ambiguous` without silently selecting candidates.
   **Complete when:** schemas, references, duplicates, animation metadata, and stale exports have deterministic outcomes.
6. **Hand off real-game checks.** Give staging, dependencies, manifest, and visual scenarios to `minecraft-verification`. Exercise item/hand/placed-block states, sprites, sounds, fonts, and conditional features in the exact client; previews and static checks do not close runtime gates.
   **Complete when:** every required scenario has real-client evidence or an explicit blocker.

## Output

Return the staged tree, validation findings, dependency limitations, and real-game handoff. Report `invalid`, `ambiguous`, `unsupported_request`, or `unavailable` without claiming load, rendering, audio, or visual success.
