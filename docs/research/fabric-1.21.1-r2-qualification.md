# Fabric 1.21.1 r2 qualification

Date: 2026-11-07.

## Disposition

`java-fabric-1.21.1-r2` is **`candidate`**. It supersedes rejected `java-fabric-1.21.1-r1`; r1 evidence remains unchanged. Exact Loom `1.20.0-alpha.19` required JVM 25 and was incompatible with this target's JDK 21. R2 changes only the Loom pin to stable `1.17.21` and advances the target revision. No automatic `supported` promotion is made.

Evidence root: `~/.local/share/voxellume/evidence/fabric-1.21.1-r2-20261107T153259Z/`.

## Immutable inputs

- Minecraft `1.21.1`, obfuscated, official Mojang mappings, data pack 48, resource pack 34.
- Fabric Loader `0.20.1` and Fabric API `0.116.17+1.21.1`.
- Java/Gradle JVM, toolchain, and release 21; Gradle wrapper `9.8.2`.
- Plugin `net.fabricmc.fabric-loom-remap:1.17.21`.
- Template `FabricMC/fabric-example-mod@4c47210589a9ff72a6075c8dd1d73315dcc3e010`; only the floating `1.19-SNAPSHOT` Loom override changes to `1.17.21`.
- Container `gradle@sha256:85f8f572045bfb31874d66d7d8a2bd0c17d8cb9ad34b6a4d02f5d552b4b92c04`, Linux/arm64.

Exact Fabric Maven identities were independently downloaded and matched:

| Artifact                                                   | SHA-256                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `fabric-loom-1.17.21.jar`                                  | `89c08938d865621172e3fb31036081399b2731a4971f599b42724b2509ff5b64` |
| `fabric-loom-1.17.21.module`                               | `b4b57c34129fe2b113c9db754d7deca89c527eeffbb08612af3c64760e9006b3` |
| `net.fabricmc.fabric-loom-remap.gradle.plugin-1.17.21.pom` | `234e78cc7f7ab4b458f043a5694464cd7ef543194029a482c82b1c629ee12ea2` |

The wrapper distribution checksum is `21bd5da2de49b642904077f38c0efdc7778e92b3ed0889392dca61b97e389607`; the wrapper JAR checksum is `3b8a25775a69158b5ad2b1d17a80a88dc7b40a352a73eb27d06c612a7ce68e98`.

## Prior partial evidence

Ad-hoc research passed `tasks --all` and `clean build` on JDK 21 with Loom `1.17.21`, but omitted `cap_drop=ALL`, a read-only root, and bounded tmpfs. It created no finalized evidence bundle. Those results are not mandatory-sandbox qualification.

## Sandbox diagnostics

The first r2 sandbox run used root with `cap_drop=ALL`. Gradle failed before configuration because the dropped-capability root user could not create `libnative-platform.so.lock` in the Gradle-owned native extraction directory. Owner-mode reuse then failed on the root-owned wrapper lock. These are recorded as setup failures, not task-discovery passes. A clean owner-initialized volume uses `--user gradle`; `/tmp` is a 512 MiB `exec,nosuid,nodev` tmpfs so native extraction and execution remain inside writable, authorized mounts without relaxing the sandbox.

## Executed checks

The successful checks used `--user gradle`, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root, and the bounded executable `/tmp` tmpfs. `HOME` and `GRADLE_USER_HOME` were isolated named volumes. Exact Docker argv is in `commands.log`; container `HostConfig` and exit state are in the per-check JSON files.

| Check               | Gradle argv                                                | Status | Exit | Evidence                                                |
| ------------------- | ---------------------------------------------------------- | -----: | ---: | ------------------------------------------------------- |
| Task discovery      | `./gradlew --no-daemon --console=plain --info tasks --all` | passed |    0 | `tasks-clean.log`, `tasks-clean.status`                 |
| Clean build         | `./gradlew --no-daemon --console=plain --info clean build` | passed |    0 | `clean-build.log`, `clean-build.status`                 |
| Dedicated server    | `./gradlew --no-daemon --console=plain runServer`          | passed |    0 | `server.log`, `server.status`                           |
| Configured GameTest | `./gradlew --no-daemon --console=plain runGametest`        | passed |    0 | `gametest-configured.log`, `gametest-configured.status` |

