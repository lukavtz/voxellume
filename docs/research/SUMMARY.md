# Итог исследования Voxellume

Дата: 2026-11-06.

## Главный вывод

Готового решения, которое само создаёт произвольные качественные Minecraft-моды под Fabric/NeoForge/Forge/Quilt с моделями, текстурами и доказанной работой в игре, не найдено. Сильная система получится как **оркестратор над официальными toolchains, специализированными MCP/OSS и собственным deterministic verification core**.

Компиляция и server boot недостаточны. Нужны отдельные evidence levels: specification → generated files → build → server/client behavior → production JAR → real-client visuals.

## Рекомендуемый состав для обсуждения

| Область                | Кандидат                                                                                                                         | Предлагаемая роль                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent workflow         | Universal Modder                                                                                                                 | Взять skills, field-note format, vertical slices, backups, offline/game worker split, game oracle и publish checks                                         |
| Typed generation       | AI-mod creator                                                                                                                   | Взять MCL-like operations, canonical ModSpec, deterministic hashes, transactions и last-good state                                                         |
| Java targets           | Официальные Fabric/NeoForge/Forge/Quilt MDK и docs                                                                               | Отдельный versioned target pack для каждой точной связки                                                                                                   |
| Multi-loader           | Architectury                                                                                                                     | Только для реально общего multi-loader мода, не как обязательная сложность каждого scaffold                                                                |
| Source/mappings        | ModLens MCP **или** adhi minecraft-modding-mcp                                                                                   | Один сравнительный пилот через узкий read-only facade                                                                                                      |
| Texture cleanup/export | `smile-minecraft/mc-asset` `v0.5.0`, `bedf67229ab0fdf304f6d40bc0000a27bd05e880`                                                  | **Adopt pinned external process только за Voxellume facade**; `.grid`/`.mcpx`, deterministic cleanup, tiling, strip+`.mcmeta`; raw CLI paths/MCP не expose |
| Blockbench             | jasonjgardner `1.10.1`, `97a8a80d3a37bf95c5e136d93d2c7da399fff753`                                                               | Единственный external pinned headless `.bbmodel` engine; desktop для optional visual review                                                                |
| Animation methods      | sosadly `0.3.1`, `028cdd76589de2e2cea51bfd79495b50a3c7d1d2`                                                                      | **Reject installable MCP; adapt MIT methods only** с typed API и seeded RNG; никакого `execute_script`/plugin bridge                                       |
| Blender/ingress        | EL4CTEO Release 1.2.0, `fb92cfb4cc5a238c22113a6a230b09f535bd0656`; Mosaicary `0.1.4`, `08bdba5252a378cf8e2111b0c2cb27cec4ea15ba` | Fixed Blender scripts optional для loop/QA/contact sheets; Mosaicary conditional local ingress, `PENDING RUNTIME`                                          |
| Blockbench skills      | blockbench-mcp-project                                                                                                           | Выборочная адаптация после benchmark                                                                                                                       |
| Data validation        | AJV + Spyglass/vanilla-mcdoc + собственные rules                                                                                 | Schema shape плюс semantic cross-file и mod-specific checks                                                                                                |
| PNG/visual diffs       | pngjs + pixelmatch                                                                                                               | Dimensions/decode/diff; не доказательство эстетики или gameplay                                                                                            |
| Server automation      | Официальные GameTests + RCON + Mineflayer                                                                                        | Behavior assertions на isolated offline server                                                                                                             |
| Real client            | ModLens, mcp-rogal или Arclight по target                                                                                        | Пилоты; затем собственный минимальный verification mod для непокрытых targets                                                                              |
| Runtime orchestration  | Universal Modder methods                                                                                                         | Deterministic scenes, logs, screenshots, exact PID cleanup, production-JAR checks                                                                          |
| Release/security       | Gradle locking/verification, JUnit, Error Prone, CycloneDX, OSV, Gitleaks, Semgrep                                               | Target templates и CI gates                                                                                                                                |
| OMP/Harness            | Native extensions/tools + общие skills                                                                                           | Один core, два host adapters; optional MCP только поверх того же core                                                                                      |

## Что не стоит делать обязательной основой

