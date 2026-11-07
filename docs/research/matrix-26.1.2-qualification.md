# Minecraft 26.1.2 target qualification

Date: 2026-11-08. The resumed run executed on 2026-11-07 UTC.

Evidence root: `~/.local/share/voxellume/evidence/matrix-26.1.2-r1-20261107T213000Z/`.

## Outcomes

No 26.1.2 pack is `supported`; no pack has an `evidenceManifest`.

| Pack                      | Outcome     | Final `packSha256`                                                 | Observed qualification                                                                                                                                                                                        |
| ------------------------- | ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `java-fabric-26.1.2-r1`   | `candidate` | `c296e643ddd2b4aa7e8bb7e3803ee19ca2326ed73d5604e0f7f44692de3beea0` | Task discovery, clean builds, development and packaged production servers, positive server GameTest, and valid negative control passed. Client GameTest crashed during shutdown; visual matrix incomplete.    |
| `java-neoforge-26.1.2-r1` | `candidate` | `900c23ce1fbbe3bf5863959ea53cef1196fc04dec11f6805d52f8b3799c15940` | Binary-patch task discovery and clean builds, development and packaged production servers, two positive GameTests, valid negative control, and real-client rendering passed. Full visual matrix did not pass. |
| `java-forge-26.1.2-r1`    | `rejected`  | `e32cf1987539b4243b42c4c49d3d2b1f474d4107761fac14b9b29bb4ebd19179` | Task discovery, bounded-heap retry, and clean build failed during decompilation with exit 137. No executable verification or template is retained.                                                            |
| `java-quilt-26.1.2-r1`    | `candidate` | `982d6e384197bd68c1c7490df6c7bf6de5f62ca96948c998ccee87e2c623d872` | Task discovery and clean build passed. Development and packaged production servers rejected Java 25 class major 69. No rendered client or visual pass was established.                                        |

`pack-validation.json` and `pack-validation-repair1.status.json` record `loadTargetPacks` validation of all four final packs. Final pack JSON and cleaned templates are copied under `final-packs/`.

## Resumed evidence audit

The cancelled run's exact inputs, templates, logs, container states, and production artifacts were inspected before new execution. Applicable passed checks were reused. Two retained controls were invalid and were not counted:

- `fabric-gametest-negative` was a Java compilation error caused by a mismatched public class/file name, not a deliberate game-test failure.
- The initial NeoForge positive and negative runs discovered only one built-in test. Neither configured mod fixture was present.

The corrected Fabric run passed `mod_loaded` and failed only `deliberate_negative_control` with exit 1. Adding NeoForge `test_instance` resources produced three passing tests in `neoforge-gametest-positive-repair1`; its negative run preserved both mod fixture passes and failed only the deliberate control. Earlier records remain retained alongside the valid repairs.

## Immutable inputs and sandbox

Minecraft `26.1.2` is unobfuscated and uses Java 25, data pack 101.1, and resource pack 84. Release JSON SHA-256 is `ae0a4ad2843d0cb77a673ab6b16ff4d15f7f976fe7513af1d6a86545194cae73`. Every loader uses `mappings.kind=none`; no Yarn, Intermediary, Quilt Mappings, or Mojang mapping substitute was introduced.

All executions used Linux/arm64, JDK 25, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, bounded tmpfs, isolated per-loader Gradle homes, argument-array supervisor spawning, and a 16 MiB output cap. Build and runtime limits were 900 and 600 seconds. One Gradle process ran per project. `commands.log`, `*.status.json`, and `*-container-state.json` retain argv, timestamps, exit codes, and container inspections. Existing EULA and official-network approvals were reused. `environment.json` records limits and image identity; `input-artifact-hashes.txt` records exact input hashes.

Templates contain no `.gradle`, `build`, `run`, logs, crash reports, or world data. Temporary work and production-server directories were removed. `cleanup.json` confirms no owned containers or volumes survive.

## Fabric r1

Exact inputs are Loader `0.20.1`, Fabric API `0.155.3+26.1.2`, Gradle `9.8.2`, Loom `1.20.0-alpha.19`, and template `FabricMC/fabric-example-mod@10ea2384a5664a9b6c82d17e0fdb2773bbf6f1ba`. The wrapper distribution SHA-256 is `21bd5da2de49b642904077f38c0efdc7778e92b3ed0889392dca61b97e389607`; wrapper JAR SHA-256 is `3b8a25775a69158b5ad2b1d17a80a88dc7b40a352a73eb27d06c612a7ce68e98`.

`fabric-tasks.log`, `fabric-clean-build.log`, and final `fabric-production-clean-build.log` pass. The clean build runs two server GameTests, logs `VOXELLUME_TEST_PASSED=mod_loaded`, and reports all required tests passing. `fabric-gametest-negative-repair1.log` preserves that pass and reports only the deliberate failure with exit 1. `fabric-server.log` and `fabric-production-server.log` reach `Done`; the latter loads `modid 1.0.0` from the production JAR.

Production JAR: `artifacts/fabric/modid-1.0.0.jar`, SHA-256 `992fafec495c2cc99ed43dcaf03b69b1e2d45b16fe331dddce5392e652c0299b`. `fabric-production-jar-contents-final.txt` contains no GameTest classes or resources.

