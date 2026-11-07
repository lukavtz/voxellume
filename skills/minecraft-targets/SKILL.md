---
name: minecraft-targets
description: Resolve exact Minecraft Java release and loader targets, decide requested capabilities, inspect existing-project coordinates, and select version-local official documentation.
---

# Minecraft targets

## Use when

Use to select an exact target pack, choose among pack revisions, determine build/server/client/GameTest/visual capability, infer coordinates from an existing project, or obtain documentation for downstream work.

References: [target-pack contract](../../docs/research/minecraft-targets.md), [support rules](../../docs/SPEC.md#6-target-packs), and [source-facade decision](../../docs/research/source-mcp-benchmark.md).

## Inputs

- Minecraft edition, exact case-sensitive release, loader, and required capabilities.
- Optional explicit target-pack ID, whose identifier includes its immutable revision.
- Authorized project root when coordinates must come from an existing project.
- Installed target-pack catalog; runtime resolution never uses `latest` or live discovery.

## Procedure

1. **Establish exact coordinates.** For a direct request, preserve the supplied release and loader exactly; whitespace, malformed values, unknown editions, and unknown loaders are invalid. For an existing project, call `minecraft_project_inspect` read-only and use its reported coordinates, source sets, dependencies, and mismatches. Inspection may describe a non-supported pack; malformed or missing build metadata remains a diagnostic.
   **Complete when:** exact coordinates and requested capabilities are known, or an inspection/validation diagnostic identifies what is missing.

2. **Resolve through the shared operation.** Call `minecraft_target_resolve` with the coordinates and optional explicit target-pack ID. The ID and its embedded revision must match the requested coordinates. Only `supported` packs are candidates; make no project mutation.

   | Resolver result                                                | Action                                                                                   |
   | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
   | Exactly one matching `supported` pack                          | Continue with its immutable pack record.                                                 |
   | `ambiguous`                                                    | Return the lexically sorted candidate IDs and require an explicit ID/revision selection. |
   | `unsupported_target`, `target_not_found`, or `target_mismatch` | Return the structured reason and evidence; stop without substitution.                    |

   **Complete when:** one immutable pack is selected or the exact ambiguity/unsupported diagnostic is returned. Never substitute a nearby release, loader, mappings kind, case variant, or revision; an empty catalog is unsupported.

3. **Record capability preflight.** Compare requested build/server/client/GameTest/visual capabilities with the selected pack's `verification.capabilities` and immutable evidence reference. Resolution alone does not execute the core capability assertion. `minecraft_project_verify` performs that assertion before execution and returns `capability_unavailable` or `missing_qualification_evidence` when its gate fails.
   **Complete when:** every requested capability and any missing flag/evidence are recorded without claiming verification success. A non-supported target remains `unsupported_target` or its explicit-ID mismatch diagnostic.

4. **Load version-local references.** Read only the selected pack's official `docs.json` entries and revisions, `verification.json`, mappings, and known limitations. For Fabric only, consult the conditional [Fabric version contract](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/fabric-modding/references/version-contracts.md); for NeoForge only, consult the [NeoForge version contract](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/neoforge-modding/references/version-contracts.md). Exact pack documents outrank examples. These references do not qualify packs or establish Forge/Quilt support; those loaders use their own pack documentation. The disabled source facade is not a documentation substitute.
   **Complete when:** downstream work receives the selected pack ID, revision, immutable hash, applicable documentation revisions, verification contract, and limitations.

## Output

Return requested coordinates, resolution status, selected pack ID/revision/hash or sorted ambiguity candidates, per-capability preflight with evidence references, version-local documentation references, known limitations, and any inspection diagnostics. Non-resolved outcomes produce no success artifacts or project changes.
