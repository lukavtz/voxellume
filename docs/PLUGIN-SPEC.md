# Voxellume — Plugin Specification

Status: normative. Any change to a signature, error code, or trust boundary in this
document requires a matching change in `docs/TOOLS.md` in the same commit.

## 1. What the plugin is

Voxellume is a plugin for two agent hosts, OMP (`@oh-my-pi/pi-coding-agent`) and
DeepSeek Harness (`@deepseek-ai/dsh`). It ships:

- procedures (skills, agent roles, commands) that tell an agent how to build a
  Minecraft mod correctly;
- exact version data for 68 Java targets (`targets/pins.json`);
- one project template (`templates/fabric-1.21.1`);
- four tools that touch the filesystem and run processes: `minecraft_target_info`,
  `minecraft_project_scaffold`, `minecraft_run`, `minecraft_assets_check`;
- fixed Blender QA scripts (`scripts/blender/*.py`).

The plugin owns **no MCP server**. Blockbench is reached through the external
`blockbench-mcp` plugin running inside the Blockbench desktop application; Blender
is reached through its own CLI. The plugin documents both and validates their output.

The plugin owns **no evidence pipeline**: no manifests, no transaction journals, no
target status catalog, no `supported`/`qualified` labels, no hosted MCP surface.

## 2. Envelope

Every tool resolves to one JSON document:

```jsonc
{ "schemaVersion": "voxellume-tool-1.0.0", "status": "ok", "value": { } }
{ "schemaVersion": "voxellume-tool-1.0.0", "status": "error",
  "error": { "code": "unsafe_argument", "detail": "--init-script" } }
```

Rules:

- `value` is present only when `status === "ok"`; `error` only when
  `status === "error"`. Never both, never neither.
- `detail` is a short, deterministic, human-readable string. It never contains a
  stack trace and never contains absolute host paths outside the project root.
- Hosts serialize the envelope as a single text block. There is no second channel:
  no `details.evidence`, no trailing metadata.
- A tool that reports `status: "ok"` has observed the fact it reports: an exit code,
  a parsed file, or a hash it computed itself.

## 3. Error codes

| Code                        | Raised by                         | Meaning                                                     |
| --------------------------- | --------------------------------- | ----------------------------------------------------------- |
| `invalid_request`           | all                               | Parameters fail the tool's own validation rules             |
| `pin_not_found`             | `scaffold`                        | No pin matches the requested id                             |
| `template_missing`          | `scaffold`                        | Pin has no template, or the template directory is absent    |
| `destination_not_empty`     | `scaffold`                        | Destination exists and is not an empty directory            |
| `destination_outside_root`  | `scaffold`, `run`, `assets_check` | Resolved path escapes the project root                      |
| `task_not_allowed`          | `run`                             | Task id is not in the allowlist                             |
| `unsafe_argument`           | `run`                             | Extra argument is not in the allowlist                      |
| `project_not_found`         | `run`                             | Project root lacks the Gradle wrapper                       |
| `spawn_failed`              | `run`                             | The wrapper could not be started                            |
| `baseline_hash_mismatch`    | `assets_check`                    | Baseline screenshot bytes differ from the declared SHA-256  |
| `model_texture_missing`     | `assets_check`                    | Model JSON references a texture that does not exist         |
| `lang_key_missing`          | `assets_check`                    | A comparison locale lacks a key present in the baseline     |
| `lang_placeholder_mismatch` | `assets_check`                    | Ordered printf placeholders differ from the baseline locale |
| `png_invalid`               | `assets_check`                    | PNG signature, IHDR, or CRC is invalid                      |
| `png_too_large`             | `assets_check`                    | PNG exceeds byte, edge, or pixel limits                     |
| `file_missing`              | `assets_check`                    | A requested texture, model, or lang file is absent          |
| `json_invalid`              | `assets_check`                    | A model or lang file is not valid JSON                      |
| `dimension_mismatch`        | `assets_check`                    | Texture dimensions differ from the `WxH` expectation        |
| `pins_invalid`              | `target_info`, `scaffold`         | `targets/pins.json` is absent or schema-invalid             |

Codes are stable identifiers. Adding a code is a compatible change; renaming one is
not.

## 4. `minecraft_target_info`

Read-only. Returns the pinned Java targets, optionally filtered.

Parameters:

```jsonc
{
  "id": "java-fabric-1.21.1", // optional, exact match
  "minecraft": "1.21.1", // optional, exact match
  "loader": "fabric", // optional, exact match
}
```

