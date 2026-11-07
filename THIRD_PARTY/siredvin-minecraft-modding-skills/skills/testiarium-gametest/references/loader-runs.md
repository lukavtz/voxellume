# Loader runs and pinned source integration

## Baseline and support

Use [Minecraft-Modding-Libs commit 86bfe0b75d0dceb26e713a6c3bdcc91ec74eac2c](https://github.com/SirEdvin/Minecraft-Modding-Libs/tree/86bfe0b75d0dceb26e713a6c3bdcc91ec74eac2c) as this skill's source baseline. It declares Testiarium 2.0.0, Stonecutter 0.9.7, Minecraft 1.20.1/1.21.1, and separate common/Fabric/Forge branches. This is not verification of Maven availability, all older Testiarium releases, or newer Minecraft lines.

| Minecraft | JVM target | Fabric API | Forge-family loader | CC:Tweaked |
| --- | --- | --- | --- | --- |
| 1.20.1 | Java 17 | 0.92.3+1.20.1 | Forge 47.1.0 | 1.113.1 |
| 1.21.1 | Java 21 | 0.116.14+1.21.1 | NeoForge 21.1.9 | 1.120.0 |

Read `gradle/libs.versions.toml`, `gradle.properties`, and the applied plugin paths, not only the module README: the pinned Testiarium README still describes 1.20.1. The `forge` branch name does not mean the 1.21.1 adapter uses Forge.

## Current paths, not historical module names

- Common API and generic/CCT source sets: [projects/testiarium/build.gradle.kts](https://github.com/SirEdvin/Minecraft-Modding-Libs/blob/86bfe0b75d0dceb26e713a6c3bdcc91ec74eac2c/projects/testiarium/build.gradle.kts).
- Fabric registration and runs: [projects/testiarium/fabric/build.gradle.kts](https://github.com/SirEdvin/Minecraft-Modding-Libs/blob/86bfe0b75d0dceb26e713a6c3bdcc91ec74eac2c/projects/testiarium/fabric/build.gradle.kts).
- Forge/NeoForge runs: [projects/testiarium/forge/build.gradle.kts](https://github.com/SirEdvin/Minecraft-Modding-Libs/blob/86bfe0b75d0dceb26e713a6c3bdcc91ec74eac2c/projects/testiarium/forge/build.gradle.kts).
- NeoForge registration override: [ForgeTestiarium.kt](https://github.com/SirEdvin/Minecraft-Modding-Libs/blob/86bfe0b75d0dceb26e713a6c3bdcc91ec74eac2c/projects/testiarium/forge/versions/1.21.1/src/main/kotlin/site/siredvin/testiarium/ForgeTestiarium.kt).

Common Gradle nodes are `:testiarium:1.20.1` and `:testiarium:1.21.1`; loader nodes add `:fabric:` or `:forge:` before the version. Do not copy old `:testiarium-forge` task paths into this topology.

Successful `projects tasks --all` discovery in a disposable clone confirmed the node/task names below. The GameTest runs themselves were not executed. Rediscover tasks before using a different checkout:

```bash
./gradlew projects
./gradlew :testiarium:forge:1.20.1:tasks --all
./gradlew :testiarium:forge:1.20.1:runGameTestServer
./gradlew :testiarium:forge:1.21.1:runGameTestServer -Ptestiarium.cct
./gradlew :testiarium:fabric:1.21.1:runServer
./gradlew :testiarium:fabric:1.21.1:runCctGameTest
```

`-Ptestiarium.cct` is a Gradle project property whose **presence** selects CCT in the Forge-family build. `-Ptestiarium.cct=false` still enables it. `testiarium.tags`, report locations, and client automation are **game JVM** properties: configure them on the loader run; do not assume `./gradlew -D...` forwards daemon properties into a forked Minecraft process.

## Match the build plugin, not merely Minecraft version

The current Forge 1.20.1 build applies **ModDevGradle LegacyForge** (`net.neoforged.moddev.legacyforge`), not ForgeGradle. It configures `LegacyForgeExtension`, `legacyForge`, `enable { forgeVersion = ... }`, and remapping configurations via `ObfuscationExtension`. Older projects may still use ForgeGradle `minecraft { runs }` and `fg.deobf`; inspect the installed plugin before selecting either DSL.

The 1.21.1 branch uses the project-specific `site.siredvin.neoforge` convention plugin and `neoForge`/`ModDevExtension`; it wires `createMinecraftArtifacts` to `stonecutterGenerate`. Both run families register `gameTestServer` and `clientGameTest`, load explicit mod models with `loadedMods`, and configure `sourceSet(...)` contributions. These convention-plugin methods are not Testiarium APIs to copy into an unrelated build.

Fabric configures Loom runs, `fabric-api.gametest=true`, and on 1.21.1 `fabric.debug.loadLate` for the fixture mod. The consumer must contribute test classes before the first `FabricTestiarium.registerTests()` scan. Late-loading a fixture mod is not a substitute for checking all entrypoint order.

## Verify the complete test-only classpath

1. Common `main` supplies registration, annotations, assertions, and reporters; `testMod` supplies client/fixture code; `cctTestMod` supplies CC helpers.
2. These features are registered with `java.registerFeature` in the source build. Loader test classpaths explicitly include the corresponding common outputs; merely adding a main artifact cannot expose those packages.
3. Loading classes is insufficient: include loader testmod metadata and matching mixin configs. Inspect `versions/1.21.1/src/...` overrides as well as shared files.
4. For external consumers, inspect the actual published variant metadata/JAR contents and resolved dependencies before specifying feature capabilities or classifiers. This audit did not resolve published feature artifacts; do not invent coordinates.
5. Verify publication under the normal non-test configuration. The pinned NeoForge build conditionally adds CC:Tweaked to `implementation` under the CCT property, so **do not publish with `-Ptestiarium.cct`** without checking generated metadata for test dependency leakage.
6. The pinned CI runs root `build` only. It is not evidence of GameTest execution, client screenshots, or a nonzero discovered test count.

## Entrypoint examples

Typical Fabric testmod entrypoint:

```kotlin
object ExampleFabricTestMod : ModInitializer {
    override fun onInitialize() {
        Testiarium.register(ExampleGameTests::class.java)
        FabricTestiarium.registerTests()
    }
}
```

Typical Forge 1.20 testmod entrypoint:

```java
@Mod("example_testmod")
public final class ExampleForgeTestMod {
    public ExampleForgeTestMod() {
        Testiarium.register(ExampleGameTests.class);
        ForgeTestiarium.registerTests();
    }
}
```

Typical NeoForge 1.21 testmod entrypoint:

```java
@Mod("example_testmod")
public final class ExampleNeoForgeTestMod {
    public ExampleNeoForgeTestMod() {
        Testiarium.register(ExampleGameTests.class);
    }
}
```

## API checks worth retaining

- [GameTests.kt](https://github.com/SirEdvin/Minecraft-Modding-Libs/blob/86bfe0b75d0dceb26e713a6c3bdcc91ec74eac2c/projects/testiarium/src/main/kotlin/site/siredvin/testiarium/api/GameTests.kt): `sequence` appends success; tags split literally on commas.
- [CctGameTestExtensions.kt](https://github.com/SirEdvin/Minecraft-Modding-Libs/blob/86bfe0b75d0dceb26e713a6c3bdcc91ec74eac2c/projects/testiarium/src/cctTestMod/kotlin/site/siredvin/testiarium/cct/CctGameTestExtensions.kt): `thenLua` does not append success.
- [Actual Tweakium consumer](https://github.com/SirEdvin/Minecraft-Modding-Libs/blob/86bfe0b75d0dceb26e713a6c3bdcc91ec74eac2c/projects/tweakium/versions/1.21.1/src/testMod/kotlin/site/siredvin/tweakium/testmod/CreativeFillerGameTests.kt): explicit template, group, timeout, and `helper.thenLua().thenSucceed()`.

These source files contain MPL-2.0 notices for code adapted from CC:Tweaked. The skill's MIT license covers its original documentation, not blanket relicensing of upstream code. Preserve applicable upstream notices when reusing implementation files.
