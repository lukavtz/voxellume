# Minecraft 26.3 target qualification

Date: 2026-11-08. Execution timestamps are 2026-11-07 UTC.

Evidence root: `~/.local/share/voxellume/evidence/matrix-26.3-r1-20261108Tqualification/`.

## Outcomes

No 26.3 pack is `supported`; no pack has an `evidenceManifest`.

| Pack                    | Outcome     | Final `packSha256`                                                 | Observed qualification                                                                                                                                                                                                                                        |
| ----------------------- | ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `java-fabric-26.3-r1`   | `candidate` | `1836fae799401a5fcfb4896cc80c5e9b765895ffe40e7778445577941d487697` | Task discovery, repaired clean build, development and packaged production servers, positive server GameTests, and valid negative control passed. Three client attempts failed or were stopped; no visual pass.                                                |
| `java-neoforge-26.3-r1` | `candidate` | `cb6e8028774f92e09ecc5e6399189fc2a28e5b96209a955caa7a7ffd379b1a41` | Binary-pipeline task discovery, repaired clean build, test-free production build, development and packaged production servers, two positive GameTests, and valid negative control passed. Three real-client attempts failed; reviewed capture is a GLX error. |
| `java-forge-26.3-r1`    | `rejected`  | `599071c19b3c190f8f25a7d30b75c401e05aca5547714e870ce315669a50259b` | Task discovery and clean build failed during decompilation with MCP exit 137. No executable verification or template is retained.                                                                                                                             |
| `java-quilt-26.3-r1`    | `candidate` | `6f2469932670d61f2ea38d23ec054cca190188e4aa7828b28cb75f5b3abe3cad` | Task discovery and repaired clean build passed. Development and packaged production servers reject Java 25 class major 69. Client asset download stalled and was deliberately stopped.                                                                        |

`result.json`, `final-packs/`, `production-jars.sha256`, command records, logs, reviewed visual outcomes, cleanup records, and this report are included in the evidence root. No result claims a production-JAR/client/GameTest/visual matrix sufficient for `supported`.

## Immutable inputs and sandbox

Minecraft `26.3` is unobfuscated and uses Java 25, data pack 121, and resource pack 97.1. Release JSON SHA-256 is `15c38c58047fd327ed2ad8475c470df54112faa37b7db77c1b1f73ec84474278`. Every loader uses `mappings.kind=none`; no Yarn, Intermediary, Quilt Mappings, Parchment, or Mojang mapping substitute was introduced.

Executions used Linux/arm64, JDK 25, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, bounded tmpfs, isolated per-loader Gradle homes, argument-array supervisor spawning, and a 16 MiB output cap. Build and runtime limits were 900 and 600 seconds. One Gradle process ran per project, with at most two concurrent runtime jobs. Existing EULA and official-network approvals were reused. `environment.json`, `commands.log`, `*.status.json`, and container-state records retain limits, argv, timestamps, exit codes, and cleanup state.

Exact LWJGL `3.4.3` ARM64 artifacts were downloaded for 26.3 client attempts and hashed in `lwjgl-3.4.3-arm64-hashes.txt`. The initial NeoForge attempt correctly rejected stale 3.4.1 natives; no dependency substitution was made.

## Fabric r1

Exact inputs are Loader `0.20.1`, Fabric API `0.165.0+26.3`, Gradle `9.8.2`, Loom `1.20.0-alpha.19`, and template `FabricMC/fabric-example-mod@91f19010a4e764f193fe50acfe2c8ee68f1f15cd`. Wrapper distribution SHA-256 is `21bd5da2de49b642904077f38c0efdc7778e92b3ed0889392dca61b97e389607`; wrapper JAR SHA-256 is `3b8a25775a69158b5ad2b1d17a80a88dc7b40a352a73eb27d06c612a7ce68e98`.

The first build exposed retained 26.2 metadata. `fabric-clean-build-repair1.log` passes after both production and GameTest metadata declare 26.3. It runs two server GameTests and logs `VOXELLUME_TEST_PASSED=mod_loaded`. `fabric-gametest-negative.log` preserves the positive test and fails only `deliberate_negative_control` with expected exit 1.

`fabric-server-repair2.log` reaches `Done`; its exit 143 is the supervisor's deliberate stop after the startup assertion. `fabric-production-server-final.log` installs the exact loader, loads `modid 1.0.0` from the packaged JAR, and reaches `Done` without the earlier missing-properties error.

Production JAR: `artifacts/fabric/modid-1.0.0.jar`, SHA-256 `98ac7943ab8a8b8ec1c8075db6363ad367ba4a774a12798f1c8617429a7cb375`. Its inventory has no GameTest classes or resources.

