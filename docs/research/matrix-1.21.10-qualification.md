# Minecraft 1.21.10 target qualification

Date: 2026-11-07.

Evidence root: `~/.local/share/voxellume/evidence/matrix-1.21.10-r1-20261107T202500Z/`.

## Outcomes

No 1.21.10 pack is `supported`; no pack has an `evidenceManifest`.

| Pack                       | Outcome     | Final `packSha256`                                                 | Observed qualification                                                                                                                                                                               |
| -------------------------- | ----------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `java-fabric-1.21.10-r2`   | `candidate` | `c9c5aa14e3a5ec45338279abcd1d015cee2d5cb67404291e44adfd24157cf77c` | Task discovery, clean builds, development and packaged production servers, positive GameTest, and negative control passed. Client remained in asset download; black capture rejected.                |
| `java-neoforge-1.21.10-r1` | `candidate` | `926faae2e7efa80a99e4f1f1d8c973f013c2f2b9269bc1a5f91a79ad96189418` | Task discovery, clean binary-patch builds, development and packaged production servers, two positive GameTests, negative control, and real-client rendering passed. Full visual matrix did not pass. |
| `java-forge-1.21.10-r1`    | `rejected`  | `096583d9591368a6b0101ad8966c17822ac6fa2c33aac44ede11615edd95f4b1` | Task discovery and a bounded-heap retry failed during decompilation with exit 137. No executable verification or template is retained.                                                               |
| `java-quilt-1.21.10-r2`    | `candidate` | `081961ead5968328757d57d2a7a08e60b392b7bccb0ed85ba6854de697b885ce` | R2 task discovery, clean build, development server, and packaged production server passed. Client remained in asset download; black capture rejected. No GameTest is configured.                     |

`pack-validation.json` records `loadTargetPacks` validation of all four final packs. Final pack JSON and reviewed templates are copied under `final-packs/`.

## Immutable inputs and sandbox

Minecraft `1.21.10` is obfuscated and uses Java 21, data pack 88, and resource pack 69. Release JSON SHA-256 is `aeb4eb146190122dec966a9bba00eb16b7c415fc5348affc5e3f494c24002abd`. Client mappings SHA-256 is `2a6f53f4c1fd048e8fa956e3a3fbbb0afc02d5bbc23e52a16b328aed61b9bf39`; server mappings SHA-256 is `6b90e3206eb288c1976e10e2369f3752e4e93ac7f0afe513754d390d07bb2ebb`.

All executions used Linux/arm64, JDK 21, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, bounded tmpfs, isolated Gradle homes, argument-array spawning, and a 16 MiB output cap. `commands.log`, `*.status.json`, and `*-container-state.json` retain argv, timestamps, exit codes, and container inspections. Existing EULA and official-network approvals were reused. `environment.json` records limits and wrapper identities; `input-artifact-hashes.txt` records exact input hashes. Templates contain no `.gradle`, `build`, `run`, logs, or world data.

## Fabric r2

Exact inputs are Loader `0.20.1`, Fabric API `0.138.4+1.21.10`, official Mojang mappings, Gradle `9.8.2`, Loom `1.17.21`, and template `FabricMC/fabric-example-mod@5e9647a230978926f3922b8d24c224997fd6d163`. Template, loader, API, mapping, and wrapper hashes independently match the pack.

R1 used exact Loom `1.20.0-alpha.19`; `fabric-r1-tasks.log` records its JVM 25 requirement under required JDK 21. R2 changes only the Loom pin. `fabric-r2-tasks.log`, `fabric-r2-clean-build.log`, and fixture-free `fabric-r2-production-clean-build.log` pass. `fabric-r2-server-clean-shutdown.log` reaches `Done`.

The initial separate GameTest metadata did not register the fixture. Direct `fabric-gametest` registration and the current singular `structure` resource directory fixed target-local discovery. `fabric-r2-gametest-positive-current.log` records `VOXELLUME_TEST_PASSED=mod_loaded` and all required tests passing. `fabric-r2-gametest-negative-current.log` preserves the positive pass and reports only the deliberate failure with exit 1. Earlier discovery attempts remain retained.

Production JAR: `artifacts/fabric/modid-1.0.0.jar`, SHA-256 `f50b5445dd82c57eaf2658e0689edfc955952e290f1a5887f7bf8d073a77231d`. Its inventory contains no GameTest classes or resources. `fabric-production-server.log` loads the production JAR with exact Fabric API and reaches `Done`.

The real client remained in `downloadAssets`. `artifacts/visual/fabric/main-menu.png` is a reviewed 1280x720 uniformly black capture and is rejected. `client:false` and `visual:false` are intentional.

