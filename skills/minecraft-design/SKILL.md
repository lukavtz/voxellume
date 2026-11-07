---
name: minecraft-design
description: Design Minecraft Java mods or feature changes into validated, target-bound ModSpecs with requirement traceability and independent acceptance criteria.
---

# Minecraft design

## Use when

Use for a new mod idea, a gameplay feature request, or a change to an existing mod that needs behavioral decisions and a ModSpec. Target-only requests belong to `minecraft-targets`; implementation begins only after this design is validated.

References: [design requirements](../../docs/SPEC.md#42-design), [core boundaries](../../docs/ARCHITECTURE.md#adr-002-skills-guide-tools-execute-and-verify), and [acceptance scenarios](../../docs/TEST_PLAN.md#4-end-to-end-mod-scenarios).

## Inputs

- User request, desired player experience, constraints, and distribution goals.
- Authorized project root and `minecraft_project_inspect` result when changing an existing project.
- Exact Minecraft release, loader, optional target-pack ID/revision, and required capabilities.
- Existing ModSpec and prior design decisions when present.

## Procedure

1. **Frame and trace requirements.** Assign a stable requirement ID to every requested behavior. Record player fantasy, gameplay loop, progression, balance, content boundaries, configuration, accessibility, persistence, multiplayer behavior, and compatibility as applicable. For an existing project, use its inspection result rather than guessing current behavior. Separate confirmed facts, chosen defaults, and unresolved questions.
   **Complete when:** every requested behavior has a requirement ID, and every behavior-changing unknown appears in an explicit question list.

2. **Bind the target.** Pass the exact coordinates and required capabilities to `minecraft-targets`, which uses `minecraft_target_resolve`; retain its result without duplicating resolution. An `ambiguous` result requires the user's explicit pack selection. An unsupported, mismatched, or unavailable result remains a design blocker.
   **Complete when:** the design records one supported pack ID/revision plus required-capability preflight, or returns the blocker without claiming an implementable design. Authoritative capability checks remain with `minecraft_project_verify`.

3. **Model typed features.** Create stable feature IDs with schema-supported kinds. Map each requirement through `requirement ID → feature IDs → implementation-unit IDs → acceptance IDs`. Specify dependencies, recipes, configuration, persistence/migrations, failure cases, and asset references needed by each feature; route editable-art decisions to `minecraft-assets`.
   **Complete when:** every requirement has at least one feature, every feature traces back to a requirement and implementation unit, and no orphan feature or dangling reference remains.

4. **Define art and visual contracts.** For features requiring art, produce a reviewed style board with reference provenance, palette/ramps, silhouettes, light direction, material examples, and negative constraints. Create target-bound `TextureSpec`/`AnimationSpec` contracts and a visual rubric covering required states, composition, clipping, and readability. Reference plates remain design inputs, not shipping pixels.
   **Complete when:** every asset reference has an approved style-board entry, an asset ID linked to a complete texture or animation contract, and acceptance-linked visual rubric criteria.

5. **Specify acceptance independently.** Give each feature observable acceptance entries with stable IDs, a supported deterministic check kind, check ID, fixture, and expected output derived from the requirement. Add negative cases and, where applicable, restart persistence, multiplayer synchronization, and named visual states. Do not derive expected output from the proposed implementation.
   **Complete when:** every feature has linked acceptance entries, every acceptance entry traces to its requirement and implementation unit, and required checks have capability preflight results or explicit blockers.

6. **Validate and publish the ModSpec.** Create or update the versioned ModSpec through the transaction operations, then run core schema and cross-reference validation with the exact target revision recorded. Answer behavior-changing questions before validation; preserve nonblocking assumptions separately.
   **Complete when:** validation passes, traceability is complete, and the unresolved-question list is empty or contains only explicitly nonbehavioral items.

## Output

Return the validated ModSpec, exact target decision and capability preflight, requirement/feature/acceptance traceability, reviewed style board, `TextureSpec`/`AnimationSpec` contracts, visual rubric, assumptions, and explicit unresolved questions. If validation or a target gate fails, return the draft plus structured diagnostics instead of a validated ModSpec. Hand off to `minecraft-implementation`, `minecraft-assets`, and `minecraft-verification` without claiming their work or checks have run.
