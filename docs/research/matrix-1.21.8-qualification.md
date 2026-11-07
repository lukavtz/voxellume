# Minecraft 1.21.8 target qualification

Date: 2026-11-07.

Evidence root: `~/.local/share/voxellume/evidence/matrix-1.21.8-r1-20261107T193000Z/`.

## Outcomes

No 1.21.8 pack is `supported`.

| Pack                      | Outcome     | Final `packSha256`                                                 | Observed qualification                                                                                                                                                                                              |
| ------------------------- | ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `java-fabric-1.21.8-r2`   | `candidate` | `14ab602fac7c3b2ecf6f55521795f07a9df533fe3aef987c19863ff732d069fd` | R2 task discovery, clean builds, development and packaged production servers, positive GameTests, and negative control passed. Client and visual checks did not pass.                                               |
| `java-neoforge-1.21.8-r1` | `candidate` | `e051c1f0ea6ad198cdb33d6e21a81502fa98a2b1c3e74c597ce53814b55fd881` | Task discovery, clean binary-patch builds, development and packaged production servers, positive GameTests, negative control, and real-client accessibility/menu rendering passed. Full visual matrix did not pass. |
| `java-forge-1.21.8-r1`    | `rejected`  | `19d18bb6554d584ad478bc993f5c95094ad1e92e106ad6c745da61027d07aa05` | Task discovery and clean build failed during decompilation with Vineflower exit 137. No runtime or visual claim.                                                                                                    |
| `java-quilt-1.21.8-r2`    | `candidate` | `0bafac4a0432fdb4f90b360fd355ee7bedb11e4d028ab6ad9f2eb146941ac8d5` | R2 task discovery, clean build, and development and packaged production servers passed. Client and visual checks did not pass.                                                                                      |

`pack-validation.json` records successful `loadTargetPacks` validation of all four final targets. No `evidenceManifest` is declared.

## Immutable inputs and sandbox

Minecraft `1.21.8` is obfuscated, uses Java 21, data pack 81, and resource pack 64. Release JSON SHA-256 is `5723a5d3ba121b44ea4e41d91e76494fc86ce83823d5cd89f28187ed99925dfa`. Client mappings SHA-256 is `dce035fedcc047ce0306c69892176b5eb9036bcc2845c87198163f12bb1d67ca`; server mappings SHA-256 is `e373ba569839e6f3c7bd4880247f3e85577d92cde2c605adfa2024eb9cae503e`.

`input-verification.json` records independently fetched and matched release, mappings, loader, API, template, Loom, NeoForge, Parchment, Forge, Quilt mappings, and Quilt profile hashes. The Quilt profile has exact `inheritsFrom: 1.21.8` and response SHA-256 `ff6ee388fafc877bcc1d0015c08042619dbc1c3ddd1d669645758aa7c86d2eeb`.

Executions used Linux/arm64, JDK 21 target settings, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, bounded tmpfs, isolated Gradle homes, argument-array process spawning, and a 16 MiB output cap. Exact argv, logs, timestamps, exit codes, and container inspections are in `commands.log`, `*.status.json`, and `*-container-state.json`. Existing EULA and official-network approvals were reused. Build and runtime limits were 900 and 600 seconds; client captures used shorter bounded runs.

## Fabric r2

Exact inputs are Loader `0.20.1`, Fabric API `0.136.1+1.21.8`, official Mojang mappings, Gradle `9.8.2`, Loom `1.17.21`, and template `FabricMC/fabric-example-mod@8d15369809ce85bc717c61073dfb085d10a1d92b`. R1 Loom `1.20.0-alpha.19` task discovery failed because that plugin requires JVM 25 while this target requires JDK 21. R2 changes only the Loom pin. Its reviewed fixture-free template is materialized under `target-packs/java/fabric/1.21.8/templates/`.

`fabric-r2-tasks.log`, `fabric-r2-clean-build.log`, and `fabric-final-clean-build.log` pass. Development and packaged production servers reach `Done` and load `modid`, Loader 0.20.1, Minecraft 1.21.8, and Fabric API 0.136.1+1.21.8. The initial production launch omitted the exact official server JAR; that infrastructure failure is retained and the repaired launch passes.

GameTests use the Loom `fabricApi.configureTests` source set and the target-local non-static `net.fabricmc.fabric.api.gametest.v1.GameTest` API. The explicit custom structure failed to place, so the repaired fixture uses the default test structure. `fabric-r2-gametest-positive-repair2.log` records `VOXELLUME_TEST_PASSED=mod_loaded` and all required tests passing. The negative run preserves the positive pass and reports only the deliberate failure. Test sources and configuration were removed before the final clean build.

