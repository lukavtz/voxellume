# Universal Modder — детальный разбор

Источник: https://github.com/rehan-remade/universal-modder
Инспектированная revision: `3c4ac6c38e411b8c543bce217eae197039516bfc`
Дата revision: 2026-11-06T00:37:53-08:00
Лицензия репозитория: MIT.

Локальный sparse checkout: `/tmp/minecraft-mod-agent-research/universal-modder`. Код и skills читались напрямую. Продукт и его примеры в этом исследовании не запускались.

## Что подтверждено исходниками

### Agent workflow

`skills/mod-any-game/SKILL.md` задаёт цепочку:

1. intake и критерии завершения;
2. поиск существующих field notes;
3. recon игры и выбор наименее сложного route;
4. отдельная лаборатория и backup;
5. чтение реального кода/данных;
6. один vertical slice;
7. asset generation и conversion;
8. проверка в реальной игре;
9. showcase;
10. packaging и field note.

Для нашего плагина особенно полезны `MODLOG.md`, явные evidence levels, повторяемые game scenarios и запрет объявлять непроверенный результат рабочим.

### Minecraft playbook

`skills/mod-any-game/references/engines/minecraft.md` содержит:

- Fabric/NeoForge/Forge routes и штатные `runClient`/`runServer`;
- версионную связку game + loader + API;
- структуру `assets/<modid>` и `data/<modid>`;
- GameTest и scripted-client oracles для портов;
- production-JAR проверку отдельно от dev-run;
- ошибки реальных проектов: mappings, client/server различия, конфигурация, fluids, FOV, sound, network protocol versions.

Это полезная база знаний, но не замена официальной версионной документации каждого target pack.

### Porting method

`skills/port-a-mod/SKILL.md` описывает метод борьбы с drift:

- одна pinned исходная версия;
- private reference;
- adaptation matrix по подсистемам;
- извлечение данных скриптами вместо ручного переписывания;
- unit-by-unit GameTests;
- scripted real-client scenarios;
- послойные read-only audits;
- `MIGRATION_STATUS.md` и `HANDOFF.md`;
- различение `quirk kept`, `deviation`, `implemented`, `tested`, `seen in real client`, `unverified`.

Метод переносим в будущий skill портирования модов независимо от использования самого `um` CLI.

### Runtime verification

`skills/game-automation/SKILL.md` и Minecraft field notes подтверждают наличие методов:

- launch → deterministic scene → input/action → screenshot + logs;
- mod-side test commands и loopback JSON bridge вместо нестабильного menu clicking;
- фиксированный window size и pristine test world;
- production-JAR и real-instance проверки;
- точное завершение процессов по PID;
- разделение offline worker и единственного live-game worker.

В Bloons TD6 field note реальный проект использует четыре разных oracle: headless Java tests, dedicated-server self-test, real-client self-test и scripted real-world scenarios со screenshots. Это сильный образец для нашей verification matrix, но числа тестов и производительность являются отчётом автора, а не нашим измерением.

### Asset pipeline

`skills/asset-pipeline/SKILL.md` и `um/sprite.py` содержат конкретные операции:

- border-connected background cutout;
- hard alpha;
- trim и один nearest-neighbour resize;
- palette extraction/snapping;
- sprite sheet/slice;
- simple idle frames;
- team masks;
- seamless preview;
- checkerboard previews;
- 3D-to-sprite rendering через Blender.

`um/fal.py`, `um/comfy.py`, `um/sprixen.py` и `um/voidless.py` предоставляют внешние и локальные generation routes. Они требуют отдельной оценки стоимости, ключей, сети, воспроизводимости и условий использования output.

### Knowledge base

`um/kb.py` и `knowledge/` реализуют:

- поиск field notes по игре/engine/route;
- схему метаданных и обязательные разделы setup/route/verification/gotchas;
- проверку заметок;
- GitHub sync/cache;
- создание PR после подтверждения человека.

Для плагина полезен локальный knowledge format с exact versions, route, evidence и unresolved facts. Публичные PR из приватного продукта не должны происходить автоматически.

### Publish checks

`um/publish.py` содержит детерминированные проверки:

- byte-identical game files;
- secret patterns и `.env`;
- decompiler fingerprints;
- engine archives;
- absolute user paths;
- README/credits;
- generation manifest attribution.

Это кандидат на отдельный pre-release lint после проверки false positives и адаптации к Java/Minecraft.

### Agent roles

`agents/mod-orchestrator.md`, `agents/mod-game-worker.md` и `agents/mod-offline-worker.md` разделяют:

- orchestrator: план и проверка claims по evidence;
- offline worker: source, generators и тесты без запуска игры;
- game worker: единственный владелец build/deploy/launch/probe.

Это снижает риск параллельных Gradle runs и конфликтующих действий с игрой. Для малых задач три агента не оправданы; включать разделение по сложности и независимости работы.

## Codebase Memory

Sparse checkout проиндексирован как `universal-modder-research`: 1,179 nodes, 3,198 edges. Граф подтверждает отдельные CLI entry points `um.backup`, `um.sprite`, `um.publish`, `um.kb`, `um.win`, `um.fal` и других модулей, а также центральную роль `um/common.py`.

Граф использован только для навигации. Работоспособность этих entry points не проверялась запуском.

## Что брать в продукт

### Прямые кандидаты

- Minecraft/porting/game-automation/asset-pipeline/publish skills и references.
- `um/sprite.py` и минимальные зависимости из `um/common.py` после behavior/security tests.
- `um/publish.py` как основа pre-release lint.
- `um/backup.py` для snapshots после проверки path/containment и restore behavior.
- Формат knowledge notes и выбранные Minecraft notes как версионные references.
- Agent role briefs как шаблоны для сложных модов.

### Методы без обязательного копирования

- Один vertical slice до расширения.
- Last-good state и pristine test world.
- Единственный live-game worker.
- Production artifact как отдельный oracle.
- Evidence manifest и явные unsupported/unverified состояния.
- Послойный read-only review портов.

## Ограничения

- Это общий game-modding toolkit, а не готовый версионно-безопасный Minecraft generator.
- Нет полной матрицы Fabric/NeoForge/Forge/Quilt × Minecraft × mappings × Java.
- Minecraft code correctness остаётся ответственностью agent и target toolchain.
- `um win` ориентирован на Windows; macOS/Linux требуют отдельных adapters и проверок.
- fal/Sprixen/Voidless являются внешними сервисами; Blender/ffmpeg и другие binaries не входят в автоматически проверенное окружение.
- Field notes являются первичными отчётами авторов, но не независимым аудитом.
- Наличие skills и CLI не доказывает успешное создание произвольного мода.
