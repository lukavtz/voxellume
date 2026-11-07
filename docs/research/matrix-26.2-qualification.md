# Minecraft 26.2 target qualification

Date: 2026-11-08. The resumed run executed on 2026-11-07 UTC.

Evidence root: `~/.local/share/voxellume/evidence/matrix-26.2-r1-20261107T220000Z/`.

## Outcomes

No 26.2 pack is `supported`; no pack has an `evidenceManifest`.

| Pack                    | Outcome     | Final `packSha256`                                                 | Observed qualification                                                                                                                                                                                                |
| ----------------------- | ----------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `java-fabric-26.2-r1`   | `candidate` | `61f2caec7b068554c76fa513c622133c6708f3571ca05c39c19d94fbba888d9f` | Task discovery, clean build, development and packaged production servers, positive server GameTest, and valid negative control passed. Client GameTest timed out; real-client captures were black.                    |
| `java-neoforge-26.2-r1` | `candidate` | `19135d40878d13e2f1d65fc3e46e82730fcbaa82c8e4121290ea9fe2ec39970d` | Binary-patch task discovery and clean builds, development and packaged production servers, two positive GameTests, and valid negative control passed. Three real-client attempts failed before window initialization. |
| `java-forge-26.2-r1`    | `rejected`  | `c4f3c4d96379973699fa672dc34fc26df3d34acc94b2f2827fb42614a2b815f3` | Task discovery and clean build failed during decompilation with MCP step exit 137. No executable verification or template is retained.                                                                                |
| `java-quilt-26.2-r1`    | `candidate` | `5e36954e0bd569caf6b909acbc64c8aa9cd294b83e16cbac1ca5274ca489d5f6` | Task discovery and repaired clean build passed. Development and packaged production servers rejected Java 25 class major 69. Real-client captures were black.                                                         |

`pack-validation.json` records `loadTargetPacks` validation of all four final packs. Final pack JSON and cleaned templates are copied under `final-packs/`.

## Resumed evidence audit

The cancelled run's exact inputs, templates, logs, container states, and production artifacts were inspected before new execution. `resume.json` identifies reused passed checks and resumed outcomes. The following completed records were reused without rerunning:

- Fabric task discovery, clean build, repaired positive server GameTest, deliberate negative control, and dedicated server.
- NeoForge task discovery.

The truncated Fabric client GameTest, NeoForge clean build, and Forge task discovery had no final status and were not treated as passed. Quilt had no recorded executable checks. The original Fabric positive GameTest failure remains retained; its repaired run corrected the test-mod Minecraft dependency from `~26.1` to exact `26.2` and passed two required tests. The negative run preserved that positive assertion and failed only `VOXELLUME_DELIBERATE_NEGATIVE_CONTROL` with exit 1.

## Immutable inputs and sandbox

Minecraft `26.2` is unobfuscated and uses Java 25, data pack 107.1, and resource pack 88. Release JSON SHA-256 is `894450538aaf0c3f106dd5a45b8756676a5156dc37b91ba41636dfba987cd5d8`. Every loader uses `mappings.kind=none`; no Yarn, Intermediary, Quilt Mappings, or Mojang mapping substitute was introduced.

Executions used Linux/arm64, JDK 25, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, bounded tmpfs, isolated per-loader Gradle homes, argument-array supervisor spawning, and a 16 MiB output cap. Build and runtime supervisor limits were 900 and 600 seconds. One Gradle process ran per project and this worker owned at most one runtime at a time. The Fabric resumed client GameTest additionally reached the harness's 300-second wall clock and was cleaned up; it is recorded as `timed_out`, not passed.

