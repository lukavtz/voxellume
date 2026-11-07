# NeoForge 26.1 r1 qualification

Date: 2026-11-07.

## Disposition

`java-neoforge-26.1-r1` is **`candidate`**, not `supported`. Its final `packSha256` is `f42c9347799b85ea09b6cc4091551d4c269f1b6be9332c6b21a8e461174cc8d9`.

Evidence root: `~/.local/share/voxellume/evidence/neoforge-26.1-r1-20261107T170158Z/`.

The official MDG binary patch pipeline passed task discovery, two clean builds, positive GameTests and a deliberate negative control, a development dedicated server, a packaged-JAR pristine production server, and a real development client with reviewed main-menu/mod-list captures. The full packaged-JAR client and world/inventory/hand/placed-block/animation visual matrix was not run. `verification.json` therefore has no `evidenceManifest`, and candidate status is intentional.

## Exact inputs and pipeline

- Minecraft `26.1`, NeoForge `26.1.0.19-beta`, JDK `25.0.5+8-LTS`, Gradle `9.2.1`, MDG `2.0.148`, no mappings.
- Template `NeoForgeMDKs/MDK-26.1-ModDevGradle@15b9ce62ebd2ea80871cea2ebb1b6551ef972280`, archive `contentSha256=15ae3e3ccf500cc71f62f716e39a3b76441ac299123fc9e9f56d936fdafe04d5`.
- Universal JAR SHA-256 `cd57bc3ce419023996b0ead6869a6f681810fde802d17efbcb26b9b689362ae6`; installer SHA-256 `8fba9309b78ffb14a3791ed64a42b28a4bc924bb38942046949d8b0c7ebd6cc0`, matched to the official sidecar.
- `gradle.properties` sets `neoForge.enable.disableRecompilation=true` exactly once. `build.gradle` passes it to the official `neoForge.enable.disableRecompilation` DSL. Builds logged `Creating Minecraft artifacts without recompilation.` and executed `binaryPatch` plus `applyDevTransforms`.
- This is not a decompile repair or heap override. Decompiled Minecraft sources are unavailable.
- The wrapper enforces `distributionSha256Sum=72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f`; wrapper JAR SHA-256 is `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172`.

The initial wrapper's 10-second network timeout failed before Gradle started; the pinned distribution then downloaded with a 120-second timeout and the required SHA-256. An initial incorrect `enable.disableRecompilation` property access failed during configuration and was corrected to the official `enable { ... }` block. The first clean build was externally stopped at 300 seconds during cold dependency resolution; its warm rerun passed with the full 900-second boundary. These attempts are retained and are not counted as qualification passes.

## Mandatory sandbox

Gradle checks used `eclipse-temurin@sha256:83f4a7fc27df94dcc7b8de04d14cbbba8da14406f921e966969c3b09000aa507` on Linux/arm64 with Temurin `25.0.5+8-LTS`.

Every check used 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, and a 512 MiB executable `nosuid,nodev` `/tmp` tmpfs. `HOME` and `GRADLE_USER_HOME` were isolated in `neoforge-261-r1-home-170158`; no credentials or Docker socket were mounted. Output was capped at 16 MiB per check. Build timeout was 900 seconds and runtime timeout 600 seconds. Cold downloads used the approved official endpoints. The existing EULA approval at `~/.config/voxellume/approvals.json` was read; the approval file itself was not mounted.

Common Docker boundary before the image and check argv:

```sh
docker run --user 0:0 --cpus 2 --memory 4g --pids-limit 512 \
  --cap-drop ALL --security-opt no-new-privileges --read-only \
  --tmpfs /tmp:rw,exec,nosuid,nodev,size=512m,mode=1777 \
  --network bridge -e HOME=/home/gradle \
  -e GRADLE_USER_HOME=/home/gradle/.gradle -e TMPDIR=/tmp \
  -v neoforge-261-r1-home-170158:/home/gradle -w /home/gradle/mod \
  eclipse-temurin@sha256:83f4a7fc27df94dcc7b8de04d14cbbba8da14406f921e966969c3b09000aa507
```

Visual checks used `voxellume/xvfb-jdk25@sha256:1b717618431ee56dbfc4ec12ecb55bf1344b571f58f565976a653ada47c687cb`, `DISPLAY=:99`, `LIBGL_ALWAYS_SOFTWARE=1`, and `Xvfb :99 -screen 0 1280x720x24 -nolisten tcp`.

