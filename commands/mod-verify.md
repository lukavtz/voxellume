---
description: Verify a Minecraft mod and return the core evidence report
argument-hint: "<project> [verification profile]"
---

Verify: $ARGUMENTS

1. Inspect with `minecraft_project_inspect` and resolve with `minecraft_target_resolve`. Collect the validated ModSpec, exact pack `verification.json`, staged candidate hashes, requested profile, fixtures, visual rubric, approvals, and authorized project/evidence roots.
2. Dispatch `minecraft_project_verify` to `mod-game-worker` with the requested profile and host `AbortSignal`. `mod-offline-worker` may diagnose source/resource findings but cannot run red/green, Gradle, asset-engine, or game processes.
3. Preserve core stage order `static → build → server → gameTest → client → productionJar → visual → package` as selected by the profile. Return requested/executed checks, statuses, diagnostics, exact commands, artifacts, environment, repair history, and trusted human visual-rubric record. Treat unexecuted checks as not passed.
4. Limit repair to three one-change attempts; never weaken a check or substitute a target.