Pinned images were `eclipse-temurin@sha256:83f4a7fc27df94dcc7b8de04d14cbbba8da14406f921e966969c3b09000aa507` and `voxellume/xvfb-jdk25:20261107@sha256:1b717618431ee56dbfc4ec12ecb55bf1344b571f58f565976a653ada47c687cb`. `commands.log`, `*.status.json`, and `*-container-state.json` retain argv, timestamps, exit codes, and container inspections. Existing EULA and official-network approvals were reused. `environment.json` records limits and image identities; `input-artifact-hashes-final.txt` records exact input hashes.

Templates contain no `.gradle`, `build`, `run`, logs, crash reports, or world data. Temporary work and production-server directories were removed. `cleanup.json` confirms no owned containers or volumes survive.

## Fabric r1

Exact inputs are Loader `0.20.1`, Fabric API `0.161.0+26.2`, Gradle `9.8.2`, Loom `1.20.0-alpha.19`, and template `FabricMC/fabric-example-mod@1eb2bde4d23f98a785ab6fd9ed18b3502d035b3f`. The wrapper distribution SHA-256 is `21bd5da2de49b642904077f38c0efdc7778e92b3ed0889392dca61b97e389607`; wrapper JAR SHA-256 is `3b8a25775a69158b5ad2b1d17a80a88dc7b40a352a73eb27d06c612a7ce68e98`.

`fabric-tasks.log` and `fabric-clean-build.log` pass. `fabric-gametest-positive-repair1.log` runs two server GameTests, logs `VOXELLUME_TEST_PASSED=mod_loaded`, and reports all required tests passing. `fabric-gametest-negative.log` preserves that pass and reports only the deliberate failure with expected exit 1. `fabric-server.log` and `fabric-production-server.log` reach `Done`; the latter loads `modid 1.0.0` from the production JAR and exact Fabric API.

Production JAR: `artifacts/fabric/modid-1.0.0.jar`, SHA-256 `af75a56e9945e91a7e4f5e651309bc2051b9fafacf6fbd3e960baff4f3b6c530`. `fabric-production-jar-contents-final.txt` contains no GameTest classes or resources.

The original client GameTest log was truncated at `downloadAssets`. `fabric-client-gametest-resume.status.json` records the resumed 300-second harness timeout and container cleanup. A separate bounded `runClient` capture also stopped at `downloadAssets`, without `Setting user`. Both reviewed 1280x720 screenshots are uniformly black. `fabric-visual-review.json` rejects those captures. No rendered client, inventory, hand, placed-block, animation, persistence, multiplayer, clipping, or z-fighting matrix was established. `client:false` and `visual:false` are intentional.

## NeoForge r1

Exact inputs are NeoForge `26.2.0.93`, MDG `2.0.148`, Gradle `9.2.1`, and template `NeoForgeMDKs/MDK-26.2-ModDevGradle@a0340c5454c01e43ccf83977601a4d90afee6e1f`. The wrapper distribution SHA-256 is `72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f`; wrapper JAR SHA-256 is `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172`.

The reviewed template enables the official binary-patch pipeline with `neoForge.enable.disableRecompilation=true`. `neoforge-tasks.log`, `neoforge-clean-build-repair1.log`, and fixture-free `neoforge-production-clean-build.log` pass. `neoforge-server.log` reaches `Done`.

`neoforge-gametest-positive.log` discovers three tests, including `registry_and_item` and `place_example_block`, and exits 0. `neoforge-gametest-negative.log` discovers four tests, preserves both mod fixture passes, and reports only `examplemod:deliberate_negative_control` with expected exit 1. Test-only sources and resources were removed before the final production build.

Production JAR: `artifacts/neoforge/examplemod-1.0.0.jar`, SHA-256 `4169adb9afb6eeba35965556a02c1db2b958e38de53fe654bbb350025cff5cd2`. Its inventory contains no GameTest classes or resources. `neoforge-production-server.log` installs exact NeoForge `26.2.0.93`, loads `examplemod-1.0.0.jar`, and reaches `Done`.

