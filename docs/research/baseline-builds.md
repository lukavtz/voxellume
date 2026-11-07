# Fabric and NeoForge 1.21.1 baseline build evidence

Date: 2026-11-06.

## Qualification result

Both `java-fabric-1.21.1-r1` and `java-neoforge-1.21.1-r1` remain **`candidate`**. Neither clean build passed, neither produced a production JAR, and **zero targets are supported** by these runs. No dedicated-server, client, GameTest, production-JAR, or visual qualification was completed; this report makes no runtime or visual-support claim.

## Fabric `java-fabric-1.21.1-r1`

Evidence root: `~/.local/share/voxellume/evidence/fabric-1.21.1-r1-20261106T150255Z-17015/`.

### Immutable inputs and isolation

- Template: `https://github.com/FabricMC/fabric-example-mod.git@4c47210589a9ff72a6075c8dd1d73315dcc3e010`; expected and actual uncompressed `git archive` SHA-256: `0e29551a0acc38f4907081c77b8af68da8a73f2cfa862c0af40f0c92b4d346ea` (`result.json`, `template-revision.txt`, `commands.log`).
- Loom: exact `net.fabricmc:fabric-loom:1.20.0-alpha.19`, selected through `net.fabricmc.fabric-loom-remap:1.20.0-alpha.19`.
- Wrapper distribution: `https://services.gradle.org/distributions/gradle-9.8.2-bin.zip`; expected and actual SHA-256: `21bd5da2de49b642904077f38c0efdc7778e92b3ed0889392dca61b97e389607`. `distributionSha256Sum` was configured and accepted. Wrapper JAR SHA-256: `3b8a25775a69158b5ad2b1d17a80a88dc7b40a352a73eb27d06c612a7ce68e98` (`gradle-wrapper.properties`, `gradle-distribution.sha256`, `wrapper-input-hashes.txt`).
- Container: Java `21.0.13+9-LTS`, Linux/arm64, image `eclipse-temurin@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a`.
- Docker boundaries: 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, read-only root filesystem, bounded tmpfs, isolated `HOME` and `GRADLE_USER_HOME`, no credentials or Docker socket, 15-minute timeout, and 16 MiB log cap. Recorded cold artifact resolution used official GitHub, Gradle, and Fabric Maven endpoints. After the unavailable `/tmp` bind mount failed with exit `125`, isolated named volumes backed `/work` and `/gradle-home` (`commands.log`, `environment.txt`).

### Commands and outcomes

| Check          | Gradle argv inside the pinned container                    |     Status | Exit | Primary evidence                 |
| -------------- | ---------------------------------------------------------- | ---------: | ---: | -------------------------------- |
| Task discovery | `./gradlew --no-daemon --console=plain --info tasks`       | **failed** |  `1` | `result.json`, `tasks.log`       |
| Clean build    | `./gradlew --no-daemon --console=plain --info clean build` | **failed** |  `1` | `result.json`, `clean-build.log` |

Both commands failed during root-project configuration. `net.fabricmc:fabric-loom:1.20.0-alpha.19` requires JVM runtime 25 or newer, while this target and container use Java 21. Thus task discovery did **not** pass. Configuration failed before compilation or packaging; `artifact-inventory.txt` records `build/libs absent`, and `result.json` records `productionJar: null`.

### Evidence integrity and repair

`SHA256SUMS` is present and covers the result, commands, logs, and input records. The evidence directory was observed as `dr-xr-xr-x` and sampled files, including `result.json` and `SHA256SUMS`, as `-r--r--r--`; these files are read-only. This observation does not claim an independent checksum-verification run.

Next repair: select and pin an exact Loom release compatible with the target's JDK 21, update the target pack, and rerun qualification. Do not promote the target by switching it to JDK 25.

A separate Ruby Blade rerun under `/tmp/voxellume-fabric-1.21.1-r1-ruby-blade-CostlyRabbit/evidence/result.json` reproduced the same result: wrapper JAR and Gradle 9.8.2 distribution hashes passed, but both `clean build` and `runGametest` exited `1` because Loom `1.20.0-alpha.19` requires JVM 25. No tests ran, no JAR was produced, and production-JAR/visual smoke was `unavailable`. The pack remains `candidate` with unchanged versions.

