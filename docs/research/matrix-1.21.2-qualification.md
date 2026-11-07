# Minecraft 1.21.2 target qualification

Date: 2026-11-07.

## Outcome matrix

No cell is `supported`. Unexecuted checks are `unavailable`, not passes. No pack declares `evidenceManifest`.

| Loader   | Target                    | Status        | Build       | Server      | GameTest                          | Client      | Visual      | Final `packSha256`                                                 |
| -------- | ------------------------- | ------------- | ----------- | ----------- | --------------------------------- | ----------- | ----------- | ------------------------------------------------------------------ |
| Fabric   | `java-fabric-1.21.2-r2`   | `candidate`   | passed      | unavailable | unavailable                       | unavailable | unavailable | `9e187551f73f4159ddb9b171a38b73993fc4cc6ead28f491394f6f2a850ac004` |
| NeoForge | `java-neoforge-1.21.2-r1` | `candidate`   | passed      | unavailable | passed; negative control detected | unavailable | unavailable | `7cfdda9f79d88cb7316824f78dcf51be48d0b60adc725c6164aabdf5307f22b2` |
| Forge    | `java-forge-1.21.2-r1`    | `unsupported` | unavailable | unavailable | unavailable                       | unavailable | unavailable | `28d127b410663e04b585328abba7bc0eceb78af79a128c1bc0e1f2580b2142ee` |
| Quilt    | `java-quilt-1.21.2-r2`    | `candidate`   | passed      | unavailable | unavailable; not required         | unavailable | unavailable | `a64de57531da085be367fff00112bd75ba13c04db1f807c15a8de1dd49277b3f` |

All four final packs passed `loadTargetPacks` validation, including canonical hash, exact pins, status/template relationships, and capabilities. Runtime, pristine production-JAR installation, and visual qualification stopped before execution; candidate status is intentional.

## Fabric r1 rejection and r2 result

R1 used exact Fabric Loader `0.20.1`, Fabric API `0.106.1+1.21.2`, Mojang mappings, Gradle `9.8.2`, JDK 21, and Loom `1.20.0-alpha.19`. The pinned template archive SHA-256 matched `02bee780fcc29737004aeaa55263078cf03e1c29d729c5193177309e2d09e47b`. Real sandboxed `tasks --all` and `clean build` each exited 1 because the exact Loom module requires JVM 25. R1 was rejected with `toolchain_unavailable`; its template and executable verification were removed. Evidence: `~/.local/share/voxellume/evidence/fabric-1.21.2-r1-20261107T181500Z/`; superseded r1 hash: `851a6f994c86c34d6f248edc9824d9dc9d3bc7013d58412aa96cf476ae8c2530`.

R2 changes only Loom to exact JDK-21-compatible `1.17.21` and advances ID/revision. Task discovery passed in `tasks-retry`; isolated clean build passed in `clean-build-retry-isolated`. Earlier concurrent attempts were OOM-killed and retained as infrastructure failures. Production `modid-1.0.0.jar` SHA-256 is `cf1616e9f51e2b0730896f25d1ed04d82091de627f35ea835a94b1a800bb5bfe`. GameTest/negative control, dedicated server, real client, pristine production runtime, and visual captures were not executed. Evidence: `~/.local/share/voxellume/evidence/fabric-1.21.2-r2-20261107T184500Z/`.

## NeoForge

The exact MDK archive matched `04d2608e176dd4c0d1fadd4f476f62f8221efdec8a2011a0a415d2e2d26369da`. The materialization selects NeoForge `21.2.1-beta`, MDG `2.0.148`, Gradle `9.2.1`, JDK 21, official Mojang mappings, and the binary patch pipeline; unrelated Parchment `1.21.1` properties were removed. Wrapper JAR SHA-256 is `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172`.

Task discovery and clean build passed. Positive `runGameTestServer` passed `registry_and_item` and `place_example_block`, reporting `All 2 required tests passed :)`. The deliberate negative control was discovered and failed with exit 1 while both positive checks passed. The fixture-only repair used 1.21.2's `Optional<Reference<Item>>` registry result and annotation scanning. A fixture-free final clean build produced `examplemod-1.0.0.jar`, SHA-256 `2dd68bae714cf76127c7fb5a3bc930424ef123fe4ee7c35f0aef8774b53cc7fb`. Dedicated server, real client, pristine production runtime, and visual captures were not executed. Evidence: `~/.local/share/voxellume/evidence/neoforge-1.21.2-r1-20261107T181800Z/`.

## Forge

Fresh official `promotions_slim.json` and Forge Maven metadata exactly matched SHA-256 values `33d01c1e8a8b5e53bd25b048b81dc42950c1e251078aa1361bf3ce79727c1e72` and `cbc1accd281218828cc4866d01bb5ef9b2fd1a7243a3400220f9844c8c552d92`. Neither contains an exact `1.21.2` Forge release or MDK. No template was fabricated and no build/runtime command was attempted. The pack remains `unsupported` with empty capabilities. Evidence: `~/.local/share/voxellume/evidence/forge-1.21.2-r1-20261107T190000Z/`.

## Quilt r1 rejection and r2 result

R1 paired `org.quiltmc.loom:1.15.1` with Gradle `8.9`. After removal of an invalid unused version-catalog bundle, task discovery and clean build both exited 1: Loom declares Gradle plugin API `9.2.0`. The non-remap plugin was also wrong for this obfuscated target. R1 evidence remains at `~/.local/share/voxellume/evidence/quilt-1.21.2-r1-20261107T182500Z/`.

R2 pins Loader `0.30.2`, `org.quiltmc.loom.remap:1.15.1`, and Gradle `9.2.0`; Minecraft `1.21.2` and Quilt Mappings `1.21.2+build.3` remain unchanged. Loader JAR SHA-256 is `273033b1e92793e87f4800b02c6f3d8a89e14cbb71a8087a1f008837f24ab945`; exact profile response SHA-256 is `fcddab6c95d10484c4790fea48fa1ae57a79b21d48f2388787cec9961c2bd669`. With `api_dependencies=[]`, the template uses Loader's `pre_launch` entrypoint and no QSL/QFAPI dependency. Task discovery passed; isolated clean build passed after the loader-only entrypoint repair. Production `example_mod-1.0.0+1.21.2.jar` SHA-256 is `bada513b0fede85f0ac85936339eace50cbe82cc5796037097b884aa0f0a418b`. Dedicated server, real client, pristine production runtime, and visual captures were not executed. GameTest has no target-local command and is not required. Evidence: `~/.local/share/voxellume/evidence/quilt-1.21.2-r2-20261107T185000Z/`.

## Sandbox and integrity

Checks used one Gradle process per project, JDK 21, 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, read-only roots, isolated homes, bounded executable `/tmp`, 16 MiB log caps, 900-second build limits, and 600-second runtime limits. Exact Docker argv, logs, exit states, input hashes, production artifacts, and cleanup records are in the evidence bundles. Concurrent revision attempts caused retained OOM/download interruptions; final reported builds ran without concurrent Gradle projects. Existing EULA/network approvals were not changed. Qualification containers and writable volumes were removed.

Each bundle contains a copy of this report and `SHA256SUMS` with bundle-relative paths only. No live repository path or self-entry is listed. Entries were hash-verified before read-only sealing.
