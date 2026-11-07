# NeoForge 1.21.11 r1 qualification

Date: 2026-11-07.

Evidence root: `~/.local/share/voxellume/evidence/neoforge-1.21.11-r1-20261107T165345Z/`.

## Disposition

`java-neoforge-1.21.11-r1` is **`candidate`**, not `supported`. Its final `packSha256` is `a5073c7baa8360947d83a3ff6fb9cd3e55cdd708adc511c06554e23c8394b4a7`.

The official MDG binary patch pipeline passed task discovery, clean builds, positive GameTests and a deliberate negative control, a development dedicated server, a packaged-JAR production server, and a real development client with reviewed main-menu/mod-list captures. The full packaged-JAR client and world/inventory/hand/animation visual matrix was not run. `verification.json` therefore has no `evidenceManifest`, and support-manifest qualification evidence remains null pending the central manifest update.

## Exact inputs and materialization

- Minecraft `1.21.11`, NeoForge `21.11.48`, JDK 21, Gradle `9.2.1`, MDG `2.0.148`.
- Parchment Minecraft `1.21.11` / mappings `2025.12.20`; coordinate and artifact identity are unchanged.
- Template `NeoForgeMDKs/MDK-1.21.11-ModDevGradle@c3fd175261fd672799dca21ef03387bfdc4eba44`, codeload ZIP `contentSha256=0219f46ba7e864e8e29793e48f0c833ab12e5922e28200ff6974f9c42349010c`. All 17 upstream files were materialized under `templates/`.
- `gradle.properties` sets `neoForge.enable.disableRecompilation=true` exactly once. `build.gradle` passes that property to the official `neoForge.enable.disableRecompilation` DSL. Task discovery and both initial and positive-GameTest compilation logged `Creating Minecraft artifacts without recompilation.`
- This is the binary patch pipeline, not a decompile repair or heap override. Decompiled Minecraft sources and Parchment IDE source/Javadoc augmentation are unavailable.
- The wrapper enforces `distributionSha256Sum=72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f`. Wrapper JAR SHA-256 is `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172`; bytes are identical in the codeload ZIP and raw pinned-revision URL.
- Production installer `net.neoforged:neoforge:21.11.48:installer` has SHA-256 `1f14a4bac4aa885a497550fa5a8374451b7014cec27e1bb69ab16742fb689db0`, matched to the official sidecar.

## Mandatory sandbox

Gradle checks used `gradle@sha256:85f8f572045bfb31874d66d7d8a2bd0c17d8cb9ad34b6a4d02f5d552b4b92c04` on Linux/arm64 with Temurin `21.0.13+9-LTS`.

Checks used 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, and a 512 MiB executable `nosuid,nodev` `/tmp` tmpfs. `HOME` and `GRADLE_USER_HOME` were isolated in `neoforge-12111-home-165345`; no credentials or Docker socket were mounted. Output was capped at 16 MiB per check. Build timeout was 900 seconds and runtime timeout 600 seconds. Cold downloads used the approved official endpoints. The existing EULA approval at `~/.config/voxellume/approvals.json` was read; the approval file itself was not mounted.

The visual checks used `voxellume/xvfb-jdk21@sha256:97b64a12b0cffdf728d3376d79ca1437747b81ef0977cf564287cb7ff20c6fdd`, user `1000:1000`, `DISPLAY=:99`, `LIBGL_ALWAYS_SOFTWARE=1`, and `Xvfb :99 -screen 0 1280x720x24 -nolisten tcp`. `glxinfo-retry.log` proves direct-rendered Mesa llvmpipe OpenGL 4.5 / GLES 3.2.

## Build and GameTests

