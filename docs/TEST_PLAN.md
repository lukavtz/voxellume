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
- valid and malformed block/item/entity assets and `TextureSpec`/`AnimationSpec` documents;
- `.grid`/`.mcpx`/`.bbmodel` source-to-export round trips, stale exports, missing textures, invalid references, duplicate identifiers, and wrong resource roots;
- vertical frame-strip dimensions/order, `.png.mcmeta` timing/interpolation, loop deltas, palette/alpha/tiling, UV/orientation, rig pivots/roles, clip transitions, z-fighting, and planted animation defects;
- deterministic cleanup and seeded regeneration hashes, including replacement of every adapted sosadly random path and normalization of editor UUID/state;
- verification report ordering and status transitions, including `source`, `browser(surface=...)`, and `design_review` evidence classes and the prohibition on unchecked/preview-only passes;
- unsupported check reporting;
- partial build/test failure diagnostics;
- artifact path and checksum correctness;
- journal HMAC authentication before recovery, kept distinct from unkeyed evidence `SHA256SUMS` coverage/tamper detection and read-only publication;
- no implicit overwrite or network mutation where prohibited.

### 2.3 Security tests

Use adversarial fixtures:

- `..` and absolute-path escape attempts, including the output escapes demonstrated by raw mc-asset CLI/MCP;
- symlink-parent escapes demonstrated by raw mc-asset, plus concurrent path-swap races and hardlinked inputs/outputs not exercised by its pilot;
- oversized raster input before spawn/read, decoded pixel/dimension bombs, output/log/MCP-response floods, and ZIP/nested-archive bombs;
- partial multi-artifact writes and failure/cancellation during staged journal publication, requiring no outside-root or partial canonical output;
- raw sosadly outside-root requests, default-on `execute_script`, plugin installation, and unauthenticated loopback commands, all rejected by the absence of that server surface;
- fal model-as-URL credential exfiltration, self-attested ComfyUI workflow approval, loopback redirects, stalled providers, cancellation during final download, and secret-bearing request/workflow manifests;
- unsigned or MAC-repaired evidence, altered review subjects/scenarios/reviewers, unexecuted passes, preview-only client claims, and stand-in human approvals;
- command and argument injection through metadata and target input;
- malicious Gradle/build scripts attempting unexpected filesystem or network access;
- archive traversal and unsafe extraction;
- secret values in environment, logs, process output, reports, and artifacts;
- output floods, hung compilers, hung games, and runaway child processes;
- cancellation before start, during build, and during game execution;
- corrupted target manifests, docs metadata, templates, and fixtures;
- untrusted MCP input and oversized structured results.

Assertions verify containment, fail-closed behavior, redaction, process cleanup, bounded resource use, and accurate error reporting.

#### Native path and process contracts

The existing path/process supervisor suites exercise the host on which they run; their results do not transfer to another OS or architecture. macOS and Linux CI must each run the real Koffi prebuilt and assert:

- host-granted root authority, read-only project roots, staging-only writes, realpath pinning, and rejection of forged capabilities;
- traversal, absolute paths, NUL, missing parents, symlink leaves/parents, concurrent root/parent swaps, hard-linked mutation targets, archive links, revision conflicts, no-replace publication, and one-writer atomicity without outside-root mutation;
- fixed argv with `shell:false`, scrubbed environment and isolated directories, exact timeouts/output limits, nonzero/output-overflow failures, pre-spawn cancellation, complete process-group cleanup, and `timed_out`/`cancelled`/`unavailable` never becoming `passed`;
- missing prebuilt/native symbols and the Docker backend failing closed as unavailable, with no source-build, shell, pathname-mutation, or Windows single-PID/`taskkill` fallback;
- exact EULA URL and network host/purpose/cache approval scopes, mode-`0600` persistence, and no implicit approval.

Required Windows x64 and ARM64 NTFS CI probes must execute, not mock, the NTDLL and Job Object backends. They cover Koffi prebuilt resolution and ABI sizes/offsets; relative opens and missing/not-directory errors; junction/symlink leaves and intermediate hops; parent-swap races; mkdir/rename/no-replace/unlink/rmdir; cross-volume and sharing failures; hard-link refusal; positional I/O and short writes; file flush plus explicit unsupported directory flush; stable file identity/revision CAS; long paths and filesystem-defined case behavior. Process probes cover suspended creation and assignment before resume, child/grandchild cleanup on cancellation, timeout, normal supervisor close, and supervisor crash, bounded output, scrubbed environment, denied job assignment as `unavailable`, and no `taskkill`, `MoveFileExW`, or unsafe path fallback. Unsupported filesystem/API behavior must remain `unsupported` or `unavailable`, not pass.

