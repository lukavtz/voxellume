# Итог исследования Voxellume

Дата: 2026-11-06.

## Главный вывод

Готового решения, которое само создаёт произвольные качественные Minecraft-моды под Fabric/NeoForge/Forge/Quilt с моделями, текстурами и доказанной работой в игре, не найдено. Сильная система получится как **оркестратор над официальными toolchains, специализированными MCP/OSS и собственным deterministic verification core**.

Компиляция и server boot недостаточны. Нужны отдельные evidence levels: specification → generated files → build → server/client behavior → production JAR → real-client visuals.

## Рекомендуемый состав для обсуждения

| Область               | Кандидат                                                                           | Предлагаемая роль                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Agent workflow        | Universal Modder                                                                   | Взять skills, field-note format, vertical slices, backups, offline/game worker split, game oracle и publish checks |
| Typed generation      | AI-mod creator                                                                     | Взять MCL-like operations, canonical ModSpec, deterministic hashes, transactions и last-good state                 |
| Java targets          | Официальные Fabric/NeoForge/Forge/Quilt MDK и docs                                 | Отдельный versioned target pack для каждой точной связки                                                           |
| Multi-loader          | Architectury                                                                       | Только для реально общего multi-loader мода, не как обязательная сложность каждого scaffold                        |
| Source/mappings       | ModLens MCP **или** adhi minecraft-modding-mcp                                     | Один сравнительный пилот через узкий read-only facade                                                              |
| Blockbench            | jasonjgardner/blockbench-mcp-plugin                                                | External pinned headless `.bbmodel` pipeline; desktop для optional visual review                                   |
| Blockbench skills     | blockbench-mcp-project                                                             | Выборочная адаптация после benchmark                                                                               |
| Data validation       | AJV + Spyglass/vanilla-mcdoc + собственные rules                                   | Schema shape плюс semantic cross-file и mod-specific checks                                                        |
| PNG/visual diffs      | pngjs + pixelmatch                                                                 | Dimensions/decode/diff; не доказательство эстетики или gameplay                                                    |
| Server automation     | Официальные GameTests + RCON + Mineflayer                                          | Behavior assertions на isolated offline server                                                                     |
| Real client           | ModLens, mcp-rogal или Arclight по target                                          | Пилоты; затем собственный минимальный verification mod для непокрытых targets                                      |
| Runtime orchestration | Universal Modder methods                                                           | Deterministic scenes, logs, screenshots, exact PID cleanup, production-JAR checks                                  |
| Release/security      | Gradle locking/verification, JUnit, Error Prone, CycloneDX, OSV, Gitleaks, Semgrep | Target templates и CI gates                                                                                        |
| OMP/Harness           | Native extensions/tools + общие skills                                             | Один core, два host adapters; optional MCP только поверх того же core                                              |

## Что не стоит делать обязательной основой

- MCreator native MCP: сильный schema-first workspace, но обнаружен в `master`, требует live MCreator и не заменяет arbitrary Java/runtime pipeline. Возможен optional adapter после pilot.
- Player Games MCP: hosted generation/iteration и download, но не наш deterministic core. Может быть отдельной optional интеграцией для сравнения результатов.
- Второй Blockbench MCP `sosadly/blockbench-mcp`: дублирование и arbitrary script execution; quality-gate ideas можно сравнить без второго production server.
- Несколько source/mapping MCP одновременно: сначала head-to-head benchmark, затем один.
- Свободная LLM-генерация всего Gradle проекта и приблизительный реестр версий.

## Target policy

Поддержка объявляется только для полной связки:

`Minecraft + loader + loader/API versions + mappings + Java + Gradle + plugins + immutable template revision`.

Для каждой цели обязательны clean build, server smoke, client smoke, visual checklist и configured GameTests. Неизвестная цель возвращает `unsupported_target`; ближайшая версия не подставляется.

Критические различия:

- Java 21 для линии 1.21.x и Java 25 для 26.x — разные toolchains.
- Minecraft 26.1 удаляет обфускацию; старые mappings/plugin IDs нельзя переносить автоматически.
- Quilt QSL/QFAPI и Quilt mappings имеют отдельную версионную поддержку; общий CLI GameTest workflow нужно доказать отдельно.
- Gradle JVM, Java toolchain и `options.release` — разные параметры.
- Wrapper SHA-256, template revision и dependency verification входят в target evidence.

## Что придётся написать самим

1. Versioned target-pack и docs-index contracts.
2. ModSpec, typed operations, deterministic canonical state и transactions.
3. Семантический validator мод metadata, IDs, resources, assets и cross-file references.
4. Безопасный execution supervisor: roots/symlinks, allowlisted tasks, limits, cancellation, cleanup, network/EULA visibility и redaction.
5. Target-independent client driver и verification mod для непокрытых версий.
6. Evidence manifest: команды, exit codes, logs, reports, screenshots, artifacts и unresolved states.
7. Сравнительный benchmark skills/MCP и реальных модов.
8. OMP и Harness adapters без дублирования domain logic.

## Подтверждённые решения

1. Обязательны все официальные релизы Minecraft 1.21–26.3 и Fabric/NeoForge/Forge/Quilt. Каждая комбинация требует отдельной квалификации; отсутствующий loader/API явно обозначается unsupported.
2. Используются JDK 21 и 25 по требованиям конкретного target.
3. ModLens и adhi minecraft-modding-mcp сравниваются на одинаковых fixtures перед выбором одного source/mapping MCP.
4. Real-client verification использует собственный минимальный verification mod вместе с подходящими OSS adapters.
5. Asset generation: host image tools, fal и local ComfyUI.
6. MCreator и Player Games — optional integrations.
7. Устанавливаются JDK 21/25, Blockbench, Blender, ffmpeg и Docker/Colima.
8. EULA и network approval подтверждаются один раз на окружение и сохраняются вместе с cached dependencies.
9. Reuse смешанный: selected vendoring as-is, external MCP и адаптация методов в core.

## Research pack

- [Существующие решения и конкуренты](existing-solutions.md)
- [OSS, skills, MCP и dependencies](oss-inventory.md)
- [Официальные target toolchains](minecraft-targets.md)
- [Universal Modder — детальный разбор](universal-modder.md)
- [AI-mod creator — детальный разбор](ai-mod-creator.md)
- [OMP и Harness contracts](host-contracts.md)
- [Локальное окружение](environment.md)

## Границы доказательств

Исследование опирается на первичные source/docs. Внешние продукты, MCP и примеры модов в этом этапе не запускались. Их возможности обозначены по исходникам и документации, а не по нашим runtime измерениям. Реальная интеграция требует отдельных smoke, security и target-matrix tests.
