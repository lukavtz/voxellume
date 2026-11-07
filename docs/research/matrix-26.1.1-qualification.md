# Minecraft 26.1.1 target qualification

Initial checks: 2026-11-07. Resumed and finalized: 2026-11-08.

Evidence root: `~/.local/share/voxellume/evidence/matrix-26.1.1-r1-20261107T210000Z/`.

## Outcomes

No 26.1.1 pack is `supported`; no pack has an `evidenceManifest`.

| Pack                      | Outcome     | Final `packSha256`                                                 | Production JAR SHA-256                                             | Observed qualification                                                                                                                                                                   |
| ------------------------- | ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `java-fabric-26.1.1-r1`   | `candidate` | `1db6275d8756fad186b259126a59aa5c662ba717f507481c0c0c94e76b65e704` | `44f9feea6e08df1279d63263374ae82c2d51c99198133ca78509eae29b6fd4ca` | Tasks, clean builds, development and packaged production servers, positive GameTests, negative control, and reviewed visual surfaces passed. Client GameTest exited 134 during shutdown. |
| `java-neoforge-26.1.1-r1` | `candidate` | `b9ff4c90f640af0dc2e2905163b3931f408ddf5b287c952320b081b5fe87c622` | `6ccd30a8b8b611f8b4e0c657c7ea92313d51c1bdb1997b6478b988334fbc7670` | Tasks, clean binary-patch builds, development and packaged production servers, positive GameTests, negative control, real client, and reviewed visual surfaces passed.                   |
| `java-forge-26.1.1-r1`    | `rejected`  | `a61ef4184692c7d3737d7ab2c09dbe34509e3842d185820e5d18a024dce1ff74` | none                                                               | Tasks and clean build failed during decompilation with MCP step exit 137. No executable verification or template is retained.                                                            |
| `java-quilt-26.1.1-r1`    | `candidate` | `200c0cb257d1a1d3054c51c44dd891c82785b104bd57a9b2b2df09ec1803afbf` | `aa8836d840e549c13a8a126fc0064ed9631fd51dbb35eacaaccb8134f4952ccf` | No-remap task discovery and clean build passed. Development and production servers rejected Java 25 class files. Client and visual checks did not pass.                                  |

`pack-validation.json` records `loadTargetPacks` validation of the four final packs. Final pack JSON and cleaned templates are copied under `final-packs/`.

## Immutable inputs and sandbox

Minecraft `26.1.1` is unobfuscated and uses Java 25, data pack 101.1, and resource pack 84. Release JSON SHA-256 is `8c53765d6096983e227fb25b4c564ac2314ce34aa47319fda0af07e28c5aea0d`. All four packs use `mappings.kind=none`; no Yarn, Mojang, Parchment, Quilt Mappings, Intermediary, QSL, or QFAPI substitution occurred.

Exact loader inputs are Fabric Loader `0.20.1` with Fabric API `0.145.4+26.1.1`, NeoForge `26.1.1.15-beta`, Forge `63.0.2`, and Quilt Loader `0.20.0-beta.9`. Quilt Meta profile SHA-256 is `c793ac80d1465db11317b5e73b57e346af0d060babae61051929b73b0a482fd1` and declares exact `inheritsFrom: 26.1.1`.

All executions used Linux/arm64, JDK 25, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, bounded tmpfs, isolated Gradle homes, argument-array spawning, and a 16 MiB output cap. Build and runtime timeouts were 900 and 600 seconds. One Gradle process ran per project. `commands.log`, `*.status.json`, and `*-container-state.json` retain argv, timestamps, exit codes, and container inspections. Existing EULA and official-network approvals were reused. `environment.json` records limits and wrapper identities; `input-artifact-hashes.txt` records exact input hashes.

Linux/arm64 client checks used the eight saved LWJGL `3.4.1` ARM64 native archives selected through `JAVA_TOOL_OPTIONS=-Dorg.lwjgl.librarypath=/home/gradle/.gradle/lwjgl-arm64`. These qualification-only natives did not change templates or production dependencies.

## Fabric r1

Exact inputs are Loader `0.20.1`, Fabric API `0.145.4+26.1.1`, Gradle `9.8.2`, Loom `1.20.0-alpha.19`, and template `FabricMC/fabric-example-mod@6f5e3318f2dcc707b99b126b92ff312dec6680d2`. Template, loader, API, release, and wrapper hashes independently match the pack. The unobfuscated target uses `net.fabricmc.fabric-loom`, not the remapping plugin.

Reused passed evidence includes `fabric-tasks-final`, `fabric-clean-build`, fixture-free `fabric-final-clean-build`, development `fabric-server-final`, and packaged `fabric-production-server-final`. Positive server GameTests passed through `build`; the deliberate negative control failed as designed. The production inventory contains no GameTest classes or resources.

Production JAR: `artifacts/fabric/modid-1.0.0.jar`, SHA-256 `44f9feea6e08df1279d63263374ae82c2d51c99198133ca78509eae29b6fd4ca`. The pristine Fabric server loaded the exact JAR and reached `Done`.

