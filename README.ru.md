# Voxellume

Плагин для OMP и DeepSeek Harness: сборка модов Minecraft Java. Внутри процедуры
(skills, агенты, команды), точные пины версий, один шаблон проекта и четыре
инструмента: `minecraft_target_info`, `minecraft_project_scaffold`, `minecraft_run`,
`minecraft_assets_check`. Своего сервера и хостинга нет.

Справочник: [docs/TOOLS.md](./docs/TOOLS.md). Контракты: [docs/PLUGIN-SPEC.md](./docs/PLUGIN-SPEC.md).

## Установка

```sh
pnpm install && pnpm build
omp plugin link "$PWD"
pnpm pack
dsh plugin --profile voxellume-test add ./voxellume-0.2.0.tgz --ignore-scripts
```

## Требования

Node.js >= 24.9.0, JDK 21 для шаблона Fabric 1.21.1. Blockbench 5.x и Blender
необязательны ([docs/BLOCKBENCH.md](./docs/BLOCKBENCH.md)).

Fabric 1.21.1: `build` и `runServer` прогоняет opt-in живой набор
(`VOXELLUME_LIVE=1 pnpm test:live`, JDK 21 и сеть); его запускает
[.github/workflows/live-fabric.yml](./.github/workflows/live-fabric.yml) по запросу.
Остальное не доказано, пока вы это не запустите. Лицензия: [MIT](./LICENSE).
