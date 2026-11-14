---
description: Port a mod to an exact pinned target
argument-hint: "<source project> <exact destination Minecraft version and loader>"
---

Port: $ARGUMENTS

1. Use `minecraft-porting`. Pin the source revision and its usage rights.
2. Call `minecraft_target_info` for the destination. Record the pin, its JDK, and
   whether it has a template. A pin without a template means the project is created by
   hand from the loader's own documentation.
3. Build the source inventory and the unit table with dispositions before editing.
4. Port one unit at a time, running `build` through `mod-game-worker` after each unit.
5. Where the destination needs new assets, use `minecraft-assets` and
   `minecraft_assets_check`.
6. Finish with `minecraft-verification`: build, then whichever of server, GameTest, and
   client the destination supports. Report unproven claims as unproven.

Never substitute a nearby Minecraft or loader version.
