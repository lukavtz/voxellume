# Modrinth v2 read workflows

## Endpoint map

All paths below are relative to `https://api.modrinth.com/v2`.

| Need | GET path / interpretation |
|---|---|
| Search | `/search`: `query`, `facets`, `index`, `limit`, `offset` |
| Project | `/project/{id-or-slug}`: full metadata, nullable `source_url` |
| Batch projects | `/projects?ids=<JSON-array>` |
| Project versions | `/project/{id-or-slug}/version`: `loaders`, `game_versions`, `featured`, `include_changelog`; no documented limit/offset |
| Exact version | `/version/{id}` |
| Batch versions | `/versions?ids=<JSON-array>` |
| Categories | `/tag/category`: category objects |
| Loaders | `/tag/loader`: loader objects |
| Game versions | `/tag/game_version`: objects use `version`, not generic `name` |
| Licenses | `/tag/license`: objects include `id` and `name` |

Project/version IDs are opaque base62 identifiers (normally eight characters);
preserve them exactly. Slugs can change. File identity is a hash, not a required
`files[].id` field. Avoid freezing a moving API's exhaustive field enums into a
client: preserve unknown fields and consult the endpoint schema. Legacy v2 side
fields and newer environment metadata need explicit interpretation, not a blind
mapping to Packwiz `side`.

## Executable public reads

Requires curl and jq. Replace the identifying UA with your application identity.
`--get --data-urlencode` prevents raw JSON square brackets being interpreted as
curl URL globbing. `--fail-with-body` requires curl 7.76+; check the installed
version or use `--fail` on older clients.

```bash
UA='your-application/1.0 (your-public-contact-url)'
curl --fail-with-body --silent --show-error --max-time 30 --get   -H "User-Agent: $UA"   --data-urlencode 'query=modmenu'   --data-urlencode 'limit=5'   --data-urlencode 'facets=[["categories:fabric"],["project_type:mod"],["versions:1.21.1"]]'   'https://api.modrinth.com/v2/search'

curl --fail-with-body --silent --show-error --max-time 30 --get   -H "User-Agent: $UA"   --data-urlencode 'loaders=["fabric"]'   --data-urlencode 'game_versions=["1.21.1"]'   --data-urlencode 'include_changelog=false'   'https://api.modrinth.com/v2/project/modmenu/version'
```

Retain a successful version response in a temporary file when scripting multiple
steps. Use `set -euo pipefail` in Bash scripts (not portable `sh`), check curl
success before consuming the file, and fail if filtering yields no candidates.
For an explicitly requested latest **release**, this jq selection is a local
filter, not API pagination:

```bash
jq -e '[.[] | select(.version_type == "release")]
       | sort_by(.date_published) | last // error("no release candidate")' versions.json
```

For reproducible builds, resolve once and store the returned version ID rather
than repeating a latest query. Fetch `/version/{id}` thereafter, and recheck
project ID, loader, game version, file and dependency metadata before installation.
Search-only discovery never establishes joint loader/version compatibility.

## Downloads and verification

Only download when requested. Use the exact API file URL and an explicit safe
output basename in an empty staging directory. Reject absolute paths, `..`, slash
or backslash in remote filenames, and refuse overwrites. Require HTTPS and review
redirect destinations; send no API authorization to downloads. Check HTTP success,
expected size and SHA-512 over the downloaded bytes before making the staged file
available to a launcher/build. Delete or quarantine mismatches. A matching hash
proves agreement with API metadata, not publisher trust or redistribution rights.

Prefer the primary file; if absent the API permits the first file as a fallback,
but verify it is the desired runtime artifact, not sources/dev/javadoc/signature
or a required resource pack. If multiple candidates remain, report ambiguity
rather than silently choosing one. Platform upload validation is not a substitute
for local integrity checks or malware/compatibility review.

## Selected response fields and bulk discovery

Keep project `id`, `slug`, `title`, `description`, Markdown `body`, `license`,
`source_url`, `issues_url`, `wiki_url`, `discord_url`, `donation_urls`, `gallery`,
`loaders`, `game_versions`, and `versions` distinct. Nullable links do not prove
closed source; inspect licensing and project documentation. Do not assume the
project version-ID array is ordered for your release policy.

Version records provide `id`, `project_id`, `version_number`, `date_published`,
`version_type`, `loaders`, `game_versions`, `dependencies`, and `files`. Dependency
entries can identify a project, an exact version, or an external filename; inspect
`dependency_type` rather than treating all entries as mandatory downloads. File
records expose `url`, `filename`, `size`, `hashes`, `primary`, and nullable
`file_type`; do not require an invented file ID.

Search hits use `project_id`, `follows`, `versions`, `latest_version`, and
`date_modified`, whereas full projects use `id`, `followers`, `game_versions`,
and `updated`. These are different schemas, not interchangeable field aliases.
For bulk source discovery, page search using `offset`/`limit`, deduplicate project
IDs, then URL-encode a JSON ID array for `/projects` and join results by `id`,
not response position. Preserve null `source_url` values and report missing IDs.

Use `/tag/donation_platform` for donation-platform values. Category and loader
objects differ from game-version (`version`) and license (`id`, `name`) objects.
Read valid facets from the current search contract; inner groups are OR and outer
groups AND. Keep loader, game version, category, project type, license and side
filters separate when each condition is required.

The staging base `https://staging-api.modrinth.com` is a distinct environment,
not a production mirror or a safe target for unrequested writes. Do not transfer
production credentials or assume production IDs exist there.

## Official sources

- [Official API overview, auth, rate limits and UA](https://docs.modrinth.com/api/).
- [Project version query contract](https://docs.modrinth.com/api/operations/getprojectversions/).
- [Search contract](https://docs.modrinth.com/api/operations/searchprojects/).
- [Public Mod Menu metadata](https://api.modrinth.com/v2/project/modmenu) and its
  Fabric 1.21.1 version list were exercised without credentials during this audit;
  no artifacts were downloaded and no writes were issued. Results are dynamic,
  not a permanently pinned fixture or fabricated example response.
