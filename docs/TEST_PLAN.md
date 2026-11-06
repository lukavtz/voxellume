# Voxellume — Test Plan

Status: approved
Specification: [SPEC.md](SPEC.md)
Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)

## 1. Quality rule

A release candidate is accepted only when every required check for its declared support matrix has executed and passed. Skipped, unavailable, mocked, and manual-only results remain explicit and cannot satisfy an automated runtime requirement.

Every consumer-visible defect becomes a regression test at the public seam where the behavior is observed.

## 2. Test levels

### 2.1 Static and deterministic checks

Run on every pull request:

- formatter check;
- lint with no suppressed new violations;
- TypeScript type checking;
- dependency lockfile consistency;
- secret scanning;
- dependency vulnerability and license/provenance checks;
- target-pack and documentation schema validation;
- package-content inspection for credentials, caches, logs, build output, and unexpected files;
- reusable workflow/action pinning checks.

### 2.2 Core behavior tests

Test public interfaces, not private helpers.

Required cases:

- exact target resolution and incompatible-version rejection;
- ambiguous target handling;
- inspection of valid, incomplete, foreign, and malformed projects;
- scaffold creation, conflict refusal, and repeat invocation;
- valid and malformed block/item/entity assets;
- missing textures, invalid references, duplicate identifiers, and wrong resource roots;
- verification report ordering and status transitions;
- unsupported check reporting;
- partial build/test failure diagnostics;
- artifact path and checksum correctness;
- no implicit overwrite or network mutation where prohibited.

### 2.3 Security tests

Use adversarial fixtures:

- `..` and absolute-path escape attempts;
- symlink escapes inside an authorized project;
- command and argument injection through metadata and target input;
- malicious Gradle/build scripts attempting unexpected filesystem or network access;
- archive traversal and unsafe extraction;
- secret values in environment, logs, process output, reports, and artifacts;
- output floods, hung compilers, hung games, and runaway child processes;
- cancellation before start, during build, and during game execution;
- corrupted target manifests, docs metadata, templates, and fixtures;
- untrusted MCP input and oversized structured results.

Assertions verify containment, fail-closed behavior, redaction, process cleanup, bounded resource use, and accurate error reporting.

### 2.4 OMP contract tests

Run against the actual supported OMP version:

- package installation and local linking;
- extension discovery and factory initialization;
- skill, agent, command, and tool discovery;
- every exposed tool call and structured result;
- approval and cancellation propagation;
- error and unsupported-target results;
- long build progress and completion;
- session shutdown during active work;
- uninstall and clean reinstall;
- interactive and supported headless operation.

At least one end-to-end run must use the real interactive OMP surface, not only SDK calls.

### 2.5 DeepSeek Harness contract tests

Run against the exact supported Harness range:

- bundle installation into a fresh profile;
- `dsh --profile <name> --dump-config` composition;
- plugin activation and dependency injection;
- every typed tool schema and canonical JSON result;
- Cordis registration disposal and bundle removal;
- `exec.signal` cancellation and process cleanup;
- large diagnostics and renderer behavior;
- supported native and PTC invocation;
- supported interactive/headless surfaces;
- upgrade, downgrade rejection, and incompatible `engines.dsh` rejection.

At least one end-to-end run must use the real Harness application, not only direct function calls.

### 2.6 MCP contract tests

If MCP ships:

- stdio initialization and capability discovery;
- input/output schema compatibility;
- malformed and oversized requests;
- cancellation and disconnect cleanup;
- equivalence with native core results;
- no non-loopback listener by default;
- safe behavior when the client disappears.

## 3. Real Minecraft integration matrix

Each supported target pack must pass in a clean environment with its declared Java and Gradle toolchain:

1. dependency resolution;
2. template generation;
3. resource and data validation;
4. unit tests;
5. full clean build;
6. mod artifact inspection;
7. dedicated-server startup;
8. supported server game tests;
9. client startup where supported;
10. supported client/gameplay scenarios;
11. packaged-mod loading without development-only classes or resources.

