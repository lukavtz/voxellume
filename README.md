# Voxellume

Agent plugin for building Minecraft Java mods in OMP and DeepSeek Harness (DSH). It
ships procedures (skills, agent roles, commands), exact version pins for 68 Java
targets, one project template, and four tools: `minecraft_target_info`,
`minecraft_project_scaffold`, `minecraft_run`, `minecraft_assets_check`. No bundled
server, no hosted service.

Reference: [docs/TOOLS.md](./docs/TOOLS.md). Contracts:
[docs/PLUGIN-SPEC.md](./docs/PLUGIN-SPEC.md).

## Requirements

| Component         | Needed for                                           | Check                            |
| ----------------- | ---------------------------------------------------- | -------------------------------- |
| Node.js >= 24.9.0 | everything (build, tests, both hosts)                | `node -v`                        |
| pnpm 10.x         | install, build, pack                                 | `pnpm -v`                        |
| JDK 21            | `minecraft_run` builds and runs of Fabric 1.21.1     | `java -version` (must show `21`) |
| DSH 0.2.2-rc.1+   | the DSH host only                                    | `dsh --version`                  |
| Blockbench 5.x    | optional: authoring 3D models by hand or by an agent | `blockbench --version`           |
| Blender           | optional: 3D QA scripts in `scripts/blender/*.py`    | `blender --version`              |

Without JDK 21 the plugin still installs, `minecraft_project_scaffold` still writes a
project, and `minecraft_assets_check` still validates PNG, lang and model files.
Only `minecraft_run` fails, because Gradle cannot compile the Fabric 1.21.1 template.

## Get the code and build

```sh
git clone https://github.com/lukavtz/voxellume.git
cd voxellume
pnpm install
pnpm build          # required: the OMP manifest points into dist/
```

The build is mandatory. The OMP manifest (`pi.extensions` in `package.json`) and both
host adapters resolve to files under `dist/`. Linking the checkout without `pnpm
build` leaves the extension unloadable, and the host lists the plugin with no tools.

## Install in OMP

From the checkout, link the working tree:

```sh
omp plugin link "$PWD" --scope user
```

Use `--scope project` to keep the link to the current repository only. Windows
PowerShell:

```powershell
omp plugin link $PWD --scope user
```

After a tarball instead:

```sh
pnpm pack
omp plugin install ./voxellume-0.2.1.tgz
```

Verify:

```sh
omp plugin doctor
omp plugin list --json
```

`omp plugin doctor` must print `✔ plugin:voxellume: v0.2.1`, and `omp plugin list
--json` must contain a `voxellume` entry. Restart OMP, then call
`minecraft_target_info` with:

```json
{ "minecraft": "1.21.1", "loader": "fabric" }
```

The answer must contain `java-fabric-1.21.1`.

Uninstall:

```sh
omp plugin uninstall voxellume
```

## Install in DSH

```sh
pnpm pack
dsh plugin --profile voxellume add ./voxellume-0.2.1.tgz --ignore-scripts
```

`dsh plugin --profile <name>` forwards to pnpm inside that profile's directory. The
profile is created on first use and is independent of the default profile, so this
install does not touch your normal DSH setup. The tarball must be the built one:
`pnpm pack` runs `prepack` → `pnpm build` first, so `dist/` is inside the archive.
`--ignore-scripts` is required because the archive carries no install step of its own.
Without a global `dsh`, use `./node_modules/.bin/dsh` from the checkout.

Verify:

```sh
dsh --profile voxellume --dump-config
```

The composed config must contain:

```
# == voxellume
- id: voxellume
  name: voxellume
  config: {}
```

Start DSH with that profile and call `minecraft_target_info` the same way as in OMP.

Uninstall:

```sh
dsh plugin --profile voxellume remove voxellume
```

## First five minutes

1. `minecraft_target_info` — confirm the pin exists:

   ```json
   { "minecraft": "1.21.1", "loader": "fabric" }
   ```

2. `minecraft_project_scaffold` — write a project from the Fabric 1.21.1 template:

   ```json
   {
     "destination": "/home/you/projects/ruby-tools",
     "pinId": "java-fabric-1.21.1",
     "mod": {
       "modId": "ruby_tools",
       "javaPackage": "dev.example.ruby",
       "name": "Ruby Tools",
       "version": "1.0.0",
       "description": "Ruby tools for Voxellume.",
       "authors": ["You"],
       "license": "MIT"
     }
   }
   ```

3. Edit the sources under `src/main/java/dev/example/ruby/`.
4. `minecraft_run` with `{ "projectRoot": "/home/you/projects/ruby-tools", "task":
"build" }` — expect `status: "exited"`, `exitCode: 0`, and a JAR under
   `build/libs`.
5. `minecraft_assets_check` — validate textures, lang files and model references
   before you claim the mod is finished.

A claim of "it works" requires a `minecraft_run` result. The plugin reports only
observed facts: an exit code, a file it opened, or a log line it matched.

## Optional integrations

- Blockbench desktop MCP for model work: [docs/BLOCKBENCH.md](./docs/BLOCKBENCH.md).
- Blender QA scripts for loops, contact sheets and mesh reports:
  [scripts/blender](./scripts/blender).
- Neither is required. The four tools work without them.

## Troubleshooting

| Symptom                                                         | Cause and fix                                                                                                                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin listed, tools missing                                    | You linked before `pnpm build`, or the host cached the old load. Run `pnpm build`, relink, restart OMP.                                                                           |
| `omp plugin doctor` says `No omp/pi manifest`                   | Stale `package.json` in the linked directory, or an old link. Update the checkout and relink with `omp plugin link "$PWD" --scope user`.                                          |
| DSH warns `declares no dsh.bundle`                              | You installed a tarball packed before v0.2.1. Run `pnpm pack` again and reinstall with `--ignore-scripts`.                                                                        |
| `minecraft_run` returns `spawn_failed`                          | JDK missing, or `gradlew` not executable. Install JDK 21 and rebuild the project with the current version.                                                                        |
| `minecraft_run` returns `task_not_allowed` or `unsafe_argument` | Only the allowlisted tasks and extra flags exist. Use `build`, `clean`, `test`, `runServer`, `runClient`, `runGametest`, `genSources`, and `--offline`, `--info`, `--stacktrace`. |
| `pnpm` not found, or `corepack` syntax error on Windows         | Another `pnpm` shim shadows it. Use `pnpm.cmd`, or reinstall pnpm.                                                                                                                |

## What is verified

Fabric 1.21.1: `build` and `runServer` are exercised by the opt-in live suite
(`VOXELLUME_LIVE=1 pnpm test:live`, JDK 21 + network), which
[.github/workflows/live-fabric.yml](./.github/workflows/live-fabric.yml) runs on
demand and weekly. Everything else is unproven until you run it. License:
[MIT](./LICENSE).
