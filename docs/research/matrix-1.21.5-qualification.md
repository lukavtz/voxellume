# Minecraft 1.21.5 target qualification

Date: 2026-11-07.

Evidence root: `~/.local/share/voxellume/evidence/matrix-1.21.5-r1-20261107T181500Z/`.

## Outcomes

No 1.21.5 pack is `supported`.

| Pack                      | Outcome     | Final `packSha256`                                                 | Observed qualification                                                                                                                                                                                                   |
| ------------------------- | ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `java-fabric-1.21.5-r2`   | `candidate` | `7f2947bea35582259f7c1c6f9535108c6258cca71cadf4b6e5d0bec206836e43` | R2 task discovery, clean fixture-free build, development and packaged production servers, positive GameTests, and negative control passed. Client and visual checks did not pass.                                        |
| `java-neoforge-1.21.5-r1` | `candidate` | `49a4c59d21a73a288d318856dfb52a065652ead05366b37daa1e5640e293033c` | Task discovery, clean binary-patch builds, development and packaged production servers, positive GameTests, negative control, and real-client accessibility/main-menu rendering passed. Full visual matrix did not pass. |
| `java-forge-1.21.5-r1`    | `rejected`  | `3ea366f0b01c140f41bbd8b667c0fd940715d49e4a0ffb54bcc72f178894c5d8` | Task discovery and clean build failed during decompilation with Vineflower exit 137. No runtime or visual claim.                                                                                                         |
| `java-quilt-1.21.5-r2`    | `candidate` | `bb406b86ce039150c130dffd12878b01d77afe47138d296576a31b06c6c23e85` | R2 task discovery, clean build, and development and packaged production servers passed. Client and visual checks did not pass.                                                                                           |

`pack-validation.json` records successful `loadTargetPacks` validation of all four final targets. No `evidenceManifest` is declared.

## Immutable inputs and sandbox

Minecraft `1.21.5` is obfuscated, uses Java 21, data pack 71, and resource pack 55. Release JSON SHA-256 is `ea7ff2dbea92fba08b1a7d15412d912d9bcac68c610fe968882c512a8e934196`. Client mappings SHA-256 is `3907657ade3e61bc8cffb4ca0a1bcba15f57986be4e613900947119364a206e5`; server mappings SHA-256 is `ecd2f68afe3333a4db26e1fb1d1c31551c379fef2f3235007fa739f7be038a7c`.

`input-verification.json` records independently fetched and matched release, mappings, loader, API, template, Loom, NeoForge installer, Parchment, Forge installer/MDK/MCP-config, Quilt mappings, and Quilt profile hashes. The Quilt profile has exact `inheritsFrom: 1.21.5` and response SHA-256 `287111c3d7972250f01bd2106a928739fdc6b83676086094277eb13417f2b3a6`.

Executions used Linux/arm64, JDK 21 target settings, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, bounded tmpfs, isolated Gradle homes, argument-array process spawning, and a 16 MiB output cap. Exact argv, logs, timestamps, exit codes, and container inspections are in `commands.log`, `*.status.json`, and `*-container-state.json`. Existing EULA and official-network approvals were reused. Build and runtime limits were 900 and 600 seconds; client captures used shorter bounded runs.

## Fabric r2

Exact inputs are Loader `0.20.1`, Fabric API `0.128.2+1.21.5`, official Mojang mappings, Gradle `9.8.2`, Loom `1.17.21`, and template `FabricMC/fabric-example-mod@a671b9457d66d3fabc3d29b8385f459115958f6c`. R1 Loom `1.20.0-alpha.19` task discovery failed because that plugin requires JVM 25 while this target requires JDK 21. R2 changes only the Loom pin. Its reviewed fixture-free template is materialized under `target-packs/java/fabric/1.21.5/templates/`.

`fabric-r2-tasks.log`, `fabric-r2-clean-build-repair1.log`, and `fabric-final-clean-build.log` pass. The first r2 build retained a stale metadata dependency from the neighboring template; the corrected metadata requires Minecraft `~1.21.5` and the final artifact is identical across the corrected and fixture-free builds. Development and packaged production servers reach `Done` and load `modid`, Loader 0.20.1, Minecraft 1.21.5, and Fabric API 0.128.2+1.21.5.

The 1.21.4 annotation fixture did not compile unchanged. R2 uses `net.fabricmc.fabric.api.gametest.v1.GameTest`, non-static methods, `structure`, and `Component` assertions. `fabric-r2-gametest-positive-repair4.log` records `VOXELLUME_TEST_PASSED=mod_loaded` and all required tests passing. The negative run preserves the positive pass and reports only the deliberate failure.

