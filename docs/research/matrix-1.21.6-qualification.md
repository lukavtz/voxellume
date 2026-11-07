# Minecraft 1.21.6 target qualification

Date: 2026-11-07.

Evidence root: `~/.local/share/voxellume/evidence/matrix-1.21.6-r1-20261107T183303Z/`.

## Outcomes

No 1.21.6 pack is `supported`; every pack remains `candidate` and has no `evidenceManifest`.

| Pack                      | Outcome     | Final `packSha256`                                                 | Observed qualification                                                                                                                                                                                         |
| ------------------------- | ----------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `java-fabric-1.21.6-r2`   | `candidate` | `230b79fb0e95827bbeec30944a27738f0ee34548144bd0b8deeefa5654f50cbd` | Task discovery, clean build, development and packaged production servers, positive GameTest, negative control, and real-client rendering passed. Full visual matrix did not pass.                              |
| `java-neoforge-1.21.6-r1` | `candidate` | `80eccabfcb474bf5afe5b67b4200900f9ad34c0feb190e056fc28de3b209d778` | Task discovery, clean binary-patch builds, development and packaged production servers, two positive GameTests, negative control, and real-client rendering passed. Full visual matrix did not pass.           |
| `java-forge-1.21.6-r1`    | `candidate` | `ad01f60d2e810c0de5dd43751708af1a3e748e5221b95215a11f551c2d9f83ce` | Task discovery, clean build, development and resumed packaged production servers, and real-client rendering passed. Exact Forge source disables GameTestServer; full visual matrix did not pass.               |
| `java-quilt-1.21.6-r2`    | `candidate` | `91a2021a28d0aa9339e2447ef4f5c9792f01485e5a629f7eb1fa4d8fce1c39a5` | R2 task discovery, clean build, development and packaged production servers passed. Client remained in `downloadAssets`; two black captures were rejected. No GameTest is configured by this loader-only pack. |

`pack-validation.json` records successful `loadTargetPacks` validation of all four final targets.

## Immutable inputs and sandbox

Minecraft `1.21.6` is obfuscated, uses Java 21, data pack 80, and resource pack 63. Release JSON SHA-256 is `54430494f932b1bf9c7129ee6964e1ce43d8bcb2e1c501d25be99a303143648f`. Client mappings SHA-256 is `2ff82b34ce5f849aaafdff51e23b9448c4263881238b780a441fe1061a6fc261`; server mappings SHA-256 is `c6fe95810b05dfec19fdbdfb8cbbb8f976923f7cb16fcc828a0b605a49d2c492`.

All executions used Linux/arm64, JDK 21, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, bounded tmpfs, isolated Gradle homes, argument-array spawning, and a 16 MiB output cap. `commands.log`, `*.status.json`, and `*-container-state.json` retain argv, timestamps, exit codes, and inspections. Existing EULA and official-network approvals were reused. Production server directories and owned containers/volumes were removed; development run directories remain as evidence. `cleanup.json` records final cleanup.

## Fabric r2

Exact inputs are Loader `0.20.1`, Fabric API `0.128.2+1.21.6`, official Mojang mappings, Gradle `9.8.2`, Loom `1.17.21`, and template `FabricMC/fabric-example-mod@a7bb07a7f6d0ef001a8b9d3150f475c80ce9d25a`. Template, loader, API, and mapping hashes independently match the pack.

R1 used exact Loom `1.20.0-alpha.19`; `fabric-r1-tasks.log` records its JVM 25 requirement under required JDK 21. R2 changes only the Loom pin to `1.17.21`. Its fixture-free reviewed template is under `target-packs/java/fabric/1.21.6/templates/`.

`fabric-r2-tasks.log` and `fabric-r2-clean-build.log` pass. `fabric-r2-server.log` reaches `Done`. `fabric-r2-gametest-positive.log` records `VOXELLUME_TEST_PASSED=mod_loaded` and all required tests passing. The negative run preserves the positive pass and reports only the deliberate failure.

The initial pristine production launch lacked Fabric API; that failure remains in `fabric-production-server.log`. With exact Fabric API installed, `fabric-production-server-repair1.log` loads `modid 1.0.0` and reaches `Done`. Production JAR: `artifacts/fabric/modid-1.0.0.jar`, SHA-256 `87971ebada3e64502e3b75ac99d434d390bcf39bd1647d2efaca412b81cb1557`. Its inventory contains no GameTest classes or resources.

The first visual fixture used an older Screenshot signature and failed compilation. The corrected client rendered, but the title hook did not fire on the accessibility-onboarding screen. `artifacts/visual/fabric/main-menu.png` is the reviewed external X11 capture: a legible 1280x720 accessibility screen, not a full visual matrix. `client:true` and `visual:false` are intentional.

## NeoForge r1

