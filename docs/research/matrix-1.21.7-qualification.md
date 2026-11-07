# Minecraft Java 1.21.7 target qualification

Date: 2026-11-07.

Evidence root: `~/.local/share/voxellume/evidence/matrix-1.21.7-r1-20261107T184401Z/`.

## Outcomes

No 1.21.7 pack is `supported`. Every outcome is explicit and no pack declares an `evidenceManifest`.

| Pack                      | Outcome     | Final `packSha256`                                                 | Observed qualification                                                                                                                                                                              |
| ------------------------- | ----------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `java-fabric-1.21.7-r2`   | `candidate` | `d082f852c8c97bf57f4f674e7f11c0e4120b0e00c294efed70bf038fcc2db43b` | Tasks, clean builds, dedicated and packaged production servers, positive GameTests, and negative control passed. Client and visual checks did not pass.                                             |
| `java-neoforge-1.21.7-r1` | `candidate` | `b6023aa0e697d7071174fc267b5e0059b81e4097a12a39e434b1e39eb9f8a373` | Tasks, binary-patch clean builds, dedicated and packaged production servers, two positive GameTests, negative control, and real-client main-menu rendering passed. Full visual matrix did not pass. |
| `java-forge-1.21.7-r1`    | `candidate` | `12005f5cc4bf77b3b5e2084db31e0854dd6f23a5e7a86835501728c26b19cbfd` | Tasks, clean builds, dedicated and packaged production servers, two positive GameTests, negative control, and real-client main-menu rendering passed. Full visual matrix did not pass.              |
| `java-quilt-1.21.7-r2`    | `candidate` | `c98b8c9452f6c7b89fbf58b324d46164b02be8d2dff3db48a39b3f1faed68f95` | R2 tasks, clean build, dedicated server, and packaged production server passed. Client and visual checks did not pass. GameTest is not required.                                                    |

`pack-validation.json` records the final four-pack validation result. Exact argv, exit records, logs, input hashes, artifact inventories, screenshots, reviews, and cleanup records are inside the evidence bundle.

## Immutable inputs and sandbox

Minecraft `1.21.7` is obfuscated and uses JDK 21, data pack 81, and resource pack 64. The official release JSON SHA-256 is `cd75ad0ef961f490aa967d61ffb2117d9c84bbf302e6e01e9adaa66b6ee57442`. Client mappings SHA-256 is `328f2c5849c7c5fc4f2b1eae4f74a7cfe6bb337c7938242ac5c4f9eac89b1e50`; server mappings SHA-256 is `e373ba569839e6f3c7bd4880247f3e85577d92cde2c605adfa2024eb9cae503e`.

Executions used Linux/arm64, JDK 21, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, read-only root filesystems, bounded tmpfs, isolated Gradle homes, argument-array spawning, and a 16 MiB output cap. The build limit was 15 minutes and runtime limit 10 minutes. Existing EULA and official-network approvals were reused. `environment.json`, `commands.log`, status files, and container inspections record the environment and commands.

Downloaded loader, API, mappings, template, installer, and plugin inputs were hashed independently. `downloads.json`, `*-input-hashes.txt`, and `*-template-hashes.txt` preserve those identities.

## Fabric r2

Exact inputs are Loader `0.20.1`, Fabric API `0.129.0+1.21.7`, Mojang mappings, Gradle `9.8.2`, Loom `1.17.21`, and template `FabricMC/fabric-example-mod@467c6b43040fa423f915d4e18ef8f97abd1a7176`.

R1 pinned Loom `1.20.0-alpha.19`; `fabric-r1-tasks.log` proves its JVM 25 requirement under the required JDK 21. R2 changes only the Loom pin to `1.17.21` and records the wrapper JAR hash. `fabric-superseded-r1.json` preserves the superseded identity and failure.

R2 task discovery and fixture-free clean builds pass. `fabric-r2-server.log` and `fabric-production-server.log` reach `Done`. The production instance loads the packaged mod and Fabric API.

The initial GameTest used retired vanilla annotations and string exceptions. The repaired fixture uses Fabric's 1.21.7 `net.fabricmc.fabric.api.gametest.v1.GameTest` and component exceptions. `fabric-r2-gametest-positive-repair1.log` passes with `VOXELLUME_TEST_PASSED=mod_loaded`; `fabric-r2-gametest-negative.log` preserves that pass and reports only the deliberate failure. GameTest sources and resources were removed before the final production build.

The real client remained in `downloadAssets` until timeout. `artifacts/visual/fabric/main-menu.png` is a reviewed 1280x720 uniformly black capture and is rejected. `client:false` and `visual:false` are intentional.

Production JAR: `artifacts/fabric/modid-1.0.0.jar`, SHA-256 `74a9e567796cb619a53de2cba4245aa1f3a5bc6b794badc62d1d4f4a75ba8125`.

