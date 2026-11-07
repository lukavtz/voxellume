# NeoForge 1.21.1 r2 qualification

Date: 2026-11-07.

## Disposition

`java-neoforge-1.21.1-r2` is **`candidate`**, not `supported`. Its final `packSha256` is `16dae75830cc9849f1910920e8bdf9a307b9bd0aa9d74e35c49e616eea7475d8`.

Evidence root: `~/.local/share/voxellume/evidence/neoforge-1.21.1-r2-20261107T153927Z/`.

The official MDG binary patch pipeline passed task discovery, two clean builds, positive GameTests and a deliberate negative control, a development dedicated server, a packaged-JAR production server, and a real development client with reviewed main-menu/mod-list captures. The full packaged-JAR client and world/inventory/hand/animation visual matrix was not run. The llvmpipe captures also retain a magenta/black panorama background. `verification.json` therefore has no `evidenceManifest`, and the support manifest keeps `qualificationEvidence: null`.

## Exact inputs and pipeline

- Minecraft `1.21.1`, NeoForge `21.1.265`, JDK 21, Gradle `9.2.1`, MDG `2.0.148`.
- Parchment Minecraft `1.21.1` / mappings `2024.11.17`; coordinate and artifact identity are unchanged.
- Template `NeoForgeMDKs/MDK-1.21.1-ModDevGradle@e93d7f09d4eec12c76d1d7be9bf4eaad0246e9e0`, `contentSha256=1101d5f9baf5eb4dd31f826e4eef7f7380a01a776ce1af230133e32a95e46e13`.
- `gradle.properties` sets `neoForge.enable.disableRecompilation=true` exactly once. `build.gradle` passes that property to the official `neoForge.enable.disableRecompilation` DSL. Both clean builds logged `Creating Minecraft artifacts without recompilation.`
- This is not a decompile repair or heap override. Decompiled Minecraft sources and Parchment IDE source/Javadoc augmentation are unavailable.
- The wrapper enforces `distributionSha256Sum=72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f`; wrapper JAR SHA-256 remains `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172`.
- Production installer `net.neoforged:neoforge:21.1.265:installer` has SHA-256 `a547ccc30a80a675d1c61d04b55d10c45c39a86971e09731482c50a24399d1a2`, matched to the official sidecar.

An initial property-only build was stopped before qualification because the property had not yet been wired into the MDG DSL. It is preserved as `property-only-attempt.*` and is not counted as a build pass.

## Mandatory sandbox

Gradle checks used `gradle@sha256:85f8f572045bfb31874d66d7d8a2bd0c17d8cb9ad34b6a4d02f5d552b4b92c04` on Linux/arm64 with Temurin `21.0.13+9-LTS`.

Every check used 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, and a 512 MiB executable `nosuid,nodev` `/tmp` tmpfs. `HOME` and `GRADLE_USER_HOME` were isolated in `neoforge-r2-home-153927`; no credentials or Docker socket were mounted. Output was capped at 16 MiB per check. Build timeout was 900 seconds and runtime timeout 600 seconds. Cold downloads used the approved official endpoints. The existing EULA approval at `~/.config/voxellume/approvals.json` was read; the approval file itself was not mounted.

Common Docker boundary before the image and check argv:

```sh
docker run --user gradle --cpus 2 --memory 4g --pids-limit 512 \
  --cap-drop ALL --security-opt no-new-privileges --read-only \
  --tmpfs /tmp:rw,exec,nosuid,nodev,size=512m,mode=1777 \
  --network bridge -e HOME=/home/gradle \
  -e GRADLE_USER_HOME=/home/gradle/.gradle -e TMPDIR=/tmp \
  -v neoforge-r2-home-153927:/home/gradle -w /home/gradle/mod \
  gradle@sha256:85f8f572045bfb31874d66d7d8a2bd0c17d8cb9ad34b6a4d02f5d552b4b92c04
```

The visual checks instead used the approved `voxellume/xvfb-jdk21@sha256:97b64a12b0cffdf728d3376d79ca1437747b81ef0977cf564287cb7ff20c6fdd`, user `1000:1000`, `DISPLAY=:99`, `LIBGL_ALWAYS_SOFTWARE=1`, and `Xvfb :99 -screen 0 1280x720x24 -nolisten tcp`.

