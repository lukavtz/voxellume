# Minecraft Java 1.21.3 target qualification

Qualification transaction: `matrix-1.21.3-r1-20261107T183000Z`.

All runs used JDK 21, Linux/arm64, 2 CPUs, 4 GiB memory, 512 PIDs, dropped capabilities, `no-new-privileges`, a read-only root filesystem, and isolated project/Gradle storage. Template archive hashes matched the frozen pack inputs. Exact argv, exit records, logs, input hashes, artifact hashes, screenshots, and cleanup records are in the transaction evidence bundle.

## Outcomes

| Loader   | Pack                      | Outcome     | Observed evidence                                                                                                                                                                         |
| -------- | ------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fabric   | `java-fabric-1.21.3-r2`   | `candidate` | Tasks, clean build, configured server GameTest, negative control, dedicated server, production-JAR server, real client, and reviewed main-menu capture passed. Visual remains incomplete. |
| NeoForge | `java-neoforge-1.21.3-r1` | `rejected`  | Tasks passed. Clean build was OOM-killed in `createMinecraftArtifacts` during Vineflower 1.10.1 decompilation. Runtime and production-JAR checks were not run.                            |
| Forge    | `java-forge-1.21.3-r1`    | `rejected`  | Task discovery and clean build failed in ForgeGradle Mavenizer decompilation with MCP exit 137. Runtime and production-JAR checks were not run.                                           |
| Quilt    | `java-quilt-1.21.3-r2`    | `candidate` | Tasks, clean build, dedicated server, pristine production-JAR server, real client, and reviewed main-menu capture passed. GameTest is not required. Visual remains incomplete.            |

No pack is `supported`; none declares an evidence manifest. Rejected packs contain no template or executable verification commands.

## Exact-pin revision repairs

Fabric r1 pinned Loom `1.20.0-alpha.19`. Both task discovery and clean build failed because that artifact requires JVM 25. Fabric r2 keeps Minecraft `1.21.3`, Loader `0.20.1`, Fabric API `0.114.1+1.21.3`, Mojang mappings, Gradle `9.8.2`, and the template revision unchanged, and pins Loom `1.17.21`. Its official module declares JVM 21 and Gradle API 9.5.0.

Quilt r1 used Gradle `8.9`. Quilt Loom `1.15.1` declares Gradle API 9.2.0, so task discovery and clean build failed during plugin resolution. Quilt r2 keeps Minecraft `1.21.3`, Loader `0.20.0-beta.9`, Quilt Mappings `1.21.3+build.8`, Loom `1.15.1`, and the template revision unchanged, and pins Gradle `9.2.1`. The template uses Loader's `PreLaunchEntrypoint`; no QSL or QFAPI dependency was introduced.

## Production artifacts

| Loader | Production JAR SHA-256                                             | Bytecode |
| ------ | ------------------------------------------------------------------ | -------- |
| Fabric | `e425c03e748fe26dd1705afe51b275be967a36d4b9180052faa575d60ea457c2` | major 65 |
| Quilt  | `ef224bfd1b70ca8cd2750fe62aba62210bdb434efd6c760ac6d09ae44949cf1d` | major 65 |

The Fabric JAR contains no GameTest classes or resources. Both production servers loaded their JAR and reached `Done`. Their supervisors later timed out and cleaned up the containers; these are startup passes, not graceful-shutdown passes.

## Visual review

`fabric-main-menu.png` and `quilt-main-menu.png` are real 1280×720 Xvfb/llvmpipe captures. They show the Minecraft 1.21.3 main menu with the respective modded Loader labels. No world, inventory, hand, placed-block, alternate GUI-state, or animation capture was collected. Therefore both visual capabilities remain `false` and both packs remain candidates.

Narrator and OpenAL devices were unavailable. No sound or complete client-log-cleanliness claim is made.

## Failure evidence

- Fabric r1: `fabric-tasks.log`, `fabric-clean-build.log`.
- NeoForge r1: `neoforge-tasks.log`, `neoforge-clean-build.log`, `neoforge-clean-build-container-state.json` (`OOMKilled=true`).
- Forge r1: `forge-tasks-complete.log`, `forge-clean-build.log` (decompilation exit 137).
- Quilt r1: `quilt-r1-tasks.log`, `quilt-r1-clean-build.log` (Gradle API mismatch).

Final per-loader results are `fabric-result.json`, `neoforge-result.json`, `forge-result.json`, and `quilt-result.json`. `SHA256SUMS` covers the evidence bundle with relative paths only.
