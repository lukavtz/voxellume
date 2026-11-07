<p align="center">
  <img src="./assets/readme/hero.png" width="100%" alt="Voxellume voxel landscape with real Fabric client and deterministic scenario screenshots">
</p>

Voxellume is a private agent capability for building Minecraft Java mods from an idea to a reviewed, reproducible delivery. It combines exact target packs, editable source and art, secure execution, and evidence-backed verification across OMP, DeepSeek Harness, and MCP.

## Proof, not promises

The current baseline already produces real artifacts and real client evidence. It does not claim blanket compatibility or unexecuted passes.

| Baseline               | Executed evidence                                                                                                                                 | Status                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Fabric 1.21.1 r2**   | Clean build, dedicated server, required GameTest, production JAR, real client and deterministic seed capture, pristine packaged-JAR server        | **Candidate** — world/inventory/animation matrix and packaged-JAR client remain incomplete |
| **NeoForge 1.21.1 r2** | Binary-pipeline clean build, two positive GameTests plus a deliberately failing control, dedicated and packaged-JAR servers, real client mod list | **Candidate** — packaged-JAR client and complete visual matrix remain incomplete           |
| **Quilt 1.21.1 r2**    | Clean build, dedicated server, production JAR                                                                                                     | **Candidate** — GameTest unavailable; real-client check timed out                          |
| **Forge 1.21.1 r1**    | Exact MDK and artifact identities checked; decompilation exceeded the mandatory 4 GiB sandbox                                                     | **Rejected** — no production JAR or runtime claim                                          |

Each record includes exact commands, artifact hashes, logs, sandbox limits, and explicit unavailable outcomes.

## One engine, three surfaces

The same `CoreOperations` facade powers all hosts. Model input never supplies a target pack, verification policy, or its own filesystem authority.

```text
minecraft_target_resolve
minecraft_project_inspect
minecraft_project_scaffold
minecraft_assets_validate
minecraft_project_verify
```

Every host returns the same versioned `DomainResult<T>` with stable error codes, retryability, details, and evidence references.

| Surface              | Native contract                                                                        |
| -------------------- | -------------------------------------------------------------------------------------- |
| **OMP**              | Extension tools, conventional skills, agents, and commands                             |
| **DeepSeek Harness** | External Cordis bundle, typed tools, managed verification jobs, shared system prompt   |
| **MCP**              | Official TypeScript server v2 over stdio, strict Zod inputs, bounded structured output |

## How it works

1. **Resolve exactly.** Select an immutable Minecraft + loader + mappings + JDK + Gradle pack, or return `unsupported` without substituting a nearby version.
2. **Stage safely.** Work in an authorized transaction workspace with last-good recovery, per-project locks, bounded processes, and separate project/scaffold roots.
3. **Keep creativity editable.** Preserve ModSpec, `.bbmodel`, JSON, PNG, Java, and export provenance instead of delivering opaque generated files.
4. **Verify in order.** `static → build → server → gameTest → client → productionJar → visual → package`. Failed or unavailable stages never become passes.
5. **Deliver evidence.** Production JAR, source, editable assets, checksums, reproduction commands, and a separate authenticated evidence bundle.

## Install and verify

Requirements: Node.js `>=24.9.0`, pnpm `12.18.0`, and the target's JDK. Sandboxed build/runtime checks use Docker.

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm pack
```

The result is `voxellume-0.1.0.tgz` with prebuilt JavaScript and declarations.

**OMP**

```sh
omp plugin link /absolute/path/to/voxellume
```

**DeepSeek Harness**

```sh
dsh plugin --profile voxellume-test add ./voxellume-0.1.0.tgz
dsh --profile voxellume-test --dump-config
```

**MCP stdio**

```sh
voxellume-mcp
```

Run the deterministic gate before delivery:

```sh
corepack pnpm verify
```

## Current boundaries

- Target packs are candidates or explicit rejected/unsupported outcomes; **no complete 1.21–26.3 support matrix is claimed**.
- Full real-client, packaged-JAR, and visual qualification is still incomplete. Required unavailable checks block `supported`.
- The source facade is disabled because neither candidate passed the correctness/security benchmark.
- Quilt GameTest remains unavailable without a separately qualified workflow.
- This repository is private. Third-party revisions, licenses, modifications, and notices are recorded under `THIRD_PARTY/` and `support-manifest.json`.

## Deeper reading

- [Product specification](./docs/SPEC.md)
- [Architecture and trust boundaries](./docs/ARCHITECTURE.md)
- [Verification plan](./docs/TEST_PLAN.md)
- [Host contracts](./docs/research/host-contracts.md)
- [Sandboxed visual runtime](./docs/research/visual-qualification-image.md)
- [Pack hashes and qualification links](./support-manifest.json)
