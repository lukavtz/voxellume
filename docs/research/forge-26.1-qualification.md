# Forge 26.1 qualification

Date: 2026-11-07.

## Result

`java-forge-26.1-r1` is **`rejected`**. Task discovery and the clean build both failed during root-project configuration. No production JAR exists. Dedicated-server, configured GameTest, negative harness control, real-client, pristine production-JAR runtime, and target visual checks were not executed and cannot pass.

Evidence root: `~/.local/share/voxellume/evidence/forge-26.1-r1-20261107T180000Z/`.

Evidence manifest: `result.json`; bundle digests are in `SHA256SUMS`. Final `packSha256` is `5628f0adb32c26bc2f079b0dbcf716af8b0a09246402b2348b5bdef8cbb6f546`.

## Exact inputs

| Input         | Value                                            | SHA-256                                                                         |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Minecraft     | `26.1`, unobfuscated, Java 25                    | release JSON `7680e85c9aee9cea1ec41370d9e7e93fbd1d527f88f8edbf7ec736f3184a9533` |
| Forge         | `net.minecraftforge:forge:26.1-62.0.9:installer` | `b18b0fd7a28d2b20a6f623c0bc904a811d7def110b3aa81676e533c3b66c05af`              |
| MDK           | `forge-26.1-62.0.9-mdk.zip`                      | `542ad04b8243b15677781e9b18e994fe9f52728ee5769c5de284da1e2d6b8a17`              |
| ForgeGradle   | `net.minecraftforge:forgegradle:7.0.40`          | `e2f28c83149281d3dba933029597cc8fe85f0f6edd8926ebd6fc27839cb6fbb6`              |
| Gradle        | `gradle-9.3.1-bin.zip`                           | `b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06`              |
| Wrapper JAR   | MDK `gradle-wrapper.jar`                         | `2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`              |
| Forge sources | `forge-26.1-62.0.9-sources.jar`                  | `749572a7dd5c7e041954db9e029f0b14adf0fb2541529ea054769dcbc8d89e65`              |

The official release JSON declares Java major 25. Every downloaded hash matched the pack or official response. The Gradle sidecar matched the pinned distribution. The MDK ForgeGradle range `[7.0.17,8)` was replaced only with exact `7.0.40`; `distributionSha256Sum` was added. No Minecraft, loader, Java, Gradle, plugin, or template version was substituted. `template-hashes.txt` records the materialized files; the rejected pack retains no scaffolding template reference or template tree.

## Mandatory sandbox

Build checks use `eclipse-temurin@sha256:83f4a7fc27df94dcc7b8de04d14cbbba8da14406f921e966969c3b09000aa507` on Linux/arm64 with Temurin `25.0.5+8`. Visual checks use `voxellume/xvfb-jdk25@sha256:1b717618431ee56dbfc4ec12ecb55bf1344b571f58f565976a653ada47c687cb`, `DISPLAY=:99`, and `LIBGL_ALWAYS_SOFTWARE=1`.

The common boundary is 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, a 512 MiB executable `nosuid,nodev` `/tmp` tmpfs, isolated `HOME` and `GRADLE_USER_HOME`, no Docker socket, and no credentials. Output retention is capped at 16 MiB per check. Build and runtime timeouts are 900 and 600 seconds. Cold downloads use only approved official endpoints. The existing EULA approval was read; the approval file is not mounted.

The initial wrapper download ended prematurely before Gradle started. The exact verified distribution was preseeded into the isolated wrapper cache. This network failure is retained separately and is not a target qualification failure.

Mojang's 26.1 metadata declares x64 `natives-linux` artifacts. For the Linux/arm64 visual container, eight exact LWJGL `3.4.1` `natives-linux-arm64` JARs from Maven Central are hashed in `inputs/lwjgl-arm64/provenance.json` and extracted only into the isolated qualification home. `JAVA_TOOL_OPTIONS=-Dorg.lwjgl.librarypath=/home/gradle/lwjgl-arm64` selects them without changing the template or production JAR dependencies.

## Fixtures

The official MDK is minimal and contains no example mod source. Qualification prepared a temporary Example Mod, two positive GameTests, and a deliberately failing negative control under `fixtures/`. The required build failed before compilation, so neither positive nor negative GameTest executed and no production fixture was produced.

## Commands and outcomes

The exact Docker boundary and download commands are in `commands.log` and `sandbox.json`.

| Check          | Executed Gradle argv                                       |     Status | Exit | Evidence                                                                  |
| -------------- | ---------------------------------------------------------- | ---------: | ---: | ------------------------------------------------------------------------- |
| Task discovery | `./gradlew --no-daemon --console=plain --info tasks`       | **failed** |  `1` | `tasks.status.json`, `tasks-service.log`                                  |
| Clean build    | `./gradlew --no-daemon --console=plain --info clean build` | **failed** |  `1` | `clean-build.status.json`, `clean-build.log`, `decompile-clean-build.log` |

Task discovery ran for 7 minutes 38 seconds and failed before listing tasks. Clean build used `--network=none`, ran for 39 seconds, and failed at the same decompilation prerequisite. Neither log reached the 16 MiB output cap. Earlier wrapper/network and externally interrupted setup attempts are retained separately and make no qualification claim.

## Diagnosis

ForgeGradle 7.0.40 invoked Minecraft Mavenizer 0.5.21. Its Vineflower 1.11.2 decompile step declares `JVMArgs: '-Xms4G'`. Both runs ended with MCP step exit 137 inside the 4 GiB container. A 4 GiB initial decompiler heap cannot coexist with Gradle, Mavenizer, and container overhead under that limit. Official MCP config `26.1-20260326.105027` has SHA-256 `4f4619905579e6b94e2ecd162df6eb601a7564f8dc38e4280e5e5fe95728b338` and declares no heap override; Mavenizer supplied `-Xms4G`. No heap workaround or version change was attempted.

`build/libs` does not exist. `artifact-inventory.json` records zero production JARs. `build-reports.tar.gz` preserves the generated configuration-cache and problems reports.

## Unexecuted required gates

- **Server:** unavailable; build failed before runtime classes or a production JAR existed. Existing EULA approval was read but unused by a launched server.
- **GameTest and negative control:** unavailable; build failed before the configured test task or deliberately failing harness control could run.
- **Client:** unavailable; build failed.
- **Production-JAR runtime and pristine install:** unavailable; no production JAR exists, so the installer was not run.
- **Visual:** unavailable; no built client exists. The pinned JDK25 image independently passed Xvfb and llvmpipe OpenGL 4.5/GLES 3.2 checks, but no target visual success is inferred.

No matching containers remained afterward. `result.json` records every final status and `SHA256SUMS` covers the finalized evidence bundle. The evidence directory and files are read-only. Promotion requires a real decompile/resource fix within approved limits followed by the full required build/server/GameTest/negative-control/client/production-JAR/pristine-install/visual evidence matrix.
