---
description: Port a Minecraft mod to an exact qualified target
argument-hint: "<source project> <exact destination target>"
---

Port: $ARGUMENTS

1. Use `minecraft-porting`. Pin the source revision/hash and usage rights. Call `minecraft_project_inspect` on the source and `minecraft_target_resolve` for the exact destination; stop without success artifacts on unsupported or ambiguous resolution.
2. Build the source inventory and adaptation matrix. Extract structured data from the pinned source with pinned parsers and independent diffs. Produce or update the validated destination ModSpec, asset contracts, visual rubric, and acceptance traceability before implementation.
3. Apply the port through the same scaffold/transaction and `minecraft_assets_validate` operations as `/mod-create`; do not add a port-specific domain implementation. Preserve unrelated destination files and attribution.
4. Keep simple work single-agent. The orchestrator dispatches red/green checks, approved asset engines, Gradle, and games to `mod-game-worker`.
5. Call `minecraft_project_verify` with the complete destination inputs and host `AbortSignal`. Report behavior changes, drift, unavailable checks, evidence levels, and human visual-rubric results without claiming unexecuted checks passed.