## Commands and outcomes

| Check                         | Exact game/build argv                                                                                                             | Result                                                                                                               | Evidence                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Task discovery                | `./gradlew --no-daemon tasks`                                                                                                     | passed, exit 0                                                                                                       | `tasks-pass.log`                                                         |
| Clean build                   | `./gradlew --no-daemon clean build`                                                                                               | passed, exit 0, `OOMKilled=false`                                                                                    | `clean-build-final.status.json`, `clean-build-final.log`                 |
| Positive GameTests            | `./gradlew --no-daemon runGameTestServer`                                                                                         | passed, exit 0; both fixture tests emitted pass markers                                                              | `gametest-positive-26.status.json`, `gametest-positive-26.log`           |
| Negative control              | `./gradlew --no-daemon runGameTestServer`                                                                                         | expected failure, exit 1; `examplemod:deliberate_negative_control` discovered and failed                             | `gametest-negative-control.status.json`, `gametest-negative-control.log` |
| Fixture-free production build | `./gradlew --no-daemon clean build`                                                                                               | passed, exit 0, `OOMKilled=false`                                                                                    | `production-clean-build.status.json`, `production-clean-build.log`       |
| Dedicated development server  | `./gradlew --no-daemon runServer`                                                                                                 | `Done` and Example Mod server-start marker observed; expected cleanup exit 143                                       | `server.status.json`, `server.log`                                       |
| Pristine production server    | `java -jar /input/neoforge-26.1.0.19-beta-installer.jar --installServer /home/gradle/production-server`, then `sh ./run.sh nogui` | packaged JAR loaded as Example Mod 1.0.0 and reached `Done`; expected cleanup exit 143                               | `production-server.status.json`, `production-server.log`                 |
| Real client                   | `./gradlew --no-daemon runClient`                                                                                                 | Example Mod loaded, `Setting user: Dev`, LWJGL `3.4.1+2`, main menu and mod list reviewed; expected cleanup exit 143 | `client-final.status.json`, `client-final.log`                           |

Positive fixture IDs were `registry_and_item` and `place_example_block`. Minecraft 26.1 removed the old annotation API, so the final fixtures use registered `Consumer<GameTestHelper>` functions and datapack `test_instance` JSON. The positive run reported `All 3 required tests passed :)`; the third test was supplied by the game/loader. The negative run reported four tests, preserved both positive passes, and reported `1 required tests failed :(` for the deliberate control. All fixture classes, test instances, and structures were removed before the final clean build.

Production JAR: `artifacts/examplemod-1.0.0.jar`, SHA-256 `f044c995d4f37c3e96dda3266ec3bc157071144f34d51e0cd78c362f1c533db5`. `production-jar-inspect.log` records expanded mod metadata and the absence of GameTest classes and resources.

## Real client and visual review

Mojang's 26.1 `natives-linux` artifacts selected x64 natives on Linux/aarch64. Qualification used eight exact LWJGL `3.4.1` `natives-linux-arm64` JARs from Maven Central, hashed in `inputs/lwjgl-arm64/SHA256SUMS`, extracted only into the isolated qualification home, and selected with:

```sh
JAVA_TOOL_OPTIONS=-Dorg.lwjgl.librarypath=/home/gradle/lwjgl-arm64
```

No template or production-JAR dependency changed. The first architecture-mismatch failure is retained in `client.log`.

`visual-review.json` records the human review and PNG hashes:

- `artifacts/visual/client-loaded-menu.png` shows Minecraft `26.1`, NeoForge `26.1.0.19-beta`, three mods, and correctly rendered main-menu controls/panorama.
- `artifacts/visual/client-final-mod-list.png` shows Minecraft, NeoForge, and `Example Mod 1.0.0` in the real mod list.
- Both are genuine 1280x720 Java Robot captures from the Xvfb JDK 25 client.

The MDK's example block has no model, so the client retains `Missing model for variant: 'Block{examplemod:example_block}'`. Linux narrator/flite is also unavailable. No clean-client-log claim is made. These captures do not qualify packaged-JAR client behavior or world, inventory, hand, placed-block, animation, clipping, or z-fighting scenes.

## Integrity

`result.json` records every final status and the remaining promotion blockers. `SHA256SUMS` covers the evidence bundle, including logs, exact commands, fixtures, native artifacts, production JAR, and reviewed PNGs. The evidence directory and files were finalized read-only after checksum generation.