Production JAR: `artifacts/fabric/modid-1.0.0.jar`, SHA-256 `09cb8fa80e8676e5bf3c2a38c4cc71687323436e83986c8513ce55208017e484`.

The real client remained at `downloadAssets`. `artifacts/visual/fabric/main-menu.png` was reviewed and rejected as uniformly black. `client:false` and `visual:false` are intentional.

## NeoForge r1

Exact inputs are NeoForge `21.8.57`, Parchment `1.21.8` / `2025.09.14`, MDG `2.0.148`, Gradle `9.2.1`, and template `NeoForgeMDKs/MDK-1.21.8-ModDevGradle@696ada8840acf26b548bc2fd9f7c9f7a2424ba90`. The template uses MDG's official `disableRecompilation` binary patch pipeline. `neoforge-tasks.log`, `neoforge-clean-build.log`, and `neoforge-final-clean-build.log` pass without decompilation.

Development and packaged production servers reach `Done` with Example Mod and NeoForge 21.8.57. The data-driven fixture registers `Consumer<GameTestHelper>` functions through `BuiltInRegistries.TEST_FUNCTION` and uses `test_instance` JSON plus the target-local singular `structure` directory. `neoforge-gametest-positive-repair1.log` passes `registry_and_item` and `place_example_block`. The negative run preserves both positive passes and reports `deliberate_negative_control` as the only failure. Test classes, registration calls, and data were removed before the final clean build.

Production JAR: `artifacts/neoforge/examplemod-1.0.0.jar`, SHA-256 `313c16c6f2806d6d1bbf11d9178c02f3b9abadf5f68c6fa09144c7fdd7c98102`.

Reviewed 1280x720 captures show accessibility onboarding and the real Minecraft menu. They do not qualify the packaged-JAR client, world, inventory, hand, placed-block, animation, persistence, multiplayer, clipping, or z-fighting scenarios. `visual:false` and candidate status are intentional.

## Forge r1 rejection

The official MDK `1.21.8-58.1.26` was pinned from ForgeGradle `[7.0.3,8)` to exact `7.0.40`. Both `forge-tasks.log` and `forge-clean-build.log` fail in MCP config `1.21.8-20250717.105350` decompilation. Vineflower 1.11.1 exits 137. Official `mcp_config-1.21.8-20250717.105350.zip` SHA-256 is `581d55d439b9b8835a6bd8798816933dcdec3071a898578abfd62e23eaf99661`; its decompile function requests `-Xmx4G`, incompatible with the mandatory shared 4 GiB container. ForgeGradle selected its JDK 25 decompiler process from the JDK 21 target build. No production JAR was produced and downstream checks were not run. The rejected pack has no template or executable verification commands.

## Quilt r2

Exact inputs are Loader `0.20.0-beta.9`, Quilt Mappings `1.21.8+build.1:intermediary-v2`, Loom `org.quiltmc.loom.remap:1.15.1`, Gradle `9.2.0`, and generic template `9a6f89cd481e3f58f128596b5b043353bee6b3f2`. No QSL or QFAPI dependency is declared. R1 Gradle 8.9 failed because Loom 1.15.1 declares Gradle plugin API 9.2.0. R2 changes Gradle and the remap plugin identity while preserving Minecraft, Loader, mappings, and template family. The unqualified QFAPI dependency and QSL source entrypoint were removed in favor of Loader's `PreLaunchEntrypoint`.

`quilt-r2-tasks-repair1.log` and `quilt-r2-clean-build.log` pass. Development and packaged production servers reach `Done` with Minecraft 1.21.8, Loader 0.20.0-beta.9, and `example_mod`.

Production JAR: `artifacts/quilt/example_mod-1.0.0+1.21.8.jar`, SHA-256 `9a73a04217c0bfe87966c6715b0f53fb3d1bd429763f015a6c85442b355d8fc0`.

The real client remained at `downloadAssets`. `artifacts/visual/quilt/main-menu.png` was reviewed and rejected as uniformly black. `client:false` and `visual:false` are intentional.

## Integrity

`*-visual-review.json` records capture decisions. `cleanup.json` records owned container/volume cleanup. Final `SHA256SUMS` uses relative evidence paths only, includes this report copied into the evidence root, and excludes the manifest itself. Every final entry is verified with `shasum -a 256 -c SHA256SUMS` before the evidence directory is sealed read-only.
