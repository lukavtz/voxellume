# Fabric 26.1 r1 qualification

Date: 2026-11-07.

## Disposition

`java-fabric-26.1-r1` remains **`candidate`**. Build, dedicated server, configured server GameTests, production-JAR installation, and reviewed visual surfaces passed. Client behavior and rendering executed, but both client paths exited 134 in `libopenal.so` during shutdown. Client capability is false; no `supported` claim is made.

Evidence root: `~/.local/share/voxellume/evidence/fabric-26.1-r1-20261107T173000Z/`.

Manifest: `result.json`, SHA-256 `117ec257e2312fcdc1230a7915dbd03272cd9f2f4eb00ef06b98cef347f81f3b`.

## Immutable inputs

- Minecraft `26.1`, unobfuscated, data pack 101.1, resource pack 84; no mappings or Intermediary.
- Fabric Loader `0.20.1`, Fabric API `0.145.1+26.1`.
- Java/Gradle JVM, toolchain, and release 25; Gradle wrapper `9.8.2`.
- Plugin `net.fabricmc.fabric-loom:1.20.0-alpha.19`.
- Template `FabricMC/fabric-example-mod@963826fd464ed2982680659d25623bdcfb4aa002`.
- Template ZIP SHA-256 `120409d9e389ebde56ea30f9cab27ab479937c21a0e0e1b3fade2ad31ac90db5`.
- Wrapper JAR SHA-256 `3b8a25775a69158b5ad2b1d17a80a88dc7b40a352a73eb27d06c612a7ce68e98`.
- Container `voxellume/xvfb-jdk25:20261107`, image ID `sha256:1b717618431ee56dbfc4ec12ecb55bf1344b571f58f565976a653ada47c687cb`.

`template-overrides.diff` contains only the exact Loom override and test-only `fabricApi.configureTests` addition. The ordinary template implementation remained unchanged. `tasks-clean.log` identifies Loom alpha19 and `jar`; `remapJar` is absent. GameTest logs explicitly record `Mappings not present!`.

## Mandatory sandbox

Every Gradle/game invocation used 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, a read-only root, a 512 MiB executable `/tmp` tmpfs, and user `1000:1000`. Exact Docker argv is in `commands.json`; Docker state is in each `*-container-state.json`. The isolated Gradle volume was removed after evidence capture.

The initial `tasks` run failed before Gradle because the new named volume was root-owned. A separate trusted `chown` initialized the empty volume. `tasks-clean` then passed. The failed setup is retained and is not counted as a passed check.

## Executed checks

| Check                      | Gradle/process argv                                       | Result                   | Evidence                                                 |
| -------------------------- | --------------------------------------------------------- | ------------------------ | -------------------------------------------------------- |
| Task discovery             | `./gradlew --no-daemon --console=plain tasks --all`       | passed, exit 0           | `tasks-clean.log`, `tasks-clean.status.json`             |
| Clean build                | `./gradlew --no-daemon --console=plain clean build`       | passed, exit 0           | `clean-build.log`, `clean-build.status.json`             |
| Server GameTests           | `./gradlew --no-daemon --console=plain build`             | passed, exit 0           | `gametest-positive.log`, `gametest-positive.status.json` |
| Negative control           | `./gradlew --no-daemon --console=plain build`             | expected failure, exit 1 | `gametest-negative.log`, `gametest-negative.status.json` |
| Dedicated server           | `./gradlew --no-daemon --console=plain runServer`         | passed, exit 0           | `server.log`, `server.status.json`                       |
| Client GameTests           | `./gradlew --no-daemon --console=plain runClientGameTest` | failed, exit 1 / JVM 134 | `client-gametest.log`, `client-gametest-null-audio.log`  |
| Real client                | `./gradlew --no-daemon --console=plain runClient`         | failed, exit 1 / JVM 134 | `client.log`, `client.status.json`                       |
| Pristine production server | `java -Xmx1G -jar server.jar nogui`                       | passed, exit 0           | `pristine-server.log`, `pristine-server.status.json`     |

The positive server GameTest ran through `build` after `fabricApi.configureTests`. It logged `VOXELLUME_TEST_PASSED=mod_loaded` and `All 2 required tests passed :)`. The deliberate negative control logged `VOXELLUME_NEGATIVE_CONTROL`, `1 required tests failed :(`, and `BUILD FAILED`, proving failures propagate.

The dedicated server used the existing EULA approval for `https://www.minecraft.net/en-us/eula`. It loaded `modid 1.0.0`, logged `Hello Fabric world!` and `Done (6.303s)!`, accepted `stop`, and finished with `BUILD SUCCESSFUL`.

## Production JAR and pristine installation

The ordinary `jar` task produced:

- `modid-1.0.0.jar`, SHA-256 `8b186f1a502b4cb93fd8d86fca3317365c656569575c933a90e9f83d1203d41d`;
- `modid-1.0.0-sources.jar`, SHA-256 `e460485c87820e329ccc7a4f842e036fb947d758c179b2d2d26b58f5258ec743`.

`production-jar-contents.txt` and `production-fabric.mod.json` record the package. GameTest sources and entrypoints are absent.

The pristine installation used exact Fabric server launcher `1.1.2` SHA-256 `16362327e8ee631d9a00667ac535b41645185ed87d9712f740736f562ac62eca`, Fabric API SHA-256 `f80ee0909d820649d5b1b31c74f2ebd503530a0ed163447a4a5779b9fbe8716e`, and the production JAR above. The server loaded `modid 1.0.0`, logged `Hello Fabric world!` and `Done (5.487s)!`, then stopped cleanly with exit 0.

## Client and visual result

The client GameTest created a singleplayer world, logged `VOXELLUME_CLIENT_TEST_PASSED=singleplayer_world`, and captured `screenshots/client-gametest-world.png`. It then crashed during shutdown in `libopenal.so`. `ALSOFT_DRIVERS=null` did not prevent the same crash. No third attempt was made.

The real client displayed `Minecraft 26.1 (Modded)`, created seed `1122334455`, and rendered first-person world/hand, inventory, movement, and pause GUI states. These captures were reviewed and are indexed by `visual-scenario.json`. The ordinary template has no custom animated asset; the movement capture records live first-person rendering rather than claiming a custom animation test. Visual capability is true for those reviewed surfaces.

Saving and quitting returned to the modded main menu. Quitting then produced the same `libopenal.so` JVM shutdown crash. The visual evidence does not override the failed process exits: client remains false and the target remains candidate.

`result.json`, exact command records, logs, container states, fixture sources, input artifacts, production artifacts, screenshots, and `SHA256SUMS` form the finalized evidence bundle. No containers or named writable volumes remain.
