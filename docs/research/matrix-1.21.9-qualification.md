# Minecraft 1.21.9 target qualification

Date: 2026-11-07.

Evidence root: `~/.local/share/voxellume/evidence/matrix-1.21.9-r1-20261107T194500Z/`.

## Outcomes

No 1.21.9 pack is `supported`. Every pack has an explicit `candidate` outcome because its full required visual matrix did not pass. No `evidenceManifest` is declared.

| Pack                      | Outcome     | Final `packSha256`                                                 | Observed qualification                                                                                                                                                                                          |
| ------------------------- | ----------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `java-fabric-1.21.9-r2`   | `candidate` | `da76ecdf6dd352a186005bffdeb9cd037a6391f08519adc19173430250234330` | R2 tasks, clean builds, development and packaged production servers, positive GameTests, and negative control passed. Client and visual checks did not pass.                                                    |
| `java-neoforge-1.21.9-r1` | `candidate` | `5792eaef676d7cd89eaf1ed546863433f92dede48ece1d25ae44e3941ea6bcfa` | Tasks, clean binary-patch builds, development and packaged production servers, positive GameTests, negative control, and real-client accessibility/main-menu rendering passed. Full visual matrix did not pass. |
| `java-forge-1.21.9-r1`    | `candidate` | `c78a0073c3446b8c4eedc1a53773d73f5c86d524927991778ed570fbfd5adb27` | Tasks, clean builds, development and packaged production servers, positive GameTests, negative control, and real-client accessibility/main-menu rendering passed. Full visual matrix did not pass.              |
| `java-quilt-1.21.9-r2`    | `candidate` | `7c441ac2ed57d0d937d3a4890f48c4c0dba31dedd210ae6e74dce6e6bc582199` | R2 tasks, Loader-only clean builds, and development and packaged production servers passed. Client and visual checks did not pass. GameTest is not configured or required.                                      |

`pack-validation.json` records successful `loadTargetPacks` validation of all four final targets. The final three-file snapshots are under `pack-catalog/`.

## Immutable inputs and sandbox

Minecraft `1.21.9` is obfuscated, uses Java 21, data pack 88, and resource pack 69. Release JSON SHA-256 is `c15f22ecd953e09dd6f55792d7af59efa9cb0c997ee13d5cca7b91a8bfa21e66`. Client mappings SHA-256 is `f223e9775abb66b6712c505cb1a73b48d615efebaf43a9f81dd58df9a9b1c7b3`; server mappings SHA-256 is `d65cf145581b63a6c84af66748436e390be962effdc4dfc8ab1b5460715b9ac5`.

`input-verification.json` records independently fetched and matched release, mappings, loader, API, templates, Loom, NeoForge installer/universal, Parchment, Forge installer/MDK, Quilt mappings/profile, and production installer hashes. The Quilt profile has exact `inheritsFrom: 1.21.9`. An initial percent-encoded Quilt mapping URL returned 404; the retained fetch log precedes the successful literal-`+` URL retrieval with the expected SHA-256.

Executions used Linux/arm64, JDK 21, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, bounded tmpfs, isolated Gradle homes, argument-array process spawning, and a 16 MiB output cap. Exact argv, timestamps, logs, exit codes, and container inspections are in `commands.log`, `*.status.json`, and `*-container-state.json`. Existing EULA and official-network approvals were reused. Build and runtime limits were 900 and 600 seconds; client captures used shorter bounded runs. Owned containers and all four Gradle volumes were removed; `cleanup.json` records cleanup.

## Fabric r2

Exact inputs are Loader `0.20.1`, Fabric API `0.134.1+1.21.9`, official Mojang mappings, Gradle `9.8.2`, Loom `1.17.21`, and template `FabricMC/fabric-example-mod@a954d00fc8ab8fc86bff8e7c0af1494bde2da896`. R1 Loom `1.20.0-alpha.19` task discovery failed because that plugin requires JVM 25 while this target requires JDK 21. R2 changes only the Loom pin.

`fabric-r2-tasks.log`, `fabric-r2-clean-build.log`, and `fabric-r2-production-clean-build.log` pass. The initial dedicated-server attempt lacked the already-approved EULA file; it is retained. `fabric-r2-server-repair1.log` reaches `Done` and loads `modid`, Loader 0.20.1, Minecraft 1.21.9, and Fabric API 0.134.1+1.21.9. `fabric-production-server.log` reaches `Done` with the packaged production JAR.

The first GameTest invocation found no `runGametest`; the explicit Loom `gametest` run repair passes. `fabric-r2-gametest-positive-repair1.log` records `VOXELLUME_TEST_PASSED=mod_loaded` and all required tests passing. The negative run preserves the positive pass and reports only the deliberate failure. Test classes, entrypoints, and structures were removed before the final clean build; the production JAR inventory contains no test fixtures.

Production JAR: `artifacts/fabric/modid-1.0.0.jar`, SHA-256 `53492f5a31926924167902b55b54c577a8d5a874ad13d5abb5cf4b2e2f4ccf33`.