## NeoForge r1

Exact inputs are NeoForge `21.10.64`, Parchment `1.21.10` / `2025.10.12`, MDG `2.0.148`, Gradle `9.2.1`, and template `NeoForgeMDKs/MDK-1.21.10-ModDevGradle@4d5f4857c786f950da8d444674f51d595c16662f`. Universal, installer, Parchment, template, and wrapper hashes match.

The reviewed template enables the official binary-patch pipeline with `disableRecompilation=true` inside the 4 GiB sandbox. `neoforge-tasks.log`, `neoforge-clean-build.log`, and fixture-free `neoforge-production-clean-build.log` pass. `neoforge-server.log` reaches `Done`.

`neoforge-gametest-positive.log` records `registry_and_item` and `place_example_block` passing. `neoforge-gametest-negative.log` preserves both positive passes and reports only `deliberate_negative_control` with exit 1.

Production JAR: `artifacts/neoforge/examplemod-1.0.0.jar`, SHA-256 `f830f267ca271a94b80c56c01f443b5cdb2511d4b808a60dff383d626bbc90cc`. Its inventory contains no GameTest classes or resources. `neoforge-production-server.log` installs the exact loader, loads the JAR, and reaches `Done`.

Reviewed captures show the accessibility-onboarding screen and the settled main menu. `artifacts/visual/neoforge/main-menu-settled.png` legibly shows Minecraft 1.21.10, NeoForge 21.10.64, and three loaded mods. Inventory, hand, world, animation, persistence, multiplayer, clipping, and z-fighting scenarios were not established. `client:true` and `visual:false` are intentional.

## Forge r1

Exact inputs are Forge `60.1.18`, official Mojang mappings, ForgeGradle `7.0.40`, Gradle `9.3.1`, and the exact official MDK. The MDK range was pinned to `7.0.40`.

`forge-tasks.log` failed during Minecraft Mavenizer decompilation with MCP step exit 137. Bounding Gradle and fork heaps to 3 GiB did not repair it; `forge-tasks-repair1.log` failed identically. Exact `inputs/mcp_config-1.21.10-20251007.101210.zip`, SHA-256 `2073dfdb7e1c6a5285345c2e23024b0abd9c78ce99f51252f5269fb05657d918`, declares Vineflower 1.11.1 with `-Xmx4G`, exceeding the required 4 GiB container budget.

No tasks were listed and no production JAR was produced. Server, GameTest, client, production-JAR runtime, and visual checks were not run. The pack is `rejected` with `verification_failed`; its template and executable verification commands are removed.

## Quilt r2

Exact inputs are Loader `0.20.0-beta.9`, Quilt Mappings `1.21.10+build.4:intermediary-v2`, Loom `1.15.1`, generic template `9a6f89cd481e3f58f128596b5b043353bee6b3f2`, and Gradle `9.2.1`. Quilt Meta profile has exact `inheritsFrom: 1.21.10` and response SHA-256 `167214008060080586d73c31ba97d9252e77e766114a9c6b2b6c1c6daa049adb`. No QSL or QFAPI dependency is declared; the loader `PreLaunchEntrypoint` is used.

R1 Gradle 8.9 failed because Loom 1.15.1 declares Gradle plugin API 9.2.0. R2 changes only Gradle to 9.2.1. `quilt-r2-tasks.log` and `quilt-r2-clean-build.log` pass. `quilt-r2-server.log` reaches `Done`.

Production JAR: `artifacts/quilt/example_mod-1.0.0+1.21.10.jar`, SHA-256 `3cd812602d7520d93f9e7ef774e8b58ea6dfb7980faeb613ad7bcb128a976c10`. `quilt-production-server.log` uses the installer’s nested `server/` layout, loads the exact JAR, and reaches `Done`. No GameTest is configured by this loader-only pack.

The real client remained in `downloadAssets`. `artifacts/visual/quilt/main-menu.png` is a reviewed 1280x720 uniformly black capture and is rejected. `client:false` and `visual:false` are intentional.

## Integrity

The final report is copied into the evidence root as `matrix-1.21.10-qualification.md`. `result.json` summarizes all four outcomes and has `evidenceManifest:null`. `cleanup.json` records owned container/volume cleanup and production server removal. Development run directories remain as evidence; templates exclude generated runtime and build state.

`SHA256SUMS` uses relative evidence paths only, includes the final report, and excludes itself. Every entry was verified with `shasum -a 256 -c SHA256SUMS` before the evidence directory was sealed read-only.
