# Forge 1.21.1 qualification

Date: 2026-11-07.

## Result

`java-forge-1.21.1-r1` is finally **`rejected`**. Task discovery and the clean build both failed during root-project configuration. No production JAR exists. Dedicated-server, GameTest, real-client, production-JAR runtime, and visual checks were not executed and cannot pass.

Evidence root: `~/.local/share/voxellume/evidence/forge-1.21.1-r1-20261107T152456Z/`.

Evidence manifest: `result.json`, SHA-256 `05cb4d89cedaa3962132ddade7f586aaa5f3d5057d20a71f8a6aeebaa239031c`.

## Exact inputs

| Input           | Value                                               | SHA-256                                                                         |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| Minecraft       | `1.21.1`, obfuscated, official mappings             | release JSON `3636c26c20f1f0b7472ebef1a624ba1a6a2c4b003858c13224929898b5321437` |
| Forge           | `net.minecraftforge:forge:1.21.1-52.1.20:installer` | `6b83521a70aaf5371af8c4c9f97d930d51ec4266ac6ec3bc975182fba2ef9f62`              |
| MDK             | `forge-1.21.1-52.1.20-mdk.zip`                      | `0589cc6748934ca6fdf29cc8e7fb8a08d1133eb5e3baf68e03e910fbdeb0773c`              |
| ForgeGradle     | `net.minecraftforge:forgegradle:7.0.40`             | `e2f28c83149281d3dba933029597cc8fe85f0f6edd8926ebd6fc27839cb6fbb6`              |
| Gradle          | `gradle-9.3.1-bin.zip`                              | `b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06`              |
| Wrapper JAR     | MDK `gradle-wrapper.jar`                            | `2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`              |
| Client mappings | Mojang `client.txt`                                 | `140c47931cccc8fc9e4c22d7603e2d714d1a953a146f51ea7397d95c955536ec`              |
| Server mappings | Mojang `server.txt`                                 | `9d0b04bead421c8229aff14b534432bbc927bea642e7c8593d1276b8df8ba53f`              |

Every downloaded hash matched the target pack or discovery record. The official Gradle `.sha256` sidecar also matched. The MDK's ForgeGradle range `[7.0.3,8)` was replaced only with the pack's exact `7.0.40`; `distributionSha256Sum` was added with the pack hash. No loader, Minecraft, Gradle, Java, mapping, or template version was substituted.

## Isolation

The container was `eclipse-temurin:21-jdk@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a`, Linux/arm64, Java `21.0.13+9-LTS`. Docker limits were 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, read-only root, bounded tmpfs, isolated `HOME` and `GRADLE_USER_HOME`, no Docker socket, and no credentials. Output retention was capped at 16 MiB per check; neither check reached the cap. The build timeout was 900 seconds. No matching containers remained afterward.

The existing EULA approval at `~/.config/voxellume/approvals.json` was read. No server was launched and no EULA file was created or changed.

## Commands and outcomes

The complete Docker argv and download commands are in `commands.log`. The requested and executed Gradle commands were:

| Check          | Executed Gradle argv                                       |     Status | Exit | Evidence                                                           |
| -------------- | ---------------------------------------------------------- | ---------: | ---: | ------------------------------------------------------------------ |
| Task discovery | `./gradlew --no-daemon --console=plain --info tasks`       | **failed** |  `1` | `tasks.json`, `tasks.log`, `decompile-tasks.log`                   |
| Clean build    | `./gradlew --no-daemon --console=plain --info clean build` | **failed** |  `1` | `clean-build.json`, `clean-build.log`, `decompile-clean-build.log` |

Task discovery ran for 482.08 seconds and failed before listing tasks. Clean build used Docker `--network=none`, ran for 23.04 seconds, and failed at the same configuration prerequisite. An initial local runner launch failed with `spawn timeout ENOENT` before any container or Gradle process started; this infrastructure failure is recorded separately in `runner-preflight.json` and is not a Gradle check.

## Diagnosis

ForgeGradle 7.0.40 invoked Minecraft Mavenizer 0.5.21. Its Vineflower 1.10.1 decompile step declares `JVMArgs: '-Xms4G'`. Both runs ended with MCP step exit `137` inside the 4 GiB container. A 4 GiB initial decompiler heap cannot coexist with Gradle, Mavenizer, and container overhead under that limit. The first decompile log ends during preprocessing; the second reproduces the same exit. No heap workaround, version change, or third attempt was made.

`build/libs` does not exist. `artifact-inventory.json` records zero production JARs. `build-reports.tar.gz` preserves the generated configuration-cache and problems reports.

## Unexecuted required gates

- **Server:** unavailable; build failed before runtime classes or a production JAR existed.
- **GameTest:** unavailable; build failed. The exact MDK also has no GameTest annotations or test source set, so even a later bare `runGameTestServer` launch would not by itself establish configured-test coverage.
- **Client:** unavailable; build failed. `DISPLAY` and `WAYLAND_DISPLAY` are unset, and `Xvfb`/`xhost` are absent.
- **Production-JAR runtime and visual:** unavailable; no production JAR or real-client capture route exists.

No downstream success is inferred from the wrapper, artifact hashes, or configuration progress.

## Network-approval limitation

Cold task discovery resolved MDK plugins through `https://plugins.gradle.org/m2/` and downloaded a ForgeGradle-selected JDK 25.0.5 for Mavenizer through `https://api.foojay.io/disco/v3.0/`. Neither host appears in the existing `approvals.json`; no approval was added. The project Gradle JVM and mod toolchain remained Java 21. The separately downloaded ForgeGradle JAR from approved Forge Maven matched the cold-resolved JAR hash.

Therefore this run is **not a compliant approved-network cold qualification**, independently of the build failure. A future cold run needs explicit approvals or a preseeded, hash-pinned approved cache route. The clean build used no network.

## Pack disposition

`status` is finally `rejected` and `revision` remains `1`; executable verification was removed. `knownLimitations` records the observed failures, and `reason.evidence` links the official MCP configuration. Promotion would require a real decompile/resource fix within approved limits, a compliant network route, and the full required build/server/GameTest/client/production-JAR/visual evidence matrix.