No target is declared supported from a successful template test alone.

## 4. End-to-end mod scenarios

The benchmark uses versioned natural-language requests and independent acceptance criteria.

### Scenario A: Simple content mod

A new item, texture, localization, recipe, and creative-tab entry.

Proves design-to-build flow, assets, data, and basic gameplay.

### Scenario B: Advanced block mod

A custom block with an editable model, texture set, block entity, persistence, GUI, networking, drops, and multiplayer behavior.

Proves models, state, synchronization, UI, and runtime verification.

### Scenario C: Entity mod

A custom entity with goals, attributes, model, texture, animations, spawn rules, loot, sounds, and persistence.

Proves complex code and editable art pipeline.

### Scenario D: World-generation mod

Configured/placed features or equivalent target-specific world generation with rarity, biome rules, and reproducibility.

Proves version-local API knowledge and world-state checks.

### Scenario E: Existing-project change

Add a feature to an existing mod without overwriting unrelated user work.

Proves inspection, locality, compatibility, and regression detection.

### Scenario F: Failure recovery

Start with intentionally broken source, resources, and tests. Require diagnosis, repair, and passing verification.

Proves structured diagnostics and iteration.

### Scenario G: Unsupported target

Request a target outside the declared matrix.

Proves explicit rejection and zero false-success artifacts.

### Scenario H: Full delivery

Create, verify, document, commit, push, and open a pull request for a mod in a test repository.

Proves the complete requested GitHub workflow without exposing credentials.

## 5. Visual and gameplay verification

For every model, texture, GUI, animation, or visual effect:

- inspect the editable asset where applicable;
- inspect the exported runtime asset;
- launch the actual supported visual surface;
- capture evidence at documented angles/states/resolutions;
- verify texture references, z-fighting, transparency, scale, orientation, animation states, and GUI clipping;
- compare against the design rubric;
- record human review where subjective quality cannot be determined automatically.

A screenshot alone does not prove gameplay behavior. Runtime assertions and screenshots serve different checks.

## 6. Performance and reliability

Measure against the same benchmark and environment:

- time to first successful build;
- time to verified delivery;
- agent iterations and human interventions;
- cold and warm dependency/build cache behavior;
- repeated-run determinism;
- concurrent independent project verification;
- cancellation and cleanup latency;
- memory/output behavior during long builds and game runs.

Store raw results with target, host, model, revision, and environment metadata.

## 7. Installation and release testing

Test the exact distributed artifact, not the source checkout:

- clean private GitHub installation using the supported authentication path;
- pinned revision installation;
- local tarball/package installation where supported;
- first-run dependency/setup guidance;
- OMP and Harness side-by-side installation;
- upgrade and removal;
- clean-machine or container installation for every claimed OS;
- offline behavior after dependencies are cached;
- reproducible clean-checkout build;
- final package contents and provenance ledger.

## 8. CI organization

- **Fast gate:** static checks and core behavior on every change.
- **Host gate:** OMP, Harness, and MCP contracts on adapter changes and releases.
- **Target gate:** affected real Minecraft toolchains on target/template changes.
- **Runtime gate:** server/client scenarios on a scheduled and release matrix.
- **Security gate:** adversarial fixtures and dependency/secret checks.
- **Release gate:** all required checks plus packaged-artifact and clean-install tests.

Long jobs may run separately, but release status must aggregate their real results. Retry only infrastructure flakes; a retry must not hide a deterministic product failure.

## 9. Exit criteria

A complete release requires:

- all declared core and host-contract tests passing;
- every supported target pack passing its real build/runtime matrix;
- all end-to-end scenarios passing their acceptance criteria;
- no unresolved critical/high security findings;
- no unapproved license/provenance gaps;
- visual review completed for visual scenarios;
- installation from the exact release artifact verified;
- documentation and known-limitations lists matching observed behavior;
- a clean GitHub pull request containing the evidence and final review.
