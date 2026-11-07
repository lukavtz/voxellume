# Minecraft 1.21.4 target qualification

Date: 2026-11-07.

Evidence root: `~/.local/share/voxellume/evidence/matrix-1.21.4-r1-20261107T190000Z/`.

## Outcomes

No 1.21.4 pack is `supported`.

| Pack                      | Outcome     | Final `packSha256`                                                 | Observed qualification                                                                                                                                                                                             |
| ------------------------- | ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `java-fabric-1.21.4-r2`   | `candidate` | `92af9d4b9bc671bcf87ec1073a5d81f894ecbbd400fc13294049644e403202b9` | Task discovery, clean build, development and packaged production servers, positive GameTest, and negative control passed. Client and full visual checks did not pass.                                              |
| `java-neoforge-1.21.4-r1` | `candidate` | `a5946d00fa4ccf342faf9737e5de4d591bc5c8ef7077cbad8643490ee215b1bc` | Task discovery, clean binary-patch builds, development and packaged production servers, two positive GameTests, negative control, and real-client accessibility rendering passed. Full visual matrix did not pass. |
| `java-forge-1.21.4-r1`    | `rejected`  | `4ea5ec7358636a8c7d83f1b4b90fe3048425c7a754a331a176078367f7f10c87` | Task discovery and clean build failed during decompilation with exit 137. No runtime or visual claim.                                                                                                              |
| `java-quilt-1.21.4-r2`    | `candidate` | `6f208732b939a93606c8475af4dbe6ff0cd1f9c4475feb9fb84fcf7f55dd21e7` | R1 task discovery proved Gradle 8.9 incompatible with Loom 1.15.1. R2 task discovery was stopped before a result during wrap-up. No build/runtime/visual capability is claimed.                                    |

`pack-validation.json` records successful `loadTargetPacks` validation of all four final targets. No `evidenceManifest` is declared.

## Immutable inputs and sandbox

Minecraft `1.21.4` is obfuscated, uses Java 21, data pack 61, and resource pack 46. The release JSON SHA-256 is `110a9db5df120e614728e248ee0d705af07438d1de1d261bc7c3c85d17cf8e12`. Client mappings SHA-256 is `48b502ccc5e855b49da8aa9c0c0d7c565bec54c9f5da3a3664528aff7b9fdf23`; server mappings SHA-256 is `dae4a75ad2ca1d52d14e9c080e70e7fbb2888c3533c015ea2d970b2a15856639`.

All executions used Linux/arm64, JDK 21, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, bounded tmpfs, isolated Gradle homes, argument-array process spawning, and a 16 MiB output cap. Exact argv, logs, timestamps, exit codes, and container inspections are in `commands.log`, `*.status.json`, and `*-container-state.json`. Existing EULA and official-network approvals were reused. All 31 owned containers and four owned Gradle volumes were removed; `cleanup.json` records cleanup.

## Fabric r2

Exact inputs are Loader `0.20.1`, Fabric API `0.119.4+1.21.4`, official Mojang mappings, Gradle `9.8.2`, Loom `1.17.21`, and template `FabricMC/fabric-example-mod@db83693c14b0c6aba79669b9af0b4a6ffb208ab6`. Loader, API, template, Loom JAR/module/plugin-marker, wrapper distribution, and wrapper JAR hashes were independently matched.

R1 used exact Loom `1.20.0-alpha.19`; `fabric-tasks.log` and `fabric-clean-build.log` retain its JVM 25 requirement under the target's JDK 21. R2 changes only the Loom pin to `1.17.21`. Its template is materialized under `target-packs/java/fabric/1.21.4/templates/` without test fixtures.

`fabric-r2-tasks.log` and `fabric-r2-clean-build.status.json` pass. `fabric-r2-server.log` loads Minecraft 1.21.4, Loader 0.20.1, Fabric API 0.119.4+1.21.4, and `modid`, then reaches `Done`. The production server loads the packaged JAR and reaches `Done` in `fabric-production-server-repair1.log`; the earlier missing-`server.jar` attempt remains retained.

The GameTest fixture initially used the retired `structures` directory and wrong namespace. Those failures remain in `fabric-r2-gametest-positive.log` and `fabric-r2-gametest-positive-repair1.log`. The 1.21.4 `data/modid-gametest/structure/empty.nbt` repair passes in `fabric-r2-gametest-positive-repair2.log` with `VOXELLUME_TEST_PASSED=mod_loaded` and `All 1 required tests passed`. The negative run preserves that positive pass and reports one deliberate failure in `fabric-r2-gametest-negative.log`.

