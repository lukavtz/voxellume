---
description: Create a Minecraft mod project and prove it builds
argument-hint: "<mod idea and exact target, or existing project>"
---

Create the requested mod: $ARGUMENTS

1. Call `minecraft_target_info` with the requested Minecraft version and loader. Report
   the pin id and whether it has a template. An empty `pins` list means no pinned
   target; stop there rather than choosing a nearby version.
2. Use `minecraft-design` to turn the idea into ordered slices, each with the check that
   proves it.
3. Create the project with `minecraft_project_scaffold`, passing the pin id and the mod
   identity. Then build it once with a `build` task through `mod-game-worker` before
   editing anything.
4. Implement slices through `minecraft-implementation`, loader guidance through
   `minecraft-fabric` or `minecraft-neoforge`, and assets through `minecraft-assets`,
   `minecraft-blockbench`, or `minecraft-blender`.
5. Prove each claim with `minecraft_run`. Report the task, `status`, `exitCode`, and the
   artifact or log marker observed.

Do not claim a build, a server start, or a rendered item without a run result.
