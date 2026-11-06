# Voxellume: генерация текстур и анимаций

Дата исследовательского среза: **2026-11-06**.

## 1. Решение

Рекомендуемый конвейер:

```text
TextureSpec + утверждённый style board
  → AI concept (host image tool / fal / local ComfyUI, только approved route)
  → deterministic pixel cleanup (perfect-pixel/Unfaker → mc-asset)
  → editable source (.grid/.mcpx; для модели — .bbmodel) + runtime PNG
  → atlas только как редактируемый/диагностический sheet
  → обычные Minecraft textures + vertical frame strip + .png.mcmeta
  → source checks → Blockbench/Blender checks → real Minecraft visual review

AnimationSpec + rig roles
  → детерминированные generators, перенесённые из sosadly
  → один внешний Blockbench engine: jasonjgardner/blockbench-mcp-plugin
  → .bbmodel + target-specific animation/geometry JSON
  → analyze_animation/loop/UV/z-fighting gates
  → contact sheets → те же состояния в production-JAR Minecraft
```

Решения по включению:

1. **`smile-minecraft/mc-asset` — `ADOPT AS PINNED EXTERNAL PROCESS` за обязательным Voxellume facade.** Пилот подтвердил 22/22 assertions, deterministic workflows и representative CLI/MCP parity. Raw CLI/MCP не получает model-controlled paths: пилот подтвердил `../`, absolute и symlink-parent escapes, отсутствие effective pre-read byte cap и non-transactional multi-artifact writes. Пилот не доказывает aesthetic или in-game correctness. [S1](#s1-mc-asset), [S14](#s14-runtime-evidence-mc-asset)
2. **`sosadly/blockbench-mcp` — пилот завершён: `REJECT` как installable MCP, `ADAPT` только методы с seeded RNG.** Пилот подтвердил работоспособность rig/cycle/interpolation/analyze methods, но также отсутствие root policy, unauthenticated loopback и nondeterministic `detail_cubes`. **Не устанавливать как второй MCP.** [S7](#s7-sosadlyblockbench-mcp), [S13](#s13-runtime-evidence-sosadly)
3. **Mosaicary — условный glTF/Blender ingress, `PENDING RUNTIME`.** Только pinned local plugin, network/catalogue/Sketchfab/upload выключены. Java Block/Item не получает bone animation через этот путь. [S3](#s3-mosaicary)
4. **EL4CTEO Blender scripts — полезны для loop/QA/contact sheets, но не как Minecraft exporter.** Они работают с FBX/glTF/USD, а не `.bbmodel`, Java model JSON или GeckoLib JSON. [S4](#s4-el4cteoblender-skills)
5. **Impeccable и Taste Skill — адаптировать методы review/provenance, не код и не web-правила.** Их Source/Browser/Design-review taxonomy, stable IDs, P0–P3, unchecked-is-not-passed и reference-driven review полезны; CSS/DOM detectors, Chrome automation и фотобанки — нет. [S9](#s9-impeccable), [S10](#s10-taste-skill)
6. **Основой редактируемой entity-модели остаётся `.bbmodel`.** Blender `.blend`/glTF — дополнительный исходник или reference, но не готовый Minecraft runtime asset. Экспорт проверяется заново после каждого преобразования.
7. **Оба runtime-пилота завершены.** `McAssetPilot` поддержал adoption только за facade (§10.1); `SosadlyAnimationPilot` поддержал adaptation методов и rejection server (§10.2). Их hashes, metrics и Blockbench/mc-asset previews не являются Minecraft client evidence или production aesthetic approval.

## 2. Границы и термины

Документ относится к Minecraft **Java Edition**: item/block/gui/particle/entity textures, Java Block/Item models, Modded Entity/GeckoLib models и их анимациям. Bedrock рассматривается только как возможный промежуточный формат внутри Blockbench, не как цель поставки.

- **Editable source** — файл, из которого asset можно осмысленно изменить и повторно экспортировать: `.grid`, `.mcpx`, `.bbmodel`, при ручном pixel-art — `.aseprite`/LibreSprite project, при Blender route — `.blend` плюс последующий `.bbmodel`.
- **Concept** — AI/raster reference. Он не становится shipping texture только потому, что визуально понравился.
- **Deterministic cleanup** — локальные операции с зафиксированными входами, параметрами и PRNG. AI generation сама по себе не детерминирована между версиями модели, драйверами или hosted-провайдерами; поэтому исходный concept сохраняется и хешируется.
- **Atlas** — редактируемый sheet, UV atlas внутри Blockbench или diagnostic contact sheet. Отдельный generic atlas JSON в resource pack не нужен: Minecraft сам собирает texture atlas. Не добавлять второй формат источника истины.
- **Browser check** в заимствованной taxonomy означает **rendered surface**. Для Voxellume это реальный Minecraft client, а не Chromium. Blockbench preview и Blender render — отдельные, более слабые свидетельства и не заменяют client check.

## 3. Сравнение репозиториев и кандидатов

### 3.1. Ранжирование по практической пользе

| Ранг     | Источник и точная версия                                                                                               | Лицензия                                                                               | Что реально переиспользовать                                                                                                                               | Статус для Voxellume                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | `smile-minecraft/mc-asset` `v0.5.0`, `bedf67229ab0fdf304f6d40bc0000a27bd05e880`                                        | MIT © 2026 mc-asset contributors                                                       | `.grid`/`.mcpx`; `pixelize`, `quantize`, `cleanup`, nearest transforms; torus generation с seed; `tile`; `animate` + `mcmeta`; style/pack/model validators | **Pilot complete: adopt pinned external process behind facade**. Raw CLI paths и raw MCP tools модели не expose; production visuals требуют отдельных gates |
| 2        | `sosadly/blockbench-mcp` `0.3.1`, `028cdd76589de2e2cea51bfd79495b50a3c7d1d2`                                           | MIT © 2026 sosadly                                                                     | `applyPaintOps`, `faceRect`/`offsetOps`, `detectRig`, rig templates, 9 cycle generators, `assertSide`, `analyze_animation`, `check_model`                  | **Pilot complete: `ADAPT` methods only, `REJECT` server**. Обязательна замена unseeded RNG; GeckoLib и in-game animation пилот не проверяли                 |
| 3        | `MopicMP/mosaicary` `0.1.4`, `08bdba5252a378cf8e2111b0c2cb27cec4ea15ba`                                                | MIT © 2026 MopicMP                                                                     | glTF/GLB → GeckoLib/Bedrock/Generic Model; bones, rotation/position/scale, step/cubic spline; atlas import и conversion report                             | **Conditional pilot**. Полезен только после проверки conversion fidelity и полного network deny                                                             |
| 4        | `EL4CTEO/blender-skills` Release 1.2.0, `fb92cfb4cc5a238c22113a6a230b09f535bd0656`                                     | MIT © 2026 EL4CTEO                                                                     | `run_in_blender.py`, `_bpyx.py`, `loop_check.py`, `qa_check.py`, `review_shots.py`, round-trip test pattern                                                | **Reuse/adapt fixed scripts для Blender route**. Не использовать engine presets как MC export                                                               |
| 5        | `pbakaus/impeccable` engine `0.1.18`, `c3bb418ee38ee49a6b999b7752c1368f3123a2bd`                                       | Apache-2.0 © 2025 Paul Bakaus; сохранить `NOTICE.md`                                   | `new-work.md`, `visualize.md`, `critique.md`, `animate.md`: reference board, dual review, P0–P3, provenance, measured review                               | **High-value method adaptation**. Не переносить Rust/DOM detector и web thresholds                                                                          |
| 6        | Fabric API `client.gametest.v1.screenshot`, `0.119.3+1.21.4` и `0.162.0+26.3`                                          | Apache-2.0                                                                             | `assertScreenshotEquals`, exact/MSE/fuzzy, regions, grayscale, fixed size/delta ticks                                                                      | **Target-local adopt**. Нет в `0.116.17+1.21.1`; не переносить на NeoForge/Forge/Quilt                                                                      |
| 7        | `perfect-pixel` PyPI `0.1.4`; `CalaKuad1/ComfyUI-PixelArt-Unfaker` `1.1.0`, `4fa56639503c7d3e2569cace50e887d75beb4192` | MIT / MIT                                                                              | FFT/edge grid detection, exact output size, palette/background cleanup, JSON manifest                                                                      | **Cleanup candidates, `PENDING RUNTIME`**. После них обязательны mc-asset и Voxellume gates                                                                 |
| 8        | `Leonxlnx/taste-skill` `2.5.0`, `9b4bf937a1f69348126959c15d2f99a73e65699b`                                             | MIT © 2026 Leonxlnx; фотографии под отдельными лицензиями                              | `NOT CHECKED`, PASS/WARN/FAIL evidence, loop review, `data-source`/stand-in honesty, anti-repetition history                                               | **Method adaptation only**. `Math.random()` заменить; assets не vendorить                                                                                   |
| 9        | `LibreSprite/LibreSprite`, `98f74431f5f523c747d278e3486625ccc7fc52cc`                                                  | GPL-2.0                                                                                | Human editor с layers/tags/onion skin; batch sheet/JSON export                                                                                             | **Optional external editor only**. Не vendorить/не связывать; export fixtures обязательны из-за known palette/frame bugs                                    |
| 10       | `scenario-labs/skills`, `754d1ceea270f1bf59651671b3471f385a5a80f9`                                                     | Repo MIT © 2026 Scenario Inc.; происхождение ported Blender files требует legal review | `bx_review`, `round_trip`, measurable animation/geometry checks; SHA-256-pinned Blender CI                                                                 | **Ниже EL4CTEO по adoption priority**. Не копировать ported family до разрешения license chain; hosted generation не использовать                           |
| Baseline | `jasonjgardner/blockbench-mcp-plugin` `1.10.1`, `97a8a80d3a37bf95c5e136d93d2c7da399fff753`                             | GPL-3.0-only                                                                           | Headless `.bbmodel` edits, format rules, deterministic exports, roots/revisions/atomic writes                                                              | **Остаётся единственным Blockbench engine**, внешний процесс; его код не копировать в core                                                                  |

Источники и точные пути приведены в разделе [12](#12-первичные-источники). Ранг означает пригодность для конкретного конвейера, не общее качество проектов.

### 3.2. Supplied web/design skills: полезны только методы

`emilkowalski/skills` `c8a79627b59d72d764d6ab6f2c87c09a48169833` и `mattpocock/skills` `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` — MIT. В них нет texture/pixel/UV/Blockbench/Blender pipeline. Переносимы:

- `choreograph/SKILL.md`: один Lead, Support/Decoration/Static, `TOGETHER|OVERLAP|SEQUENCE|CARRY`, interruption tests. В AnimationSpec это становится bone casting и transition review.
- `review-animations/SKILL.md` и `STANDARDS.md`: remedial order delete → reduce → curve → origin/pivot → interruptible → performance → polish; формат findings. Миллисекунды и CSS easing **не переносятся**.
- `animation-vocabulary/SKILL.md`: общие термины loop, stepped, interpolation, anticipation/follow-through.
- `engineering/pr/SKILL.md`: screenshot + execution evidence для delivery; сохранить вложенный credit из `CREDITS.md`.
- `engineering/research/SKILL.md` и `productivity/writing-for-agents/SKILL.md`: primary-source research и дисциплина написания skills.

Не устанавливать эти repos как Voxellume dependencies. Перенести короткие адаптированные правила с notices; весь React/CSS/mobile material оставить вне Minecraft workflow. [S11](#s11-emilkowalski-и-mattpocock)

## 4. TextureSpec и style board

### 4.1. Минимальный контракт

`TextureSpec` версионируется и валидируется до генерации:

```text
schemaVersion, assetId, role=item|block|gui|particle|entity
targetPackId, targetPackRevision
width, height, texelGrid, upscale=integer nearest only
alphaMode=opaque|cutout|translucent
palette { id, sourceHash, allowedRgba[], maxColors, ramps[] }
lightDirection=top-left (или явно утверждённое исключение)
tileable, material, silhouetteMask?, styleBoardId
generationRoute=manual|mc_asset|host_ai|fal|comfyui_unfake
seed, rngAlgorithm, cleanupSettings
animation? { frameCount, frameOrder[], frameTimeTicks, interpolate, loopMode }
exportPath, editableSourcePath, acceptanceRuleIds[]
```

`StyleBoard` содержит:

- 3–7 reference plates с source URL/author/license/modifications и SHA-256;
- sampled palette и допустимые ramps, silhouette masks, light direction, outline/tint policy;
- примеры хороших и плохих materials, density, dithering и tiling;
- явные negative constraints: no pillow shading, no accidental AA fringe, no photographic resample, no unrelated palette drift;
- approved reviewer и revision.

Reference plate — **не shipping pixels**. После замены plate, palette или silhouette прежнее approval недействительно. Метод reference-first взят из Impeccable `new-work.md`/`visualize.md`, но его web `comp-diff 72%` не применяется к 16×16 textures. [S9](#s9-impeccable)

### 4.2. Маршрут текстуры

Все вызовы mc-asset идут через Voxellume facade: allowlisted operation, facade-owned relative paths, isolated staging, journaled publication, resource limits и hash evidence. Модель не получает raw CLI path arguments или raw MCP tools. [S14](#s14-runtime-evidence-mc-asset)

1. Утвердить `TextureSpec` и `StyleBoard`.
2. Получить concept через один approved provider. Сохранить exact prompt, model/version, provider seed, request/response hashes и workflow hash. Hosted seed не считать гарантией воспроизводимости. `requestAsset` использует host callback, официальный `@fal-ai/client` `1.10.1` или ComfyUI только на `127.0.0.1:8188`; fal принимает строгий endpoint ID, не URL. ComfyUI workflow digest и parameter bindings задаёт trusted host config, все запросы имеют общий deadline и запрещают redirects. Manifest хранит hashes и allowlisted non-secret projection, не raw workflow/input или credentials.
3. Для AI raster применить один выбранный grid-recovery route:
   - `perfect-pixel` — FFT grid detection + edge refinement;
   - ComfyUI Unfaker — exact fit, background/palette cleanup, manifest.
4. Выполнить mc-asset `pixelize → quantize → cleanup → transform` только с записанными параметрами. Не применять `cleanup_jaggies` вслепую: он может удалить intentional one-pixel details.
5. Для tileable block texture выполнить `mc-asset tile --edge-match both --preview 4x4` и собственный seam gate. Для семейства — `style lint`/`style audit`.
6. Сохранить editable source и PNG. Для процедурного/manual route предпочтителен `.grid` или layered `.mcpx`; AI concept хранится рядом как исходный reference, а cleanup recipe — в manifest.
7. Экспортировать по target-local path, проверить ссылки и увидеть asset в реальном клиенте.

`mc-asset` даёт нужные команды, но его `model preview` сам сообщает, что не применяет display transforms/lighting и не является game renderer. Поэтому preview не закрывает visual acceptance. [S1](#s1-mc-asset)

### 4.3. Frame animation и `.mcmeta`

Runtime source для animated item/block/texture — vertical strip с кадрами высотой `width` и sibling file `<texture>.png.mcmeta`. Horizontal/grid sheets допустимы как editable/contact sources, но перед экспортом преобразуются mc-asset в runtime strip.

Правила:

- `animation.frametime` — целое число ticks `>= 1`; не смешивать milliseconds web skills с Minecraft ticks (`1 tick = 50 ms`).
- `frames` задаёт явный порядок индексов; ping-pong не должен случайно дублировать terminal holds.
- `interpolate=false` по умолчанию для crisp pixel art. Включение требует отдельного visual approval.
- Все кадры имеют одинаковые dimensions/palette/alpha policy; пустой кадр запрещён, кроме явно описанного effect state.
- Для цикла измеряется boundary delta `last → first`, а не только внутренние переходы.
- Generic atlas packer не добавляется. Анимация atlas не заменяет `.mcmeta`.

## 5. Typed AnimationSpec и rig pipeline

### 5.1. Контракт

```text
schemaVersion, animationSetId, targetPackId, targetPackRevision
sourceFormat=bbmodel, runtimeFormat=geckolib|target_specific
rig { type=humanoid|quadruped|custom, rootBone, bones[] }
bones[] { id, parent, pivot, role=root|lead|support|decoration|static }
clips[] {
  id, state=idle|walk|run|attack|cast|jump|hurt|death|fly|custom,
  lengthTicks, loopMode=once|loop|hold_last,
  rootMotion, keyframes[], transitions[], acceptanceRuleIds[]
}
keyframes[] {
  boneId, channel=rotation|position|scale,
  timeTick, value, interpolation=linear|step|catmullrom|bezier
}
```

Не допускать arbitrary bone names, code snippets или exporter command lines от модели. Все ссылки разрешаются по stable IDs. Перед export валидируются родительские кости, pivot, clip/state references и target capability.

### 5.2. Что перенести из sosadly

Из `plugin/blockbench_mcp.js` и `src/tools.ts`:

1. `detectRig` (`plugin:2100`), `humanoidTemplate` (`2221`), `quadrupedTemplate` (`2286`) — как typed suggestions, не безусловное изменение модели.
2. `generate_animation` (`5869`) и generators `2491–2892`: idle/walk/run/attack/cast/jump/hurt/death/fly. Они создают base cycle, после чего reviewer исправляет silhouette и gameplay timing.
3. `check_rig` (`5781–5856`) — off-joint pivots и двухкостные «cardboard» limbs как предупреждения.
4. `assertSide`/`orientationReport` (`210–400`): front `-Z`, own-right `+X`; mirrored geometry должна быть явной.
5. `analyze_animation` (`5949–6112`): evaluated bone world positions, model-axis travel, loop gap, lower-segment-still и reversed-strike checks.
6. `check_model` (`5205–5272`): missing texture, zero/out-of-bounds UV, degenerate cube, coplanar z-fight pairs.
7. Paint/face mapping и UV shelf packing — только если понадобятся own deterministic texture operations; все `Math.random()` заменяются seeded PRNG.

Завершённый пилот подтвердил эти методы на 23-bone Bedrock Entity rig: idle/walk/attack, interpolation/`close_loop`, face-relative paint/readback и Java Block/Item export работали; analyzer обнаружил planted open-loop gap `4.16`. Это подтверждает **функциональную пригодность методов**, а не их production integration: GeckoLib и Minecraft in-game animation не запускались, 12 frames получены из Blockbench preview renderer, human aesthetic approval не проводилось. [S13](#s13-runtime-evidence-sosadly)

Не переносить `audit_complexity` как pass/fail: его thresholds эстетические. Он допустим только как review hint. [S7](#s7-sosadlyblockbench-mcp)

### 5.3. Blockbench и Blender

- **Один Blockbench adapter:** внешний `jasonjgardner@97a8a80…`, root-restricted, `risky_eval=off`, atomic revisions. Sosadly MCP одновременно не запускается и не регистрируется.
- **Mosaicary:** только если вход — reviewed Blender/glTF. Плагин загружается из pinned local `plugin/gltf_to_minecraft.js`; import report с counts/warnings входит в evidence. Meshes→cubes и coplanar inflation требуют послеимпортного review.
- **Blender:** fixed `run_in_blender.py`/`_bpyx.py`, `loop_check.py` (`0.5°`, `0.001 m` upstream defaults), `qa_check.py`, `review_shots.py`. Записывать `bpy.app.version_string` и `bpy.app.build_hash`; не использовать unpinned discovery как доказательство среды.
- Отключить `floating`/`enclosed`/watertight как универсальные MC gates: cuboid entities законно состоят из separated/intersecting parts. Вместо них применяются MC-specific clipping/ground/z-fight rules.
- `.blend`/GLB/contact sheet полезны для silhouette, loop и QA, но итоговый `.bbmodel` и target JSON проверяются независимо. [S4](#s4-el4cteoblender-skills), [S5](#s5-scenario-labs-skills)

## 6. Evidence taxonomy и статусы

Каждое правило имеет стабильный ID и один основной класс:

| `checkClass`    | Что является evidence                                                                                       | Что нельзя утверждать                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `source`        | JSON/PNG/.bbmodel/.mcmeta bytes, schemas, hashes, deterministic metrics, import/export round-trip           | Что asset правильно выглядит в игре                     |
| `browser`       | **Real Minecraft client** capture с фиксированными camera/tick/renderer; loader-native screenshot assertion | Что числовой screenshot diff доказывает эстетику        |
| `design_review` | Reviewer rubric, annotated crops/contact sheets, approved/rejected decision и причина                       | Что человеческий review заменяет behavior/static checks |

`browser` сохранён как имя категории для совместимости с заимствованной Impeccable taxonomy; в отчёте рядом обязательно указывается `surface=minecraft_client|blockbench|blender`. Только `minecraft_client` закрывает in-game gates. [S9](#s9-impeccable)

Execution status остаётся общим:

```text
passed | failed | timed_out | cancelled | unsupported | unavailable
```

Дополнительно `checked=false` означает, что проверка не исполнялась; её статус обязан быть `unavailable` или `unsupported`, **не `passed`**. Taste Skill прямо использует `NOT CHECKED` вместо колонки PASS, а Impeccable требует отдельного degraded review при отсутствии независимого assessment. [S9](#s9-impeccable), [S10](#s10-taste-skill)

Severity:

- **P0** — crash/load failure, missing asset, security/provenance violation.
- **P1** — invisible/wrong-facing model, broken required state, non-looping required loop.
- **P2** — UV stretch, unintended clipping, visible seam, wrong tint.
- **P3** — локальный polish без потери читаемости.

P0/P1 всегда блокируют acceptance. P2 блокирует asset approval, если нет scoped reviewed exception; P3 может быть отложен с записанным issue. Exception содержит rule ID, asset/state scope, reason, owner, expiry и evidence. Security/provenance rules не подавляются.

## 7. Acceptance gates

Ниже — **предлагаемые Voxellume gates**, а не выдержки из upstream. Числа являются начальными строгими порогами; их изменение требует отдельного baseline review, а не подгонки под failing asset.

### 7.1. Texture, palette, alpha, tiling

| Rule ID                    | Класс                   | Acceptance                                                                                                                                                                                                                        |
| -------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VX-TEX-001-DIMENSIONS`    | source                  | PNG декодируется после byte/pixel limit checks; width/height точно равны TextureSpec. Runtime upscale только integer nearest; non-integer resample запрещён                                                                       |
| `VX-TEX-002-PIXEL-GRID`    | source                  | Cleanup output имеет native texel grid; нет незаявленных промежуточных RGBA от bilinear/AA. Для cutout каждый nonzero pixel принадлежит approved palette                                                                          |
| `VX-TEX-003-PALETTE`       | source                  | Каждый непрозрачный RGB входит в `allowedRgba[]`; `uniqueColors <= maxColors`; нет unresolved `STYLE_COLOR_BUDGET` или family palette drift. Изменение palette = новая StyleBoard revision                                        |
| `VX-TEX-004-ALPHA`         | source                  | `opaque`: все alpha=255; `cutout`: alpha только 0/255; `translucent`: разрешён только явно заданный набор значений. Нет fully-transparent asset или случайной translucent fringe; alpha bbox соответствует silhouette             |
| `VX-TEX-005-TILING-WRAP`   | source                  | Для `tileable=true`: horizontal и vertical wrap MAE по RGB/alpha `<= max(P95(internal adjacent-edge MAE), 2/255)` и при этом `<= 12/255`. Пустые alpha pixels исключаются из RGB среднего. Нарушение нельзя скрыть mirror preview |
| `VX-TEX-006-TILING-REVIEW` | browser + design_review | 3×3 placed blocks и 4×4 texture preview при двух камерах/освещениях не показывают видимого шва, периодического distracting motif или orientation break                                                                            |
| `VX-TEX-007-STYLE-FAMILY`  | source + design_review  | Все failing mc-asset style findings устранены; silhouette/palette/size drift либо исправлен, либо явно описан в новой approved spec                                                                                               |
| `VX-TEX-008-REFERENCES`    | source                  | Blockstate/model/entity texture refs существуют, namespace/path корректны, нет unused/stale exports; runtime PNG hash совпадает с manifest                                                                                        |

### 7.2. Frame animation

| Rule ID                 | Класс   | Acceptance                                                                                                                                                       |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VX-FRM-001-STRIP`      | source  | `height = width × frameCount`; все frames nonempty, одинакового размера; `.png.mcmeta` валиден и соответствует имени texture                                     |
| `VX-FRM-002-ORDER-TIME` | source  | Каждый frame index в диапазоне; порядок равен AnimationSpec; `frametime` integer `>=1`; interpolation совпадает со spec; нет случайных duplicate terminal frames |
| `VX-FRM-003-LOOP-DELTA` | source  | Для `loopMode=loop`: `MAE(last,first) <= max(P95(MAE(frame[i],frame[i+1])), 2/255)`. Исключение только для явного non-loop/hold state                            |
| `VX-FRM-004-PLAYBACK`   | browser | Клиент проигрывает все кадры с ожидаемым tick timing; нет blank/fallback texture; restart/state change не оставляет прежний frame index                          |

### 7.3. UV, модель и orientation

| Rule ID                 | Класс            | Acceptance                                                                                                                                                         |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VX-UV-001-BOUNDS`      | source           | UV finite, внутри texture bounds, каждая required face имеет nonzero area; texture refs существуют; для pixel-grid profile UV совпадают с целыми texel coordinates |
| `VX-UV-002-ORIENTATION` | source + browser | Front `-Z`, own-right `+X`, нормали и face assignment соответствуют spec; mirrored limbs явно помечены. Проверяются north/east/south/west и все display transforms |
| `VX-UV-003-DISTORTION`  | design_review    | Нет незапланированного stretching, wrong-face lettering, seam на лице персонажа; Blockbench preview и client screenshots согласованы                               |
| `VX-MDL-001-ROUNDTRIP`  | source           | Editable source → export → reparse сохраняет cubes/bones/pivots/UV/materials/clip names; расхождения образуют nonempty diff и блокируют acceptance                 |
| `VX-MDL-002-DEGENERATE` | source           | Нет zero-size cubes, zero-area required faces, missing bone parent, отсутствующих materials; target-specific model schema пройден                                  |

### 7.4. Bone animation, loop, clipping, z-fighting

| Rule ID                   | Класс                            | Acceptance                                                                                                                                                                                                                                                         |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VX-ANIM-001-RIG`         | source + design_review           | Один root, не более одного Lead по художественной иерархии, Support/Static roles заданы; pivots совпадают с суставами; detached cube parentage корректна                                                                                                           |
| `VX-ANIM-002-LOOP-SEAM`   | source                           | Для loop clip first/last evaluated pose: rotation delta `<=0.5°`, translation `<=0.001` model unit, scale delta `<=0.0001`; ground-travel root исключается только при `rootMotion` policy. Seam speed отличается от медианной internal speed не более чем в 2 раза |
| `VX-ANIM-003-TRAVEL`      | source + design_review           | Walk/run имеют движение в ожидаемой model axis; strike идёт в заданном направлении; нижние сегменты не остаются неподвижны, если это не Static role                                                                                                                |
| `VX-ANIM-004-TRANSITIONS` | browser                          | idle↔walk/run, attack/hurt и re-trigger mid-clip не складывают overlays и не дают pose pop; `once` завершается заданным state, death держит final pose                                                                                                             |
| `VX-CLIP-001-GROUND-SELF` | source + browser + design_review | Нет незапланированного ground penetration (`<=0.001` block tolerance), visible interpenetration вне approved joint/contact zones; проверяются крайние позы каждого required clip                                                                                   |
| `VX-ZF-001-COPLANAR`      | source + browser                 | Ноль неутверждённых coplanar overlapping face pairs в `check_model`; нет flicker при движении камеры. Inflate допустим только как записанное изменение geometry, не молчаливая маскировка                                                                          |
| `VX-ANIM-005-STATES`      | browser                          | Все ModSpec states воспроизведены в game; required clips присутствуют в production JAR, multiplayer observer видит тот же state, persistence/restart не ломает state machine                                                                                       |

### 7.5. Обязательные in-game сцены

Для каждого применимого asset:

1. inventory icon и tooltip;
2. first-person и third-person hand;
3. dropped item и placed block;
4. north/east/south/west, верх/низ где применимо;
5. GUI open/close и animation state changes;
6. idle/walk/run/attack/hurt/death/fly — только заявленные в ModSpec;
7. tileable 3×3 surface, light/dark background для alpha, day/night/emissive где применимо;
8. production JAR в чистом instance, а не только dev client;
9. multiplayer для entity/state synchronization, если feature это требует.

Сцена фиксирует resolution, GUI scale, FOV/camera, world seed/state, tick, time/weather, inputs, OS/renderer/GPU, production-JAR SHA-256, baseline SHA-256 и tolerance. Screenshot без этих полей — reference, не regression evidence.

Для Fabric `>=1.21.4` можно использовать `ClientGameTestContext.assertScreenshotEquals` с явно выбранными region/algorithm/tolerance. Шаблоны должны быть opaque; upstream отмечает GPU/frame variance. Для `1.21.1` этот API отсутствует, поэтому статус `unsupported` для данного метода, а не автоматический PASS. Для остальных targets используются собственные client captures + `pixelmatch`; human rubric обязателен в обоих случаях. [S2](#s2-fabric-client-gametest-screenshots)

## 8. Provenance и воспроизводимость

Каждый runtime asset связывается с manifest entry:

```text
assetId, TextureSpec/AnimationSpec hash, editableSource path+SHA-256
concept/reference source URL, author, license, modifications, notice hashes
provider, exact prompt, model/version, provider seed, request/response hash
ComfyUI workflow+revision+SHA-256, cost когда доступен
cleanup tool/version/revision/argv/settings/output hashes
mc-asset version, .grid/.mcpx/style/lock hashes, CLI seed
Blockbench project format/version, plugin revisions, export settings
Mosaicary import report, Blender version+build hash, conversion diffs
targetPackId/revision, resource/data formats, runtime export hashes
scenario IDs, source/browser/design-review evidence IDs
approval reviewer/revision, standIn flag, known limitations
```

Sidecar JSON + manifest hash предпочтительнее PNG `tEXt`: optimizers могут удалить ancillary chunks. Approval отзывается при изменении source, export, palette, workflow или conversion revision. Права на reference/model weights/vanilla assets не предполагаются из наличия файла; `license_not_found` фиксируется честно.

### Seeded RNG

- Все own random operations используют версионированный PRNG, например `xoshiro128**`, с seed derived как `SHA-256("voxellume-asset-v1" || manifestSeed || assetId || stage)`.
- Алгоритм, seed derivation version и numeric precision записываются. Повторный run на тех же bytes обязан дать тот же output SHA-256.
- `Math.random()` из Taste `deal.mjs` и sosadly `dither`, `noise`, `detail_cubes` не переносится. Пилот подтвердил дефект: два identical `detail_cubes` run дали разные PNG SHA-256, а seeded VFX с seed `42` дважды дал `a23bb80f01deb0ed80dcd1168aad559e10db37be6ccf51ed19ff7d835d7df3fc`. Это не доказывает byte-determinism всего `.bbmodel`: editor UUID/state варьируются. Anti-repetition history Taste сохраняется отдельно от seed. [S13](#s13-runtime-evidence-sosadly)
- Для mc-asset используется его `--seed`. Пилот подтвердил 12 deterministic workflows и 19/19 SHA-identical artifact pairs на Node `v24.21.0`; offline output совпал с online. Bun `1.4.2` использовался для upstream tests, но Bun-vs-Node byte comparison не выполнялся, поэтому cross-runtime determinism не заявляется. [S14](#s14-runtime-evidence-mc-asset)
- Hosted AI output сохраняется как immutable input. Даже при одинаковом hosted seed повторный вызов не является доказательством byte reproducibility.

## 9. Security restrictions

1. Только fixed executable + argument arrays, `shell:false`; модель не передаёт Python/JavaScript, plugin URL, arbitrary output path или command line.
2. Writable root ограничен transaction asset staging. Export использует expected source revision, sibling temp file и atomic rename; symlink/absolute/`..` escapes отклоняются. Для mc-asset facade дополнительно делает `realpath` existing ancestors, повторную проверку при mutation и staged journal publication всего output set: пилот подтвердил successful `../`, absolute и symlink-parent escapes, а upstream multi-file writes не все-or-nothing. [S14](#s14-runtime-evidence-mc-asset)
3. PNG/JAR/ZIP/GLB проверяются по byte/pixel/entry/ratio limits **до** decode/extract. Для mc-asset действует facade input cap 16 MiB до spawn/read, decoded-edge/memory/output/log/MCP-response quotas: общий raster path не остановил 16 MiB + 1 input специальным byte-limit error. Network выключен по умолчанию; fal/ComfyUI и downloads требуют exact approved hosts/purposes. [S14](#s14-runtime-evidence-mc-asset)
4. API keys/OAuth хранятся вне repo/evidence. Логи redacted. Evidence записывается supervisor вне agent-writable tree.
5. **Никогда одновременно не запускать sosadly и jason Blockbench MCP.** Единственный adapter выбирается заранее; текущий выбор — jason headless external. Не создавать вторую MCP поверхность у mc-asset без отдельной необходимости.
6. Sosadly `execute_script` (default-on upstream), `install_plugin`, arbitrary import/export paths и unauthenticated loopback command bridge не переносятся. Пилот подтвердил, что outside-root request дошёл до filesystem и вернул `ENOTDIR`, а не policy rejection; выключенный `execute_script` отклонился лишь при явном `blockbench_mcp_allow_scripts=false`. [S7](#s7-sosadlyblockbench-mcp), [S13](#s13-runtime-evidence-sosadly)
7. Mosaicary catalogue, Sketchfab, upload и API-key storage отключены; plugin загружается из локального pinned file, egress denied. [S3](#s3-mosaicary)
8. Blender запускается только с reviewed fixed scripts и `--factory-startup`; никакого model-authored `bpy`, `--expr` или live `execute_python`. Версия binary и SHA-256 фиксируются. Supply-chain pattern с checksum следует брать из Scenario CI, а не `curl | tar` без проверки. [S4](#s4-el4cteoblender-skills), [S5](#s5-scenario-labs-skills)
9. GPL components остаются внешними процессами с notices; это архитектурная изоляция, а не автоматическое юридическое заключение. Распространение LibreSprite/jason требует отдельного legal/package review.
10. Timeout/cancellation завершает всю process group; unexecuted render получает `cancelled`/`timed_out`, не `passed`.

## 10. Пилоты и критерии включения

### 10.1. `mc-asset` — `PILOT COMPLETE`; `ADOPT AS PINNED EXTERNAL PROCESS` behind facade

Evidence: `~/.local/share/voxellume/evidence/mc-asset-pilot-20261106T151444Z/README.md`, `pilot-results.json`, `upstream-results.json` и `mcp-results.json`. Exact revision `bedf67229ab0fdf304f6d40bc0000a27bd05e880` (`v0.5.0`), Node `v24.21.0`, Bun `1.4.2 (744846f84)`, macOS arm64. [S14](#s14-runtime-evidence-mc-asset)

**Наблюдено:**

- Frozen install, typecheck и build passed. Upstream suite: **2860 passed, 1 skipped, 0 failed**, 16 505 assertions в 108 files.
- Pilot: **48 CLI commands, 22/22 assertions passed**. Восемь nonzero statuses были ожидаемыми domain/security failures, включая style drift и malformed/overwrite cases.
- Пройдены `.grid → .mcpx → PNG`, editable rebuild, pixelize/quantize/cleanup invocation, seeded generation, tiling, 4-frame animation + `.mcmeta`, style/pack validation и reproducible ZIP.
- **12 deterministic workflows, все 19 artifact pairs SHA-identical**. Offline generation совпало с online output по SHA-256.
- Stdio MCP exposed 27 tools; representative `generate_asset` PNG bytes, `tile_asset` metrics и `validate_asset` verdict/findings совпали с CLI. Normal close завершил PID `32739`; timeout вернул `-32001`, close завершил PID `32743`, surviving child не найден.
- Offline CLI/MCP работали с denied outbound network, isolated `HOME`/`TMPDIR`, minimal environment и без credentials.

**Blocking raw-integration findings:**

- CLI `--output ../…`, absolute output и output beneath symlinked parent создали files outside intended root. MCP также принял absolute outside-root output. Leaf symlink atomically заменился без изменения outside sentinel, но это не защищает от parent traversal.
- General raster input 16 MiB + 1 byte был прочитан и затем отклонён как unsupported, а не остановлен effective pre-read byte cap. PNG 16384×16384 отклонён до pixel decode по dimension limit 4096.
- Multi-artifact writes атомарны per-file, но не transactional для всего набора. Поэтому facade обязан валидировать/hashировать staged outputs и публиковать весь set через journal, с cleanup при failure/cancellation.

**Условия adoption:** только pinned process с allowlisted operations, `shell:false`, facade-owned roots, `realpath`/symlink-race/hardlink rejection, staged journal publication, pre-read и output quotas, complete process-group cleanup, offline/scrubbed environment и SHA-256 evidence. Raw CLI paths и raw MCP tools модели не expose. Concurrent path-swap, hardlink exploit и ZIP bomb не исполнялись и остаются обязательными facade security tests.

**Границы evidence:** тестировались macOS arm64 и representative fixtures, не Linux/Windows, Node 22 или Bun-vs-Node byte equality. Quantize/cleanup не изменили выбранный compliant fixture. Hashes, tile metrics и CLI/MCP parity не доказывают AI aesthetic quality, artistic coherence, animation appearance или in-game correctness; real Minecraft client/server tests не выполнялись и остаются отдельными acceptance gates.

### 10.2. Sosadly methods — `PILOT COMPLETE`; `REJECT` server, `ADAPT` methods

Evidence: `~/.local/share/voxellume/evidence/sosadly-blockbench-20261106-1/report.json` и sibling `artifact-manifest.sha256` с 23 artifacts. Пилот исполнен на exact commit `028cdd76589de2e2cea51bfd79495b50a3c7d1d2`, Blockbench `5.2.2`, Node `v24.21.0`, darwin arm64. [S13](#s13-runtime-evidence-sosadly)

**Наблюдено:**

- Создан editable Bedrock Entity `pilot_golem.bbmodel`: 23 bones, 17 cubes; `check_rig` passed; сохранены `.bbmodel` и `.geo.json`.
- Generators создали idle (`2 s`, 90 keyframes), walk (`1 s`, 171), attack (`0.85 s`, 53); получены по 4 preview frames на clip, всего 12. Walk loop gaps измерены как `0` на контрольных bones; attack direction проверен численно.
- Manual interpolation сохранил `catmullrom`/`step`; `close_loop` повторил pose `t=0` на `t=2`. Analyzer отклонил insufficient head-only motion и обнаружил planted stiff limb. Negative open-loop control обнаружен с `hand_right_loop_gap=4.16` и `loop_not_closed`.
- Java Block/Item `pilot_lantern` создан, textured, сохранён как `.bbmodel`, экспортирован в `.json` и показан в Blockbench Java render. Face painting и PNG readback passed.
- Identical `detail_cubes` runs дали разные hashes `013b29db…` и `3fbfdb2b…`; seeded VFX runs совпали с hash `a23bb80f…`. Следовательно, `detail_cubes` и paint dither/noise переносятся **только после seeded RNG replacement**.
- `execute_script=false` отклонил script, но upstream default `true`. Outside-path request `/dev/null/voxellume-outside.bbmodel` достиг filesystem и вернул `ENOTDIR`: это не authorized-root rejection. Loopback listeners не имели authentication.
- Cleanup passed: exact PIDs `31427`, `31746`, `31768` отсутствуют; listeners `8787`/`9337` закрыты; normal Blockbench profile, upstream source и Voxellume repo не изменены.

**Границы evidence:** анимационный rig был Bedrock Entity, потому что Java Block/Item не имеет animation mode. GeckoLib и Minecraft in-game animation не исполнялись. Все renders — Blockbench preview, не Minecraft client. Нулевое analyzer issue count и preview images не являются gameplay или human aesthetic approval; production aesthetic approval не запрашивалось и не выносилось.

**Оставшиеся gates для собственной адаптации:**

- Перенести минимальные pure functions за own typed API под MIT notice, без MCP bridge, `execute_script` и `install_plugin`.
- Прогнать все random paths через явный seed; повторный generation с одинаковым AnimationSpec/seed должен дать одинаковый semantic export hash. Editor UUID/state нормализуются, а не игнорируются молча.
- Добавить planted defects для off-joint pivot, mirrored arm, reversed strike, z-fight, missing UV/texture; сравнить analyzer с независимым evaluated-pose oracle.
- Статический GeckoLib `1.12.0` geometry и `1.8.0` animation export/re-import проверяется по официальным schema definitions `bernie-g/geckolib` `7c96bef7e1658e4158453c17eb464f0fb7f92426`; это не runtime evidence. Проверить все required states в production-JAR Minecraft, затем отдельно провести human visual review.

### 10.3. Остальные conditional pilots

- **Mosaicary:** GLB с иерархией bones, rotation/position/scale clips, multiple textures, coplanar faces и curved mesh. Проверить import report, round-trip diff, network deny и client result.
- **perfect-pixel/Unfaker:** mushy AI input, intentional one-pixel lines, cutout edges, batch frame consistency. Независимо проверить palette/alpha/grid; сохранить manifest.
- **Blender:** pinned 5.2.x, fixed scripts, planted loop/z-fight/UV defects, headless cancellation, contact sheets. GPU-skipped upstream CI не засчитывается как Voxellume render evidence.
- **LibreSprite:** tagged frame export regression для upstream issues `#353` и duplicate linked frames; только после этого optional manual-editor route.

## 11. Что не принимать

| Не принимать                                                                         | Причина                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Второй Blockbench MCP / sosadly server                                               | Desktop-only live state, нет roots/revisions/atomic writes, default-on arbitrary JS и plugin loading, nondeterministic random texture ops   |
| Копирование jason GPL code в core                                                    | GPL-3.0-only; baseline разрешён как внешний процесс, а не источник MIT core                                                                 |
| Scenario hosted texture/game-assets/sprite-animation                                 | Paid/network/OAuth route, partial seeds, нет editable Minecraft contract и real-game evidence                                               |
| Scenario ported Blender files без legal review                                       | Исходный `edemaistre/blender-expert-skills` v0.1/main не содержит LICENSE, несмотря на MIT declarations в ported skills                     |
| FBX/GLB/USD engine presets как MC delivery                                           | Не являются Java Block/Item, `.bbmodel` или GeckoLib runtime formats                                                                        |
| Blender `floating`/`enclosed`/watertight/triangle budgets как универсальные MC gates | Дают false failures на intentional separated cuboids и переносят чужие engine constraints                                                   |
| Impeccable/Taste browser code, Rust detector, photo assets, CSS rules                | Нет Minecraft semantics; 72% screenshot comp и ms/bezier values не переносятся на 16×16 и ticks                                             |
| `Math.random()` в любом own asset path                                               | Нарушает deterministic regeneration и hash evidence                                                                                         |
| Generic atlas JSON / второй atlas packer                                             | Minecraft Java не требует этого формата; появляется вторая истина и лишний conversion drift                                                 |
| Normal/PBR maps по умолчанию                                                         | Vanilla Java baseline их не потребляет; только явный shader/LabPBR target. PixelGraph имеет commercial-use condition и требует legal review |
| Aseprite как OSS dependency                                                          | Proprietary; допустим только отдельный пользовательский editor вне OSS bundle                                                               |
| `JannisX11/blockbench-plugins` `gltf_importer` вместо Mosaicary                      | Нет armatures/cubes/GeckoLib conversion; license не подтверждён                                                                             |
| `Jom-er/VoxGen`, `ghostmmmm/comfyui-pixel-art-workflow`, тонкие Pixelate wrappers    | Web-only/без ясной license/paid uncontrolled nodes/дублирование perfect-pixel                                                               |
| `pixelmatch` или mc-asset `model preview` как aesthetic/gameplay proof               | Это numeric/preview evidence только; нужен real client + design review                                                                      |
| Автоматическое принятие upstream benchmark/marketing                                 | «Best», blind-win и determinism claims без воспроизводимого Voxellume harness не являются evidence                                          |

## 12. Первичные источники

### S1: mc-asset

- Repo/release: <https://github.com/smile-minecraft/mc-asset>, <https://github.com/smile-minecraft/mc-asset/releases/tag/v0.5.0>.
- Exact revision: <https://github.com/smile-minecraft/mc-asset/tree/bedf67229ab0fdf304f6d40bc0000a27bd05e880>.
- License: <https://github.com/smile-minecraft/mc-asset/blob/bedf67229ab0fdf304f6d40bc0000a27bd05e880/LICENSE>.
- CLI surface: <https://github.com/smile-minecraft/mc-asset/blob/bedf67229ab0fdf304f6d40bc0000a27bd05e880/docs/cli-surface.md>.
- Pixel-art rules: <https://github.com/smile-minecraft/mc-asset/blob/bedf67229ab0fdf304f6d40bc0000a27bd05e880/skills/minecraft-pixel-art/SKILL.md>.
- Package/runtime: <https://github.com/smile-minecraft/mc-asset/blob/bedf67229ab0fdf304f6d40bc0000a27bd05e880/package.json>.

### S14: Runtime evidence mc-asset

- Evidence root: `~/.local/share/voxellume/evidence/mc-asset-pilot-20261106T151444Z/`.
- Human-readable exact commands, workflow matrix, representative hashes, security findings и limitations: `README.md`.
- Structured 48 commands, 12 determinism pairs, security cases, MCP lifecycle, 22/22 assertions и artifacts: `pilot-results.json`.
- Upstream install/test/typecheck/build summary: `upstream-results.json`; logs `upstream-install.log`, `upstream-test.log`, `upstream-typecheck.log`, `upstream-build.log`.
- MCP tool inventory/parity/lifecycle: `mcp-results.json`; exact per-command evidence находится в `commands/`, reproduction harness — `run-pilot.mjs`.
- Evidence ограничен macOS arm64 и representative fixtures; отчёт прямо фиксирует отсутствие real Minecraft client/server, human aesthetic approval, concurrent path-swap/hardlink/ZIP-bomb tests и Bun-vs-Node byte comparison.

### S2: Fabric Client GameTest screenshots

- `0.119.3+1.21.4` screenshot package: <https://maven.fabricmc.net/docs/fabric-api-0.119.3+1.21.4/net/fabricmc/fabric/api/client/gametest/v1/screenshot/package-summary.html>.
- `0.162.0+26.3` options: <https://maven.fabricmc.net/docs/fabric-api-0.162.0+26.3/net/fabricmc/fabric/api/client/gametest/v1/screenshot/TestScreenshotComparisonOptions.html>.
- `0.162.0+26.3` assertions: <https://maven.fabricmc.net/docs/fabric-api-0.162.0+26.3/net/fabricmc/fabric/api/client/gametest/v1/context/ClientGameTestContext.html>.
- Отсутствие пакета в `0.116.17+1.21.1`: <https://maven.fabricmc.net/docs/fabric-api-0.116.17+1.21.1/net/fabricmc/fabric/api/client/gametest/v1/package-summary.html> (404 на дату исследования).
- Fabric API license: <https://github.com/FabricMC/fabric/blob/1.21.4/LICENSE>.

### S3: Mosaicary

- Exact revision: <https://github.com/MopicMP/mosaicary/tree/08bdba5252a378cf8e2111b0c2cb27cec4ea15ba>.
- README, supported imports/exports и limitations: <https://github.com/MopicMP/mosaicary/blob/08bdba5252a378cf8e2111b0c2cb27cec4ea15ba/README.md>.
- Plugin path: <https://github.com/MopicMP/mosaicary/blob/08bdba5252a378cf8e2111b0c2cb27cec4ea15ba/plugin/gltf_to_minecraft.js>.
- Network-touching surface: <https://github.com/MopicMP/mosaicary/blob/08bdba5252a378cf8e2111b0c2cb27cec4ea15ba/docs/what-it-touches.md>.
- MIT: <https://github.com/MopicMP/mosaicary/blob/08bdba5252a378cf8e2111b0c2cb27cec4ea15ba/LICENSE>.

### S4: EL4CTEO/blender-skills

- Exact revision: <https://github.com/EL4CTEO/blender-skills/tree/fb92cfb4cc5a238c22113a6a230b09f535bd0656>.
- MIT: <https://github.com/EL4CTEO/blender-skills/blob/fb92cfb4cc5a238c22113a6a230b09f535bd0656/LICENSE>.
- `skills/blender-core/scripts/run_in_blender.py`: <https://github.com/EL4CTEO/blender-skills/blob/fb92cfb4cc5a238c22113a6a230b09f535bd0656/skills/blender-core/scripts/run_in_blender.py>.
- `shared/_bpyx.py`: <https://github.com/EL4CTEO/blender-skills/blob/fb92cfb4cc5a238c22113a6a230b09f535bd0656/shared/_bpyx.py>.
- `skills/blender-animation/scripts/loop_check.py`: <https://github.com/EL4CTEO/blender-skills/blob/fb92cfb4cc5a238c22113a6a230b09f535bd0656/skills/blender-animation/scripts/loop_check.py>.
- `skills/blender-asset-qa/scripts/qa_check.py`: <https://github.com/EL4CTEO/blender-skills/blob/fb92cfb4cc5a238c22113a6a230b09f535bd0656/skills/blender-asset-qa/scripts/qa_check.py>.
- `skills/blender-asset-qa/scripts/review_shots.py`: <https://github.com/EL4CTEO/blender-skills/blob/fb92cfb4cc5a238c22113a6a230b09f535bd0656/skills/blender-asset-qa/scripts/review_shots.py>.
- `skills/blender-export-pipelines/scripts/export_asset.py`: <https://github.com/EL4CTEO/blender-skills/blob/fb92cfb4cc5a238c22113a6a230b09f535bd0656/skills/blender-export-pipelines/scripts/export_asset.py>.
- CI/Blender 5.2.3: <https://github.com/EL4CTEO/blender-skills/blob/fb92cfb4cc5a238c22113a6a230b09f535bd0656/.github/workflows/ci.yml>.

### S5: scenario-labs/skills

- Exact Blender family revision: <https://github.com/scenario-labs/skills/tree/754d1ceea270f1bf59651671b3471f385a5a80f9/skills/dcc/blender>.
- MIT: <https://github.com/scenario-labs/skills/blob/754d1ceea270f1bf59651671b3471f385a5a80f9/LICENSE>.
- `scenario-blender-expert/scripts/bx_audit.py`: <https://github.com/scenario-labs/skills/blob/754d1ceea270f1bf59651671b3471f385a5a80f9/skills/dcc/blender/scenario-blender-expert/scripts/bx_audit.py>.
- `scenario-blender-expert/scripts/bx_review.py`: <https://github.com/scenario-labs/skills/blob/754d1ceea270f1bf59651671b3471f385a5a80f9/skills/dcc/blender/scenario-blender-expert/scripts/bx_review.py>.
- `scenario-blender-export/scripts/bx_export.py`: <https://github.com/scenario-labs/skills/blob/754d1ceea270f1bf59651671b3471f385a5a80f9/skills/dcc/blender/scenario-blender-export/scripts/bx_export.py>.
- SHA-256-checked Blender CI: <https://github.com/scenario-labs/skills/blob/754d1ceea270f1bf59651671b3471f385a5a80f9/.github/workflows/blender.yml>.
- Upstream без LICENSE: <https://github.com/edemaistre/blender-expert-skills>.

### S6: perfect-pixel, Unfaker, LibreSprite

- `perfect-pixel` PyPI primary metadata `0.1.4`: <https://pypi.org/pypi/perfect-pixel/0.1.4/json>.
- Unfaker exact revision: <https://github.com/CalaKuad1/ComfyUI-PixelArt-Unfaker/tree/4fa56639503c7d3e2569cace50e887d75beb4192>.
- Unfaker parameters/outputs: <https://github.com/CalaKuad1/ComfyUI-PixelArt-Unfaker/blob/4fa56639503c7d3e2569cace50e887d75beb4192/README.md>.
- Unfaker MIT: <https://github.com/CalaKuad1/ComfyUI-PixelArt-Unfaker/blob/4fa56639503c7d3e2569cace50e887d75beb4192/LICENSE>.
- LibreSprite exact revision: <https://github.com/LibreSprite/LibreSprite/tree/98f74431f5f523c747d278e3486625ccc7fc52cc>.
- LibreSprite CLI options: <https://github.com/LibreSprite/LibreSprite/blob/98f74431f5f523c747d278e3486625ccc7fc52cc/src/app/app_options.cpp>.
- GPL-2.0: <https://github.com/LibreSprite/LibreSprite/blob/98f74431f5f523c747d278e3486625ccc7fc52cc/LICENSE.txt>.
- Export issue `#353`: <https://github.com/LibreSprite/LibreSprite/issues/353>.

### S7: sosadly/blockbench-mcp

- Exact revision: <https://github.com/sosadly/blockbench-mcp/tree/028cdd76589de2e2cea51bfd79495b50a3c7d1d2>.
- MIT: <https://github.com/sosadly/blockbench-mcp/blob/028cdd76589de2e2cea51bfd79495b50a3c7d1d2/LICENSE>.
- `plugin/blockbench_mcp.js`: <https://github.com/sosadly/blockbench-mcp/blob/028cdd76589de2e2cea51bfd79495b50a3c7d1d2/plugin/blockbench_mcp.js>.
- `src/tools.ts`: <https://github.com/sosadly/blockbench-mcp/blob/028cdd76589de2e2cea51bfd79495b50a3c7d1d2/src/tools.ts>.
- `src/client.ts`: <https://github.com/sosadly/blockbench-mcp/blob/028cdd76589de2e2cea51bfd79495b50a3c7d1d2/src/client.ts>.
- Security description: <https://github.com/sosadly/blockbench-mcp/blob/028cdd76589de2e2cea51bfd79495b50a3c7d1d2/README.md#security>.

### S13: Runtime evidence Sosadly

- Полный structured report: `~/.local/share/voxellume/evidence/sosadly-blockbench-20261106-1/report.json`, schema `voxellume.sosadly-blockbench-pilot.v1`, date `2026-11-06`.
- Artifact hashes: `~/.local/share/voxellume/evidence/sosadly-blockbench-20261106-1/artifact-manifest.sha256`; 23 artifacts, включая editable `.bbmodel`, exported Java/geometry JSON, face readback и 12 animation preview frames.
- Raw tool results: `java-results.json`, `animation-results.json`, `control-results.json`, `open-loop-results.json` в том же evidence root.
- Environment identity и tool hashes: Blockbench `5.2.2`, Node `v24.21.0`, plugin SHA-256 `9c0f6fecaa528a698b3adb095f854383fc5ea231336462b9e97ab73a043c3721`, `dist/index` SHA-256 `d5fb12343da1685cc84020c2ede72eee8cefcd0ff45f0b6775f364f350b4f881`.
- Evidence ограничен Blockbench desktop/preview; отчёт прямо фиксирует отсутствие GeckoLib, Minecraft client, headless CI и human aesthetic approval.

### S8: jasonjgardner Blockbench baseline

- Exact revision: <https://github.com/jasonjgardner/blockbench-mcp-plugin/tree/97a8a80d3a37bf95c5e136d93d2c7da399fff753>.
- GPL declaration/version: <https://github.com/jasonjgardner/blockbench-mcp-plugin/blob/97a8a80d3a37bf95c5e136d93d2c7da399fff753/package.json>.
- Headless behavior/roots/revisions: <https://github.com/jasonjgardner/blockbench-mcp-plugin/blob/97a8a80d3a37bf95c5e136d93d2c7da399fff753/headless/README.md>.
- Format validation: <https://github.com/jasonjgardner/blockbench-mcp-plugin/blob/97a8a80d3a37bf95c5e136d93d2c7da399fff753/headless/formats/rules.ts>.
- Animation gates: <https://github.com/jasonjgardner/blockbench-mcp-plugin/blob/97a8a80d3a37bf95c5e136d93d2c7da399fff753/headless/gates/animation.ts>.

### S9: Impeccable

- Exact revision: <https://github.com/pbakaus/impeccable/tree/c3bb418ee38ee49a6b999b7752c1368f3123a2bd>.
- Apache-2.0 и NOTICE: <https://github.com/pbakaus/impeccable/blob/c3bb418ee38ee49a6b999b7752c1368f3123a2bd/LICENSE>, <https://github.com/pbakaus/impeccable/blob/c3bb418ee38ee49a6b999b7752c1368f3123a2bd/NOTICE.md>.
- Source/Browser/Design-review taxonomy: <https://impeccable.style/slop/>.
- `skill/reference/new-work.md`: <https://github.com/pbakaus/impeccable/blob/c3bb418ee38ee49a6b999b7752c1368f3123a2bd/skill/reference/new-work.md>.
- `skill/reference/visualize.md`: <https://github.com/pbakaus/impeccable/blob/c3bb418ee38ee49a6b999b7752c1368f3123a2bd/skill/reference/visualize.md>.
- `skill/reference/critique.md`: <https://github.com/pbakaus/impeccable/blob/c3bb418ee38ee49a6b999b7752c1368f3123a2bd/skill/reference/critique.md>.
- `skill/reference/animate.md`: <https://github.com/pbakaus/impeccable/blob/c3bb418ee38ee49a6b999b7752c1368f3123a2bd/skill/reference/animate.md>.
- `skill/reference/polish.md`: <https://github.com/pbakaus/impeccable/blob/c3bb418ee38ee49a6b999b7752c1368f3123a2bd/skill/reference/polish.md>.

### S10: Taste Skill

- Exact revision: <https://github.com/Leonxlnx/taste-skill/tree/9b4bf937a1f69348126959c15d2f99a73e65699b>.
- MIT: <https://github.com/Leonxlnx/taste-skill/blob/9b4bf937a1f69348126959c15d2f99a73e65699b/LICENSE>.
- `skills/taste-skill/scripts/consistency.mjs`: <https://github.com/Leonxlnx/taste-skill/blob/9b4bf937a1f69348126959c15d2f99a73e65699b/skills/taste-skill/scripts/consistency.mjs>.
- `skills/taste-skill/references/motion.md`: <https://github.com/Leonxlnx/taste-skill/blob/9b4bf937a1f69348126959c15d2f99a73e65699b/skills/taste-skill/references/motion.md>.
- `skills/taste-skill/references/photos.md`: <https://github.com/Leonxlnx/taste-skill/blob/9b4bf937a1f69348126959c15d2f99a73e65699b/skills/taste-skill/references/photos.md>.
- `skills/taste-skill/assets/layout/deal.mjs`: <https://github.com/Leonxlnx/taste-skill/blob/9b4bf937a1f69348126959c15d2f99a73e65699b/skills/taste-skill/assets/layout/deal.mjs>.
- Отдельные photo credits: <https://github.com/Leonxlnx/taste-skill/blob/9b4bf937a1f69348126959c15d2f99a73e65699b/assets/photos/photos.json>.

### S11: emilkowalski и mattpocock

- `emilkowalski/skills` exact revision: <https://github.com/emilkowalski/skills/tree/c8a79627b59d72d764d6ab6f2c87c09a48169833>; MIT: <https://github.com/emilkowalski/skills/blob/c8a79627b59d72d764d6ab6f2c87c09a48169833/LICENSE>.
- `skills/choreograph/SKILL.md`: <https://github.com/emilkowalski/skills/blob/c8a79627b59d72d764d6ab6f2c87c09a48169833/skills/choreograph/SKILL.md>.
- `skills/review-animations/SKILL.md`: <https://github.com/emilkowalski/skills/blob/c8a79627b59d72d764d6ab6f2c87c09a48169833/skills/review-animations/SKILL.md>.
- `skills/review-animations/STANDARDS.md`: <https://github.com/emilkowalski/skills/blob/c8a79627b59d72d764d6ab6f2c87c09a48169833/skills/review-animations/STANDARDS.md>.
- `mattpocock/skills` exact revision: <https://github.com/mattpocock/skills/tree/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d>; MIT: <https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/LICENSE>.
- `skills/engineering/pr/SKILL.md` и credits: <https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/pr/SKILL.md>, <https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/pr/CREDITS.md>.
- `skills/engineering/research/SKILL.md`: <https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/research/SKILL.md>.
- `skills/productivity/writing-for-agents/SKILL.md`: <https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/productivity/writing-for-agents/SKILL.md>.

### S12: Исключённые/ограниченные форматы

- Официальный `gltf_importer` without armatures: <https://github.com/JannisX11/blockbench-plugins/blob/master/plugins/gltf_importer/about.md>.
- Aseprite CLI (proprietary reference): <https://www.aseprite.org/docs/cli/>.
- PixelGraph license condition: <https://github.com/null511/PixelGraph/blob/main/README.md>.
- VoxGen limitations: <https://github.com/Jom-er/VoxGen/blob/main/README.md>.
- ComfyUI workflow external dependency: <https://github.com/ghostmmmm/comfyui-pixel-art-workflow/blob/main/README.md>.
