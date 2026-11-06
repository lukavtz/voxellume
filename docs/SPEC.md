# Voxellume — Product Specification

Status: approved
Product name: Voxellume

## 1. Product goal

An installable agent capability for OMP and DeepSeek Harness that turns a natural-language mod request into a complete, maintainable, visually coherent, tested Minecraft mod.

The agent owns the full workflow: discovery, game design, target selection, implementation, assets, tests, runtime verification, iteration, packaging, and documentation. Deterministic tools verify claims; the agent must not describe an unbuilt or unrun mod as verified.

## 1.1 Distribution and third-party material

The product is private and intended only for its owner. The source repository is private.

Third-party code, skills, prompts, models, textures, documentation, and other assets may be included as-is at the owner's direction. The owner owns any later legal review. A private SBOM/provenance ledger records source URL, revision, author, declared license, modifications, and bundled notices so that review remains possible.

## 2. User outcome

Given a request such as "Create a magic farming mod for Minecraft Java", the user receives:

- a coherent game design with progression, balance, recipes, interoperability, and edge cases;
- a resolved Minecraft/loader/mappings/Java/Gradle target;
- readable source code and editable assets;
- textures, models, localization, recipes, loot tables, tags, and data required by the design;
- unit, integration, data-validation, and supported in-game tests;
- a built mod artifact with reproducible build instructions;
- runtime and visual verification evidence where the environment supports them;
- a concise report listing verified behavior, remaining limitations, and exact reproduction commands.

## 3. Product principles

1. **Evidence before completion.** A feature is done only when its specified checks pass.
2. **Explicit targets.** Every supported target has a versioned target pack. An unknown target is rejected with a useful explanation instead of receiving an incompatible generic template.
3. **Version-local knowledge.** The agent reads documentation and examples for the selected target, not memory from another Minecraft or loader version.
4. **Editable creativity.** Generated art and models remain editable; Blockbench project files are included when Blockbench is part of the selected asset pipeline.
5. **One shared engine.** OMP and DeepSeek Harness adapters expose the same core behavior and verification results.
6. **Progressive disclosure.** Skills load only the workflow and target knowledge needed for the current task.
7. **Safe execution.** Generated and third-party code is untrusted. Filesystem, process, network, credentials, and resource usage follow explicit policy.
8. **No silent scope reduction.** Unsupported editions, loaders, versions, or asset operations are reported as unsupported.

## 4. Full workflow

### 4.1 Discover

- Parse the requested gameplay, aesthetic, compatibility, and distribution goals.
- Inspect an existing mod before changing it.
- Resolve the exact target against installed target packs.
- Identify missing user decisions only when defaults cannot resolve them safely.

Completion: a target record and requirement list with acceptance criteria exist.

### 4.2 Design

Produce a design covering:

- player fantasy and differentiating mechanic;
- blocks, items, entities, effects, UI, world generation, and configuration as required;
- progression, recipes, balance, multiplayer behavior, persistence, migrations, and failure cases;
- art direction, palette, silhouettes, animation, sound, and accessibility;
- a versioned `TextureSpec` for each texture and `AnimationSpec` for each animation set, tied to the exact target-pack revision and acceptance rules;
- a reviewed style board with reference provenance, palette/ramps, silhouettes, light direction, material examples, and negative constraints; reference plates are not shipping pixels;
- compatibility and dependency policy;
- testable acceptance criteria for every requested feature.

Completion: every requested feature maps to implementation units and observable checks.

### 4.3 Plan

- Select target-specific templates and official documentation.
- Split work into vertical slices that can be built and tested independently.
- Delegate independent research, art, implementation, or review tasks when this reduces elapsed time without creating conflicting writes.
- Record architectural decisions and their consequences.

Completion: the plan identifies file ownership, public seams, test evidence, and dependencies.

### 4.4 Implement

- Scaffold from the selected target pack.
- Implement one vertical slice at a time using red-green TDD.
- Reuse maintained, license-compatible code and patterns with attribution where required.
- Keep generated code idiomatic to the selected loader and mappings.
- Update localization, data, assets, documentation, and tests with the behavior.

Completion: the slice passes its public-interface tests and deterministic static checks.

### 4.5 Create assets

