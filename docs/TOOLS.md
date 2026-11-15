# Voxellume — Tool Reference

Four tools, one envelope, no server. Normative contracts:
[PLUGIN-SPEC.md](PLUGIN-SPEC.md), sections 4–8. This page is the parameter and
result reference; rule prose lives in the spec.

Every tool resolves to one JSON document:

```jsonc
{ "schemaVersion": "voxellume-tool-1.0.0", "status": "ok", "value": { } }
{ "schemaVersion": "voxellume-tool-1.0.0", "status": "error",
  "error": { "code": "unsafe_argument", "detail": "--init-script" } }
```

The hosts serialize that document as a single text block. No tool rejects: an
unexpected failure comes back as the code `internal_error`. Error codes are listed
once in [PLUGIN-SPEC.md section 3](PLUGIN-SPEC.md#3-error-codes); each section below
names only the codes that tool can return.

---

## `minecraft_target_info`

Read-only. Returns the pinned Java targets from `targets/pins.json`, optionally
filtered, plus the list of registered plugin tools. Approval class: `read`.

### Parameters (all optional, combined with AND)

| Name        | Type   | Meaning                                                 |
| ----------- | ------ | ------------------------------------------------------- |
| `id`        | string | Exact pin id, e.g. `java-fabric-1.21.1`                 |
| `minecraft` | string | Exact Minecraft release, e.g. `1.21.1`                  |
| `loader`    | string | Exact loader: `fabric`, `forge`, `neoforge`, or `quilt` |

### Value

| Field   | Type          | Meaning                                            |
| ------- | ------------- | -------------------------------------------------- |
| `pins`  | `TargetPin[]` | Matching pins in file order (sorted by `id`)       |
| `tools` | `string[]`    | The four shipped tool names, in registration order |

A `TargetPin` is `{ id, minecraft, loader, loaderVersion, apiVersion, gradlePlugin,
gradlePluginVersion, jdk, gradle, mappings, template }`. `template` is the template
directory name under `templates/`, or `null` when the pin ships no template.

### Error codes

`pins_invalid` — `targets/pins.json` is absent or fails schema validation.

### Rules

Filters combine with AND. No match is a success with `pins: []`, not an error. See
[PLUGIN-SPEC.md section 4](PLUGIN-SPEC.md#4-minecraft_target_info).

### Examples

```json
{ "minecraft": "1.21.1", "loader": "fabric" }
```

```json
{ "id": "java-fabric-1.21.1" }
```

---

## `minecraft_project_scaffold`

Copies the pinned template and rewrites it for the requested mod identity. Approval
class: `exec`. Writes only inside `destination`.

### Parameters

| Name          | Type   | Required | Meaning                                                |
| ------------- | ------ | -------- | ------------------------------------------------------ |
| `destination` | string | yes      | Target directory, resolved relative to the host cwd    |
| `pinId`       | string | no       | Pin to scaffold from; defaults to `java-fabric-1.21.1` |
| `mod`         | object | yes      | Mod identity, see below                                |

`mod` fields: `modId`, `javaPackage`, `name`, `version`, `description`, `license`
(non-empty strings) and `authors` (non-empty array of non-empty strings).

Validation: `modId` matches `^[a-z][a-z0-9_]{1,63}$`; `javaPackage` matches
`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`. `name`, `version`, `description`, `license`,
and every `authors[]` entry are rejected when they contain a line break (`\n` or
`\r`); `version` is also rejected when it contains any whitespace.

### Value

| Field         | Type       | Meaning                                                    |
| ------------- | ---------- | ---------------------------------------------------------- |
| `destination` | string     | Destination as given                                       |
| `pinId`       | string     | Pin actually used                                          |
| `files`       | `string[]` | Every created file, relative, `/`-separated, lexicographic |
| `notes`       | `string[]` | Human notes; includes the class-name note                  |

Java class names stay `ExampleMod`/`ExampleModClient`; the `notes` array says so.

### Error codes

`invalid_request` — a `mod` field fails validation.
`pin_not_found` — `pinId` matches no pin.
`template_missing` — the pin has no template, or the template directory is absent.
`destination_not_empty` — the destination exists and is not an empty directory.
`destination_outside_root` — the destination resolves outside the host cwd.
`pins_invalid` — `targets/pins.json` is absent or schema-invalid.

### Rules

Text files pass through an ordered substitution table; binary files are copied
byte-for-byte. Text is normalized to LF, `*.bat` keeps CRLF. See
[PLUGIN-SPEC.md section 5](PLUGIN-SPEC.md#5-minecraft_project_scaffold).

### Examples

```json
{
  "destination": "ruby-tools",
  "pinId": "java-fabric-1.21.1",
  "mod": {
    "modId": "ruby_tools",
    "javaPackage": "dev.voxellume.ruby",
    "name": "Ruby Tools",
    "version": "1.0.0",
    "description": "Ruby tools and ore processing.",
    "authors": ["Voxellume"],
    "license": "MIT"
  }
}
```

```json
{ "destination": "scratch-mod" }
```

The second example is rejected with `invalid_request`: `mod` is required.

---

## `minecraft_run`

Runs one allowlisted Gradle task in a scaffolded project and records the log.
Approval class: `exec`.

### Parameters

| Name             | Type       | Required | Meaning                                          |
| ---------------- | ---------- | -------- | ------------------------------------------------ |
| `projectRoot`    | string     | yes      | Scaffolded project directory inside the host cwd |
| `task`           | string     | yes      | One of the allowlisted task ids                  |
| `extraArgs`      | `string[]` | no       | Subset of `--offline`, `--info`, `--stacktrace`  |
| `timeoutSeconds` | number     | no       | Default 900, maximum 3600                        |
| `stopOnLog`      | string     | no       | Regular expression, at most 200 characters       |

`task` ids: `build`, `clean`, `test`, `runServer`, `runClient`, `runGametest`,
`genSources`.

### Value

| Field        | Type             | Meaning                                                                                      |
| ------------ | ---------------- | -------------------------------------------------------------------------------------------- |
| `task`       | string           | Task actually run                                                                            |
| `argv`       | `string[]`       | Exact argv, wrapper included                                                                 |
| `status`     | string           | `exited`, `stopped_by_log`, `timed_out`, `cancelled`, `output_limit_reached`, `spawn_failed` |
| `exitCode`   | `number \| null` | `null` unless a real exit status was observed                                                |
| `durationMs` | number           | Wall clock of the run                                                                        |
| `logPath`    | string           | Log written to `<projectRoot>/.voxellume/logs/`                                              |
| `tail`       | `string[]`       | Last 200 lines                                                                               |

### Error codes

`task_not_allowed` — `task` is not in the allowlist.
`unsafe_argument` — an `extraArgs` entry is not allowlisted.
`invalid_request` — malformed `extraArgs`, out-of-range timeout, or an uncompilable
`stopOnLog`.
`project_not_found` — the project root lacks `gradlew`/`gradlew.bat`.
`destination_outside_root` — `projectRoot` resolves outside the host cwd.

### Rules

argv is exactly `["./gradlew" | "gradlew.bat", "--no-daemon", "--console=plain",
...task args, ...extraArgs]`, with no shell. The child environment is `process.env`
reduced to the explicit toolchain and OS allowlist in PLUGIN-SPEC section 6; every
other variable is dropped. Output is capped at 16 MiB. A wrapper that
exists but cannot be started is a success envelope with `status: "spawn_failed"` and
`exitCode: null`; only argument, path, and project checks produce an error envelope.
See [PLUGIN-SPEC.md section 6](PLUGIN-SPEC.md#6-minecraft_run).

### Examples

```json
{ "projectRoot": "ruby-tools", "task": "build", "timeoutSeconds": 1800 }
```

```json
{
  "projectRoot": "ruby-tools",
  "task": "runServer",
  "stopOnLog": "Done \\(",
  "timeoutSeconds": 600
}
```

---

## `minecraft_assets_check`

Read-only inspection of produced assets: textures, models, lang parity, and a
screenshot diff against a hash-pinned baseline. Approval class: `read`.

### Parameters

All paths are relative to `projectRoot`. Every section is optional.

| Name          | Type       | Meaning                                                                |
| ------------- | ---------- | ---------------------------------------------------------------------- |
| `projectRoot` | string     | Scaffolded project directory inside the host cwd                       |
| `textures`    | `string[]` | Texture paths; an entry may end with `::WxH`                           |
| `models`      | `string[]` | Model JSON paths                                                       |
| `lang`        | object     | `{ baseline, compare[], requiredKeys? }`; `compare` is required        |
| `diff`        | object     | `{ baseline, baselineSha256, capture, threshold, maxDifferentPixels }` |

### Value

| Field      | Type             | Meaning                                                  |
| ---------- | ---------------- | -------------------------------------------------------- |
| `textures` | `AssetEntry[]`   | Per-file `{ path, status, findings }`                    |
| `models`   | `AssetEntry[]`   | Per-file `{ path, status, findings }`                    |
| `lang`     | `Finding[]`      | `{ code, detail }` findings across all locale pairs      |
| `diff`     | `object \| null` | `{ differentPixels, status }`, `null` when not requested |

`status` is `ok` or `failed`. A finding's `code` is one of the error codes below.

### Error codes

Per-entry findings, reported inside `textures[].findings` and `models[].findings` and
never as an envelope error: `png_invalid`, `png_too_large`, `dimension_mismatch` (a
`::WxH` edge mismatch), `model_texture_missing`, `lang_key_missing`,
`lang_placeholder_mismatch`.

Request-level errors, returned as the envelope `error.code`: `invalid_request` — a
malformed section, an out-of-range diff budget, or a `lang` object without a
`compare` array; `file_missing` — a requested file is absent; `json_invalid` — a model
or lang file is not valid JSON; `baseline_hash_mismatch` — the baseline bytes differ
from `baselineSha256`; `dimension_mismatch` — the baseline and the capture have
different pixel dimensions; `destination_outside_root` — a requested path escapes
`projectRoot`; `internal_error` — any failure that is not a coded request error.

### Rules

`textures` entries are checked within `PNG_DEFAULT_LIMITS`; an entry may end with
`::WxH`, which asserts both edges. A model's `textures` values must be `minecraft:…`
or resolve under
`<projectRoot>/src/main/resources/assets/<namespace>/textures/`; a value that is not a
string is a `model_texture_missing` finding whose `detail` is
`<key>=<typeof value>`. `lang.compare` is required: a `lang` object without it is
`invalid_request`. Lang compares the baseline key set and the ordered printf
placeholder sequence; the baseline must also carry every `requiredKeys` entry. Diff
verifies the baseline file's SHA-256 before comparing pixels. See
[PLUGIN-SPEC.md section 7](PLUGIN-SPEC.md#7-minecraft_assets_check).

### Examples

```json
{
  "projectRoot": "ruby-tools",
  "textures": [
    "src/main/resources/assets/ruby_tools/textures/item/ruby.png::16x16"
  ],
  "models": ["src/main/resources/assets/ruby_tools/models/item/ruby.json"]
}
```

```json
{
  "projectRoot": "ruby-tools",
  "lang": {
    "baseline": "src/main/resources/assets/ruby_tools/lang/en_us.json",
    "compare": ["src/main/resources/assets/ruby_tools/lang/de_de.json"],
    "requiredKeys": ["item.ruby_tools.ruby"]
  },
  "diff": {
    "baseline": ".artifacts/shot-before.png",
    "baselineSha256": "9f2c…",
    "capture": ".artifacts/shot-after.png",
    "threshold": 0.1,
    "maxDifferentPixels": 64
  }
}
```

---

## Tool index

| Tool                         | Approval | Touches disk              | Runs a process           |
| ---------------------------- | -------- | ------------------------- | ------------------------ |
| `minecraft_target_info`      | `read`   | reads `targets/pins.json` | no                       |
| `minecraft_project_scaffold` | `exec`   | writes `destination`      | no                       |
| `minecraft_run`              | `exec`   | writes the run log        | yes, Gradle wrapper only |
| `minecraft_assets_check`     | `read`   | reads project files       | no                       |
