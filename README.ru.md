# Voxellume

Плагин для OMP и DeepSeek Harness (DSH): сборка модов Minecraft Java. Внутри
процедуры (skills, роли агентов, команды), точные пины версий для 68 Java-целей,
один шаблон проекта и четыре инструмента: `minecraft_target_info`,
`minecraft_project_scaffold`, `minecraft_run`, `minecraft_assets_check`. Своего
сервера и хостинга нет.

Справочник: [docs/TOOLS.md](./docs/TOOLS.md). Контракты:
[docs/PLUGIN-SPEC.md](./docs/PLUGIN-SPEC.md).

## Требования

| Компонент         | Для чего нужен                                     | Проверка                           |
| ----------------- | -------------------------------------------------- | ---------------------------------- |
| Node.js >= 24.9.0 | всё: сборка, тесты, оба хоста                      | `node -v`                          |
| pnpm 10.x         | установка, сборка, упаковка                        | `pnpm -v`                          |
| JDK 21            | `minecraft_run` для сборки и запуска Fabric 1.21.1 | `java -version` (должно быть `21`) |
| DSH 0.2.2-rc.1+   | только для хоста DSH                               | `dsh --version`                    |
| Blockbench 5.x    | необязательно: модели руками или через агента      | `blockbench --version`             |
| Blender           | необязательно: QA-скрипты в `scripts/blender/*.py` | `blender --version`                |

Без JDK 21 плагин всё равно ставится, `minecraft_project_scaffold` всё равно пишет
проект, а `minecraft_assets_check` всё равно проверяет PNG, lang и модели.
Не работает только `minecraft_run`: Gradle не соберёт шаблон Fabric 1.21.1.

## Скачать код и собрать

```sh
git clone https://github.com/lukavtz/voxellume.git
cd voxellume
pnpm install
pnpm build          # required: the OMP manifest points into dist/
```

Сборка обязательна. Манифест OMP (`pi.extensions` в `package.json`) и оба адаптера
хостов указывают на файлы в `dist/`. Ссылка на клон без `pnpm build` оставляет
расширение незагружаемым, и хост покажет плагин без инструментов.

## Установка в OMP

Из клона — ссылка на рабочий каталог:

```sh
omp plugin link "$PWD" --scope user
```

`--scope project` ограничит ссылку текущим репозиторием. Windows PowerShell:

```powershell
omp plugin link $PWD --scope user
```

Установка из архива:

```sh
pnpm pack
omp plugin install ./voxellume-0.2.0.tgz
```

Проверка:

```sh
omp plugin doctor
omp plugin list --json
```

`omp plugin doctor` должен напечатать `✔ plugin:voxellume: v0.2.0`, а `omp plugin
list --json` — содержать запись `voxellume`. Перезапустите OMP и вызовите
`minecraft_target_info` с аргументом:

```json
{ "minecraft": "1.21.1", "loader": "fabric" }
```

Ответ должен содержать `java-fabric-1.21.1`.

Удаление:

```sh
omp plugin uninstall voxellume
```

## Установка в DSH

```sh
pnpm pack
dsh plugin --profile voxellume add ./voxellume-0.2.0.tgz --ignore-scripts
```

`dsh plugin --profile <name>` передаёт аргументы в pnpm внутри каталога профиля.
Профиль создаётся при первом использовании и не зависит от профиля по умолчанию:
эта установка не трогает вашу обычную настройку DSH. Архив должен быть собранным:
`pnpm pack` запускает `prepack` → `pnpm build`, поэтому `dist/` попадает внутрь.
Флаг `--ignore-scripts` обязателен: своих шагов установки у архива нет.
Если `dsh` не установлен глобально, используйте `./node_modules/.bin/dsh` из клона.

Проверка:

```sh
dsh --profile voxellume --dump-config
```

Собранный конфиг должен содержать:

```
# == voxellume
- id: voxellume
  name: voxellume
  config: {}
```

Запустите DSH с этим профилем и вызовите `minecraft_target_info` так же, как в OMP.

Удаление:

```sh
dsh plugin --profile voxellume remove voxellume
```

## Первые пять минут

1. `minecraft_target_info` — убедиться, что пин есть:

   ```json
   { "minecraft": "1.21.1", "loader": "fabric" }
   ```

2. `minecraft_project_scaffold` — создать проект из шаблона Fabric 1.21.1:

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

3. Править исходники в `src/main/java/dev/example/ruby/`.
4. `minecraft_run` с `{ "projectRoot": "/home/you/projects/ruby-tools", "task":
"build" }` — ожидается `status: "exited"`, `exitCode: 0` и JAR в `build/libs`.
5. `minecraft_assets_check` — проверить текстуры, lang-файлы и ссылки моделей,
   прежде чем называть мод готовым.

Утверждение «работает» требует результата `minecraft_run`. Плагин сообщает только
наблюдаемые факты: код выхода, открытый файл или совпавшую строку лога.

## Необязательные интеграции

- Blockbench desktop MCP для работы с моделями:
  [docs/BLOCKBENCH.md](./docs/BLOCKBENCH.md).
- QA-скрипты Blender: циклы, контактные листы, отчёты по мешу —
  [scripts/blender](./scripts/blender).
- Ни то, ни другое не обязательно. Четыре инструмента работают без них.

## Решение проблем

| Симптом                                                         | Причина и решение                                                                                                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Плагин в списке, инструментов нет                               | Ссылка создана до `pnpm build`, или хост закешировал старую загрузку. Запустите `pnpm build`, перелинкуйте, перезапустите OMP.                                                     |
| `omp plugin doctor` пишет `No omp/pi manifest`                  | Устаревший `package.json` в каталоге ссылки или старая ссылка. Обновите клон и перелинкуйте: `omp plugin link "$PWD" --scope user`.                                                |
| DSH предупреждает `declares no dsh.bundle`                      | Установлен архив, собранный до v0.2.0. Запустите `pnpm pack` снова и переустановите с `--ignore-scripts`.                                                                          |
| `minecraft_run` вернул `spawn_failed`                           | Нет JDK или `gradlew` не исполняемый. Поставьте JDK 21 и пересоберите проект текущей версией.                                                                                      |
| `minecraft_run` вернул `task_not_allowed` или `unsafe_argument` | Существуют только разрешённые задачи и флаги. Используйте `build`, `clean`, `test`, `runServer`, `runClient`, `runGametest`, `genSources` и `--offline`, `--info`, `--stacktrace`. |
| `pnpm` не найден, или на Windows ошибка синтаксиса `corepack`   | Другой шим `pnpm` перекрывает нужный. Используйте `pnpm.cmd` или переустановите pnpm.                                                                                              |

## Что проверено

Fabric 1.21.1: `build` и `runServer` прогоняет opt-in живой набор
(`VOXELLUME_LIVE=1 pnpm test:live`, JDK 21 и сеть); его запускает
[.github/workflows/live-fabric.yml](./.github/workflows/live-fabric.yml) по запросу
и раз в неделю. Остальное не доказано, пока вы это не запустите. Лицензия:
[MIT](./LICENSE).