- Start from approved `TextureSpec`/`AnimationSpec` contracts and a style board. Texture contracts cover role, target revision, texel grid, dimensions, palette, alpha, tiling, seed/RNG, cleanup, frame timing/order, exports, and acceptance rules. Animation contracts cover rig/bone roles and pivots, clips/states, tick timing, root motion, keyframes/interpolation, transitions, exports, and acceptance rules; arbitrary bone names, code, and command lines are not accepted.
- Produce textures through an approved manual, `mc_asset`, host-AI, fal, or local ComfyUI route. Preserve the immutable concept/reference and use pinned `mc-asset` `v0.5.0` at `bedf67229ab0fdf304f6d40bc0000a27bd05e880` for recorded deterministic pixel cleanup, seeded operations, tiling, and frame export. Hosted generation is not assumed reproducible from its seed.
- Preserve editable `.grid`/`.mcpx` texture sources and `.bbmodel` models. Keep the original AI concept and cleanup recipe as provenance; a generic atlas is diagnostic/editable only, never a second runtime source of truth.
- Export ordinary target-local PNGs and models. Animated textures use a vertical frame strip with sibling `.png.mcmeta`, explicit frame order, integer tick timing, and deliberate interpolation/loop policy.
- Use `jasonjgardner/blockbench-mcp-plugin` `1.10.1` at `97a8a80d3a37bf95c5e136d93d2c7da399fff753` as the sole external Blockbench engine. Adapt only the reviewed MIT rig, generator, analyzer, and paint methods from `sosadly/blockbench-mcp` `0.3.1` at `028cdd76589de2e2cea51bfd79495b50a3c7d1d2`; do not install or register its MCP server. All adapted random operations use versioned seeded RNG, never `Math.random()`.
- Optionally use pinned Blender scripts for loop analysis, QA, and contact sheets; Blender/glTF is not a Minecraft runtime delivery format. Mosaicary `0.1.4` at `08bdba5252a378cf8e2111b0c2cb27cec4ea15ba` is conditional local glTF/Blender ingress only, pending fidelity/network-deny/runtime pilots, and cannot add bone animation to Java Block/Item models.
- Validate source bytes and references, UV/orientation/scale, model round trips, rig and clip states, loop boundaries, clipping, z-fighting, tiling, alpha, and deterministic regeneration.
- Review Blockbench/Blender previews separately from real-client evidence. Exercise the same assets and declared states in the production-JAR Minecraft client and obtain design review for subjective quality.

Completion: every asset passes deterministic source checks, required real-Minecraft runtime checks, and its independent design-review gate. Preview images, hashes, and numeric diffs alone do not establish in-game correctness or aesthetic approval.

### 4.6 Verify

Run in order:

1. formatting and source/static analysis;
2. unit tests;
3. resource and data validation;
4. full clean build;
5. dedicated-server startup and supported server game tests;
6. client startup and supported client game tests;
7. gameplay smoke scenarios;
8. visual inspection and screenshot comparison where supported;
9. dependency, license, and security checks;
10. packaging and clean-checkout reproduction.

A failed check returns structured diagnostics to the implementation loop. Completion is prohibited while any required check is failing, unrun, or unverifiable without disclosure.

### 4.7 Deliver

- Package the mod and source artifacts.
- Write user and developer documentation.
- Record exact target, dependency versions, commands, test results, artifacts, and known limitations.
- Commit reviewed changes and use the requested GitHub branch/push/PR workflow.

## 5. Plugin capabilities

### 5.1 Skills

Separate skills own distinct triggers:

- mod discovery and game design;
- Minecraft target resolution;
- loader-specific implementation;
- data and resource generation;
- Blockbench and texture workflow;
- build and diagnostic repair;
- runtime and gameplay verification;
- visual quality review;
- release and GitHub delivery.

Skills contain procedures and pointers to versioned references. They do not duplicate executable logic owned by tools.

### 5.2 Deterministic tools

The shared core provides these conceptual operations:

- resolve and inspect targets;
- inspect existing mod projects;
- scaffold from an approved target pack;
- validate source, resources, models, and generated project structure;
- execute bounded build and test tasks;
- launch supported game verification scenarios;
- collect structured diagnostics and artifacts;
- validate final artifacts and reproduction instructions.

Exact public interfaces and test seams are architecture decisions and must be confirmed before tests are written.

### 5.3 Host adapters

- **OMP:** package manifest, extension module, conventional skills, agents, commands, tools, and optional MCP configuration.
- **DeepSeek Harness:** external Cordis bundle, typed model-facing tools, bundle patch, lifecycle handling, and host-native execution policy.

Adapters translate host contracts only. Domain behavior stays in the shared core.

### 5.4 MCP

MCP is optional packaging for deterministic services that are useful outside native OMP and Harness tools. It must not become a second implementation of domain behavior. Native adapters and MCP call the same core interfaces.

### 5.5 Agents

Role-specific agents may handle game design, target research, art, implementation, and review. The orchestrator assigns separate files or read-only tasks, integrates results, and runs the same mandatory verification gates.

## 6. Target packs

Each target pack declares:

- Minecraft edition and version;
- loader and exact compatible loader range;
- mappings and version;
- Java runtime and toolchain;
- Gradle and wrapper provenance;
- template and resource format versions;
- official documentation references;
- dependency coordinates and cryptographic verification metadata;
- supported build, server, client, game-test, and visual-verification adapters;
- fixtures and smoke scenarios;
- support status and known limitations.

A target is supported only after its complete verification matrix passes in CI or a documented equivalent environment.

## 7. Quality metrics

The product is evaluated against a versioned benchmark of real mod requests, not promotional claims.