Value:

```jsonc
{
  "pins": [
    {
      "id": "java-fabric-1.21.1",
      "minecraft": "1.21.1",
      "loader": "fabric",
      "loaderVersion": "0.20.1",
      "apiVersion": "0.116.17+1.21.1",
      "gradlePlugin": "net.fabricmc.fabric-loom-remap",
      "gradlePluginVersion": "1.17.21",
      "jdk": 21,
      "gradle": "9.8.2",
      "mappings": "mojang",
      "template": "fabric-1.21.1",
    },
  ],
  "tools": [
    "minecraft_target_info",
    "minecraft_project_scaffold",
    "minecraft_run",
    "minecraft_assets_check",
  ],
}
```

Rules: filters combine with AND. No match is `status: "ok"` with `pins: []`. `pins`
preserves file order (sorted by `id`). Approval class: `read`.

## 5. `minecraft_project_scaffold`

Writes a project copy of the pinned template. Approval class: `exec`.

Parameters:

```jsonc
{
  "destination": "ruby-tools", // required, relative to the host cwd
  "pinId": "java-fabric-1.21.1", // optional, defaults to that pin
  "mod": {
    "modId": "ruby_tools",
    "javaPackage": "dev.voxellume.ruby",
    "name": "Ruby Tools",
    "version": "1.0.0",
    "description": "…",
    "authors": ["Voxellume"],
    "license": "MIT",
  },
}
```

Validation:

- `modId ^[a-z][a-z0-9_]{1,63}$`; `javaPackage ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`;
  `authors` non-empty with non-empty entries; `name`, `version`, `description`,
  `license` non-empty. Violation → `invalid_request`.
- Destination must resolve inside the host cwd → otherwise `destination_outside_root`.
- Destination must be absent or an empty directory → otherwise `destination_not_empty`.

Value:

```jsonc
{
  "destination": "ruby-tools",
  "pinId": "java-fabric-1.21.1",
  "files": [
    "gradle.properties",
    "src/main/java/dev/voxellume/ruby/ExampleMod.java",
  ],
  "notes": ["class names kept as ExampleMod/ExampleModClient"],
}
```

Rules:

- Files are copied from the template, then text files are rewritten through an
  ordered substitution table (`com.example` → package, `modid` → mod id,
  `Example Mod` → name, `1.0.0` → version, `CC0-1.0` → license, `"Me!"` → first author).
  Binary files are copied byte-for-byte.
- Paths that embed the package or the mod id are renamed accordingly.
- Java class names are **not** renamed. The returned `notes` says so.
- Text is normalized to LF; `*.bat` keeps CRLF.
- `files` lists every created file as a repository-style relative path with `/`,
  in lexicographic order. Nothing is written outside `destination`.

## 6. `minecraft_run`

Runs one allowlisted Gradle task in a scaffolded project. Approval class: `exec`.

Parameters:

```jsonc
{
  "projectRoot": "ruby-tools",
  "task": "build",
  "extraArgs": ["--offline"],
  "timeoutSeconds": 900,
  "stopOnLog": "Done \\(",
}
```

- `task` ∈ `build | clean | test | runServer | runClient | runGametest | genSources`
  → otherwise `task_not_allowed`.
- `extraArgs` ⊆ `--offline | --info | --stacktrace` → otherwise `unsafe_argument`.
- `timeoutSeconds` default 900, maximum 3600.
- `stopOnLog` is a regular expression of at most 200 characters; it is compiled
  before the process starts, and a compile failure is `invalid_request`.

Execution rules:

