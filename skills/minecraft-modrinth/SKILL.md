---
name: minecraft-modrinth
description: Use when resolving a Modrinth project or version, reading its dependency graph, or checking a downloaded file against its published hash.
---

# Minecraft Modrinth

Read-only. This skill never publishes, edits, follows, uploads, or deletes Modrinth
data. Vendored API procedure:
[Modrinth v2](../../THIRD_PARTY/siredvin-minecraft-modding-skills/skills/modrinth-api/SKILL.md).

The plugin itself makes no network requests. Any call here is the harness's own
network access, which needs the user's approval and an identifying User-Agent.

## Procedure

1. Resolve the project. `GET https://api.modrinth.com/v2/project/{id-or-slug}`. Use
   `/search` only when the slug is unknown; search hits are candidates, not identity.
2. Pin one version. With an explicit version id, fetch `/version/{id}` and check
   `project_id`, `loaders`, and `game_versions`. Without one, query
   `/project/{id}/version` filtered by loader and game version, then fetch the chosen
   version and record its id. Never repeat a moving "latest" query.
3. Read dependencies by `dependency_type`: required, optional, incompatible, embedded.
   Traverse required entries with cycle tracking; keep external and optional entries
   visible for review.
4. Download only with approval, into an empty directory, from the exact API URL. Reject
   declared sizes over your stated ceiling and stream with that same limit.
5. Verify the file's byte size and SHA-512 against the version metadata. A mismatch is
   deleted, not installed.
6. Match the downloaded loader and game version against the pin from
   `minecraft_target_info`. A hash match proves the bytes, not compatibility.

## Rules

- No write endpoints, no publishing, no following.
- Never forward credentials to CDN or source hosts.
- A hash-verified file is still untrusted code. It runs only when the project runs it,
  through `minecraft_run`.

## Output

Return the resolved project and version ids, the dependency graph, the file list with
sizes and hashes, and every entry left unresolved.
