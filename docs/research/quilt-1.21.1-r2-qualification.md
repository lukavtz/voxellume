# Quilt 1.21.1 r2 qualification

Date: 2026-11-07.

## Disposition

`java-quilt-1.21.1-r2` is **`candidate`** and supersedes rejected `java-quilt-1.21.1-r1`; r1 evidence remains unchanged. R1 paired Quilt Loom `1.15.1`, which requires Gradle plugin API `9.2.0`, with Gradle `8.9`. R2 uses the exact supported repair: stable Quilt Loader `0.30.2`, plugin `org.quiltmc.loom.remap:1.15.1`, and Gradle `9.2.0`. QSL, Quilt Mappings, JDK 21, and the pinned generic template revision are unchanged. No automatic `supported` promotion is made.

Evidence root: `~/.local/share/voxellume/evidence/quilt-1.21.1-r2-20261107T154433Z/`.

## Immutable inputs

- Minecraft `1.21.1`, obfuscated, data pack 48, resource pack 34.
- Loader `org.quiltmc:quilt-loader:0.30.2`; JAR SHA-256 `273033b1e92793e87f4800b02c6f3d8a89e14cbb71a8087a1f008837f24ab945`.
- Exact Quilt Meta profile `quilt-loader-0.30.2-1.21.1`, `inheritsFrom: 1.21.1`; response SHA-256 `043a502c64a7a41b54654930934dc511a8c64752662b1646f70fc67f6f5a7661`.
- QSL `org.quiltmc:qsl:10.0.0-alpha.5+1.21.1`; POM SHA-256 `2836796932b4c3e01e063fa5fc5a6509395df06a2949bb63212e7c502dc8bb8e`.
- Mappings `org.quiltmc:quilt-mappings:1.21.1+build.9:intermediary-v2`; JAR SHA-256 `e445b1d48d016ac7302a294bf88ee158644bac941958ec7dac4aadf0db7b9c3a`.
- Loom implementation `org.quiltmc:loom:1.15.1`; JAR SHA-256 `0237bf0a894f2be15bbf11d578263b292bdf21a4ea098ef77aa2a2ea722b8029`; module SHA-256 `c26ce932905e4c118801a562ab5c31edd805d350266c7add013fb3d61d49a033`.
- Plugin marker `org.quiltmc.loom.remap:1.15.1`; marker POM SHA-256 `3532427021c8b0082eb19ba52edb2869b273e305cf9c2792de3ca6e01d24ae1e`.
- Gradle `9.2.0`; distribution SHA-256 `df67a32e86e3276d011735facb1535f64d0d88df84fa87521e90becc2d735444`; wrapper JAR SHA-256 `cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8`.
- Java/Gradle JVM, toolchain, and release 21.
- Template `QuiltMC/quilt-template-mod@9a6f89cd481e3f58f128596b5b043353bee6b3f2`; ZIP SHA-256 `a2afaa5ab8037021c4538fc8f1bbcca6e30b713c57359245c7eec315e0aaf849`.
- Container `gradle@sha256:85f8f572045bfb31874d66d7d8a2bd0c17d8cb9ad34b6a4d02f5d552b4b92c04`, Linux/arm64, Temurin `21.0.13+9-LTS`.

The materialized generic template replaces Minecraft, Quilt Mappings, Loom, Loader, and QSL coordinates with exact target values. It selects `org.quiltmc.loom.remap`, depends directly on QSL only, and declares Loader `0.30.2` in `quilt.mod.json`. It adds no Mojang mappings, Yarn mappings, or Quilted Fabric API dependency. Wrapper properties enforce `distributionSha256Sum`.

## Isolation

Gradle invocations use the pinned container with `--user gradle`, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, and a 512 MiB executable `nosuid,nodev` `/tmp` tmpfs. `HOME` and `GRADLE_USER_HOME` are isolated in named volume `voxellume-quilt-r2-home-154433`. No credentials or Docker socket are mounted. Cold dependency resolution uses official GitHub, Gradle, Quilt, Fabric, and Mojang endpoints under the existing network approvals.

The initial task invocation used the wrong container working directory and exited 127 before executing Gradle. It is retained as `tasks.log` and `tasks.status.json`. The corrected invocation is `tasks-clean`.

## Executed checks

