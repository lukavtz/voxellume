# Minecraft 1.21 target-matrix qualification

Date: 2026-11-07.

## Final outcomes

No 1.21 loader is `supported`. Isolated `loadTargetPacks` validation accepted all four final documents and recomputed pack hashes.

| Loader   | Final pack              | Status      | build | server | client | GameTest | visual | Final `packSha256`                                                 |
| -------- | ----------------------- | ----------- | ----- | ------ | ------ | -------- | ------ | ------------------------------------------------------------------ |
| Fabric   | `java-fabric-1.21-r2`   | `candidate` | yes   | yes    | no     | yes      | no     | `d3d8bfeb682593391747a8741176625eaac7a50316c10880d3d33cf23f7bb4fb` |
| NeoForge | `java-neoforge-1.21-r1` | `candidate` | yes   | no     | no     | no       | no     | `7604ecb9928f7a2fba4bb0d2790aff69672309639ce5f868299558b75fca1581` |
| Forge    | `java-forge-1.21-r1`    | `rejected`  | no    | no     | no     | no       | no     | `9d917c136abe42652fc54a6855a1afac939e64ca694432682e46025c9f12fff5` |
| Quilt    | `java-quilt-1.21-r2`    | `rejected`  | no    | no     | no     | no       | no     | `5121200f4eda92f12dc1ad46346fbcf4e62cb6c924ac859adc956135b06cd2b4` |

Candidate packs retain only observed capabilities and have no `evidenceManifest`. Rejected packs have no template or executable verification commands. No `supported` claim is made.

## Common execution boundary

Gradle checks used `gradle@sha256:85f8f572045bfb31874d66d7d8a2bd0c17d8cb9ad34b6a4d02f5d552b4b92c04`, Linux/arm64, Temurin 21.0.13+9-LTS, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, bounded executable `/tmp`, isolated `HOME`/`GRADLE_USER_HOME`, no Docker socket, and no repository credentials. Client attempts used `voxellume/xvfb-jdk21@sha256:97b64a12b0cffdf728d3376d79ca1437747b81ef0977cf564287cb7ff20c6fdd` with Xvfb and Mesa llvmpipe. Exact Docker argv, logs, status records, container inspections where available, and cleanup commands are in each bundle's `commands.log` and per-check files.

The configured check timeouts were 900 seconds for builds and 600 seconds for runtime. Several outer tool supervisors terminated their runner after 300 seconds. Those incomplete checks are explicitly recorded as `timed_out` or unavailable, never as passes. Existing EULA approval `https://www.minecraft.net/en-us/eula` at `2026-11-06T23:59:20.194Z` was reused; no approval was added.

Combined validation evidence: `~/.local/share/voxellume/evidence/matrix-1.21-qualification-20261107/`. Its `pack-validation.log` records the four validated IDs, statuses, hashes, and capabilities.

## Fabric: r1 rejected, r2 candidate

R1 evidence: `~/.local/share/voxellume/evidence/fabric-1.21-r1-20261107T183000Z/`.

Exact Loom `1.20.0-alpha.19` required JVM 25, incompatible with the required JDK 21. Task discovery and clean build failed during plugin variant resolution. R1 produced no JAR or runtime evidence.

R2 evidence: `~/.local/share/voxellume/evidence/fabric-1.21-r2-20261107T174410Z/`.

R2 advances the revision and changes only the Loom pin to stable `1.17.21`; Minecraft 1.21, Loader 0.20.1, Fabric API 0.102.0+1.21, Mojang mappings, JDK 21, and Gradle 9.8.2 remain exact. The wrapper distribution and JAR hashes are enforced.

Passed checks:

- `./gradlew --no-daemon --console=plain --info tasks --all` — exit 0.
- `./gradlew --no-daemon --console=plain --info clean build` — exit 0.
- `./gradlew --no-daemon --console=plain runServer` — Minecraft 1.21 reached `Done (14.045s)!` and stopped cleanly.
- `./gradlew --no-daemon --console=plain runGametest` — `VOXELLUME_TEST_PASSED=mod_loaded`, all 1 required test passed, exit 0.
- Deliberate negative control — `VOXELLUME_NEGATIVE_CONTROL`, 1 required test failed, expected exit 1.
- Fixture-free final clean build — passed; production JAR byte-identical to the initial build.
- Pristine packaged-JAR server — loaded `modid 1.0.0`, logged `Hello Fabric world!`, reached `Done (13.753s)!`, and stopped cleanly.

Production JAR: `artifacts/final-libs/modid-1.0.0.jar`, SHA-256 `9670f6bfc8ac0783fc955d645f758e9126d296f7072aabd27b943b83dc16515e`. Sources JAR SHA-256: `fae2491400390bd4825b0eec472df7a2b09468e05ae72ea503e88903b010a4a3`. The production JAR contains no GameTest fixture entries.