`runClientGameTest` reached its singleplayer assertion and rendered the world but exited 134 in `libopenal.so` during shutdown. The separate real `runClient` rendered the modded main menu, fixed-seed world, first-person hand, inventory, movement, and pause GUI before deliberate termination. `fabric-visual-review.json` records the reviewed captures. Visual capability is true for those surfaces; client capability remains false because the configured client GameTest crashed. Custom animation, persistence, multiplayer, clipping, and z-fighting scenarios are not claimed.

## NeoForge r1

Exact inputs are NeoForge `26.1.1.15-beta`, MDG `2.0.148`, Gradle `9.2.1`, and template `NeoForgeMDKs/MDK-26.1.1-ModDevGradle@77ca08963a1cb0d40d6b3d109a5d5bf592b5a80f`. Universal, installer, template, release, and wrapper hashes match. `neoForge.enable.disableRecompilation=true` selects the official binary-patch pipeline; decompiled Minecraft sources are unavailable.

Reused `neoforge-tasks` and `neoforge-clean-build` passed. The resumed dedicated server reached `Done`. Positive `runGameTestServer` evidence records `registry_and_item` and `place_example_block` passing, with all three required tests passing. The negative run preserved both positive passes and reported only `deliberate_negative_control` with exit 1.

All temporary test classes, test instances, and structures were removed. `neoforge-final-clean-build-online` then passed from the fixture-free template. An earlier `--network=none` attempt failed because the new isolated cache lacked Mojang metadata; it is retained and is not counted as a pass.

Production JAR: `artifacts/neoforge/examplemod-1.0.0.jar`, SHA-256 `6ccd30a8b8b611f8b4e0c657c7ea92313d51c1bdb1997b6478b988334fbc7670`. Its inventory contains no GameTest classes or resources. The pristine installer-based server loaded Example Mod 1.0.0 and reached `Done`.

The real development client rendered Minecraft 26.1.1, NeoForge 26.1.1.15-beta, and three loaded mods. Reviewed captures cover the fixed-seed world, first-person hand, inventory/crafting GUI, movement, and pause GUI. The client was deliberately stopped after capture and exited 137. Packaged-JAR client behavior, persistence, multiplayer, placed-block, custom animation, clipping, and z-fighting scenarios remain unqualified, so the pack remains `candidate` despite all observed capability flags being true.

## Forge r1

Exact inputs are Forge `63.0.2`, ForgeGradle `7.0.40`, Gradle `9.3.1`, and the official MDK archive. `forge-tasks.log` and `forge-clean-build.log` both failed during Minecraft Mavenizer decompilation with MCP step exit 137 inside the required 4 GiB container. No tasks were listed and no production JAR was produced.

Official MCP config `26.1.1-20260401.101545`, SHA-256 `b743eea5bfd80420a5a31030005d27424031c9fc0a2b73c0fe90bc87318e3ac1`, selects Vineflower 1.11.2. Its saved response is under `inputs/`. The pack is `rejected` with `verification_failed`; its template and executable verification commands are removed.

Server, GameTest, negative control, client, production-JAR runtime, and visual checks were not run because the build prerequisite failed. No support is claimed.

## Quilt r1

Exact inputs are Loader `0.20.0-beta.9`, Quilt Loom `1.15.1`, generic template `9a6f89cd481e3f58f128596b5b043353bee6b3f2`, and Gradle `9.8.2`. The original generic template coordinates were overridden to 26.1.1.

Initial task discovery failed because the remapping plugin required an empty `mappings` configuration. The target-local unobfuscated repair selects plugin `org.quiltmc.loom.no_remap` and uses `implementation libs.quilt.loader`; no mappings dependency was invented. `quilt-tasks-final.log` and `quilt-clean-build.log` pass. No GameTest task is configured by this loader-only pack.

Production JAR: `artifacts/quilt/example_mod-1.0.0+26.1.1.jar`, SHA-256 `aa8836d840e549c13a8a126fc0064ed9631fd51dbb35eacaaccb8134f4952ccf`. Development and packaged production servers both reached Quilt Loader but failed before mod loading with `java.lang.IllegalArgumentException: Unsupported class file major version 69`. The exact loader cannot read Java 25 class files in these runs.

The real client remained in `downloadAssets` and was deliberately stopped. `artifacts/visual/quilt/client-attempt.png` is a reviewed 1280x720 uniformly black capture and is rejected. `quilt-visual-review.json` records the failure. Only build capability is true.

## Integrity and cleanup

The final report is copied into the evidence root as `matrix-26.1.1-qualification.md`. `result.json` summarizes all four outcomes and has `evidenceManifest:null`. `cleanup.json` records owned container/volume cleanup and temporary-work removal. Templates contain no `.gradle`, `build`, `run`, logs, or world data; the rejected Forge pack has no template.

`SHA256SUMS` uses relative evidence paths only, includes the final report and copied final packs, and excludes itself. Every entry is verified before the evidence directory is sealed read-only.