Three bounded real-client attempts failed before window initialization. The first reported an `org.lwjgl.shaderc` linux/x64 mismatch on Linux/aarch64. Exact LWJGL `3.4.1` Shaderc ARM64 native SHA-256 `048ae4967cc193f839dfa16c1643eab77efb2ee729e92f00b87fc479614b862c` was supplied read-only; the second attempt advanced to `org.lwjgl.spvc`. Exact SPVC ARM64 native SHA-256 `69813164485665d9dc2fe9e97beb549106aad23cc860ae1862258c04addda102` was supplied; the third attempt advanced to `org.lwjgl.vma` and exited 134. No fourth repair or substitution was made. No screenshot or `Setting user` assertion was produced. `neoforge-visual-review.json` records the failed sequence. `client:false` and `visual:false` are intentional.

## Forge r1

Exact inputs are Forge `65.1.5`, ForgeGradle `7.0.40`, Gradle `9.5.0`, and official MCP config `26.2-20260616.103818`. The MDK's range was pinned to exact ForgeGradle `7.0.40`. Wrapper JAR SHA-256 is `497c8c2a7e5031f6aa847f88104aa80a93532ec32ee17bdb8d1d2f67a194a9c7`.

`forge-tasks-resume.log` and `forge-clean-build.log` fail during Minecraft Mavenizer decompilation with MCP step exit 137 in the required 4 GiB container. The earlier truncated task log was not counted. No tasks were listed and no production JAR was produced. Server, GameTest, client, production-JAR runtime, and visual checks were not run because the build prerequisite failed.

The pack is `rejected` with `verification_failed`. `reason.evidence[]` links the exact official MCP config ZIP, SHA-256 `135042b4b1926927ce96ddf9c4abf09740b212c971426dea7345e8e2c41df632`. Its template metadata and executable verification commands are removed; no template directory is retained.

## Quilt r1

Exact inputs are Loader `0.20.0-beta.9`, Quilt Loom `1.15.1`, generic template `9a6f89cd481e3f58f128596b5b043353bee6b3f2`, and Gradle `9.8.2`. The Quilt profile has exact `inheritsFrom: 26.2` and response SHA-256 `6490e78a1190c59f3ffedc5f8008b16c9ae04c32b7403a054ad1e74d377c2002`. No QSL/QFAPI dependency or mapping is declared. Wrapper JAR SHA-256 is `cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8`.

`quilt-tasks.log` passes and exposes `runClient` and `runServer`; no GameTest is configured. The first clean build failed on the generic template's obsolete Yarn `TitleScreenMixin`. Removing that unused mixin and its unreferenced config produced `quilt-clean-build-repair1.log` with exit 0. Production JAR: `artifacts/quilt/example_mod-1.0.0+26.2.jar`, SHA-256 `f01ba25c554d0ec7d003fc9db8ebe1f9fd0f40480ca352127a90e9f541c51212`.

`quilt-server.log` and `quilt-production-server.log` both fail before mod loading with `Unsupported class file major version 69` in Quilt Loader's ASM entrypoint patch. The production run used exact installer `0.15.1`, exact Loader `0.20.0-beta.9`, and the production JAR. No newer loader or ASM substitution was made.

The bounded real-client attempt stopped at `downloadAssets` without `Setting user`. Both reviewed 1280x720 captures are uniformly black and rejected by `quilt-visual-review.json`. No rendered game surface or full visual matrix was established. `server:false`, `client:false`, `gameTest:false`, and `visual:false` are intentional.

## Integrity

The final report is copied into the evidence root as `matrix-26.2-qualification.md`. `result.json` summarizes all four outcomes and has `evidenceManifest:null`. `artifact-inventory.json`, `production-jars.sha256`, and `production-jars-verification.log` record final production JAR identities and verification.

`SHA256SUMS` uses relative evidence paths only, includes the final report and final pack copies, and excludes itself. Every entry was verified with `shasum -a 256 -c SHA256SUMS` before the evidence directory was sealed read-only.