The real client remained at `downloadAssets`. Two reviewed 1280x720 captures were uniformly black, both SHA-256 `805aa3bd21f857ad6b442103286d1df7ec5f5f746fa98936eaccc7306d6c98b0`. No main-menu, world, inventory, hand, GUI-state, or animation pass is claimed. Client and visual remain unavailable.

## NeoForge: candidate

Evidence: `~/.local/share/voxellume/evidence/neoforge-1.21-r1-20261107T180500Z/`.

Exact inputs remain Minecraft 1.21, NeoForge 21.0.167, Parchment 2024.11.10, MDG 2.0.148, JDK 21, and Gradle 9.2.1. The pinned MDK is `NeoForgeMDKs/MDK-1.21-ModDevGradle@1a8837b6ce8d795bac88e7720ef6ddf1af35259f`. The template enables the official binary patch pipeline through `neoForge.enable.disableRecompilation=true`; the wrapper hash is enforced.

Passed checks:

- Task discovery — exit 0; `runClient`, `runServer`, and `runGameTestServer` discovered; `Creating Minecraft artifacts without recompilation.` observed.
- Clean build — exit 0, `BUILD SUCCESSFUL in 3m 13s`.
- Production installation — exact NeoForge installer completed successfully after an initial network-timeout failure was retained.
- Pristine packaged-JAR server — discovered `examplemod-1.0.0.jar`, reached `Done (12.110s)!`, logged `HELLO from server starting`, and stopped.

Production JAR: `artifacts/libs/examplemod-1.0.0.jar`, SHA-256 `5207283f2df93ba4c5c98f43f07488cf47b1bea23051804025453dff55fa4eee`.

Two development-server attempts and the positive GameTest attempt exceeded the outer 300-second runner during asset/download initialization. The negative control was therefore unavailable. A bounded 60-second real-client attempt remained in Gradle configuration; its reviewed capture was black with SHA-256 `805aa3bd21f857ad6b442103286d1df7ec5f5f746fa98936eaccc7306d6c98b0`. Development server, GameTest, client, and visual capabilities remain false. The pristine packaged-JAR server pass does not get misreported as the missing development-server capability.

## Forge: rejected

Evidence: `~/.local/share/voxellume/evidence/forge-1.21-r1-20261107T181800Z/`.

The exact MDK ZIP SHA-256 is `868c90c6badd7ca8c910e72989faf2c1144ee589bf304c935a9882d76ab2706c`; installer SHA-256 is `e59cbc05af015b2e6c083703a60f931b88e931f14cc9c97c401d4f72fc14e1ec`; ForgeGradle 6.0.54 JAR SHA-256 is `1d54a97a225ed5180300e8070a1c818597d98ec45a11fedecb425254b7982da2`.

Task discovery passed with Gradle 8.7 and the exact ForgeGradle pin. Clean build remained in dependency download when the outer 300-second runner ended. No production JAR was observed. Server, GameTest, client, packaged-JAR runtime, and visual checks were unavailable. The pack is rejected with `verification_failed`; no executable verification remains.

## Quilt: r1 and r2 rejected

R1 evidence: `~/.local/share/voxellume/evidence/quilt-1.21-r1-20261107T182500Z/`.

R1 used exact Loader 0.20.0-beta.9, QFAPI 11.0.0-alpha.3+0.102.0-1.21, QSL 10.0.0-alpha.1+1.21, Quilt Mappings 1.21+build.19, Loom 1.15.1, and Gradle 8.9. Task discovery and clean build failed because Loom declares Gradle plugin API 9.2.0. No production JAR exists.

R2 evidence: `~/.local/share/voxellume/evidence/quilt-1.21-r2-20261107T183000Z/`.

R2 advances the revision and makes only the exact toolchain repair: Gradle 9.2.0 and `org.quiltmc.loom.remap:1.15.1`. Loader, APIs, mappings, Minecraft, and JDK remain unchanged. Task discovery then failed when Quilt Maven returned HTTP 500 for the exact QFAPI `fabric-crash-report-info-v1` module. Clean build exceeded the outer 300-second runner without a production JAR. All runtime and visual checks are unavailable. R2 is finally rejected with `verification_failed`; no template or executable verification is retained.

## Evidence integrity

Each bundle contains its result manifest, exact commands, retained failures, immutable-input hashes, available production artifacts, visual review where attempted, and cleanup records. `SHA256SUMS` uses bundle-relative paths, excludes itself, and is verified before read-only sealing. This report is copied into each finalized bundle.
