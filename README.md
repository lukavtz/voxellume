# Voxellume

Agent plugin for building Minecraft Java mods in OMP and DeepSeek Harness. Ships
procedures (skills, agents, commands), exact version pins, one project template, and
four tools: `minecraft_target_info`, `minecraft_project_scaffold`, `minecraft_run`,
`minecraft_assets_check`. No bundled server, no hosted service.

Reference: [docs/TOOLS.md](./docs/TOOLS.md). Contracts: [docs/PLUGIN-SPEC.md](./docs/PLUGIN-SPEC.md).

## Install

```sh
pnpm install && pnpm build
omp plugin link "$PWD"
pnpm pack
dsh plugin --profile voxellume-test add ./voxellume-0.2.0.tgz --ignore-scripts
```

## Requirements

Node.js >= 24.9.0, JDK 21 for the Fabric 1.21.1 template. Blockbench 5.x and Blender
are optional ([docs/BLOCKBENCH.md](./docs/BLOCKBENCH.md)).

Fabric 1.21.1: `build` and `runServer` are exercised by the opt-in live suite
(`VOXELLUME_LIVE=1 pnpm test:live`, JDK 21 + network), which
[.github/workflows/live-fabric.yml](./.github/workflows/live-fabric.yml) runs on demand.
Everything else is unproven until you run it. License: [MIT](./LICENSE).
