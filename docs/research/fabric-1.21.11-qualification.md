# Fabric 1.21.11 r1 qualification

Date: 2026-11-07.

## Disposition

`java-fabric-1.21.11-r1` remains **`candidate`**. Build, dedicated server, configured server/client GameTests, production-JAR packaging, pristine packaged-JAR server installation/restart, and real production-client launch passed. The full visual matrix did not complete. `verification.json` sets `build`, `server`, `client`, and `gameTest` to `true`, leaves `visual:false`, and deliberately has no `evidenceManifest`.

Evidence root: `~/.local/share/voxellume/evidence/fabric-1.21.11-r1-20261107T161824Z/`.

Result manifest SHA-256: `3b99321b4e83e5edce798e43cd44769aa26b688530d02d26578d001bd4bc12db`.

Final target `packSha256`: `f03c5c3296c8d96764fefb9989095afe4ab950a7ba8aadaa304eb7c5b4f3a889`.

## Immutable inputs

- Minecraft `1.21.11`, obfuscated, official Mojang mappings, data pack 94.1, resource pack 75.
- Fabric Loader `0.20.1` and Fabric API `0.141.6+1.21.11`.
- Java/Gradle JVM, toolchain, and release 21; Gradle wrapper `9.8.2`.
- Plugin `net.fabricmc.fabric-loom-remap:1.17.21`.
- Template `FabricMC/fabric-example-mod@8272aadc8605a4661685465c22f80aab21c7b969`.
- Container `voxellume/xvfb-jdk21:20261107`, image ID `sha256:97b64a12b0cffdf728d3376d79ca1437747b81ef0977cf564287cb7ff20c6fdd`, Linux/arm64.

The downloaded template ZIP SHA-256 matched `2fa8f993c6aaa8f27bec350c9fd940fa652181cf692320777e6b5121b1b662ed`. Only the floating `1.19-SNAPSHOT` Loom version changed to `1.17.21`, and `distributionSha256Sum` was added. `template-overrides.diff` records the complete diff.

Exact downloaded identities matched:

| Artifact                         | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `fabric-loader-0.20.1.jar`       | `d0c5a082e07410aaff9de7ab196aa6b4236002870f9ba3ad5c1260fcce5110ad` |
| `fabric-api-0.141.6+1.21.11.jar` | `bdff7fd7e220085cfad2ff9b1f40dde6534ae0b96cf378f97a374bc54cb9ed0f` |
| `fabric-installer-1.1.2.jar`     | `61e035bf7bf70153e127440ce34de47c9036f0a2d0c65d1529454bd35ceefe4f` |
| `1.21.11.json`                   | `cc717c0d11f2447690a13069401368969671a90d0503d2848b9e4438ae82d866` |
| `1.21.11-server.jar`             | `f83b8e093865806f931c7e34aae41b177d4c076335263dd124c75d6d65dd1726` |
| `fabric-loom-1.17.21.jar`        | `89c08938d865621172e3fb31036081399b2731a4971f599b42724b2509ff5b64` |
| `fabric-loom-1.17.21.module`     | `b4b57c34129fe2b113c9db754d7deca89c527eeffbb08612af3c64760e9006b3` |
| Loom remap plugin POM            | `234e78cc7f7ab4b458f043a5694464cd7ef543194029a482c82b1c629ee12ea2` |

The wrapper distribution checksum is `21bd5da2de49b642904077f38c0efdc7778e92b3ed0889392dca61b97e389607`; the wrapper JAR checksum is `3b8a25775a69158b5ad2b1d17a80a88dc7b40a352a73eb27d06c612a7ce68e98`.

## Mandatory sandbox

All target containers used UID/GID `1000:1000`, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, a 3 GiB executable home tmpfs, and a 512 MiB executable `/tmp` tmpfs. Only the reviewed template, fixtures, and exact inputs were mounted read-only. `HOME` and `GRADLE_USER_HOME` were isolated. `sandbox-host-config.json` and `pristine-sandbox-host-config.json` record Docker `HostConfig`.

The approved Xvfb image ran Xvfb at `:99` with TCP disabled. `glxinfo.log` records direct rendering through Mesa llvmpipe, OpenGL 4.5, and GLES 3.2.

## Executed checks

Exact argv and observed outcomes are in `commands.log`; per-check logs and status JSON files form the evidence record.