The dedicated-server run used the existing approval for `https://www.minecraft.net/en-us/eula` recorded in `~/.config/voxellume/approvals.json`; it did not create a new approval. The log records Fabric Loader 0.20.1, `Hello Fabric world!`, `Done (10.155s)!`, graceful `stop`, and `BUILD SUCCESSFUL`.

The initial unconfigured `runGametest` exited 1 because the task did not exist. A test-only fixture then enabled Loom `fabricApi.configureTests`, created an isolated `gametest` source set, registered `modid-gametest`, and asserted that `modid` was loaded. The successful log records `VOXELLUME_TEST_PASSED=mod_loaded`, one running test, and `All 1 required tests passed :)`. The production JAR was captured before adding this fixture.

The clean build produced `modid-1.0.0.jar` with SHA-256 `696a4e59e6633d324490485d14037baadbc6dadf599aa1292097aa62eaaf12c2` and `modid-1.0.0-sources.jar` with SHA-256 `9496c02bc4fb541f1cabc8b34e5a4174b4d42f906f487af8d8c7494db8f13199`. Contents and metadata are recorded in `production-jar-contents.txt` and `production-fabric.mod.json`.

The original pinned Gradle image had neither `DISPLAY` nor Xvfb (`client-display-probe.log`). A follow-up used approved `voxellume/xvfb-jdk21:20261107` (final image ID `sha256:97b64a12b0cffdf728d3376d79ca1437747b81ef0977cf564287cb7ff20c6fdd`) with Xvfb `:99`, Mesa llvmpipe, and the same mandatory sandbox boundaries. Follow-up evidence is under `~/.local/share/voxellume/evidence/fabric-1.21.1-r2-visual-20261107T155854Z/`.

The production JAR passed a separate pristine dedicated-server installation in that image. Exact Fabric server launcher `1.1.2` SHA-256 `7638dc69ef2cecb27d1cff1a1b0a6e2c3ced7ece0000d584039a3f4e1386123c`, Fabric API `79ac44b40780acbd884b34c50be1e39af682847e5f5cb3b1fddeeaa768dce800`, and production JAR `696a4e59e6633d324490485d14037baadbc6dadf599aa1292097aa62eaaf12c2` were verified before launch. The server loaded `modid 1.0.0`, logged `Hello Fabric world!` and `Done (9.131s)!`, then stopped cleanly with exit 0 (`pristine-server-shared.log`). An initial infrastructure attempt used a Docker-invisible `/tmp` bind and failed before launch; it is retained separately.

The follow-up clean build also produced a byte-identical `modid-1.0.0.jar` with SHA-256 `696a4e59e6633d324490485d14037baadbc6dadf599aa1292097aa62eaaf12c2` (`visual-live-build.log`, `artifacts/modid-1.0.0.jar`). `glxinfo.log` records direct rendering through Mesa llvmpipe. The final image supplies `libxtst6=2:1.2.5-1ubuntu0.1` and `libxi6=2:1.8.2-2`; `ldd libawt_xawt.so` resolves completely. The earlier image required a temporary, hash-verified extraction of older XTest/XInput packages into authorized home. The workspace was migrated to the final image without rerunning dependency downloads or changing the sandbox.

The final-image real client loaded Fabric Loader 0.20.1 and `modid 1.0.0`, initialized LWJGL, and displayed a reviewed, nonblank main menu (`client-latest.log`, `screenshots/latest-main.png`). Narrator/flite and OpenAL-device errors are recorded as environment diagnostics, not suppressed or counted as mod-loading failures. The deterministic world-options and seed `1122334455` GUI captures were also reviewed. World creation then terminated with exit 137 and Docker `OOMKilled=true` under the mandatory 4 GiB container limit (`client-state.json`). World, inventory, hand, and animation captures were not completed; visual is `unavailable`. No further client retry was made.

The target therefore remains **`candidate`**. Build, server, GameTest, real-client main-menu, and pristine packaged-JAR server checks passed; full visual qualification did not. `verification.json` sets `client:true`, `visual:false`, and deliberately has no `evidenceManifest`.

All r2 containers and named writable volumes were removed after artifact capture. `result.json`, exact `commands.log`, per-check logs/state/sandbox records, fixture sources, input artifacts, and `SHA256SUMS` form the finalized evidence bundle.