## NeoForge r1

Exact inputs are NeoForge `21.7.25-beta`, Parchment `1.21.7` / `2025.07.18`, MDG `2.0.148`, Gradle `9.2.1`, and template `NeoForgeMDKs/MDK-1.21.7-ModDevGradle@4f0fd256b81993acdd17b28581682f3e66eaa088`.

The reviewed template enables MDG's official `disableRecompilation` binary patch pipeline. `neoforge-clean-build-repair1.log` passes after the first outer supervisor interruption; the final fixture-free `neoforge-production-clean-build.log` also passes. Development and packaged production servers reach `Done`. The production server loads Example Mod from the packaged JAR.

The GameTest fixture uses registered `Consumer<GameTestHelper>` functions and `test_instance` JSON. One repair changes the assertion message to the 1.21.7 `Component` API. `neoforge-gametest-positive-repair1.log` passes `registry_and_item` and `place_example_block`. The negative run exits nonzero with the deliberate assertion failure. Fixtures were removed before final packaging.

Real 1280x720 captures show accessibility onboarding and the Minecraft 1.21.7 main menu labeled NeoForge `21.7.25-beta` with three mods. No world, inventory, hand, placed-block, animation, persistence, multiplayer, clipping, or z-fighting scenario was captured. `visual:false` and candidate status are intentional.

Production JAR: `artifacts/neoforge/examplemod-1.0.0.jar`, SHA-256 `698946a7598afab3a709d1afa2020066fdbb3564396f9a1bb7023ba25b44cf2d`.

## Forge r1

Exact inputs are Forge `57.0.3`, Mojang mappings, ForgeGradle `6.0.54`, Gradle `8.12.1`, and the official `1.21.7-57.0.3` MDK. The MDK's floating plugin range is pinned exactly. Its 5 GiB Gradle/decompiler settings are bounded to 1 GiB/2 GiB for the mandatory container.

Task discovery and clean builds pass. `forge-server.log` and `forge-production-server.log` reach `Done`; the packaged server executes Example Mod common setup.

The GameTest fixture uses `Registries.TEST_FUNCTION`, registered consumers, and `test_instance` JSON after the initial registry-type compile failure. `forge-gametest-positive-repair1.log` passes `registry_and_item` and `place_example_block`. `forge-gametest-negative.log` exits nonzero with the deliberate assertion failure. Fixtures were removed before final packaging.

Real 1280x720 captures show accessibility onboarding and the Minecraft 1.21.7 main menu labeled Forge Beta `57.0.3` with three mods loaded. The client was stopped after review; no graceful-shutdown claim is made. The full visual matrix was not run, so `visual:false` remains.

Production JAR: `artifacts/forge/examplemod-1.0.0.jar`, SHA-256 `261e20c3089de534350a8d50720b73dd3ca4f78a2fb37c79ddcc9041c721a809`.

## Quilt r2

Exact inputs are Loader `0.20.0-beta.9`, Quilt Mappings `1.21.7+build.7:intermediary-v2`, Loom `1.15.1`, Gradle `9.2.0`, and generic template `QuiltMC/quilt-template-mod@9a6f89cd481e3f58f128596b5b043353bee6b3f2`. Quilt Meta profile `quilt-loader-0.20.0-beta.9-1.21.7` has exact `inheritsFrom: 1.21.7` and response SHA-256 `28022446f9004d58c1ca3a868b0f3b3aef1a6e7fa8606b30c6aae47d7d2991a2`. No QSL or QFAPI dependency is declared.

R1 Gradle 8.9 failed because Loom 1.15.1 declares Gradle plugin API 9.2.0. R2 changes only Gradle to exact 9.2.0. `quilt-superseded-r1.json` and `quilt-r1-tasks.log` preserve the superseded identity and failure.

R2 task discovery, clean build, development server, and pristine packaged production server pass. The template uses Loader's `PreLaunchEntrypoint`; no GameTest command or capability is inferred.

The real client remained in `downloadAssets`. `artifacts/visual/quilt/main-menu.png` is a reviewed 1280x720 uniformly black capture and is rejected. `client:false` and `visual:false` are intentional.

Production JAR: `artifacts/quilt/example_mod-1.0.0+1.21.7.jar`, SHA-256 `ac5118dff29487271a7e2491f7ed252b22fda1ef74b62672a23ab1314f9c88af`.

## Integrity

The final report is copied into the evidence root as `matrix-1.21.7-qualification.md`. `SHA256SUMS` uses relative evidence paths only, includes that report, and excludes itself. Every entry is verified with `shasum -a 256 -c SHA256SUMS` before the evidence directory is sealed read-only. `cleanup.json` records owned container, volume, and temporary-work cleanup.