The real client remained at `downloadAssets`. `artifacts/visual/fabric/main-menu.png` was reviewed and rejected as uniformly black. `client:false` and `visual:false` are intentional.

## NeoForge r1

Exact inputs are NeoForge `21.9.16-beta`, Parchment `1.21.9` / `2025.10.05`, MDG `2.0.148`, Gradle `9.2.1`, and template `NeoForgeMDKs/MDK-1.21.9-ModDevGradle@4ab89e95e574cc0f24c2f38e4c707d9041af4388`. The template uses MDG's official `disableRecompilation` binary patch pipeline. `neoforge-tasks.log`, `neoforge-clean-build.log`, and `neoforge-production-clean-build.log` pass.

`neoforge-server.log` and `neoforge-production-server.log` reach `Done` with Example Mod and NeoForge 21.9.16-beta. The data-driven fixture registers `Consumer<GameTestHelper>` functions through `BuiltInRegistries.TEST_FUNCTION`. `neoforge-gametest-positive.log` passes `registry_and_item` and `place_example_block`. The negative run preserves both positive passes and reports `deliberate_negative_control` as the only failure. Test classes, registration calls, and data were removed before the final clean build; the production JAR contains no test fixtures.

Production JAR: `artifacts/neoforge/examplemod-1.0.0.jar`, SHA-256 `b345b52e953cbee09202dea8d635e02100dd5a5b45a57797b09d7670b98ac938`.

Reviewed 1280x720 captures show accessibility onboarding and the real main menu with Minecraft 1.21.9, NeoForge 21.9.16-beta, and three mods. They do not qualify the packaged-JAR client, world, inventory, hand, placed-block, animation, persistence, multiplayer, clipping, or z-fighting scenarios. `client:true`, `visual:false`, and candidate status are intentional.

## Forge r1

Exact inputs are Forge `59.0.5`, official Mojang mappings, ForgeGradle `6.0.54`, Gradle `8.12.1`, and official MDK `1.21.9-59.0.5`. The MDK range was pinned to the exact plugin. `forge-r1-tasks.log`, `forge-r1-clean-build.log`, and `forge-production-clean-build.log` pass within the shared sandbox.

`forge-server.log` and `forge-production-server.log` reach `Done` with Example Mod and Forge 59.0.5. The initial GameTest compile failure records the required registry-key API repair. `forge-gametest-positive-repair1.log` passes `registry_and_item` and `place_example_block`; the negative run preserves those passes and reports only the deliberate failure. Fixtures were removed before the final production build.

Production JAR: `artifacts/forge/examplemod-1.0.0.jar`, SHA-256 `a62bdf2eb1f419a83ead8c5e15de4dd64f1d90aea5e2ad2181bf7407ea2d3ab8`.

Reviewed 1280x720 captures show accessibility onboarding and the real main menu with Minecraft 1.21.9, Forge Beta 59.0.5, and three mods. The full packaged-JAR/world/inventory/hand/block/animation/persistence/multiplayer visual matrix did not pass. `client:true`, `visual:false`, and candidate status are intentional.

## Quilt r2

Exact inputs are Loader `0.20.0-beta.9`, Quilt Mappings `1.21.9+build.2:intermediary-v2`, Loom `org.quiltmc.loom.remap:1.15.1`, Gradle `9.2.0`, and generic template `9a6f89cd481e3f58f128596b5b043353bee6b3f2`. No QSL or QFAPI dependency is declared. R1 Gradle 8.9 failed because Loom 1.15.1 declares Gradle plugin API 9.2.0. R2 changes Gradle and the remap plugin identity while preserving Minecraft, Loader, mappings, and template family.

`quilt-r2-tasks.log` and `quilt-r2-clean-build-repair1.log` pass. The initial clean build retained generic QSL/QFAPI 1.20.6 dependencies and its server selected Loader 0.25.0; `quilt-r2-server.log` retains that exact mismatch. The Loader-only repair uses exact Loader 0.20.0-beta.9 and its `pre_launch` entrypoint. `quilt-r2-server-repair1.log` and `quilt-r2-production-server.log` reach `Done` with Minecraft 1.21.9 and `example_mod`.

Production JAR: `artifacts/quilt/example_mod-1.0.0+1.21.9.jar`, SHA-256 `f3fc55d08ce63a080bb668893883cc0348775c5ea27dfbb7ae7fa38371c6a780`.

The real client remained at `downloadAssets`. `artifacts/visual/quilt/main-menu.png` was reviewed and rejected as uniformly black. `client:false` and `visual:false` are intentional.

## Integrity

`artifact-hashes.txt` records final production JAR identities. The four `*-visual-review.json` files record capture decisions. Final `SHA256SUMS` uses relative evidence paths only, includes this report copied into the evidence root, and excludes itself. Every final entry is verified with `shasum -a 256 -c SHA256SUMS` before the evidence directory is sealed read-only.