- argv is exactly `["./gradlew" | "gradlew.bat", "--no-daemon", "--console=plain",
...TASK_ARGS[task], ...extraArgs]`. No shell. Nothing else is appended.
- The environment is `process.env` reduced to an explicit allowlist of toolchain
  and OS variables (`PATH`, `PATHEXT`, `SystemRoot`, `windir`, `ComSpec`, `TEMP`,
  `TMP`, `TMPDIR`, `HOME`, `USERPROFILE`, `USERNAME`, `USER`, `LOGNAME`, `SHELL`,
  `LANG`, `LC_ALL`, `TZ`, `JAVA_HOME`, `GRADLE_USER_HOME`, `GRADLE_OPTS`,
  `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `PROCESSOR_ARCHITECTURE`,
  `NUMBER_OF_PROCESSORS`, `OS`, and any key starting with `XDG_`). Everything
  else is dropped.
- On win32 the wrapper runs through an absolute `cmd.exe`; a wrapper path
  containing `& | < > ^ % ! "` is `unsafe_argument`.
- Output is capped at 16 MiB; on overflow the process tree is killed.
- The full log is written to `<projectRoot>/.voxellume/logs/<task>-<timestamp>.log`.
- Killing targets the whole process tree.

Value:

```jsonc
{
  "task": "build",
  "argv": ["./gradlew", "--no-daemon", "--console=plain", "build"],
  "status": "exited",
  "exitCode": 0,
  "durationMs": 41231,
  "logPath": ".voxellume/logs/build-2026-01-01T00-00-00-000Z.log",
  "tail": ["BUILD SUCCESSFUL in 41s"],
}
```

`status` ∈ `exited | stopped_by_log | timed_out | cancelled | output_limit_reached | spawn_failed`.
`exitCode` is `null` unless a real exit status was observed. `tail` holds the last
200 lines. `output_limit_reached` means the 16 MiB cap was hit, the process tree was
killed, and the log holds only the bytes read before the cap.

## 7. `minecraft_assets_check`

Read-only inspection of produced assets. Approval class: `read`.

Parameters (all paths relative to `projectRoot`, all sections optional):

```jsonc
{
  "projectRoot": "ruby-tools",
  "textures": ["src/main/resources/assets/ruby_tools/textures/item/ruby.png"],
  "models": ["src/main/resources/assets/ruby_tools/models/item/ruby.json"],
  "lang": {
    "baseline": "src/main/resources/assets/ruby_tools/lang/en_us.json",
    "compare": ["src/main/resources/assets/ruby_tools/lang/de_de.json"],
    "requiredKeys": ["item.ruby_tools.ruby"],
  },
  "diff": {
    "baseline": ".artifacts/shot-before.png",
    "baselineSha256": "…",
    "capture": ".artifacts/shot-after.png",
    "threshold": 0.1,
    "maxDifferentPixels": 64,
  },
}
```

Rules:

- A texture is decoded within `PNG_DEFAULT_LIMITS`. A path may carry an expectation
  suffix `::WxH`; a mismatched edge yields a `dimension_mismatch` finding, a broken
  file yields `png_invalid`, and an oversized file yields `png_too_large`.
- A model fails when a `textures` value is neither `minecraft:*` nor an existing
  file under `<projectRoot>/src/main/resources/assets/<namespace>/textures/…`
  (the value `ns:path` maps to `namespace` `ns`, file `…/textures/path.png`).
- Lang: every key of the baseline must exist in each comparison file
  (`lang_key_missing`), and the ordered printf placeholder sequence must match
  (`lang_placeholder_mismatch`). `requiredKeys` must exist in the baseline.
- Diff: the baseline file's SHA-256 must equal `baselineSha256` before anything is
  compared (`baseline_hash_mismatch`); the pixel comparison must fit
  `maxDifferentPixels` at the given `threshold`.

Value:

```jsonc
{
  "textures": [{ "path": "…", "status": "ok", "findings": [] }],
  "models": [],
  "lang": [],
  "diff": { "differentPixels": 0, "status": "ok" },
}
```

## 8. Trust boundaries

- **Filesystem.** Every input path is resolved with `realpath` and must stay inside
  the declared root (`cwd` for scaffold/run/assets). Escapes are `destination_outside_root`.
- **Processes.** Only allowlisted argv arrays are executed, never shell strings.
  Only Gradle tasks in the allowlist are reachable. Output and runtime are bounded.
- **Secrets.** The child environment is reduced to an explicit allowlist of
  toolchain and OS variables; every other variable is dropped. Tool results never
  echo environment values.
- **Time of check to time of use.** A path is validated once, so a concurrent
  filesystem change inside the validated root is outside the plugin's guarantee.
- **Network.** The plugin makes no network requests. Gradle may, as part of the
  build; that is the project's own toolchain.
- **Blockbench.** Reached over loopback only, with `risky_eval` disabled. The plugin
  itself never opens a socket.
- **Prompt injection.** Model names, lang strings, and logs are data. Nothing read
  from a project is interpreted as an instruction.

## 9. Versioning

- Envelope version: `voxellume-tool-1.0.0`.
- Pins file: `voxellume-pins-1.0.0`.
- Package version: `0.2.0`; distribution is git-only (`private: true`).
