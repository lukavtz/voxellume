# Quilt 1.21.11 r1 qualification

Date: 2026-11-07.

## Disposition

`java-quilt-1.21.11-r1` remains **`candidate`**. Mandatory-sandbox task discovery and clean builds passed. Development and pristine packaged-JAR dedicated servers loaded the exact production mod and reached `Done`. A real development client reached the title screen, executed the mod mixin, saved a reviewed main-menu capture, and exited cleanly. GameTest is unavailable. The full required visual matrix was not run, so `visual` remains false and no `evidenceManifest` is declared.

Evidence root: `~/.local/share/voxellume/evidence/quilt-1.21.11-r1-20261107T165343Z/`.

## Immutable inputs

- Minecraft `1.21.11`, obfuscated, data pack 94.1, resource pack 75; release JSON SHA-256 `cc717c0d11f2447690a13069401368969671a90d0503d2848b9e4438ae82d866`.
- Loader `org.quiltmc:quilt-loader:0.30.2`; JAR SHA-256 `273033b1e92793e87f4800b02c6f3d8a89e14cbb71a8087a1f008837f24ab945`.
- Exact Quilt Meta profile `quilt-loader-0.30.2-1.21.11`, `inheritsFrom: 1.21.11`; response SHA-256 `c400e783f3a1b1fb00fe427b369951b1c57517216b1507bb4940b890970e6197`.
- Mappings `org.quiltmc:quilt-mappings:1.21.11+build.2:intermediary-v2`; JAR SHA-256 `5e89bd868693fa6507b7ab1dba0a66b7183b619e4e99d70a7c0b9fa431b614af`.
- Loom implementation `org.quiltmc:loom:1.15.1`; JAR SHA-256 `0237bf0a894f2be15bbf11d578263b292bdf21a4ea098ef77aa2a2ea722b8029`; module SHA-256 `c26ce932905e4c118801a562ab5c31edd805d350266c7add013fb3d61d49a033`.
- Plugin marker `org.quiltmc.loom.remap:1.15.1`; marker POM SHA-256 `3532427021c8b0082eb19ba52edb2869b273e305cf9c2792de3ca6e01d24ae1e`.
- Gradle `9.2.0`; distribution SHA-256 `df67a32e86e3276d011735facb1535f64d0d88df84fa87521e90becc2d735444`; wrapper JAR SHA-256 `cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8`.
- Java/Gradle JVM, toolchain, and release 21; runtime Temurin `21.0.13+9-LTS`.
- Template `QuiltMC/quilt-template-mod@9a6f89cd481e3f58f128596b5b043353bee6b3f2`; ZIP SHA-256 `a2afaa5ab8037021c4538fc8f1bbcca6e30b713c57359245c7eec315e0aaf849`.
- Pristine installer `org.quiltmc:quilt-installer:0.15.1`; JAR SHA-256 `0a229138caa1b87fd8f5622038410696f98bb85871a279640e7002404c4d0dc2`.
- Build container `gradle@sha256:85f8f572045bfb31874d66d7d8a2bd0c17d8cb9ad34b6a4d02f5d552b4b92c04`; real-client container `voxellume/xvfb-jdk21@sha256:97b64a12b0cffdf728d3376d79ca1437747b81ef0977cf564287cb7ff20c6fdd`, Linux/arm64.

The generic template declares Minecraft 1.20.6 upstream. The materialized target replaces Minecraft, Quilt Mappings, Loom, Loader, and metadata coordinates exactly. It uses Loader's `pre_launch` entrypoint and contains no QSL, QFAPI, Yarn, Mojang, or Parchment dependency. The title mixin uses the 1.21.11 `ScreenshotRecorder.saveScreenshot(File, Framebuffer, Consumer<Text>)` signature.

## Isolation

Gradle and runtime invocations use 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, and a 512 MiB executable `nosuid,nodev` `/tmp` tmpfs. `HOME` and `GRADLE_USER_HOME` use isolated volume `voxellume-quilt-12111-home-165343`. No credentials or Docker socket are mounted. Cold downloads use the existing approved official dependency endpoints. Exact Docker argv, inspections, logs, exit codes, and timestamps are recorded per check in `commands.log`, `*.status.json`, and `*-sandbox.json`.

Server runs use the existing EULA approval for `https://www.minecraft.net/en-us/eula` recorded in `~/.config/voxellume/approvals.json`; no new approval was created.

## Executed checks