No Windows runtime probe has yet been executed and recorded. Both architectures therefore remain **unverified** and outside the qualified support matrix; source inspection, cross-compilation, mocks, or a probe on only one architecture cannot close this gate.

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

Every visual rule has a stable ID and one primary evidence class:

- `source`: schemas, source/export bytes and hashes, deterministic metrics, import/export round trips, and independent evaluated-pose oracles;
- `browser`: rendered-surface evidence with an explicit `surface`. Only `minecraft_client` closes in-game gates; `blockbench` and `blender` are supplementary previews;
- `design_review`: reviewer decision, rubric, annotated captures/contact sheets, reasons, scope, and revision.

Execution uses the common `passed|failed|timed_out|cancelled|unsupported|unavailable` statuses. An unexecuted check has `checked=false` and cannot pass. P0 security/load/missing-asset and P1 required-state/loop failures block acceptance. P2 visible seam, UV, clipping, or tint findings block asset approval without a scoped reviewed exception. Numeric image diffs do not decide aesthetics.

### 5.1 Static asset gates

For every model, texture, GUI, animation, or visual effect:

- validate `TextureSpec`/`AnimationSpec`, target revision, style-board provenance, and acceptance references before generation;
- enforce input byte/pixel limits before decode, exact dimensions, integer-nearest scaling, palette and alpha policy, silhouette, and tiling wrap/seam metrics;
- verify editable `.grid`/`.mcpx`/`.bbmodel` sources and exported runtime hashes, blockstate/model/entity references, UV bounds/orientation, nonzero faces, bone parents/pivots, and independent round-trip diffs;
- validate actual Fabric `~1.21.1` and NeoForge/Forge singleton/range metadata across all dependency tables; parse GeckoLib `1.12.0` geometry and `1.8.0` animation schemas rather than accepting internal envelopes;
- require animated textures to have `height = width × frameCount`, nonempty frames, explicit valid order, integer `frametime >= 1`, matching interpolation, and measured last-to-first loop delta;
- evaluate declared bone clips for loop seam, travel/strike direction, required movement, ground penetration, self-intersection, and unapproved coplanar/z-fighting pairs;
- rerun deterministic cleanup and seeded generators and compare semantic/output hashes; hosted-AI seed repetition alone is not a reproducibility check;
- inspect Blockbench/Blender previews and contact sheets where applicable, but label them preview evidence only.

### 5.2 Real Minecraft and design-review gates

Run the packaged production JAR in a clean target instance and capture, where applicable:

1. inventory icon and tooltip;
2. first-person and third-person hand;
3. dropped item and placed block;
4. north/east/south/west and top/bottom;
5. GUI open/close and animation state changes;
6. every ModSpec-declared idle/walk/run/attack/hurt/death/fly/custom state, including transitions, mid-clip retrigger, once/hold-last behavior, and death final pose;
7. tileable 3×3 surfaces, light/dark alpha backgrounds, and day/night/emissive states;
8. multiplayer observer state synchronization and persistence/restart where required.

Each scenario fixes resolution, GUI scale, FOV/camera, seed/world state, tick/time/weather, inputs, OS/renderer/GPU, production-JAR and baseline hashes, and tolerance. Runtime assertions prove state and behavior; screenshots prove only their declared rendered surface. Independent design review then evaluates style-board coherence, materials, silhouettes, UV distortion, clipping, z-fighting, animation quality, and GUI readability.

Fabric screenshot GameTest assertions are target-local where the exact API exists. Their absence on `1.21.1` is `unsupported` for that method, not a pass. Other targets use their qualified client-capture path; every route still requires behavior assertions and human design review.

### 5.3 Conditional tool pilots and evidence boundary

Mosaicary must pass GLB/bone/channel/multi-texture/coplanar/curved-mesh conversion, import-report and round-trip diffs, complete network denial, and production-client review before ingress is enabled. Perfect-pixel/Unfaker must pass grid/palette/alpha and one-pixel-detail fixtures before use. Blender fixed scripts require planted loop/UV/z-fight defects, environment hashes, cancellation, and contact-sheet checks. None becomes production-qualified from upstream claims.

The completed mc-asset pilot passed 22/22 pilot assertions and 19/19 deterministic artifact pairs; the sosadly pilot exercised rig/generator/analyzer/paint methods and found the planted open-loop gap. These are tool-selection evidence only. Neither executed real Minecraft nor obtained human aesthetic approval, so neither satisfies §5.2 or authorizes broader raw integration.

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
- **Native execution gate:** real path/process contracts on macOS and Linux; required NTDLL/Job Object probes on Windows x64 and ARM64 before either Windows architecture can be declared verified.
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