### Correctness

- acceptance criteria passed by feature;
- clean-build success rate;
- runtime scenario success rate;
- resource/model validation success rate;
- regressions detected before delivery;
- unsupported-target false-success rate, required to be zero.

### Speed

- wall-clock time to first successful build;
- wall-clock time to fully verified delivery;
- number of agent iterations and human interventions;
- cache-safe repeated verification time.

### Creative quality

A versioned rubric evaluates gameplay coherence, balance, art consistency, model quality, UI usability, localization, and documentation. Automated checks supplement rather than replace human visual and gameplay review.

## 8. Security requirements

- Validate every model-generated argument at the host boundary.
- Resolve paths inside an authorized project root and reject traversal and symlink escapes.
- Use argument arrays for processes; never interpolate model input into shell commands.
- Apply cancellation, timeouts, output limits, and resource limits to builds and games.
- Keep credentials out of generated projects, logs, artifacts, and tool results.
- Pin and verify downloaded toolchains and dependencies where the ecosystem supports it.
- Treat Gradle scripts, plugins, generated code, and install scripts as executable trust boundaries.
- Invoke `mc-asset` only as a pinned external process behind the shared Voxellume execution facade. Expose allowlisted operations, not raw CLI paths or raw MCP tools. Enforce facade-owned authorized roots, realpath and mutation-time symlink/race checks, hardlink rejection, pre-read/decode/output/log limits, transaction staging with journaled all-output publication, complete process-group cleanup, `shell:false`, offline/scrubbed environments, and SHA-256 evidence.
- Run external Blockbench as a root-restricted process with `risky_eval` disabled and loopback-only desktop access. Never expose sosadly `execute_script`, plugin installation, arbitrary import/export paths, or its unauthenticated command bridge.
- Require host approval for operations outside the project sandbox.
- Do not expose a network service beyond loopback by default.
- Preserve audit evidence for external mutations.

## 9. Testing strategy

Development follows SDD, Architecture-Driven Development (ADD), and TDD. ADD means that module seams, host adapters, target-pack contracts, security invariants, and architectural decisions are recorded before implementation.

TDD uses vertical slices: one failing public-interface test, the minimum implementation that passes, then review. Tests must not pin incidental implementation details.

Proposed public seams for confirmation:

1. target resolution;
2. project scaffolding;
3. build and verification execution;
4. asset validation;
5. OMP tool contract;
6. DeepSeek Harness tool contract;
7. final verification report.

Permanent tests cover behavior, malformed input, path containment, cancellation, timeouts, unsupported targets, partial failures, and artifact correctness. Integration fixtures use real toolchains in a separately identified CI suite.

## 10. Repository hygiene

- Group files by domain and host adapter.
- Keep one authoritative location for each contract and workflow.
- Keep research, specification, architecture decisions, source, fixtures, and generated output separate.
- Never commit credentials, build output, caches, logs, or temporary scripts.
- Run deterministic format, lint, type, security, unit, integration, and packaging checks before commits and PRs.

## 11. Confirmed product decisions

- Java Edition is the required edition; Bedrock is outside the complete release scope.
- Fabric, NeoForge, Forge, and Quilt use separate target packs and real verification matrices.
- Editable `.grid`/`.mcpx`/`.bbmodel` sources and direct JSON/PNG/Java asset generation are required; frame strips plus `.png.mcmeta` are the animated-texture runtime contract.
- Public test seams: target resolution, scaffolding, verification, assets, OMP, Harness, and final report.
- Base toolchain: pnpm, TypeScript, and the built-in Node test runner.
- Repository: private [`lukavtz/voxellume`](https://github.com/lukavtz/voxellume).

- Required coverage is every official Minecraft release from 1.21 through 26.3, using JDK 21 and 25 as appropriate. Each loader/release combination still requires its own qualification evidence and an explicit unsupported result when no compatible loader/API exists.
- ModLens and adhi minecraft-modding-mcp are compared on the same fixtures before one source/mapping integration is selected.
- Real-client verification combines a minimal target-specific verification mod with suitable OSS adapters.
- Asset generation supports host image tools, fal, and local ComfyUI. Pinned `mc-asset` is an external-process implementation dependency behind the Voxellume facade; jasonjgardner is the only external Blockbench engine; sosadly is method adaptation only; Blender is optional QA/review tooling; Mosaicary remains conditional and unqualified.
- The completed mc-asset and sosadly pilots establish only their recorded process/method behavior. Neither pilot establishes real-Minecraft correctness or human aesthetic approval.
- MCreator and Player Games are optional integrations, not core dependencies.
- Local prerequisites include JDK 21/25, Blockbench, Blender, ffmpeg, and Docker-based isolation.
- EULA and network approval is confirmed once per environment, recorded, and reused with cached dependencies.
- Reuse is mixed: selected files may be vendored as-is, MCP tools run separately, and target-specific methods are adapted into core.