Exact inputs are NeoForge `21.6.20-beta`, Parchment `1.21.6` / `2025.06.29`, MDG `2.0.148`, Gradle `9.2.1`, and template `NeoForgeMDKs/MDK-1.21.6-ModDevGradle@604cac56dceff69b85116ec3e14d4e2e5903ab0e`. Universal, installer, Parchment, and template hashes match.

The initial binary-patch wiring placed `version` outside `enable`; `neoforge-tasks.log` retains that failure. The repaired template puts `version` and `disableRecompilation=true` inside `enable`. `neoforge-tasks-repair1.log`, `neoforge-clean-build.log`, and fixture-free `neoforge-production-clean-build.log` pass. The reviewed template is under `target-packs/java/neoforge/1.21.6/templates/`.

`neoforge-server.log` and `neoforge-production-server.log` reach `Done`; production loads Example Mod 1.0.0 and NeoForge 21.6.20-beta. Production JAR: `artifacts/neoforge/examplemod-1.0.0.jar`, SHA-256 `7f98e6fef4e3644c8e75d1e464162cc4940b6c193255767f95df8d0eae78e40f`.

The retired annotation fixture failed compilation because 1.21.6 uses registry-driven GameTests. The exact `RegisterGameTestsEvent` repair passes `registry_and_item` and `place_example_block` in `neoforge-gametest-positive-repair1.log`. The negative run preserves both positive passes and reports only `deliberate_negative_control`.

`artifacts/visual/neoforge/main-menu.png` is a reviewed 1280x720 accessibility-onboarding capture. It does not qualify inventory, hand, world, animation, persistence, multiplayer, clipping, or z-fighting scenarios. `visual:false` is intentional.

## Forge r1

Exact inputs are Forge `56.0.9`, official Mojang mappings, ForgeGradle `6.0.54`, Gradle `8.12.1`, and the exact official MDK. The MDK range was pinned to `6.0.54`; Gradle and fork heaps were bounded to 3 GiB inside the 4 GiB sandbox. The reviewed template is under `target-packs/java/forge/1.21.6/templates/`.

`forge-tasks.log`, `forge-clean-build.log`, and `forge-production-clean-build.log` pass. `forge-server.log` reaches `Done`. The first packaged install timed out during data extraction. The resumed exact install completed checksum validation and `forge-production-server-repair1.log` loads Example Mod with Forge 56.0.9 and reaches `Done`. Final production JAR: `artifacts/forge/examplemod-1.0.0.jar`, SHA-256 `c3f515c28b5188940648e9ff73173d3eb4d892e3468a2c363d57d01af366a60f`.

GameTest is not claimed. The MDK task first launched a normal dedicated server. Setting `net.minecraftforge.gametest.GameTestMain` then failed with unrecognized `launchTarget` despite Gradle exiting zero. Exact `inputs/forge-1.21.6-56.0.9-sources.jar` contains `patches/net/minecraft/server/Main.java.patch`, where GameTestServer creation is commented out with `TODO: [Forge][GameTest] URGENT !!! FIX GAME TESTS !!!`. No positive or negative-control success is fabricated.

`artifacts/visual/forge/main-menu.png` is a reviewed 1280x720 accessibility-onboarding capture. `client:true` and `visual:false` are intentional.

## Quilt r2

Exact Loader `0.20.0-beta.9`, Quilt Mappings `1.21.6+build.6:intermediary-v2`, Loom `1.15.1`, generic template `9a6f89cd481e3f58f128596b5b043353bee6b3f2`, and Gradle `9.2.1` hashes were matched. Quilt Meta profile has exact `inheritsFrom: 1.21.6` and response SHA-256 `3a932820ef21ef8e9adb4dccd7d5e6fea175456d73628cfa948ad10f63d777b3`. No QSL or QFAPI dependency is declared; the loader `PreLaunchEntrypoint` is used instead.

R1 Gradle 8.9 failed because Loom 1.15.1 declares Gradle plugin API 9.2.0. R2 changes only Gradle to 9.2.1. `quilt-r2-tasks.log` and `quilt-r2-clean-build.log` pass. `quilt-r2-server.log` reaches `Done`.

The first packaged launch used the installer’s nested `server/` layout incorrectly. `quilt-production-server-repair1.log` uses that observed layout, loads `example_mod 1.0.0+1.21.6`, and reaches `Done`. Production JAR: `artifacts/quilt/example_mod-1.0.0+1.21.6.jar`, SHA-256 `1254d9639d0107797b5fb5c8fcb937711eafa7feef5a94b6925c396abc2d88c6`.

The client remained in `downloadAssets` until its 300-second bound. Both 1280x720 captures are uniformly black and rejected in `quilt-visual-review.json`. `client:false` and `visual:false` are intentional.

## Integrity

Final pack JSON and reviewed templates are copied under `final-packs/`. The final report is copied into the evidence root as `matrix-1.21.6-qualification.md`. `SHA256SUMS` uses relative evidence paths only, includes that report, and excludes itself. Every entry was verified with `shasum -a 256 -c SHA256SUMS` before the evidence directory was sealed read-only.