## Commands and outcomes

| Check                         | Exact game/build argv                                                                                                       | Result                                                                                                               | Evidence                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Task discovery                | `./gradlew --no-daemon tasks`                                                                                               | passed, exit 0                                                                                                       | `tasks.status.json`, `tasks.log`                                   |
| Clean build                   | `./gradlew --no-daemon clean build`                                                                                         | passed, exit 0, `OOMKilled=false`                                                                                    | `clean-build.status.json`, `clean-build.log`                       |
| Positive GameTests            | `./gradlew --no-daemon runGameTestServer`                                                                                   | passed, exit 0; both required tests emitted pass markers                                                             | `gametest-positive.log`, `gametest-results.json`                   |
| Negative control              | `./gradlew --no-daemon runGameTestServer`                                                                                   | expected failure, exit 1; `deliberate_negative_control` discovered and failed                                        | `gametest-negative-control.log`                                    |
| Fixture-free production build | `./gradlew --no-daemon clean build`                                                                                         | passed, exit 0, `OOMKilled=false`                                                                                    | `production-clean-build.status.json`, `production-clean-build.log` |
| Dedicated development server  | `./gradlew --no-daemon runServer`                                                                                           | `Done` and Example Mod observed; expected cleanup exit 143                                                           | `server.status.json`, `server.log`                                 |
| Packaged production server    | `java -jar /input/neoforge-21.1.265-installer.jar --installServer /home/gradle/production-server`, then `sh ./run.sh nogui` | packaged JAR loaded as Example Mod 1.0.0 and reached `Done`; expected cleanup exit 137                               | `production-server.status.json`, `production-server.log`           |
| Real client                   | `./gradlew --no-daemon runClient`                                                                                           | Example Mod loaded, `Setting user: Dev`, LWJGL `3.3.3+5`, main menu and mod list reviewed; expected cleanup exit 143 | `client-final.status.json`, `client-final.log`                     |

Positive test IDs were `registry_and_item` and `place_example_block`. The positive run reported `All 2 required tests passed :)`. The negative run discovered three tests, preserved both positive passes, and reported `1 required tests failed :( - deliberate_negative_control`. Both fixture classes and the structure were removed before the final clean build.

Production JAR: `artifacts/examplemod-1.0.0.jar`, SHA-256 `f5242bbff7f77b48bdf7e898a97efe328a3cc7c563857cce2e29e369db0d9e81`. `production-jar-inspect.log` records expanded mod metadata and the absence of GameTest classes and structures.

## Real client and visual review

Mojang's 1.21.1 `natives-linux` artifacts are x64. The first complete-AWT image attempt failed before window creation with `liblwjgl.so` unavailable for Linux/aarch64. The final client used eight exact LWJGL `3.3.3` `natives-linux-arm64` JARs from Maven Central, hashed in `inputs/lwjgl-arm64/provenance.json`, extracted only into the isolated qualification home, and selected with:

```sh
JAVA_TOOL_OPTIONS=-Dorg.lwjgl.librarypath=/home/gradle/lwjgl-arm64
```

No template or production-JAR dependency changed. Earlier runtime-library and native-architecture failures are retained with explicit non-qualification notes.

`visual-review.json` records the human review and PNG hashes:

- `artifacts/visual/client-final-main-menu.png` shows Minecraft `1.21.1`, NeoForge `21.1.265`, three mods, and the main-menu controls.
- `artifacts/visual/client-final-mod-list.png` shows Minecraft, NeoForge, and `Example Mod 1.0.0` in the real mod list.
- Both are genuine 1280x720 Java Robot captures from the Xvfb client. The panorama/background is magenta and black under llvmpipe. Menus and mod metadata are legible, but the defect is not claimed as correct rendering.

These captures do not qualify packaged-JAR client behavior or world, inventory, hand, placed-block, animation, clipping, or z-fighting scenes. Candidate status is intentional.

## Integrity

`result.json` records every final status and the remaining promotion blockers. `SHA256SUMS` covers the evidence bundle, including logs, exact commands, fixtures, native artifacts, production JAR, and reviewed PNGs. The evidence directory and files were finalized read-only after checksum generation. Final pack validation passed through `loadTargetPacks`; the support-manifest ID and pack hash match the candidate pack.