## NeoForge `java-neoforge-1.21.1-r1`

Evidence root: `~/.local/share/voxellume/evidence/neoforge-baseline.fp2L9v/`. Immutable-input values are cross-referenced from `docs/research/minecraft-targets.md`; wrapper files remained at `/tmp/voxellume-neoforge-baseline.4mytVD/` when inspected.

### Immutable inputs and isolation

- Template: `NeoForgeMDKs/MDK-1.21.1-ModDevGradle@e93d7f09d4eec12c76d1d7be9bf4eaad0246e9e0`; uncompressed `git archive` `contentSha256=e3bc538fc9c77d2ef9f86e46b2dc2a2190b899807d62bc03c1515fefb2c0505f`. Target inputs are NeoForge `21.1.265`, Parchment `1.21.1` / `2024.11.17`, ModDevGradle `2.0.148`, and Java 21.
- Wrapper distribution: `https://services.gradle.org/distributions/gradle-9.2.1-bin.zip`; SHA-256: `72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f`. The downloaded archive's observed SHA-256 matched this value. The pinned MDK's `gradle-wrapper.properties` did **not** contain `distributionSha256Sum`; do not claim wrapper checksum enforcement for this run. Wrapper JAR SHA-256: `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172`.
- Container image: `eclipse-temurin:21-jdk@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a`.
- Docker boundaries in every result JSON: 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges:true`, read-only root filesystem, 512 MiB `nosuid` `/tmp` tmpfs, isolated `HOME` and `GRADLE_USER_HOME`, and a 16 MiB output cap. The successful task-discovery run and builds used isolated named volumes for `/workspace` and `/home/voxellume` after the initial bind-mounted workspace could not find `gradlew`.

### Commands and outcomes

| Check                         | Gradle argv inside the pinned container |     Status |  Exit | Primary evidence                                               |
| ----------------------------- | --------------------------------------- | ---------: | ----: | -------------------------------------------------------------- |
| Initial task-discovery launch | `./gradlew --no-daemon tasks`           | **failed** | `127` | `tasks.json`, `tasks.log`                                      |
| Task discovery, named volumes | `./gradlew --no-daemon tasks`           | **passed** |   `0` | `tasks-volume.json`, `tasks-volume.log`                        |
| Clean build                   | `./gradlew --no-daemon clean build`     | **failed** |   `1` | `clean-build.json`, `clean-build.log`, `decompile-console.log` |
| Clean-build retry             | `./gradlew --no-daemon clean build`     | **failed** |   `1` | `clean-build-retry.json`, `clean-build-retry.log`              |

The initial exit `127` was an infrastructure launch failure: `/workspace/gradlew` was absent through the bind mount. The named-volume rerun passed and listed `runServer`, `runClient`, `runGameTestServer`, and `createMinecraftArtifacts`; task listing alone is not runtime evidence.

Both builds reached `:createMinecraftArtifacts`, completed the earlier NFRT stages, then failed at `decompile` while running `org.vineflower:vineflower:1.10.1`. NeoForm Runtime reported `Node action for decompile failed`, and the Java tool exited `1`. The warm-cache retry reproduced the same failure. The retained decompiler console ends with mapping warnings and does not establish the fatal root cause. No production JAR resulted from these failed builds.

### Evidence integrity and repair

Finalized `SHA256SUMS` deterministically covers 9 files; `shasum -a 256 -c` reported 9/9 OK. All 10 evidence files were observed as mode `0444`, and the directory as `0555`, making the finalized evidence read-only.

Next repair: diagnose the Vineflower/NFRT decompiler exit using its full console, exact inputs, and resource behavior before changing anything or retrying again. A third blind retry is not qualification evidence.

The rerun under `/Users/luxvtz/.local/share/voxellume/evidence/neoforge-1.21.1-r1-20261107T000410Z/` verified exact wrapper JAR and Gradle 9.2.1 ZIP hashes plus offline `distributionSha256Sum`, then reproduced `OOMKilled=true` on the initial build and a targeted 256 MiB Gradle-heap retry. NFRT forces at least `-Xmx4096m` for Vineflower inside the 4 GiB container. GameTest and production-JAR checks were unavailable; all 27 `SHA256SUMS` entries verified and no check containers remain. The pack remains `candidate` with unchanged versions.
