---
description: Create or extend a Minecraft mod through Voxellume core operations
argument-hint: "<mod idea and exact target, or existing project>"
---

Create the requested mod: $ARGUMENTS

1. Use `minecraft-design` to produce a validated ModSpec, requirement/feature/acceptance traceability, exact target request, reviewed style board, required `TextureSpec`/`AnimationSpec` contracts, and visual rubric. Resolve behavior-changing questions first.
2. For an existing project, call `minecraft_project_inspect`. Call `minecraft_target_resolve` and stop on `unsupported` or `ambiguous`; record capability preflight without treating it as runtime proof.
3. Scaffold new work only through `minecraft_project_scaffold` after ModSpec validation. Implement through `minecraft-implementation` in transaction staging. Generate/export assets through `minecraft-assets` and call `minecraft_assets_validate`.
4. Keep simple work single-agent. The orchestrator dispatches every red/green or process-backed check and approved asset engine to `mod-game-worker`; `mod-offline-worker` only edits and performs non-process core operations.
5. Call `minecraft_project_verify` with the ModSpec, exact pack, staged candidate, requested profile, fixtures/rubric, approvals, authorized roots, and host `AbortSignal`. Return its structured evidence report and human visual-rubric result. Never claim unexecuted checks passed.

Do not reimplement target resolution, scaffolding, validation, verification, or reporting in this command.
