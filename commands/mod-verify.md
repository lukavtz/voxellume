---
description: Prove a mod project with observed build and runtime results
argument-hint: "<project directory>"
---

Verify: $ARGUMENTS

1. Confirm the project's pin with `minecraft_target_info`, and read `gradle.properties`
   for its declared versions.
2. Dispatch `minecraft_run` through `mod-game-worker`, one claim at a time: `build` for
   the JAR, `runServer` with `stopOnLog: "Done \\("` for a booting server, `runGametest`
   for in-game tests, `runClient` for a client.
3. Validate assets with `minecraft_assets_check` when the claim involves models,
   textures, language files, or a screenshot diff.
4. Report per claim: task, `argv`, `status`, `exitCode`, `durationMs`, `logPath`, and
   the artifact or marker line observed.
5. Treat `timed_out`, `cancelled`, `output_limit_reached`, `spawn_failed`, and
   `exitCode: null` as not passed. Never accept the server EULA for the user.
6. Limit repair to three one-change attempts per claim, and never weaken a check.