Production JAR: `artifacts/fabric/modid-1.0.0.jar`, SHA-256 `906547cf8732b95a2008f968e98304c88ccb4cdb07dd681ee18eb14b11d792d5`.

The real client remained at `downloadAssets`. `artifacts/visual/fabric/main-menu.png` was reviewed and rejected as uniformly black. `client:false` and `visual:false` are intentional.

## NeoForge r1

Exact inputs are NeoForge `21.5.101`, Parchment `1.21.5` / `2025.06.15`, MDG `2.0.148`, Gradle `9.2.1`, and template `NeoForgeMDKs/MDK-1.21.5-ModDevGradle@dfe91621947dd3189ea846d0ce8b7a903cbf9149`. The template uses MDG's official `disableRecompilation` binary patch pipeline. `neoforge-tasks.log`, `neoforge-clean-build.log`, and `neoforge-final-clean-build.log` pass without decompilation.

Development and packaged production servers reach `Done` with Example Mod and NeoForge 21.5.101. The initial production-server launch omitted its writable home tmpfs; that infrastructure failure is retained and the repaired launch passes.

The 1.21.5 data-driven fixture registers `Consumer<GameTestHelper>` functions through `BuiltInRegistries.TEST_FUNCTION` and uses `test_instance` JSON plus `examplemod:empty`. `neoforge-gametest-positive-repair1.log` passes `registry_and_item` and `place_example_block`. The negative run preserves both positive passes and reports `deliberate_negative_control` as the only failure. Test classes, registration calls, and data were removed before the final clean build; the final production JAR is identical to the packaged-server artifact.

Production JAR: `artifacts/neoforge/examplemod-1.0.0.jar`, SHA-256 `8e8ca6f76940a2bcd47390912e6e005ab938ca1c29c17773bf9c6e394bd4ba00`.

Reviewed 1280x720 captures show accessibility onboarding and the real main menu with Minecraft 1.21.5, NeoForge 21.5.101, and three mods. They do not qualify the packaged-JAR client, world, inventory, hand, placed-block, animation, persistence, multiplayer, clipping, or z-fighting scenarios. `visual:false` and candidate status are intentional.

## Forge r1 rejection

The official MDK `1.21.5-55.1.18` was pinned from ForgeGradle `[7.0.3,8)` to exact `7.0.40`. Both `forge-tasks.log` and `forge-clean-build.log` fail in MCP config `1.21.5-20250325.155543` decompilation. Vineflower 1.11.1 exits 137. Official `mcp_config-1.21.5-20250325.155543.zip` SHA-256 is `1bce26f59e7bb8ce71f55e9e4397efe804446a8104dd60a5af78bd829bb2ec91`; its decompile function requests `-Xmx4G`, incompatible with the mandatory shared 4 GiB container. No production JAR was produced and downstream checks were not run. The rejected pack has no template or executable verification commands.

## Quilt r2

Exact inputs are Loader `0.20.0-beta.9`, Quilt Mappings `1.21.5+build.10:intermediary-v2`, Loom `org.quiltmc.loom.remap:1.15.1`, Gradle `9.2.0`, and generic template `9a6f89cd481e3f58f128596b5b043353bee6b3f2`. No QSL or QFAPI dependency is declared. R1 Gradle 8.9 failed because Loom 1.15.1 declares Gradle plugin API 9.2.0. R2 changes Gradle and the remap plugin identity while preserving Minecraft, Loader, mappings, and template family.

`quilt-r2-tasks.log` and `quilt-r2-clean-build.log` pass. Development and packaged production servers reach `Done` with Minecraft 1.21.5, Loader 0.20.0-beta.9, and `example_mod`. The initial packaged launch used the installer's parent directory; the repaired script enters its `server/` output directory and passes.

Production JAR: `artifacts/quilt/example_mod-1.0.0+1.21.5.jar`, SHA-256 `fcb85d1e334f376ad4b4d4ae8ec75e2e87306cadb67839e459b565401401c25d`.

The real client remained at `downloadAssets`. `artifacts/visual/quilt/main-menu.png` was reviewed and rejected as uniformly black. `client:false` and `visual:false` are intentional.

## Integrity

`artifact-hashes.json` and `visual-review.json` record final artifact identities and capture decisions. `cleanup.json` records owned container/volume cleanup. Final `SHA256SUMS` uses relative evidence paths only, includes this report copied into the evidence root, and excludes both the manifest and any initial manifest. Every final entry is verified with `shasum -a 256 -c SHA256SUMS` before the evidence directory is sealed read-only.
