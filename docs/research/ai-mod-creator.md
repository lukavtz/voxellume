# AI-mod creator — детальный разбор

Источник: https://github.com/sjdthree/ai-mod-creator
Инспектированная revision: `e6b6cd5783b53e1a8c4555bd4416ef260e8aa94e`
Лицензия кода: Apache-2.0; model weights распространяются отдельно под Gemma Terms.

Локальный sparse checkout: `/tmp/minecraft-mod-agent-research/ai-mod-creator`. Читались schemas, ADRs, test plan и state/verification modules. Код не запускался.

## Подтверждённая область

README прямо ограничивает продукт simple items, weapons, tools, food, blocks и recipes. Статус — early alpha. Основной target — Minecraft 1.21.1 / Java 21; desktop Fabric, CLI NeoForge по умолчанию или Fabric. Это не генератор произвольных модов, сущностей или сложных моделей.

## Сильные архитектурные методы

### 1. Модель выбирает операции, engine генерирует код

`schemas/0.1.0/operation.schema.json` определяет ограниченный MCL:

- `create_concept`, `update_concept`, `delete_concept`, `rename_concept`;
- recipe add/update/remove;
- behavior add/update/remove;
- `set_appearance`, `test_concept`, `revert_change`;
- `clarify_request`, `unsupported_request`.

`create_concept` ограничен `item`, `weapon`, `tool`, `food`, `block`. Модель не получает права генерировать произвольные файлы проекта.

ADR-0002 отделяет model checkpoint от engine через OpenAI-compatible endpoint, MCL schema, decoding grammar и pinned manifest hashes. Для нашего плагина модель уже предоставлена OMP/Harness, поэтому нужен только узкий operation contract, не bundled LLM.

### 2. Детерминированная canonical state

`amc-state` строит candidate state из normalized operations. Из lessons-learned:

- state hash исключает ULIDs, timestamps и selector bookkeeping;
- одинаковые parent state + normalized operations дают одинаковый generated-implementation hash;
- validator side-effect-free;
- semantic/reference validation разделена по владельцам;
- относительные значения вроде `stronger` не угадываются core;
- неоднозначность становится clarification, неизвестное — unsupported.

Это прямо применимо к нашей ModSpec: детерминировать следует нормализованную спецификацию и output, исключая случайные IDs и время.

### 3. Transactional last-good state

`transaction.schema.json` задаёт переходы:

`proposed → validated → generated → verified → committed`, с отдельными `build_failed`, `verification_failed`, `rejected`.

`amc-state/src/manager.rs` реализует candidate/canonical separation: только verified candidate становится canonical; неуспешный candidate оставляет предыдущее verified state неизменным.

Для нашего плагина нужны те же last-good semantics на уровне ModSpec и файлового diff, плюс snapshots test worlds. Сама Rust-реализация не является drop-in для TypeScript core.

### 4. Версии берутся из официального MDK

ADR-0003 фиксирует одну конкретную target line. Lessons-learned фиксирует реальную ошибку угаданных ModDevGradle/NeoForge versions и успешный метод: копировать точные pins из official MDK и подтверждать реальной сборкой.

Это подтверждает выбранную target-pack архитектуру и запрет approximate registry.

### 5. Runtime verification

ADR-0006 документирует реальный container run generated NeoForge mod через `runGameTestServer`:

- обнаружение GameTests;
- registry assertions;
- exit code 0 как машинный результат;
- `data/<modid>/structure/empty.nbt` в singular folder;
- `neoforge.enabledGameTestNamespaces`.

ADR-0007 и test plan документируют последующий Fabric path:

- общие vanilla resources;
- разные metadata/Gradle/Java registration;
- Mojmap для общих game-class names;
- реальные Loom build и `runGametest`;
- loader divergences, которые golden tests не поймали.

Полезный принцип: golden trees не доказывают compile compatibility; каждый loader требует реальных build и runtime checks.

## Что брать

### Прямые кандидаты

- JSON Schema ideas для ModSpec operations и transactions.
- Canonical-state normalization и hash semantics.
- Transaction status model и rejection/clarification behavior.
- ADR/test-plan patterns для target verification.
- Generator boundaries: общие vanilla resources, loader-specific Java/metadata/Gradle.
- GameTest fixtures и negative controls после проверки на выбранных target packs.

### Методы без переноса ограничений

- Model-independent tests через committed fixture state.
- Negative control, который обязан провалить verification.
- Каждый новый target сначала scaffold, затем supported только после build/GameTest/client matrix.
- Evidence levels вместо одного `working` boolean.

## Ограничения

- Небольшой whitelist контента, не полный Minecraft API.
- Placeholder textures, не художественный pipeline.
- Rust engine требует адаптации или sidecar; это не drop-in TypeScript dependency.
- Публичная история начинается с alpha; долгая maintenance history отсутствует.
- Model weights и отдельные model terms не входят в Apache-2.0 код.
- Часть test plan описывает конкретную ветку и исторические runs; эти результаты не являются нашими измерениями.
- Runtime levels persistence и client smoke в прочитанных ADR оставались отдельными/открытыми задачами.