The first client attempt stopped in `downloadAssets` and hit the supervisor job limit. The second reached renderer creation with stale natives and was stopped; the third used exact 3.4.3 natives but OpenGL GLX and Vulkan surface creation failed. No client assertion or visual capture passed. `client:false`, `visual:false`, and `gameTest:true` are intentional: the latter is established by server GameTests and their negative control.

## NeoForge r1

Exact inputs are NeoForge `26.3.0.101`, MDG `2.0.148`, Gradle `9.2.1`, and template `NeoForgeMDKs/MDK-26.3-ModDevGradle@966d723e9563dd5488e7cb2362373f68c6783119`. Wrapper distribution SHA-256 is `72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f`; wrapper JAR SHA-256 is `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172`.

The exact 26.3 MDK changed `ModConfig.Type.COMMON` to `ModConfig.Type.LOCAL`. `neoforge-clean-build-repair1.log` passes after applying that exact API. `neoforge-gametest-positive.log` discovers three tests, including `registry_and_item` and `place_example_block`, and exits 0. The first negative attempt was compile-only and is not counted. `neoforge-gametest-negative-repair1.log` preserves both positive fixture passes and fails only the deliberate control with expected exit 1.

Test-only sources and resources were removed before `neoforge-production-clean-build.log`. Production JAR: `artifacts/neoforge/examplemod-1.0.0.jar`, SHA-256 `a33c6b0c1ba751a556ea7e320f1b117b982b8f5853673f4dfcc6e351082805b8`. Its inventory contains no GameTest classes or resources.

`neoforge-server.log` reaches `Done`. The first production attempt installed the exact server but lacked the copied EULA fixture. `neoforge-production-server-repair1.log` loads the production JAR and reaches `Done`. Both server runs were deliberately stopped after startup.

Three client attempts failed: stale-native rejection, GLX visual creation failure with exact natives, and SDL initialization failure with a 32-bit Xvfb screen. `artifacts/visual/neoforge/main-menu.png` was reviewed and rejected as an early-display error surface. It is not a Minecraft main menu. `client:false` and `visual:false` are intentional.

## Forge r1

Exact inputs are Forge `66.1.0`, ForgeGradle `7.0.40`, Gradle `9.7.1`, and official MCP config `26.3-20260918.230105`. The MDK range was pinned to exact ForgeGradle `7.0.40`.

`forge-tasks.log` and `forge-clean-build.log` fail during Minecraft Mavenizer decompilation with MCP step exit 137 in the required 4 GiB container. No tasks were listed and no production JAR was produced. Server, GameTest, client, production-JAR runtime, and visual checks were not run because the build prerequisite failed.

The pack is `rejected` with `verification_failed`. `reason.evidence[]` links the official MCP config ZIP, SHA-256 `8679f4eaa95f9779cfe9c4a59998ba2b3be9dce84a42d835a05248dc72c83df6`. Template metadata and executable verification commands are removed.

## Quilt r1

Exact inputs are Loader `0.20.0-beta.9`, Quilt Loom `1.15.1`, generic template `9a6f89cd481e3f58f128596b5b043353bee6b3f2`, and Gradle `9.8.2`. No QSL/QFAPI dependency or mapping is declared. Wrapper JAR SHA-256 is `cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8`.

`quilt-tasks.log` passes. The initial build retained an unused Yarn-era TitleScreen mixin; those stale sources and mixin configuration were removed. `quilt-clean-build-repair1.log` passes. No GameTest is configured by this loader-only pack.

Production JAR: `artifacts/quilt/example_mod-1.0.0+26.3.jar`, SHA-256 `816ffe7e4df842149717596bb300615a1d9c88920b28c8ae7d26c1b0a3a666f6`.

`quilt-server.log` and `quilt-production-server.log` both fail before mod loading with `Unsupported class file major version 69` in Quilt Loader's ASM entrypoint patch. The production run used installer 0.15.1 and the exact production JAR. `quilt-client.log` stalled in `downloadAssets` and was deliberately stopped; no rendered game surface or screenshot passed. `server:false`, `client:false`, and `visual:false` are intentional.

## Integrity and cleanup

Canonical `packSha256` values were recomputed over `canonicalJson(target without packSha256)`. `pack-validation.json` records validation of the four final packs from `final-packs/`. Templates contain no `.gradle`, `build`, `run`, logs, crash reports, or world data. Generated work trees, production worlds, and temporary runtime files were removed after logs, artifacts, and reports were captured externally.

`cleanup.json` confirms no owned containers or volumes survive. `SHA256SUMS` uses relative evidence paths only, includes this report and final pack copies, and excludes itself. Every entry was verified with `shasum -a 256 -c SHA256SUMS` before read-only sealing.