`fabric-client-gametest-xvfb.log` records `VOXELLUME_CLIENT_TEST_PASSED=singleplayer_world`, then a JVM exit 134 in `libopenal.so` during shutdown. The assertion marker does not override the failed process result. `artifacts/visual/fabric/main-menu.png` is a reviewed real-client accessibility-onboarding capture. No settled main-menu, world, inventory, hand, placed-block, animation, persistence, multiplayer, clipping, or z-fighting matrix was established. `client:false` and `visual:false` are intentional.

## NeoForge r1

Exact inputs are NeoForge `26.1.2.126`, MDG `2.0.148`, Gradle `9.2.1`, and template `NeoForgeMDKs/MDK-26.1.2-ModDevGradle@b7040ef34422615a879cfb015feeeb04a6284ddb`. The wrapper distribution SHA-256 is `72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f`; wrapper JAR SHA-256 is `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172`.

The reviewed template enables the official binary-patch pipeline with `neoForge.enable.disableRecompilation=true`. `neoforge-tasks-repair1.log`, `neoforge-clean-build-repair1.log`, and fixture-free `neoforge-production-clean-build.log` pass. `neoforge-server.log` reaches `Done`.

`neoforge-gametest-positive-repair1.log` discovers three tests, including `registry_and_item` and `place_example_block`, and exits 0. `neoforge-gametest-negative-repair1.log` discovers four tests, preserves both positive mod fixture passes, and reports only `examplemod:deliberate_negative_control` with exit 1. Test-only sources and resources were removed before the final production build.

Production JAR: `artifacts/neoforge/examplemod-1.0.0.jar`, SHA-256 `fee2da971eaac018a0d3679a699331ed281c8b2e4282ec00e90c6a4f13c1580d`. Its inventory contains no GameTest classes or resources. `neoforge-production-server.log` installs the exact loader, loads `examplemod-1.0.0.jar`, and reaches `Done`.

The first client attempt failed on linux/x64 natives under Linux/aarch64. Exact LWJGL `3.4.1` `natives-linux-arm64` artifacts, hashed in `lwjgl-arm64-hashes.txt`, were then selected read-only with `JAVA_TOOL_OPTIONS=-Dorg.lwjgl.librarypath=/natives`; no template dependency changed. `neoforge-client-final.log` records Example Mod 1.0.0, `Setting user: Dev`, and LWJGL `3.4.1+2` without a mod-loading error.

Reviewed captures show the accessibility-onboarding screen and a post-Continue logo/panorama transition. They do not establish settled menu controls or a full visual matrix. The client was deliberately stopped after capture. Packaged-JAR client behavior and inventory, hand, world, placed-block, animation, persistence, multiplayer, clipping, and z-fighting scenarios were not established. `client:true` and `visual:false` are intentional.

## Forge r1

Exact inputs are Forge `64.1.5`, ForgeGradle `7.0.40`, Gradle `9.5.0`, and the official `26.1.2-20260409.101008` MCP config. The MDK's range was pinned to exact ForgeGradle `7.0.40`.

`forge-tasks-repair1.log` and `forge-clean-build.log` fail during Minecraft Mavenizer decompilation with MCP step exit 137 in the required 4 GiB container. The initial wrapper task attempt also failed before task discovery. No tasks were listed and no production JAR was produced. Server, GameTest, client, production-JAR runtime, and visual checks were not run because the build prerequisite failed.

The pack is `rejected` with `verification_failed`. `reason.evidence[]` links the exact official MCP config ZIP, SHA-256 `21902894dd58b99a694fc83bc876ca6cbba75e5bd3910cb371def9c39b86e4a4`. Its template directory, template metadata, and executable verification commands are removed.

## Quilt r1

Exact inputs are Loader `0.20.0-beta.9`, Quilt Loom `1.15.1`, generic template `9a6f89cd481e3f58f128596b5b043353bee6b3f2`, and Gradle `9.8.2`. The Quilt profile has exact `inheritsFrom: 26.1.2` and response SHA-256 `c8226abe588eb64361bc7688284d26875b8ecf936fc0d9063765a8704756b056`. No QSL/QFAPI dependency or mapping is declared. Wrapper JAR SHA-256 is `cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8`.

`quilt-r2-tasks-repair1.log` and `quilt-r2-clean-build.log` pass. Production JAR: `artifacts/quilt/example_mod-1.0.0+26.1.2.jar`, SHA-256 `8b95ca118b1c3250c7bae1669f998bf62c9ca92f7f4f10929f41849a7367e14f`. No GameTest is configured by this loader-only pack.

`quilt-r2-server.log` and `quilt-production-server.log` both fail before mod loading with `Unsupported class file major version 69` in Quilt Loader's ASM entrypoint patch. The production run used the exact installer and production JAR. No newer loader or ASM substitution was made.

Three bounded client attempts remained in wrapper or asset download before deliberate cleanup. Their 1280x720 captures were reviewed and rejected as uniformly black; no `Setting user` assertion or rendered game surface was observed. `client:false` and `visual:false` are intentional.

## Integrity

The final report is copied into the evidence root as `matrix-26.1.2-qualification.md`. `result.json` summarizes all four outcomes and has `evidenceManifest:null`. `artifact-inventory.json` and `production-jars.sha256` record final production JAR identities.

`SHA256SUMS` uses relative evidence paths only, includes the final report and final pack copies, and excludes itself. Every entry was verified with `shasum -a 256 -c SHA256SUMS` before the evidence directory was sealed read-only.
