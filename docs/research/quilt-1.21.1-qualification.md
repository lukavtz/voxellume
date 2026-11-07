# Quilt 1.21.1 qualification evidence

Date: 2026-11-07.

## Result

`java-quilt-1.21.1-r1` is **rejected** with `verification_failed`. Exact Quilt Loom `1.15.1` requires Gradle plugin API `9.2.0`, while the target pins Gradle `8.9`. Task discovery and clean build both failed during root-project plugin resolution. No Gradle task ran, no code compiled, and no production JAR was produced.

Evidence root: `~/.local/share/voxellume/evidence/quilt-1.21.1-r1-20261107Tqualification/`.

Result manifest SHA-256: `c8c98ff163f5e9bebf6345a89a0e92e9c186180d51eed83313cb3da27e5edcbc`.

## Immutable inputs

- Template: `QuiltMC/quilt-template-mod@9a6f89cd481e3f58f128596b5b043353bee6b3f2`; downloaded ZIP SHA-256: `a2afaa5ab8037021c4538fc8f1bbcca6e30b713c57359245c7eec315e0aaf849`.
- Loader: `org.quiltmc:quilt-loader:0.20.0-beta.9`; JAR SHA-256: `a475689ac9a5b9718c045972bb0f41381ce22315a87273a99f30ec1fa3aacb8a`.
- QSL: `org.quiltmc:qsl:10.0.0-alpha.5+1.21.1`; packaging is `pom`; POM SHA-256: `2836796932b4c3e01e063fa5fc5a6509395df06a2949bb63212e7c502dc8bb8e`.
- Mappings: `org.quiltmc:quilt-mappings:1.21.1+build.9:intermediary-v2`; JAR SHA-256: `e445b1d48d016ac7302a294bf88ee158644bac941958ec7dac4aadf0db7b9c3a`.
- Loom: `org.quiltmc.loom:1.15.1`; Gradle module SHA-256: `c26ce932905e4c118801a562ab5c31edd805d350266c7add013fb3d61d49a033`.
- Gradle: `8.9`; distribution SHA-256: `d725d707bfabd4dfdc958c624003b3c80accc03f7037b5122c4b1d0ef15cecab`; wrapper JAR SHA-256: `cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8`.
- Java: JDK 21.

The materialized template replaces the generic Minecraft, Quilt Mappings, Loom, Loader, and QSL coordinates with the exact target values. It depends directly on QSL only. It does not add Quilted Fabric API, Mojang mappings, or Yarn mappings. The wrapper properties enforce `distributionSha256Sum`.

## Isolation

Every Gradle invocation used `eclipse-temurin:21-jdk@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a` on Linux/arm64. Docker limits were 2 CPUs, 4 GiB memory, and 512 PIDs, with `cap_drop=ALL`, `no-new-privileges`, a read-only root filesystem, and a 512 MiB `nosuid,noexec` `/tmp` tmpfs. `HOME` and `GRADLE_USER_HOME` used the isolated named volume `quilt-1.21.1-r1-home`. No credentials or Docker socket were mounted. Cold dependency resolution used the official endpoints recorded in `result.json`.

## Commands and outcomes

| Check          | Gradle argv                                                      | Status | Exit | Evidence                                |
| -------------- | ---------------------------------------------------------------- | -----: | ---: | --------------------------------------- |
| Task discovery | `./gradlew --no-daemon --console=plain --stacktrace tasks`       | failed |    1 | `tasks.log`, `tasks.status`             |
| Clean build    | `./gradlew --no-daemon --console=plain --stacktrace clean build` | failed |    1 | `clean-build.log`, `clean-build.status` |

Both logs report no matching runtime variant for `org.quiltmc:loom:1.15.1`: its `runtimeElements` declares `org.gradle.plugin.api-version=9.2.0`, while Gradle `8.9` requires plugin API `8.9`. The primary-source `loom-1.15.1.module` independently records this attribute.

The wrapper downloaded Gradle `8.9` successfully with the configured checksum. `artifact-inventory.txt` records `build/libs absent`; `result.json` records `productionJar: null` through its null production-JAR path.

## Runtime and visual checks

Dedicated server, GameTest, real client, production-JAR, and visual checks were **not executed** because the build prerequisite failed. No GameTest task was inferred from another loader or version. This report makes no runtime or visual-support claim.

## Evidence files

- `result.json`: inputs, environment, check statuses, failure, and runtime policy.
- `commands.log`: exact Gradle argv and Docker boundaries.
- `environment.txt`: container Java and kernel observations.
- `tasks.log`, `tasks.status`: task-discovery output and exit code.
- `clean-build.log`, `clean-build.status`: clean-build output and exit code.
- `artifact-inventory.txt`: production-JAR absence.
- `template.zip`: pinned upstream template archive.
- `input-artifacts/`: exact Loader, QSL, Mappings, and Loom metadata artifacts.
- `SHA256SUMS`: checksums for all evidence files present at finalization.