| Check                    | Gradle argv or probe                                       |              Status | Exit | Evidence                                                                     |
| ------------------------ | ---------------------------------------------------------- | ------------------: | ---: | ---------------------------------------------------------------------------- |
| Task discovery           | `./gradlew --no-daemon --console=plain --info tasks --all` |              passed |    0 | `tasks-clean.log`, `tasks-clean.status.json`                                 |
| Clean build              | `./gradlew --no-daemon --console=plain --info clean build` |              passed |    0 | `clean-build.log`, `clean-build.status.json`                                 |
| Final clean build        | `./gradlew --no-daemon --console=plain --info clean build` |              passed |    0 | `clean-build-repair1-applied.log`, `clean-build-repair1-applied.status.json` |
| Initial dedicated server | `./gradlew --no-daemon --console=plain runServer`          |              failed |    1 | `server.log`, `server.status.json`                                           |
| Final dedicated server   | `./gradlew --no-daemon --console=plain runServer`          |              passed |    0 | `server-final.log`, `server-final.status.json`                               |
| Client display probe     | `DISPLAY`, `Xvfb`, and `xvfb-run` discovery                | passed (probe only) |    0 | `client-display-probe.log`                                                   |
| Initial real client      | Xvfb + `./gradlew --no-daemon --console=plain runClient`   |           timed_out |  124 | `client-final.log`, `client-final.status.json`                               |
| Updated real client      | Xvfb + `./gradlew --no-daemon --console=plain runClient`   |           timed_out |  124 | `client-latest.log`, `client-latest.status.json`                             |

Task discovery records Gradle `9.2.0`, Quilt Loom `1.15.1`, `runServer`, `runClient`, and `BUILD SUCCESSFUL`. Clean build completed eight tasks and produced `example_mod-1.0.0+1.21.1.jar` with final SHA-256 `4ab5b32681a0acb3f3c1978a267e863458ecc402133028921ebcbdf0bfd03d19`; the final sources JAR has SHA-256 `5b9cb0090bc450c8df22de86581377d385f2908de80b018c15d0c19efd289178`. Final artifacts are under `artifacts/collect-final-artifacts/libs/`. `production-jar-contents.txt` and `production-quilt.mod.json` record the remapped production classes, exact Loader `0.30.2` and `quilt_base` dependencies, and absence of test entries. Final check results are recorded in `result.json`, per-check status JSON, logs, container inspection records, and `commands.log`.

## Runtime, GameTest, client, and visual policy

Dedicated-server execution uses the existing approval for `https://www.minecraft.net/en-us/eula` recorded in `~/.config/voxellume/approvals.json`; it creates no new approval.

The final server log records Quilt Loader `0.30.2`, `Hello Quilt world from Mod Name!`, `Done (8.722s)!`, graceful shutdown, and `BUILD SUCCESSFUL`. The initial server attempt loaded Minecraft `1.21.1` with Quilt Loader `0.30.2`, then exited 1 because the template declared the non-existent umbrella mod ID `qsl`. The crash report proves QSL modules were present, including `quilt_base` at the exact pinned version. Repair 1 changes only the template metadata dependency from `qsl` to the actual QSL base module ID `quilt_base`; the QSL artifact pin is unchanged. `apply-repair1` copies that file into the isolated project. An intermediate rebuild before this copy reused stale metadata; its server attempt was cancelled and is not qualification evidence.

GameTest is **unavailable**. No GameTest command is inferred from another loader or version, and `verification.json` contains no GameTest argv.

The original Gradle image has no `DISPLAY`, Xvfb, or `xvfb-run` (`client-display-probe.log`). A newly approved runtime, `voxellume/xvfb-jdk21@sha256:97b64a12b0cffdf728d3376d79ca1437747b81ef0977cf564287cb7ff20c6fdd`, provides Xvfb `21.1.22-1ubuntu1.3`, Mesa `26.0.8-1ubuntu0.3`, `DISPLAY=:99`, and `LIBGL_ALWAYS_SOFTWARE=1`. `visual-helper-probe.log` records successful llvmpipe OpenGL 4.5 initialization. The updated client reached real LWJGL rendering and loaded the mod, but neither 10-minute run reached `TitleScreen`. `artifacts/client-latest/client-latest-timeout.png` (SHA-256 `851e73f481a7fac42e7b0f8e544f853b5ed24b1bfb513e59c0dfe3aa1bac2073`) was captured through AWT and reviewed: it shows Minecraft's accessibility welcome screen with **Narrator: Not Available**, not the main menu. The client was then terminated as timed out. Client and full visual capabilities remain false; the capture is diagnostic evidence, not a visual pass.

## Evidence files

The bundle contains exact inputs and hashes, the sandbox runner, exact Docker argv, per-check logs/status/state/HostConfig records, production artifacts when available, cleanup records, and final `SHA256SUMS`. `verification.json` deliberately has no `evidenceManifest` unless the complete qualification matrix passes.
