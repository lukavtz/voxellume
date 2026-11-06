# OMP и DeepSeek Harness — контракты интеграции

Дата проверки: 2026-11-06.

Наблюдаемые версии: OMP `18.17.0`, DeepSeek Harness `0.2.2-rc.1`.

## OMP

Первичные источники: встроенная документация `omp://extensions.md`, `omp://custom-tools.md`, `omp://extension-loading.md`, `omp://skills.md`, `omp://plugin-manager-installer-plumbing.md`, `omp://mcp-server-tool-authoring.md`.

### Упаковка

`package.json#omp.extensions` объявляет extension entries. Installed plugins поддерживают conventional `skills/`, `agents/`, `commands/`, `hooks/`, `tools/`, prompts, rules и MCP config.

Локальная разработка может использовать `omp plugin link`. Поддерживаются npm/git/marketplace installs.

### Extension

Extension — TypeScript/JavaScript module с default factory:

- `pi.registerTool` для model-facing tools;
- `pi.registerCommand` для commands;
- `pi.on` для lifecycle/events;
- `pi.exec` для process execution;
- `pi.zod`/omptype для schemas;
- cancellation через signal;
- tool result содержит content и structured details.

Registration происходит при load. Runtime actions выполняются из events/tools/commands, а не во время инициализации модуля.

### Skills

`skills/<name>/SKILL.md` имеет name/description frontmatter. Skills загружаются on demand через `skill://`; conventional discovery нерекурсивный ниже одного skill directory.

### MCP

Поддерживаются stdio, HTTP и legacy SSE. Инструменты MCP появляются как `mcp__*`. Plugin-origin configs могут ограничивать env/header resolution. Для локальных серверов следует задавать явный transport и timeouts.

### Security/lifecycle

Extensions и custom tools выполняются in-process и не являются sandbox. Долгие callbacks используют managed timers; AbortSignal передаётся в subprocess. Tool paths должны проверять containment и не считать host extension isolation песочницей.

## DeepSeek Harness

Первичные источники:

- https://github.com/deepseek-ai/deepseek-harness
- `docs/architecture.md`
- `docs/cookbook/adding-a-tool.md`
- `docs/user/develop/basic/publish.md`
- `docs/subsystems/system-prompt.md`
- `docs/subsystems/workflow.md`

Context7 library: `/deepseek-ai/deepseek-harness`.

### Упаковка

Внешний plugin — npm package bundle:

```text
package.json       # dsh.bundle.patch
cordis.patch.yml   # composition layer
index.js           # plugin entry
```

Установка: `dsh plugin --profile <name> add <package-or-git-spec>`.

`engines.dsh` ограничивает совместимые Harness versions. Git installation TypeScript source требует prepare build и явного allowBuilds; npm/tarball с built artifacts этого шага избегает.

### Tools

Cordis plugin регистрирует typed tools через `ctx.tools.register(defineTool(...))`:

- parameters schema валидирует model args;
- `execute` получает `exec.signal` и protected execution identity;
- canonical JSON output валидируется отдельно;
- human rendering отделён от canonical value;
- registration автоматически unwind при dispose;
- background jobs используют `ctx.jobs`, а не скрытые detached processes.

### Prompt/workflow

`ctx.systemPrompt` поддерживает ordered sections, dynamic context и tool providers. Workflow/subagent capabilities опциональны. Общие skill procedures можно поставлять как Markdown source of truth и проецировать через prompt mechanisms; нельзя предполагать идентичность OMP skill discovery и Harness prompt assembly.

### Compatibility risk

README обозначает developer preview и предупреждает о compatibility-breaking changes. Поэтому адаптер и contract tests фиксируются на конкретный supported Harness range; `master` documentation не смешивается с другой installed version без проверки.

## Общий core и различия адаптеров

| Concern      | OMP                      | Harness                          | Решение                                 |
| ------------ | ------------------------ | -------------------------------- | --------------------------------------- |
| Tool schema  | `pi.zod`/omptype         | `defineTool` ParameterSchemaSpec | Отдельные schema adapters               |
| Result       | content + details        | canonical JSON + renderer        | Общий domain result, разные projections |
| Lifecycle    | extension factory/events | Cordis effects/dispose           | Явное cleanup в обоих                   |
| Cancellation | tool AbortSignal         | `exec.signal`                    | Один core signal contract               |
| Prompt       | conventional skills      | systemPrompt sections/context    | Общие Markdown procedures               |
| Jobs         | extension runtime        | `ctx.jobs`                       | Host-specific long-job adapter          |
| Packaging    | `omp.extensions`         | `dsh.bundle.patch`               | Один package, два manifests             |
| Isolation    | in-process, no sandbox   | plugin capabilities/policy       | Core сам enforce path/process policy    |

## Проверки перед поддержкой

- OMP real extension install/link/discovery/tool call/cancellation/shutdown.
- Harness fresh-profile bundle install/dump-config/activation/tool call/dispose/cancellation.
- Обе host surfaces с одинаковым domain request дают эквивалентный domain result.
- Incompatible host version отклоняется до выполнения project mutations.
- Ни один adapter не дублирует target resolution, generation или verification logic.