Production JAR: `artifacts/fabric/modid-1.0.0.jar`, SHA-256 `b510c586675b6232edd80bd122860269a4043e1c629f82d9fca70f6211d93289`.

Three client attempts remained at `downloadAssets`. `main-menu.png` and `main-menu-initialized.png` were reviewed and rejected as uniformly black. The final capture was stopped during wrap-up. `client:false` and `visual:false` are intentional.

## NeoForge r1

Exact inputs are NeoForge `21.4.161`, Parchment `1.21.4` / `2025.03.23`, MDG `2.0.148`, Gradle `9.2.1`, and template `NeoForgeMDKs/MDK-1.21.4-ModDevGradle@36a58e77b4ac9ff8bcb23da22f4c02333ccc154b`. Loader universal, installer, Parchment, template, wrapper distribution, and wrapper JAR hashes were independently matched.

The initial build failed in Vineflower decompilation. The repaired template uses MDG's official `enable { disableRecompilation = true }` binary patch pipeline. `neoforge-clean-build-repair2.log` records `Creating Minecraft artifacts without recompilation` and `BUILD SUCCESSFUL`; the incorrect direct-extension wiring attempt remains in `neoforge-clean-build-repair1.log`. The final fixture-free build also passes. The reviewed template is materialized under `target-packs/java/neoforge/1.21.4/templates/`.

`neoforge-server.log` reaches `Done` with Example Mod and NeoForge 21.4.161. `neoforge-production-server.log` discovers `mods/examplemod-1.0.0.jar` and reaches `Done`. The production-server JAR SHA-256 is `7f9dcc29dfc61301eb298584fdcda3305eab0ca9d6caa44d540b586fd2b42926`. The final clean-build JAR SHA-256 is `307bab7a4c467d3dcae96524d5fb44a7753da0146db851c6ca28f9f0682a61cd`; its contents contain no GameTest fixtures.

The initial GameTest compile failure records the 1.21.4 registry API returning `Optional<Reference<Item>>`. The repaired fixture passes `registry_and_item` and `place_example_block` in `neoforge-gametest-positive-repair1.log`. The negative run preserves both positive passes and reports `deliberate_negative_control` as the only failure.

The real client loaded Example Mod and LWJGL 3.3.3+5. `artifacts/visual/neoforge/main-menu.png` is a reviewed 1280x720 accessibility onboarding capture with legible controls. It does not qualify the main menu, packaged-JAR client, world, inventory, hand, placed-block, animation, persistence, multiplayer, clipping, or z-fighting scenarios. `visual:false` and candidate status are intentional.

## Forge r1 rejection

The official MDK `1.21.4-54.1.22` was pinned from ForgeGradle `[7.0.3,8)` to exact `7.0.40`. Both `forge-tasks.log` and `forge-clean-build.log` fail in MCP config `1.21.4-20241203.143248` decompilation with exit 137. Official `mcp_config-1.21.4-20241203.143248.zip` SHA-256 is `4ab389a224f2f07549ad3e808e936454f9f2b270fcea5dacfb978d449079d330`; its Vineflower 1.10.1 function requests `-Xmx4G`, incompatible with the mandatory shared 4 GiB container. No production JAR was produced, and downstream checks were not run. The rejected pack has no template or executable verification commands.

## Quilt r2

Exact Loader `0.20.0-beta.9`, Quilt Mappings `1.21.4+build.5:intermediary-v2`, Loom `1.15.1`, and generic template `9a6f89cd481e3f58f128596b5b043353bee6b3f2` hashes were matched. Quilt Meta profile `quilt-loader-0.20.0-beta.9-1.21.4` has exact `inheritsFrom: 1.21.4` and response SHA-256 `67de5ec689439d672a91cefde7cad7a7ddd2f7f5a84d23b54599de438f9e7b2a`. No QSL or QFAPI dependency is declared.

R1 Gradle 8.9 failed because Loom 1.15.1 declares Gradle plugin API 9.2.0. R2 changes only Gradle to exact `9.2.0` with distribution SHA-256 `df67a32e86e3276d011735facb1535f64d0d88df84fa87521e90becc2d735444`. The r2 task-discovery container was stopped before a result during wrap-up. Therefore r2 remains a candidate with no executable capability claims, no production JAR SHA, and no supported qualification.

## Integrity

The original manifest is preserved as `SHA256SUMS.initial`. The final report is copied into the evidence root as `matrix-1.21.4-qualification.md`. Final `SHA256SUMS` uses relative evidence paths only, includes that report, and excludes both manifest files. Every final entry was verified with `shasum -a 256 -c SHA256SUMS` before the evidence directory was sealed read-only.
