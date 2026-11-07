# Version target packs для Minecraft Java Edition

Дата исследования: 2026-11-06. Это исследование для спецификации, а не объявление поддержки конкретных версий. Значения версий ниже — только подтверждённые примеры из указанных страниц и веток. Страницы `latest`, `current` и ветки могут измениться; target pack должен фиксировать версию документации или commit.

## Решение

**Общее ядро генератора допустимо; один генератор артефактов для произвольной пары Minecraft + loader — нет.** Поддерживаемой можно объявлять только цель, для которой существует явный version target pack и пройдены его сборка и runtime-проверки. Для неизвестной цели генератор обязан вернуть `unsupported_target`, а не подставлять «ближайшую» версию.

Основания:

- Fabric требует при ручной настройке согласованно обновить Minecraft, mappings, Loader и Loom. Loader и version-specific Fabric API — разные компоненты. Loom заявляет поддержку всех версий Minecraft, но прямо оговаривает, что это не поддержка Fabric API для этих версий ([Creating a Project](https://docs.fabricmc.net/develop/getting-started/creating-a-project), [Fabric Loader](https://docs.fabricmc.net/develop/loader/), [Loom](https://docs.fabricmc.net/develop/loom/)).
- NeoForge связывает `minecraft_version` и `neo_version`, а его генератор предлагает разные Gradle-плагины: ModDevGradle или NeoGradle ([Mod Files](https://docs.neoforged.net/docs/gettingstarted/modfiles/), [Getting Started](https://docs.neoforged.net/docs/gettingstarted/)).
- Forge распространяет версионный MDK и использует ForgeGradle; Quilt использует собственный template, Quilt Loom и `quilt.mod.json` ([Forge Getting Started](https://docs.minecraftforge.net/en/1.21.x/gettingstarted/), [ForgeGradle 6](https://docs.minecraftforge.net/en/fg-6.x/), [Quilt setup](https://wiki.quiltmc.org/en/introduction/setting-up), [Quilt Loom](https://github.com/QuiltMC/quilt-loom)).
- Сама игра меняет несовместимые параметры toolchain. Например, релиз 1.20.5 требует Java 21 и имеет Data Pack 41 / Resource Pack 32; релиз 26.1 требует Java 25, имеет Data Pack 101.1 / Resource Pack 84 и поставляется без обфускации ([1.20.5, Technical Changes](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-20-5), [26.1, Technical Changes](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-1)).

## Подтверждённые baseline inputs для 1.21.1

Это воспроизводимые входы для `java-fabric-1.21.1-r2` и `java-neoforge-1.21.1-r2`. **Оба pack имеют статус `candidate`.** Переход в `supported` возможен только после полной build/server/GameTest/client/production-JAR/visual qualification. Наличие артефактов и частичных runtime-проверок не доказывает полную поддержку.

### Общие данные Minecraft 1.21.1

| Поле                     | Точное значение                                                                                   | Официальный источник                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Тип релиза               | `release`                                                                                         | [Mojang version manifest v2](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json)                                                  |
| `releaseManifestUrl`     | `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`                                 | Mojang                                                                                                                                         |
| `releaseJsonUrl`         | `https://piston-meta.mojang.com/v1/packages/82ba6501da174a665c1787775f946487422f2432/1.21.1.json` | Mojang                                                                                                                                         |
| `releaseJsonSha256`      | `3636c26c20f1f0b7472ebef1a624ba1a6a2c4b003858c13224929898b5321437`                                | Скачанный release JSON, SHA-256                                                                                                                |
| Обфускация / Java        | Obfuscated; официальные client/server mappings; Java major `21`                                   | Release JSON                                                                                                                                   |
| Data / Resource Pack     | `48` / `34`                                                                                       | `version.json` внутри [официального client JAR](https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar) |
| Protocol / World version | `767` / `3955`                                                                                    | Тот же `version.json`                                                                                                                          |
| Client mappings SHA-256  | `140c47931cccc8fc9e4c22d7603e2d714d1a953a146f51ea7397d95c955536ec`                                | [client.txt](https://piston-data.mojang.com/v1/objects/2244b6f072256667bcd9a73df124d6c58de77992/client.txt)                                    |
| Server mappings SHA-256  | `9d0b04bead421c8229aff14b534432bbc927bea642e7c8593d1276b8df8ba53f`                                | [server.txt](https://piston-data.mojang.com/v1/objects/03f8985492bda0afc0898465341eb0acef35f570/server.txt)                                    |

Официальная статья релиза: https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-1.

### `java-fabric-1.21.1-r1`

| Вход       | Точные координаты / URL                                                                                                                                                                                                        | SHA-256                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Loader     | `net.fabricmc:fabric-loader:0.20.1`; [JAR](https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.20.1/fabric-loader-0.20.1.jar)                                                                                              | `d0c5a082e07410aaff9de7ab196aa6b4236002870f9ba3ad5c1260fcce5110ad`               |
| Fabric API | `net.fabricmc.fabric-api:fabric-api:0.116.17+1.21.1`; [JAR](https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/0.116.17%2B1.21.1/fabric-api-0.116.17%2B1.21.1.jar)                                                  | `79ac44b40780acbd884b34c50be1e39af682847e5f5cb3b1fddeeaa768dce800`               |
| Mappings   | `loom.officialMojangMappings()`                                                                                                                                                                                                | Общие client/server hashes выше                                                  |
| Loom       | Plugin `net.fabricmc.fabric-loom-remap:1.20.0-alpha.19`; implementation `net.fabricmc:fabric-loom:1.20.0-alpha.19`; [JAR](https://maven.fabricmc.net/net/fabricmc/fabric-loom/1.20.0-alpha.19/fabric-loom-1.20.0-alpha.19.jar) | `0a742bd8f3542f4058de52e40dcdebdbed6b135d8ac74a0917503c9db0c69bb0`               |
| Gradle     | [gradle-9.8.2-bin.zip](https://services.gradle.org/distributions/gradle-9.8.2-bin.zip); [опубликованный checksum](https://services.gradle.org/distributions/gradle-9.8.2-bin.zip.sha256)                                       | `21bd5da2de49b642904077f38c0efdc7778e92b3ed0889392dca61b97e389607`               |
| Template   | `FabricMC/fabric-example-mod@4c47210589a9ff72a6075c8dd1d73315dcc3e010`                                                                                                                                                         | `contentSha256=cfe3150f5e031a88a3cb33d3799810567b4b4cc6338481aad86c685c6dd76793` |

[Fabric Meta](https://meta.fabricmc.net/v2/versions/loader/1.21.1/0.20.1) подтверждает Loader `0.20.1`, build `1`, `stable:true`. [Plugin marker](https://maven.fabricmc.net/net/fabricmc/fabric-loom-remap/net.fabricmc.fabric-loom-remap.gradle.plugin/1.20.0-alpha.19/net.fabricmc.fabric-loom-remap.gradle.plugin-1.20.0-alpha.19.pom) разрешается в implementation artifact выше. SHA-256 Loader и Fabric API совпадают с официальными `.sha256` sidecars.

**Обязательная коррекция шаблона:** commit содержит `loom_version=1.19-SNAPSHOT`; scaffold должен заменить его на точный `1.20.0-alpha.19`. Не хешировать путь `net/fabricmc/fabric-loom-remap/...jar`: он возвращает 404; реальный JAR — `net.fabricmc:fabric-loom`. Остальные pins шаблона уже совпадают: Minecraft `1.21.1`, Loader `0.20.1`, API `0.116.17+1.21.1`, Gradle `9.8.2`, Java release `21`.

Источники: [версионная настройка Fabric](https://docs.fabricmc.net/1.21.1/develop/getting-started/setting-up-a-development-environment), [template revision](https://github.com/FabricMC/fabric-example-mod/tree/4c47210589a9ff72a6075c8dd1d73315dcc3e010), [Gradle 9.8.2 compatibility](https://docs.gradle.org/9.8.2/userguide/compatibility.html) (запуск на Java 21).

### `java-neoforge-1.21.1-r1`

| Вход         | Точные координаты / URL                                                                                                                                                                                | SHA-256                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| NeoForge     | `net.neoforged:neoforge:21.1.265:universal`; [JAR](https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.265/neoforge-21.1.265-universal.jar)                                               | `c12cf1a6cb0aa7792b13174b06088a4f54d8bcc92f6a32fcb03310b456936847`               |
| Parchment    | `org.parchmentmc.data:parchment-1.21.1:2024.11.17@zip`; [ZIP](https://maven.parchmentmc.org/org/parchmentmc/data/parchment-1.21.1/2024.11.17/parchment-1.21.1-2024.11.17.zip)                          | `7c240a37ab432213033b1113d75cb80dc22bffa631d979818b2da1585fa24a08`               |
| ModDevGradle | Plugin `net.neoforged.moddev:2.0.148`; implementation `net.neoforged:moddev-gradle:2.0.148`; [JAR](https://maven.neoforged.net/releases/net/neoforged/moddev-gradle/2.0.148/moddev-gradle-2.0.148.jar) | `e4cab1e28fcede52101ffc5bb5052fe8a4dd41b699992c52c8ec1c267e306017`               |
| Gradle       | [gradle-9.2.1-bin.zip](https://services.gradle.org/distributions/gradle-9.2.1-bin.zip); [опубликованный checksum](https://services.gradle.org/distributions/gradle-9.2.1-bin.zip.sha256)               | `72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f`               |
| Template     | `NeoForgeMDKs/MDK-1.21.1-ModDevGradle@e93d7f09d4eec12c76d1d7be9bf4eaad0246e9e0`                                                                                                                        | `contentSha256=1101d5f9baf5eb4dd31f826e4eef7f7380a01a776ce1af230133e32a95e46e13` |

SHA-256 NeoForge и Parchment совпадают с официальными `.sha256` sidecars. [Parchment metadata](https://maven.parchmentmc.org/org/parchmentmc/data/parchment-1.21.1/maven-metadata.xml) называет `2024.11.17` и `latest`, и `release`; pack фиксирует саму версию, а не moving label. [MDG plugin marker](https://maven.neoforged.net/releases/net/neoforged/moddev/net.neoforged.moddev.gradle.plugin/2.0.148/net.neoforged.moddev.gradle.plugin-2.0.148.pom) разрешается в implementation artifact выше.

Template уже содержит все pins: NeoForge `21.1.265`, Parchment Minecraft `1.21.1` / mappings `2024.11.17`, MDG `2.0.148`, Gradle `9.2.1`, Java toolchain `21`. Run `gameTestServer` даёт задачу `runGameTestServer`; это конфигурация для последующей квалификации, не пройденный test evidence.

Источники: [NeoForge 1.21.1](https://docs.neoforged.net/docs/1.21.1/gettingstarted/), [ModDevGradle](https://docs.neoforged.net/toolchain/docs/plugins/mdg/), [Parchment](https://parchmentmc.org/docs/getting-started), [template revision](https://github.com/NeoForgeMDKs/MDK-1.21.1-ModDevGradle/tree/e93d7f09d4eec12c76d1d7be9bf4eaad0246e9e0), [Gradle 9.2.1 compatibility](https://docs.gradle.org/9.2.1/userguide/compatibility.html) (запуск на Java 21).

### Воспроизведение `template.contentSha256`

`contentSha256` — SHA-256 байтов ZIP-архива из `discovery.snapshot.json` → `template.archive`: codeload для GitHub templates или версионного MDK-архива. Это не hash распакованного дерева. Для baseline packs:

```sh
curl -fL https://codeload.github.com/FabricMC/fabric-example-mod/zip/4c47210589a9ff72a6075c8dd1d73315dcc3e010 | shasum -a 256
# cfe3150f5e031a88a3cb33d3799810567b4b4cc6338481aad86c685c6dd76793

curl -fL https://codeload.github.com/NeoForgeMDKs/MDK-1.21.1-ModDevGradle/zip/e93d7f09d4eec12c76d1d7be9bf4eaad0246e9e0 | shasum -a 256
# 1101d5f9baf5eb4dd31f826e4eef7f7380a01a776ce1af230133e32a95e46e13
```

Отдельные SHA-256 несжатых `git archive --format=tar` потоков (`0e29551a…` для Fabric и `e3bc538f…` для NeoForge) относятся только к проверке входов baseline build в `docs/research/baseline-builds.md`. Они не являются `template.contentSha256` в pack.

## Различия toolchain

Таблица описывает документированные примеры, **не матрицу поддержки всех версий**. Для каждой цели нужен отдельно проверенный набор точных версий.

| Аспект                     | Fabric                                                                                                                                                                                                                                                                                                                                                                                                    | NeoForge                                                                                                                                                                                                               | Forge                                                                                                                                                                                                                                                                                                      | Quilt                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loader и API               | Fabric Loader отвечает за загрузку; game-specific и version-specific hooks находятся в Fabric API. Их версии фиксируются отдельно ([Loader](https://docs.fabricmc.net/develop/loader/)).                                                                                                                                                                                                                  | Версия NeoForge согласуется с версией Minecraft; схема версионирования NeoForge также менялась для 26.1 ([Versioning](https://docs.neoforged.net/docs/gettingstarted/versioning/)).                                    | Версионный Forge MDK является начальной точкой проекта ([Getting Started](https://docs.minecraftforge.net/en/1.21.x/gettingstarted/)).                                                                                                                                                                     | В проверенной ветке `1.20.6` template отдельно фиксирует Loader, QSL и QFAPI. QSL, QFAPI и Quilt Kotlin Libraries retired начиная с Minecraft 26.1; нельзя переносить эти зависимости на новые цели ([template catalog](https://github.com/QuiltMC/quilt-template-mod/blob/1.20.6/gradle/libs.versions.toml), [объявление Quilt от 2026-02-03](https://quiltmc.org/en/blog/2026-02-03-non-obfuscated-updates/)). |
| Метаданные и entrypoint    | `fabric.mod.json` в корне JAR; entrypoints и mixin config объявляются в нём ([Loader](https://docs.fabricmc.net/develop/loader/)).                                                                                                                                                                                                                                                                        | `src/main/resources/META-INF/neoforge.mods.toml`; Java entrypoint через `@Mod` ([Mod Files](https://docs.neoforged.net/docs/gettingstarted/modfiles/)).                                                                | `src/main/resources/META-INF/mods.toml`; Java entrypoint через `@Mod` ([Mod Files](https://docs.minecraftforge.net/en/1.21.x/gettingstarted/modfiles/)).                                                                                                                                                   | `quilt.mod.json`, в примере — `quilt_loader.entrypoints.init` ([setup](https://wiki.quiltmc.org/en/introduction/setting-up)).                                                                                                                                                                                                                                                                                    |
| Gradle и шаблон            | Template Mod Generator или `fabric-example-mod`; Gradle plugin — Fabric Loom ([Creating a Project](https://docs.fabricmc.net/develop/getting-started/creating-a-project), [Loom](https://docs.fabricmc.net/develop/loom/)). Ветка example mod `26.2` фиксирует Gradle 9.8.2 через wrapper ([wrapper](https://github.com/FabricMC/fabric-example-mod/blob/26.2/gradle/wrapper/gradle-wrapper.properties)). | Официальный Mod Generator создаёт проект с ModDevGradle или NeoGradle ([Getting Started](https://docs.neoforged.net/docs/gettingstarted/)). Это разные plugin contracts, не переключаемые только именем задачи.        | MDK + ForgeGradle. Документация ForgeGradle 6 указывает Gradle 8 и plugin id `net.minecraftforge.gradle` ([ForgeGradle 6](https://docs.minecraftforge.net/en/fg-6.x/)).                                                                                                                                    | Официальный `quilt-template-mod`; plugin id `org.quiltmc.loom`. Ветка `1.20.6` фиксирует Quilt Loom 1.7.4, Loader 0.26.3 и Gradle 8.9 ([catalog](https://github.com/QuiltMC/quilt-template-mod/blob/1.20.6/gradle/libs.versions.toml), [wrapper](https://github.com/QuiltMC/quilt-template-mod/blob/1.20.6/gradle/wrapper/gradle-wrapper.properties)). Это факты о ветке, не обещание актуальной поддержки.      |
| Mappings / имена           | Для обфусцированных версий применялись Intermediary и Yarn или Mojang mappings. Minecraft был обфусцирован через 1.21.11; в 26.1 обфускационные mappings не нужны ([Migrating Mappings](https://docs.fabricmc.net/develop/porting/mappings/), [Mojang announcement](https://www.minecraft.net/en-us/article/removing-obfuscation-in-java-edition)).                                                       | Используются официальные имена Mojang; Parchment отдельно добавляет parameter names и Javadocs и сам имеет `minecraftVersion` + `mappingsVersion` ([Parchment](https://docs.neoforged.net/toolchain/docs/parchment/)). | Нельзя подставлять Yarn/Quilt Mappings. Для конкретной цели конфигурацию следует брать из соответствующего MDK/ForgeGradle; историческая документация Forge также фиксирует переход на Mojang Official Mappings ([Forge 1.17 Getting Started](https://docs.minecraftforge.net/en/1.17.x/gettingstarted/)). | Ветка `1.20.6` использует Quilt Mappings `1.20.6+build.6` с classifier `intermediary-v2` ([build.gradle](https://github.com/QuiltMC/quilt-template-mod/blob/1.20.6/build.gradle)). Quilt Mappings не выпускаются для новых версий после перехода на unobfuscated code ([Quilt announcement](https://quiltmc.org/en/blog/2026-02-03-non-obfuscated-updates/)).                                                    |
| Подтверждённый пример Java | JDK 17 для 1.20.4, JDK 21 для 1.21.1, JDK 25 для разработки под 26.1 ([1.20.4](https://docs.fabricmc.net/1.20.4/develop/getting-started/setting-up-a-development-environment), [1.21.1](https://docs.fabricmc.net/1.21.1/develop/getting-started/setting-up-a-development-environment), [26.x setup](https://docs.fabricmc.net/develop/getting-started/setting-up)).                                      | Документация 26.1 требует JDK 25 и 64-bit JVM ([Getting Started](https://docs.neoforged.net/docs/gettingstarted/)).                                                                                                    | Документация 1.21.x требует JDK 21 и 64-bit JVM ([Getting Started](https://docs.minecraftforge.net/en/1.21.x/gettingstarted/)).                                                                                                                                                                            | Template `1.20.6` задаёт `options.release = 21`, source/target Java 21 ([build.gradle](https://github.com/QuiltMC/quilt-template-mod/blob/1.20.6/build.gradle)). Общий совет wiki «JDK 17 или новее» не заменяет это точное требование ([wiki](https://wiki.quiltmc.org/en/introduction/setting-up)).                                                                                                            |
| Сборка и ручной запуск     | `./gradlew build`; `./gradlew runClient` и `./gradlew runServer` ([example workflow](https://github.com/FabricMC/fabric-example-mod/blob/26.2/.github/workflows/build.yml), [Launching the Game](https://docs.fabricmc.net/develop/getting-started/intellij-idea/launching-the-game)).                                                                                                                    | `gradlew build`, `gradlew runClient`, `gradlew runServer` ([Getting Started](https://docs.neoforged.net/docs/gettingstarted/)).                                                                                        | `gradlew build`, `gradlew runClient`, `gradlew runServer` ([Getting Started](https://docs.minecraftforge.net/en/1.21.x/gettingstarted/)).                                                                                                                                                                  | Ветка template содержит Gradle wrapper, но в просмотренной официальной Quilt-документации не найден отдельный командный контракт `build`/`runClient`/`runServer`. Нельзя объявлять эти команды Quilt-поддержанными только по аналогии с Fabric; pack обязан проверить их на выбранном template.                                                                                                                  |
| Автоматические game tests  | В документации 26.2 server game tests запускаются через `build`, client game tests — `runClientGameTest`; также есть Fabric Loader JUnit ([Automated Testing](https://docs.fabricmc.net/develop/automatic-testing)).                                                                                                                                                                                      | В документации 26.1 есть `gradlew runGameTestServer`; exit code равен числу failed required tests ([Game Tests](https://docs.neoforged.net/docs/misc/gametest/)).                                                      | В документации 1.21.x есть `gradlew runGameTestServer`; exit code равен числу failed required tests ([Game Tests](https://docs.minecraftforge.net/en/1.21.x/misc/gametest/)).                                                                                                                              | QSL ветки `1.20.6` перечисляет GameTest API и Auto Test Server argument ([QSL README](https://github.com/QuiltMC/quilt-standard-libraries/blob/1.20.6/README.md)). Официальная Quilt-инструкция с конкретной CLI-командой не найдена; наличие API не равно готовому test task.                                                                                                                                   |

### Почему mappings и plugin id нельзя спрятать за общим значением `latest`

Fabric явно разделяет plugin ids: `net.fabricmc.fabric-loom-remap` для обфусцированных 1.21.11 и старше, `net.fabricmc.fabric-loom` для unobfuscated 26.1 и новее; legacy `fabric-loom` оставлен для обратной совместимости с обфусцированными версиями ([Loom, Plugin IDs](https://docs.fabricmc.net/develop/loom/#plugin-ids)). Mojang подтверждает удаление обфускации и исчезновение obfuscation maps из version JSON ([Removing obfuscation](https://www.minecraft.net/en-us/article/removing-obfuscation-in-java-edition)). Следовательно, смена mappings может потребовать другого plugin id, шаблона и миграции исходников, а не только другой координаты зависимости.

### Java и Gradle — три разные настройки

Gradle различает JVM, на которой запускается сам Gradle, Java toolchain проекта и `options.release`. `--release` ограничивает API и bytecode level, но не выбирает JDK; toolchain выбирает инструменты, а совместимость Gradle с JVM имеет отдельную матрицу ([Gradle Toolchains](https://docs.gradle.org/current/userguide/toolchains.html), [Gradle Compatibility Matrix](https://docs.gradle.org/current/userguide/compatibility.html)). Поэтому target pack хранит `gradle_jvm`, `toolchain` и `release` отдельно.

Gradle рекомендует Wrapper: он вызывает объявленную версию Gradle, скачивает её при необходимости и стандартизирует версию между машинами и CI. Версия находится в `gradle/wrapper/gradle-wrapper.properties`; wrapper также поддерживает SHA-256 дистрибутива ([Gradle Wrapper](https://docs.gradle.org/current/userguide/gradle_wrapper.html)). Запуск системным `gradle` вместо закреплённого `./gradlew` разрушает эту воспроизводимость.

## Контракт version target pack

Ниже — предлагаемый формат, а не готовый поддерживаемый target. Все `<...>` обязаны быть заменены точными значениями до статуса `supported`. YAML выбран как человекочитаемая сериализация; эквивалентный JSON допустим.

```yaml
kind: minecraft-java-target-pack
spec_version: 1
id: "<loader>-<minecraft>-<pack-revision>"
status: "draft" # draft | candidate | supported | legacy | rejected

minecraft:
  version: "<exact-release-id>" # не latest и не диапазон
  obfuscation: "<obfuscated|unobfuscated>"
  data_pack_version: "<exact-string-or-number>"
  resource_pack_version: "<exact-string-or-number>"

loader:
  id: "<fabric|neoforge|forge|quilt>"
  version: "<exact-version>"
  api_dependencies: # Fabric API, QSL/QFAPI и т. п.; [] если их нет
    - id: "<api-id>"
      version: "<exact-version>"
      coordinates: "<maven-coordinates>"

mappings:
  kind: "<yarn|mojang|quilt|parchment-layer|none>"
  artifacts: [] # точные coordinates + версии; [] только при kind=none

java:
  gradle_jvm: "<exact-major>"
  toolchain: "<exact-major>"
  release: "<exact-major>"
  architecture: "64-bit"

gradle:
  version: "<exact-version>"
  wrapper:
    distribution_url: "<exact-https-url>"
    distribution_sha256: "<sha256>"
  plugins:
    - id: "<exact-plugin-id>"
      version: "<exact-plugin-version>"

template:
  repository: "<official-repository-or-generator>"
  revision: "<immutable-commit-or-archive-sha256>"
  path: "<template-subdirectory-or-empty>"
  variables:
    mod_id: "<mod-id>"
    package: "<java-package>"

metadata:
  file: "<fabric.mod.json|META-INF/neoforge.mods.toml|META-INF/mods.toml|quilt.mod.json>"

documentation:
  minecraft_release: "<official-release-url>"
  loader_api:
    - name: "<api-name-and-version>"
      url: "<versioned-official-doc-or-javadoc-url>"
      revision: "<doc-version-or-commit>"
  toolchain:
    - name: "<gradle-plugin-and-version>"
      url: "<versioned-official-doc-url>"
      revision: "<doc-version-or-commit>"

resources:
  model_format: "java-block-item-json"
  blockbench:
    project_format: "Java Block/Item"
    application_version: "<tested-version>"

build:
  command: ["./gradlew", "build"]
  artifact_glob: "build/libs/*.jar"
  reports_glob: "build/reports/**"

runtime:
  server:
    command: ["./gradlew", "runServer"]
    requires_explicit_eula_acceptance: true
    success: "<pack-specific-startup-assertion>"
    logs_glob: "run/logs/*.log"
  client:
    command: ["./gradlew", "runClient"]
    success: "<pack-specific-startup-assertion>"
    logs_glob: "run/logs/*.log"
  game_test:
    status: "<configured|unavailable>"
    command: [] # обязательно при configured
    reports_glob: "<test-report-path>"
  visual:
    required: true
    steps:
      - "<load-world-and-confirm-mod-content>"
      - "<exercise-block-item-gui-and-model>"
      - "<check-client-log-for-errors>"
    screenshots_glob: "verification/screenshots/*.png"

verification:
  clean_checkout: true
  required: ["build", "server", "client", "visual"]
  evidence_directory: "verification/"
  tested_platforms:
    - os: "<macOS|Windows|Linux>"
      arch: "<arm64|x86_64>"
```

Правила валидации схемы:

1. `supported` запрещён при любом незаполненном `<...>`, `latest`, нефиксированном `revision`, пустой обязательной команде или отсутствии evidence.
2. `mappings.kind=none` допустим только при подтверждённом unobfuscated target. Для обфусцированного target должны быть точные mapping artifacts.
3. `runtime.game_test.status=unavailable` не означает пропуск всей runtime-проверки: server/client smoke и визуальный checklist остаются обязательными.
4. `documentation.loader_api[]` должен вести на документацию именно выбранных API и версий. Общая страница `latest` может быть навигационным источником, но не единственным зафиксированным API-источником.
5. `template.revision` и `wrapper.distribution_sha256` связывают генерацию с проверенными входами. Изменение loader, API, mappings, Java, Gradle plugin/wrapper или template требует повторной квалификации pack.
6. Пути `run/logs` и команды в примере — начальные значения из распространённых шаблонов, а не универсальная константа. Pack заменяет их фактическими путями выбранного MDK/template.

## Runtime и визуальная проверка

### Уровни проверки

1. **Build smoke.** Выполнить wrapper-команду из pack в чистом checkout; проверить exit code и существование JAR. Fabric, NeoForge и Forge документируют `build` и каталог `build/libs` в своих версионных руководствах ([Fabric workflow](https://github.com/FabricMC/fabric-example-mod/blob/26.2/.github/workflows/build.yml), [NeoForge](https://docs.neoforged.net/docs/gettingstarted/), [Forge](https://docs.minecraftforge.net/en/1.21.x/gettingstarted/)).
2. **Server smoke.** Запустить dedicated server и проверить pack-specific условие успешной инициализации. NeoForge и Forge требуют принять EULA после первого запуска; NeoForge дополнительно описывает `online-mode=false` для подключения dev player. Это локальная dev-настройка, не рекомендация для публичного сервера ([NeoForge Server Testing](https://docs.neoforged.net/docs/gettingstarted/#server-testing), [Forge Getting Started](https://docs.minecraftforge.net/en/1.21.x/gettingstarted/)). Плагин не должен молча принимать EULA от имени пользователя.
3. **Client smoke.** Запустить клиент через заданную pack команду, создать/открыть мир и выполнить минимальный сценарий мода. Успешная компиляция и запуск server не доказывают корректность моделей, текстур, GUI или client-only кода.
4. **Game tests.** Использовать только механизм, подтверждённый для этой версии и loader; сохранить отчёт и логи.
5. **Visual review.** Для визуальных функций сохранить скриншоты и результат checklist. Game test мира и успешный client launch не заменяют оценку читаемости текстуры, корректного silhouette, UV, анимации и отображения в руке/инвентаре/мире.

### Поддерживаемые документированные варианты game tests

- **Vanilla server jar, подтверждено для 1.21.5.** Добавлен entrypoint `net.minecraft.gametest.Main`: он запускает server, выполняет доступные game tests и завершается. Поддерживаются `--packs`, `--report` с JUnit-like XML, `--tests`, `--universe` и `--verify`. Официальный пример: `java -DbundlerMainClass="net.minecraft.gametest.Main" -jar server.jar --packs mytestpacks` ([Minecraft 1.21.5, Game Test Entry Point](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-5)). Нельзя переносить этот entrypoint на более ранние версии без отдельного источника.
- **Fabric, документация 26.2.** Loom настраивает server и client game tests; server tests выполняются при `build`, client tests — через `runClientGameTest`. Fabric описывает client tests как end-to-end tests клиентских функций ([Automated Testing](https://docs.fabricmc.net/develop/automatic-testing#game-tests)).
- **NeoForge, документация 26.1.** `/test` запускает тесты в мире, а `gradlew runGameTestServer` запускает специальный server с машинным exit code ([Game Tests](https://docs.neoforged.net/docs/misc/gametest/#game-test-server-run-configuration)).
- **Forge, документация 1.21.x.** `/test` и `gradlew runGameTestServer`; exit code специального server равен число failed required tests ([Game Tests](https://docs.minecraftforge.net/en/1.21.x/misc/gametest/#game-test-server-run-configuration)).
- **Quilt.** Подтверждено наличие GameTest API в QSL `1.20.6`, но не подтверждён общий CLI workflow. До отдельной проверки pack должен указывать `game_test.status=unavailable`, а не выдумывать task name ([QSL README](https://github.com/QuiltMC/quilt-standard-libraries/blob/1.20.6/README.md)).

Game Test API тоже версионируется: NeoForge 1.21.4 описывает annotation-based registration через `@GameTest`/`@GameTestHolder`, а документация 26.1 описывает data-driven `TestData`, test environment и test instance ([1.21.4](https://docs.neoforged.net/docs/1.21.4/misc/gametest/), [26.1](https://docs.neoforged.net/docs/misc/gametest/)). Поэтому test templates входят в pack вместе с production templates.

### Blockbench и модели

Blockbench разделяет форматы `Java Block/Item` и `Modded Entity`: первый экспортирует Java block/item JSON, второй — `.java`; таблица возможностей и ограничений различается по форматам ([Blockbench Formats](https://blockbench.net/wiki/blockbench/formats)). Wiki также отмечает изменение ограничения углов до/после 1.21.6. Поэтому pack фиксирует формат проекта и проверенную версию Blockbench, а экспортированный файл проходит обычные build + client visual checks. Наличие `.bbmodel` или успешный экспорт не является runtime verification.

## Explicit support policy

1. **Allowlist только.** Пользователь выбирает `target_pack.id`; произвольные строки Minecraft/loader не принимаются как автоматически поддерживаемые.
2. **Точная связка.** Поддержка относится к полному набору `Minecraft + loader + loader version + APIs + mappings + Java + Gradle + plugins + template revision`, а не к названию loader.
3. **Никаких silent fallbacks.** Не заменять Yarn на Mojang mappings, Fabric API на QFAPI, Forge на NeoForge, задачу `runClientGameTest` на `runGameTestServer` или новую версию на предыдущую без отдельного pack.
4. **Доказательство до обещания.** `candidate` становится `supported` только после clean build, server smoke, client smoke и visual checklist; если game test configured, его отчёт тоже обязан быть успешным.
5. **Capability honesty.** Отсутствие автоматического game test отмечается явно. Ручная проверка не выдаётся за автоматическую. Наличие API в репозитории не выдаётся за работающий Gradle task.
6. **Воспроизводимые источники.** Pack хранит официальные URLs и immutable revisions. При расхождении общей wiki и версионного template приоритет имеет фактический версионный template, а расхождение фиксируется.
7. **Evidence обязателен.** Сохранить команду, exit code, логи, путь к JAR, test reports, скриншоты и tested OS/arch. Без evidence статус остаётся `draft` или `candidate`.
8. **Изменение = повторная квалификация.** Обновление любой зафиксированной версии создаёт новую revision pack и повторяет проверки. Поддержка будущей версии не выводится из успеха предыдущей.
9. **Общее ядро, отдельные адаптеры.** Идея мода, namespace, общий план ресурсов и сценарии проверки могут повторно использоваться. Java API calls, metadata, build scripts, mappings, game-test templates и ресурсы генерируются loader/version-specific адаптером выбранного pack.
