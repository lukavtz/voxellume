# Forge 1.21.11 qualification

Date: 2026-11-07.

## Result

`java-forge-1.21.11-r1` is finally **`rejected`**. Task discovery and the clean build both failed during root-project configuration. No production JAR exists. Dedicated-server, configured GameTest, negative harness control, real-client, pristine production-JAR runtime, and visual checks were not executed and cannot pass.

Evidence root: `~/.local/share/voxellume/evidence/forge-1.21.11-r1-20261107T161725Z/`.

Evidence manifest: `result.json`, SHA-256 `136f71aaa72dadeba97ab6d62ae212f8c4a0dcef6fa79afa4b8ac805f88c3125`.

## Exact inputs

| Input           | Value                                               | SHA-256                                                                         |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| Minecraft       | `1.21.11`, obfuscated, official mappings            | release JSON `cc717c0d11f2447690a13069401368969671a90d0503d2848b9e4438ae82d866` |
| Forge           | `net.minecraftforge:forge:1.21.11-61.2.4:installer` | `b1c3ee57baded63f7591293134ff079b69cacef3317d2e6783b28d92cfdc2bf4`              |
| MDK             | `forge-1.21.11-61.2.4-mdk.zip`                      | `e1b9cd94390af7ab82bbf49b293337f739e92f78ce81c5e44fb84a0e582dd4fc`              |
| ForgeGradle     | `net.minecraftforge:forgegradle:7.0.40`             | `e2f28c83149281d3dba933029597cc8fe85f0f6edd8926ebd6fc27839cb6fbb6`              |
| Gradle          | `gradle-9.5.0-bin.zip`                              | `553c78f50dafcd54d65b9a444649057857469edf836431389695608536d6b746`              |
| Wrapper JAR     | MDK `gradle-wrapper.jar`                            | `497c8c2a7e5031f6aa847f88104aa80a93532ec32ee17bdb8d1d2f67a194a9c7`              |
| Client mappings | Mojang `client.txt`                                 | `517799a8485e107e932dc1bd27c002b2d0b9207eb2396b685bcfe6c3321a9fbd`              |
| Server mappings | Mojang `server.txt`                                 | `7ffd98f77f403043748d56467aac287a58f8187a27d5d6b7ebcac70042b02b1c`              |
| MCP config      | `1.21.11-20251223.124241`                           | `1d389d1400f44e51c81487d9fbdd7abc098095129ff415bca9039ab1de252a14`              |

Every downloaded hash matched the target pack or the official response. The official Gradle `.sha256` sidecar also matched. The MDK's ForgeGradle range `[7.0.3,8)` was replaced only with the pack's exact `7.0.40`; `distributionSha256Sum` was added with the pack hash. The extracted `gradlew` required `chmod +x` before launch. Recommended Forge `61.2.4` remained pinned; `61.2.5` was not used. No Minecraft, loader, Gradle, Java, mapping, or template version was substituted.

## Isolation

The build container was `eclipse-temurin:21-jdk@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a`, Linux/arm64, Java `21.0.13+9-LTS`. Docker limits were 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, read-only root, bounded executable tmpfs, isolated `HOME` and `GRADLE_USER_HOME`, no Docker socket, and no credentials. Output retention was capped at 16 MiB per check; neither Gradle check reached the cap. Both had a 900-second timeout. No matching containers remained afterward.

Cold artifact downloads and task dependency resolution used only existing approved hosts. Exact wrapper/plugin inputs and the Foojay JDK were preseeded; `plugins.gradle.org` and `api.foojay.io` were not used by the approved-network task run. Clean build used Docker `--network=none`. The existing EULA approval was read but unused; no server launched and no EULA file was created or changed.

## Commands and outcomes

The complete Docker argv and download commands are in `commands.log`.

| Check                           | Executed Gradle argv                                       |     Status | Exit | Evidence                                                           |
| ------------------------------- | ---------------------------------------------------------- | ---------: | ---: | ------------------------------------------------------------------ |
| Offline task discovery          | `./gradlew --no-daemon --console=plain --info tasks`       | **failed** |  `1` | `tasks.log`; new 1.21.11 artifacts were not cached                 |
| Approved-network task discovery | `./gradlew --no-daemon --console=plain --info tasks`       | **failed** |  `1` | `tasks.json`, `tasks-approved-network.log`, `decompile-tasks.log`  |
| Clean build                     | `./gradlew --no-daemon --console=plain --info clean build` | **failed** |  `1` | `clean-build.json`, `clean-build.log`, `decompile-clean-build.log` |

The approved-network task discovery ran for 490.13 seconds and failed before listing tasks. Clean build ran for 24.07 seconds and failed at the same decompilation prerequisite. An initial launch exited `126` because the extracted wrapper was not executable; this occurred before Gradle started and is recorded in `runner-preflight.json`. No additional task/build retry was made after the required clean build.

## Diagnosis

ForgeGradle 7.0.40 invoked Minecraft Mavenizer 0.5.21. Its Vineflower 1.11.2 decompile step declares `JVMArgs: '-Xms4G'`. Official MCP config `1.21.11-20251223.124241` specifies `-Xmx4G`. Both runs ended with MCP step exit `137` inside the 4 GiB container. A 4 GiB initial decompiler heap cannot coexist with Gradle, Mavenizer, and container overhead under that limit. The first decompile log ends during preprocessing; the second reproduces the same exit. No heap workaround or version change was attempted.

`build/libs` does not exist. `artifact-inventory.json` records zero production JARs. `build-reports.tar.gz` preserves the generated configuration-cache and problems reports.

## Unexecuted required gates

- **Server:** unavailable; build failed before runtime classes or a production JAR existed.
- **GameTest and negative control:** unavailable; build failed before the configured test task or a deliberately failing harness control could run.
- **Client:** unavailable; build failed.
- **Production-JAR runtime and pristine install:** unavailable; no production JAR exists.
- **Visual:** unavailable; no built client exists. The pinned `voxellume/xvfb-jdk21:20261107` image was therefore not launched.

No downstream success is inferred from wrapper verification, artifact hashes, or dependency resolution.

## Pack disposition

`status` is finally `rejected` and `revision` remains `1`. `packSha256` is `ac203aaf9b256ae8b420194b389951723ec1996dbcf40c22b1e483d99135626e`. Executable verification was removed and no capabilities are claimed. `reason.evidence` links the official MCP configuration. Promotion requires a real decompile/resource fix within approved limits followed by the full required build/server/GameTest/negative-control/client/production-JAR/pristine-install/visual evidence matrix.