| Check                            | Command or probe                                                                   | Outcome                                                        | Evidence                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Task discovery                   | `./gradlew --no-daemon --console=plain --info tasks --all`                         | passed, exit 0                                                 | `tasks.log`, `tasks.status.json`                                 |
| Initial clean build              | `./gradlew --no-daemon --console=plain --info clean build`                         | passed, exit 0                                                 | `clean-build.log`, `clean-build.status.json`                     |
| Final clean build                | `./gradlew --no-daemon --console=plain clean build`                                | passed, exit 0                                                 | `final-clean-build-r2.log`, `final-clean-build-r2.status.json`   |
| Development dedicated server     | `./gradlew --no-daemon --console=plain runServer`                                  | startup passed; supervisor timed out after `Done`              | `server.log`, `server.status.json`                               |
| Pristine installation            | Quilt Installer `install server 1.21.11 0.30.2 --download-server --create-scripts` | passed, exit 0                                                 | `pristine-install.log`, `pristine-install.status.json`           |
| Final pristine production server | `java -jar quilt-server-launch.jar nogui`                                          | production JAR loaded and reached `Done`; supervisor timed out | `pristine-final-server.log`, `pristine-final-server.status.json` |
| Real client and visual capture   | Xvfb, llvmpipe, `./gradlew --no-daemon --console=plain runClient`                  | passed, exit 0                                                 | `client-visual-final.log`, `client-visual-final.status.json`     |

Task discovery records Gradle `9.2.0`, Quilt Loom `1.15.1`, `runServer`, and `runClient`. The final JAR is `example_mod-1.0.0+1.21.11.jar`, SHA-256 `179cc6ce66940feced3df7b7aa4cf3e0cded74f75c3dcfe590c57a95a7bba154`; the sources JAR SHA-256 is `dba33987fbfb45cc16f2e7a154ba2367af5e0577d14146ad8c443323dc3d263f`. `production-bytecode.txt` records class major 65. `production-jar-contents.txt` and `production-quilt.mod.json` record exact Loader and Minecraft dependencies, remapped classes, and no QSL/QFAPI or test entries.

The final pristine log loads `example_mod:1.0.0+1.21.11` from `<mods>/example_mod-1.0.0+1.21.11.jar`, prints `Hello Quilt world from Mod Name!`, and reaches `Done (0.227s)!`. The earlier pristine run independently reached `Done (11.314s)!`. Supervisor timeouts are not claimed as graceful-shutdown passes.

## Client, visual, and GameTest

The final client log records LWJGL, Quilt Loader `0.30.2`, the example mod, `VOXELLUME_CLIENT_TITLE_SCREEN=true`, `VOXELLUME_VISUAL_CAPTURE=Saved screenshot as 2026-11-07_17.34.23.png`, `VOXELLUME_CLIENT_STOP=true`, `Stopping!`, and `BUILD SUCCESSFUL`. `glxinfo` records Mesa llvmpipe OpenGL 4.5 with software rendering.

Reviewed capture: `artifacts/client-visual-final/screenshots/2026-11-07_17.34.23.png`, SHA-256 `f44a292e0c980f52eccf8664dfd3b12801c3576cfe7168e1b95f697502a93429`. It shows the actual Minecraft 1.21.11 title screen with `Quilt Loader 0.30.2 (Modded)` in the footer. Menus and logo are legible. No world, inventory, hand, placed-block, alternate GUI-state, or animation capture was produced; the required visual capability therefore remains false. Narrator and OpenAL devices are unavailable in the image; no sound or complete client-log-cleanliness claim is made.

GameTest is **unavailable**. No GameTest command is inferred from another loader or release, and `verification.json` contains no GameTest argv. `gameTest` remains false and is not required.

## Repairs and retained failures

- Initial visual repair used the pre-1.21.11 four-argument screenshot API and failed compilation. `final-clean-build.log` retains the exact compiler diagnostic.
- The corrected API built successfully, but the first Xvfb client run lacked an explicit Xvfb process and failed GLFW initialization. `client.log` retains the crash.
- The explicit-Xvfb run reached the title screen and stopped cleanly but lacked the screenshot directory. `client-r1.log` retains that failure.
- The final run creates the directory and uses the client working directory as screenshot root. It passed and produced the reviewed PNG.

## Evidence files

The bundle includes immutable input artifacts and hashes, materialized-template hashes, exact Docker commands, sandbox/HostConfig inspection, per-check logs/status/container state, production artifacts and metadata, bytecode inspection, pristine installer evidence, the real-client capture, `visual-review.json`, `result.json`, cleanup records, and final `SHA256SUMS`.
