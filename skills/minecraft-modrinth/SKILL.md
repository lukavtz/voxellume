---
name: minecraft-modrinth
description: Use for strictly read-only Modrinth project/version resolution, dependency-graph inspection, and approved integrity-checked downloads of declared Minecraft dependencies.
---

# Minecraft Modrinth

Use the vendored [SirEdvin API procedure](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/modrinth-api/SKILL.md) and [endpoint workflows](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/modrinth-api/references/api-v2-workflows.md). This skill never publishes, creates, modifies, follows, uploads, or deletes Modrinth data.

## Inputs

- Declared project ID/slug, optional exact version ID, release policy, and purpose.
- Exact Minecraft release, loader, physical side, and existing dependency lock/graph.
- Approved network scope and identifying User-Agent; downloads also require explicit approval and empty authorized staging.

## Procedure

1. **Authorize only reads.** Use HTTPS GET against `https://api.modrinth.com/v2` with timeouts, identifying User-Agent, status checks, and rate-limit handling. Public reads omit Authorization; never forward credentials to CDN/source hosts. Missing approval or network returns `unavailable`.
   **Complete when:** every endpoint is within approved read scope and no write endpoint is invoked.
2. **Resolve the exact project.** Fetch `/project/{id-or-slug}`. If discovery is unavoidable, use `/search` with JSON-encoded, URL-encoded facets, deduplicate project IDs, then fetch full metadata. Search hits establish neither identity nor joint compatibility. Empty results return `not_found`; competing identities return `ambiguous`.
   **Complete when:** one project ID matches the declaration or resolution stops explicitly.
3. **Pin one compatible version.** When an explicit or dependency `version_id` exists, fetch `/version/{id}` directly and validate its `project_id`, loader, game release, and policy; never replace it with another compatible version. Only without an exact ID, query `/project/{id}/version` with JSON-array `loaders` and `game_versions`, check each version’s own arrays and release policy, then fetch the selected `/version/{id}` and persist its opaque ID. No documented `limit`/`offset` exists. Never infer SemVer or repeat moving “latest” queries. Candidates without deterministic user-approved policy return `ambiguous`.
   **Complete when:** the exact version matches project, loader, game release, and policy.
4. **Resolve the dependency graph.** Inspect `dependencies` by `dependency_type`: required, optional, incompatible, or embedded. Traverse required project/version references with visited IDs, detect cycles, and retain optional/external-filename entries for review. Check side and licensing; expose missing, incompatible, cyclic, or externally unresolved requirements.
   **Complete when:** every node has an exact version or visible unresolved outcome.
5. **Select and verify files.** Prefer the primary file; review the API’s first-file fallback for purpose. Reject accidental sources/dev/javadoc/signature/resource-pack artifacts; remaining choices are `ambiguous`. Download only with approval, using the exact API URL and safe basename in empty staging, refusing traversal and overwrites. Set a host-approved hard byte ceiling, reject excessive declared sizes before download, stream with that limit, and abort plus remove output on overflow. Review HTTPS redirects; then verify exact byte size and SHA-512 before handoff. Quarantine/delete mismatches and return `failed`; never execute files here.
   **Complete when:** each artifact matches filename, size, and SHA-512, or none leaves staging.
6. **Report evidence limits.** Record project/version IDs, compatibility arrays, dependency decisions, file metadata, hashes, and approvals. Matching hashes do not prove publisher trust, safety, redistribution rights, or runtime compatibility; route installation checks to `minecraft-verification`.
   **Complete when:** metadata reads, verified downloads, and unexecuted checks remain distinct.

## Output

Return the exact dependency graph, version/file manifest, approved verified artifacts, and explicit `not_found`, `ambiguous`, `incompatible`, `failed`, or `unavailable` outcomes. Never claim publication, mutation, or runtime verification.