| Check                          | Gradle/runtime argv                                         |                           Status | Exit | Evidence                                                             |
| ------------------------------ | ----------------------------------------------------------- | -------------------------------: | ---: | -------------------------------------------------------------------- |
| Task discovery                 | `./gradlew --no-daemon --console=plain --info tasks --all`  |                           passed |    0 | `tasks.log`, `tasks.status.json`                                     |
| Clean build                    | `./gradlew --no-daemon --console=plain --info clean build`  |                           passed |    0 | `clean-build.log`, `clean-build.status.json`                         |
| Negative harness control       | `./gradlew --no-daemon --console=plain build`               |                   passed control |    1 | `negative-control-final.log`, `negative-control.status.json`         |
| Server GameTests through build | `./gradlew --no-daemon --console=plain build`               |                           passed |    0 | `gametest-build.log`, `gametest-build.status.json`                   |
| Client GameTests               | `./gradlew --no-daemon --console=plain runClientGameTest`   |                           passed |    0 | `client-gametest.log`, `client-gametest.status.json`                 |
| Dedicated server               | `./gradlew --no-daemon --console=plain runServer`           |                           passed |    0 | `server.log`, `server.status.json`                                   |
| Pristine packaged-JAR server   | `net.fabricmc.installer.ServerLauncher nogui`               |                           passed |    0 | `pristine-server.log`, `pristine-server.status.json`                 |
| Pristine restart               | `net.fabricmc.installer.ServerLauncher nogui`               |                           passed |    0 | `pristine-server-restart.log`, `pristine-server-restart.status.json` |
| Packaged-JAR production client | `./gradlew --no-daemon --console=plain runProductionClient` | launch passed; visual incomplete |  137 | `production-client.log`, `production-client.status.json`             |

The dedicated server used the existing approval for `https://www.minecraft.net/en-us/eula` recorded at `2026-11-06T23:59:20.194Z`; no new approval was created. Its log records `Hello Fabric world!`, `Done (3.825s)!`, graceful `stop`, complete world saving, and `BUILD SUCCESSFUL`.

### GameTest harness

The test-only fixture used `fabricApi.configureTests` with a separate `gametest` source set and both server/client tests enabled. Initial migration failures are retained in `negative-control-build.log` and `negative-control-runtime.log`; target-local Fabric GameTest annotations require instance methods on this release.

The final negative control executed `VOXELLUME_NEGATIVE_CONTROL`, reported `1 required tests failed :(`, and failed the build with exit 1. Removing only that deliberate test produced `VOXELLUME_TEST_PASSED=mod_loaded`, `All 2 required tests passed :)`, and exit 0. The client test created a singleplayer world, emitted `VOXELLUME_CLIENT_TEST_PASSED=singleplayer_world`, captured `client-gametest/screenshots/0000_voxellume-fabric-1.21.11-client-gametest.png`, and exited 0. The screenshot was reviewed: first-person terrain, crosshair, hearts, hunger, and hotbar rendered without a mod-error surface.

### Production artifacts and pristine installation

The clean build produced:

- `modid-1.0.0.jar`, SHA-256 `176bc3b753f76fa96e14ad8a26aedc17c15cdb07ff27ceda932d0cababd645d7`.
- `modid-1.0.0-sources.jar`, SHA-256 `bfeb5e54d20131022263ba1ff5bf653b424dcba5e7827d501d5207bbfb57f774`.

`production-jar-contents.txt` and `production-fabric.mod.json` record the package. GameTest sources remained in the separate test source set and were absent from this production JAR.

The pristine instance used the exact local installer, loader, official server JAR, Fabric API, and captured production JAR. It generated the normal Fabric server installation, loaded `modid 1.0.0`, logged `Hello Fabric world!` and `Done (7.120s)!`, and stopped cleanly. A second launch loaded the existing world, logged `Done (0.211s)!`, and stopped cleanly with full world saving.

### Real production client and visual limitation

A Loom `ClientProductionRunTask` received `build/libs/modid-1.0.0.jar` and Fabric API through its production `mods` configuration. The log confirms obfuscated production execution with Minecraft 1.21.11, Loader 0.20.1, and `modid 1.0.0`.

Reviewed captures under `screenshots/` prove the first-run screen, modded main menu, creative selection, seed `12345`, rendered fixed-seed world, creative inventory, held oak log, and an alternate world direction. The world and GUI surfaces rendered without a mod-error screen.

After 14 minutes 31 seconds the client exited 137 under the mandatory 4 GiB limit. Placed-block, complete-direction, game-menu, and animation captures did not finish. `production-game-menu.png` is intentionally retained as a black post-exit failure capture. This is not a passing visual or clean-client-shutdown result; full visual qualification remains incomplete.

## Finalization

Both qualification containers were removed; `surviving-containers.txt` is empty. `result.json`, exact commands, per-check logs/status, sandbox records, fixtures, immutable inputs, production artifacts, reviewed screenshots, cleanup records, and `SHA256SUMS` form the finalized evidence bundle. The evidence directory is read-only. No `supported` claim or `evidenceManifest` is made.