| Check                        | Exact game/build argv                                                                                                       | Result                                                                                                                     | Evidence                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Task discovery               | `./gradlew --no-daemon tasks`                                                                                               | passed, exit 0; `runClient`, `runServer`, and `runGameTestServer` discovered                                               | `tasks.status.json`, `tasks.log`                                               |
| Clean build                  | `./gradlew --no-daemon clean build`                                                                                         | passed, exit 0, `OOMKilled=false`                                                                                          | `clean-build.status.json`, `clean-build.log`                                   |
| Positive GameTests           | `./gradlew --no-daemon runGameTestServer`                                                                                   | passed after one fixture-only API adaptation, exit 0; both required markers present and runner reported all 3 tests passed | `gametest-positive-repair1.log`, `gametest-results.json`                       |
| Negative control             | `./gradlew --no-daemon runGameTestServer`                                                                                   | expected failure, exit 1; `examplemod:deliberate_negative_control` discovered and failed while both positive checks passed | `gametest-negative-control.log`, `gametest-results.json`                       |
| Final production build       | `./gradlew --no-daemon clean build`                                                                                         | passed, exit 0, `OOMKilled=false`                                                                                          | `production-clean-build-final.status.json`, `production-clean-build-final.log` |
| Production JAR inspection    | `jar tf` / `unzip -p` inside the pinned container                                                                           | expanded NeoForge/Minecraft metadata; no GameTest classes, structures, or test-instance paths                              | `production-artifact.json`, `production-jar-inspect-final.log`                 |
| Dedicated development server | `./gradlew --no-daemon runServer`                                                                                           | `Done` and Example Mod 1.0.0 observed; expected cleanup exit 143                                                           | `server.status.json`, `server.log`                                             |
| Packaged production server   | `java -jar /input/neoforge-21.11.48-installer.jar --installServer /home/gradle/production-server`, then `sh ./run.sh nogui` | packaged JAR loaded as Example Mod 1.0.0 and reached `Done`; expected cleanup exit 143                                     | `production-server.status.json`, `production-server.log`                       |

The first positive run used the 1.21.1 annotation fixtures and failed compilation. Exact 1.21.11 documentation and `javap` showed `Identifier`, registered `Consumer<GameTestHelper>` functions, and datapack `test_instance` JSON instead. One fixture-only vertical repair replaced the retired annotations and `ResourceLocation`; no template or production behavior changed. The passing explicit checks were `registry_and_item` and `place_example_block`, with independent registry and placed-block assertions.

The negative run discovered four tests, preserved both positive pass markers, and reported `1 required tests failed :( - examplemod:deliberate_negative_control`. Fixtures and their empty resource directories were removed before the final clean build. The first packaging inspection caught those empty directories; it is retained as `production-jar-inspect.log` and is not counted as the final artifact pass.

Production JAR: `artifacts/examplemod-1.0.0.jar`, SHA-256 `d4d0de06e9ad766db4e9f0118d7b7789cf49e958c36fe1b07fa5065ad1a790ec`. `production-jar-inspect-final.log` records expanded mod metadata and the absence of GameTest classes, structures, and test-instance paths. The pristine installer loaded this JAR from `mods/examplemod-1.0.0.jar`, not development classes.

## Real client and visual review

Mojang's 1.21.11 `natives-linux` artifacts are x64 and the client uses LWJGL `3.3.3+5`. Eight exact LWJGL `3.3.3` `natives-linux-arm64` JARs from Maven Central, hashed in `inputs/lwjgl-arm64/provenance.json`, were extracted only into the isolated qualification home and selected with `JAVA_TOOL_OPTIONS=-Dorg.lwjgl.librarypath=/home/gradle/lwjgl-arm64`. No template or production-JAR dependency changed.

The first two captures were uniformly black because asset download had not completed. They are explicitly rejected in `visual-initial-captures-rejected.json`. After real initialization and accessibility onboarding, Java Robot navigation produced genuine 1280x720 captures:

- `artifacts/visual/client-final-main-menu.png` shows Minecraft `1.21.11`, NeoForge `21.11.48`, three mods, a rendered panorama, and the main-menu controls.
- `artifacts/visual/client-actual-mod-list.png` shows Minecraft, NeoForge, and `Example Mod 1.0.0` in the real mod list.

`visual-review.json` binds both PNG hashes to these observations. The sandbox has no working narrator flite library or OpenAL audio device, so sound disabled itself and no log-cleanliness claim is made. Captures do not qualify packaged-JAR client behavior or world, inventory, hand, placed-block, animation, persistence, multiplayer, clipping, or z-fighting scenes. Agent review is not represented as trusted-human aesthetic approval. Candidate status is intentional.

## Integrity

`result.json` records every final status and the remaining promotion blockers. `pack-validation.json` proves `loadTargetPacks` accepted the final candidate pack, exact pins, recomputed pack hash, MDG wiring, and wrapper hash enforcement. `SHA256SUMS` covers the evidence bundle, including exact commands, fixtures, native artifacts, production JAR, installer, rejected captures, and reviewed PNGs. The evidence directory and files were finalized read-only after checksum generation.