- MCreator native MCP: сильный schema-first workspace, но обнаружен в `master`, требует live MCreator и не заменяет arbitrary Java/runtime pipeline. Возможен optional adapter после pilot.
- Player Games MCP: hosted generation/iteration и download, но не наш deterministic core. Может быть отдельной optional интеграцией для сравнения результатов.
- Installable `sosadly/blockbench-mcp`: пилот подтвердил отсутствие root policy, unauthenticated loopback, default-on arbitrary script execution и nondeterministic texture ops. Только адаптация MIT rig/generator/analyzer/paint methods с seeded RNG; второй server не запускается.
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
3. `TextureSpec`/`AnimationSpec`, editable `.grid`/`.mcpx`/`.bbmodel` contracts, deterministic cleanup/export и semantic validator мод metadata, IDs, resources, assets и cross-file references.
4. Безопасный execution supervisor: roots/symlinks/races/hardlinks, allowlisted tasks, pre-read/decode/output limits, staged journal publication, process-group cancellation, env scrubbing, network/EULA visibility и redaction. Raw mc-asset CLI/MCP и sosadly server не expose.
5. Target-independent client driver и verification mod для непокрытых версий.
6. Evidence manifest: команды, exit codes, logs, reports, source/browser(`surface=...`)/design-review checks, screenshots, artifacts и unresolved states. Только real Minecraft client закрывает in-game visual gate.
7. Сравнительный benchmark skills/MCP и реальных модов.
8. OMP и Harness adapters без дублирования domain logic.

## Подтверждённые решения

1. Обязательны все официальные релизы Minecraft 1.21–26.3 и Fabric/NeoForge/Forge/Quilt. Каждая комбинация требует отдельной квалификации; отсутствующий loader/API явно обозначается unsupported.
2. Используются JDK 21 и 25 по требованиям конкретного target.
3. ModLens и adhi minecraft-modding-mcp сравниваются на одинаковых fixtures перед выбором одного source/mapping MCP.
4. Real-client verification использует собственный минимальный verification mod вместе с подходящими OSS adapters.
5. Asset generation: host image tools, fal и local ComfyUI; pinned mc-asset только external process за facade. Jason остаётся единственным Blockbench engine; sosadly server rejected, его MIT methods адаптируются с seeded RNG. Blender optional; Mosaicary conditional.
6. `TextureSpec`/`AnimationSpec`, `.grid`/`.mcpx`/`.bbmodel`, vertical strip + `.png.mcmeta` и production-JAR Minecraft states обязательны. Source/static, real-client runtime и design review — отдельные gates.
7. MCreator и Player Games — optional integrations.
8. Устанавливаются JDK 21/25, Blockbench, Blender, ffmpeg и Docker/Colima.
9. EULA и network approval подтверждаются один раз на окружение и сохраняются вместе с cached dependencies.
10. Reuse смешанный: selected vendoring as-is, внешние pinned processes/MCP и адаптация методов в core.

## Research pack

- [Существующие решения и конкуренты](existing-solutions.md)
- [OSS, skills, MCP и dependencies](oss-inventory.md)
- [Texture/animation pipeline и runtime pilots](asset-generation.md)
- [Официальные target toolchains](minecraft-targets.md)
- [Universal Modder — детальный разбор](universal-modder.md)
- [AI-mod creator — детальный разбор](ai-mod-creator.md)
- [OMP и Harness contracts](host-contracts.md)
- [Локальное окружение](environment.md)

## Границы доказательств

Исследование опирается на первичные source/docs. Кроме явно перечисленных pilots, возможности внешних продуктов обозначены по исходникам и документации, а не по нашим runtime измерениям. Реальная интеграция требует отдельных smoke, security и target-matrix tests.

`mc-asset` `v0.5.0` pilot complete: upstream 2860 passed/1 skipped/0 failed; Voxellume 48 CLI commands и 22/22 assertions, 12 deterministic workflows с 19/19 SHA-identical artifact pairs, representative CLI/MCP parity и cleanup. Найдены raw outside-root writes, ineffective general pre-read cap и non-transactional output sets, поэтому adoption только за facade. `sosadly` `0.3.1` pilot complete: rig/generators/interpolation/analyzer/paint/Java export работали в Blockbench 5.2.2, planted loop gap `4.16` найден; unseeded `detail_cubes`, outside-root request и unauthenticated/default-script surface подтвердили rejection installable server.

Оба pilots выполнены на macOS arm64 с Node `v24.21.0`; их previews и hashes не являются Minecraft client/server evidence или human aesthetic approval. GeckoLib/in-game animation, production-JAR visuals, concurrent path-swap/hardlink/ZIP-bomb facade tests и conditional Mosaicary/Blender/perfect-pixel/Unfaker pilots ещё не пройдены. Подробности и evidence roots: [asset-generation.md](asset-generation.md#10-пилоты-и-критерии-включения).
