# Source/MCP candidate benchmark

Date: 2026-11-07.

## Verdict

Neither pinned third-party candidate qualifies for production. The source facade remains disabled. Do not enable either candidate without passing the complete correctness, security, cancellation, offline, and performance gates.

## Candidates

- Adhi `adhi-jp/minecraft-modding-mcp` `8.1.0`, revision `552489550c9d652dbfacee67df6f6b816fe12034`.
- ModLens `CreeperHost/modlens-mcp`, revision `ba2020c226b51858d157bc943ed13f1c6b578514`.

## Adhi evidence

The permanent runner is `tests/integration/source-mcp/run.ts`; fixtures and exact hashes live under `fixtures/source-mcp/`.

Executed full-matrix attempts produced 14/68 and 19/68 passing cases before later routing corrections. Two subsequent full attempts exceeded the 300-second command limit and are not passing evidence. Focused NeoForge `find_class` passed after exact workspace routing was fixed. Focused NeoForge `read_source` then failed its independent oracle: upstream silently returned vanilla `Item` source, and the runner reported `patched loader source is not distinct from vanilla`.

Security review also found that Quilt mappings cannot be represented as Mojang or identity mappings. The pinned Quilt Tiny file maps `net/minecraft/class_1792` to `net/minecraft/item/Item`, not `net/minecraft/world/item/Item`. Unsupported Quilt and unverified patched-source requests now fail closed instead of returning fabricated success.

The adapter was hardened during the pilot: offline Vineflower/tiny-remapper pins, literal-loopback manifest validation, offline request rejection for online candidates, binary SHA-256 verification, sibling-source rejection, exact right-target diffs, complete-result checks, package/entrypoint digests, header limits, and unambiguous class matching. These fixes do not establish full candidate qualification.

## ModLens evidence

The pinned checkout was inspected at `/tmp/modlens-mcp`. It was not runtime-qualified because static inspection found unconditional gate blockers:

- no offline mode; first-use tools and mappings use unhashed downloads with retries;
- detached Vineflower children lack a cancellation path and can survive facade cancellation;
- artifact lookup is database/`sha1` based, not exact coordinates plus caller-verified SHA-256;
- class diffs are whole-artifact/version or database-ID operations, not exact left/right artifact operations;
- patched source export supports ModDevGradle only; ForgeGradle/NeoGradle/Loom discovery is unimplemented;
- stdio responses are unbounded and errors can contain absolute paths/stack frames.

Primary evidence: `src/mod-reference.ts`, `src/java-tools.ts`, `src/fetch-utils.ts`, `src/tools/version-diff.ts`, `scripts/gradle/modlens.init.gradle`, and `README.md` in the pinned checkout.

## Remaining reusable work

`src/core/sources/tiny-mappings.ts` provides a bounded Tiny v2 parser for exact future Quilt integration. `fixtures/source-mcp/` and the runner remain the reproducible gate for any replacement candidate. The source facade continues to validate exact artifact identities, archive contents, paths, cancellation, response budgets, and both sides of diffs.
