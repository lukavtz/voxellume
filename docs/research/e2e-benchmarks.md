# Voxellume E2E benchmarks

Date: 2026-11-08  
Benchmark schema: `voxellume-e2e-benchmarks-1.0.0`  
Benchmark version: `1.0.0`

## Scope and evidence rules

`tests/e2e/benchmarks/v1.json` versions eight natural-language requests. Every scenario has independent acceptance criteria and expected observations. The criteria do not use implementation output as their oracle.

The model-independent runner invokes the registered OMP and DSH tools through their public adapter surfaces. It uses the production target catalog and real core operations behind those adapters; scenario execution does not call core operations directly. Temporary projects are disposable and isolated. The full-delivery fixture initializes a local disposable Git repository but has no remote and receives no credentials.

A host result of `unsupported_target` is not a mod success. A blocked acceptance criterion remains `blocked`; it is never converted to `passed`. An outer domain result with `status: "ok"` can still contain an unsupported target and is evaluated accordingly.

## Executed checks

Command:

```text
corepack pnpm test:e2e
```

Observed result:

```text
tests 20
pass 20
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 2714.434042
```

The 20 tests comprise two benchmark-contract tests, 16 OMP/DSH scenario runs, one real DSH CLI check, and one real OMP CLI availability probe.

Additional focused checks:

```text
corepack pnpm exec tsc --noEmit --pretty false
# exit 0, no output

corepack pnpm exec oxlint tests/e2e
# exit 0, no output
```

### Real host boundaries

- The registered OMP and DSH tool surfaces executed all eight scenarios each.
- The real DSH `0.2.2-rc.1` CLI built the exact package tarball, installed it into a fresh temporary profile, and completed `dsh --profile voxellume-e2e --dump-config`. Telemetry was disabled and the temporary profile was removed afterward.
- The real OMP application probe passed with exact local Bun `1.4.4`: `omp/18.17.0` launched, `plugin link` registered `voxellume 0.1.0`, and `plugin list --json` showed its enabled extension. The full E2E suite then completed **20/20 with zero skips**.
- No model-backed run was requested or executed. Model-backed final evaluation remains optional and unavailable in this run, not passed.
- No Minecraft mod build, dedicated server, GameTest, real client, packaged-mod runtime, or visual review executed. The production catalog offered no supported target for these requests, so those checks were blocked rather than simulated.

## Scenario results

Each row applies independently to both registered host surfaces, OMP and DSH.

| Scenario           | Executed observation                                                                                                                                                                                                 | Overall outcome | Blocked work                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Simple item        | Exact Fabric `1.21.1` pack `java-fabric-1.21.1-r2` returned `unsupported_target`; scaffolding returned the same domain outcome and created no staging files.                                                         | Blocked         | Item implementation, resources, recipe, clean mod build, gameplay, and visual evidence.                                                                                                                            |
| Advanced block     | Exact target resolution and scaffold rejection executed through both hosts; no project or staging output appeared.                                                                                                   | Blocked         | Editable model, block entity, persistence, GUI, networking, drops, multiplayer, and runtime evidence.                                                                                                              |
| Entity             | Exact target resolution and scaffold rejection executed through both hosts; no project or staging output appeared.                                                                                                   | Blocked         | Entity behavior, editable art, animation, spawning, loot, sound, persistence, and runtime evidence.                                                                                                                |
| World generation   | Exact target resolution and scaffold rejection executed through both hosts; no project or staging output appeared.                                                                                                   | Blocked         | Worldgen data, biome/rarity checks, fixed-seed reproducibility, restart behavior, and runtime evidence.                                                                                                            |
| Existing project   | Read-only inspection returned exact Fabric `1.21.1` coordinates with a `candidate` pack and existing `ruby_tools` metadata. Every pre-existing file hash remained unchanged. Feature scaffolding was unsupported.    | Blocked         | Feature addition and regression verification. All acceptance criteria remain blocked; inspection and unchanged hashes are observations only.                                                                       |
| Failure recovery   | The intentional malformed Gradle fixture returned `build_file_malformed`; all fixture hashes remained unchanged. Exact target/scaffold resolution was unsupported. Repair attempts: `0`.                             | Blocked         | Source/resource/test repair, bounded retry behavior, last-good restoration, and passing verification. All acceptance criteria remain blocked; one malformed-build diagnostic does not record all planted failures. |
| Unsupported target | Java Fabric `1.20.6` returned `unsupported_target` with the original coordinates. No substitute target, project files, staging files, commit, remote, or delivery artifact was created.                              | Passed          | None. Passing this scenario asserts rejection and zero success artifacts, not Minecraft support.                                                                                                                   |
| Full delivery      | A disposable local Git repository was initialized. Create returned unsupported; verify, document, commit, push, and pull request remained blocked. `HEAD` stayed absent, status stayed empty, and no remote existed. | Blocked         | Every stage after create. No commit, push, pull request, credential use, or external delivery success occurred.                                                                                                    |

Across the 16 host scenario runs, the expected unsupported-target scenario passed twice and the other seven scenarios remained blocked on each host. The harness asserted zero false-success artifacts, zero repair attempts, zero human interventions, and nonempty measured host-output bytes. Wall-clock duration is collected per run for measurement only; this blocked run is not a performance qualification. Clean-mod-build, runtime, visual-rubric, and cold/warm-cache success metrics are not applicable and were not reported as passes.

## Remaining qualification gates

A future supported-pack run must execute the independent acceptance criteria rather than reuse this run's blocked outcomes. In particular, content scenarios still require real builds and runtime evidence, failure recovery must demonstrate at most three real repair attempts, and full delivery still requires verified documentation, reviewed-path commit, separately approved push, separately approved pull request, and remote-SHA verification in a disposable test repository.

The OMP application-level installation and CLI checks passed. No model-backed interactive agent-experience run was requested, so that evaluation remains unavailable rather than passed.
