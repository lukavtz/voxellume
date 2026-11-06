# Локальное окружение исследования

Дата проверки: 2026-11-06.

## Host и базовый toolchain

| Компонент        | Наблюдаемая версия / состояние                     | Проверка                               |
| ---------------- | -------------------------------------------------- | -------------------------------------- |
| OMP              | `omp/18.17.0`                                      | `omp --version`                        |
| DeepSeek Harness | `0.2.2-rc.1`                                       | `npx --yes @deepseek-ai/dsh --version` |
| Node.js          | `v24.21.0`                                         | `node --version`                       |
| pnpm             | `12.18.0` через Corepack                           | `corepack pnpm --version`              |
| Git              | `2.56.0`                                           | `git --version`                        |
| GitHub CLI       | активный аккаунт `lukavtz`, scopes включают `repo` | `gh auth status`                       |
| Bun              | установлен                                         | `command -v bun`                       |
| uv               | установлен                                         | `command -v uv`                        |
| Docker CLI       | `/opt/homebrew/bin/docker`                         | `command -v docker`                    |

## Отсутствующие prerequisites

- Java runtime: `/usr/bin/java` является системной заглушкой и сообщает `Unable to locate a Java Runtime`.
- Gradle: отсутствует; target-проекты должны использовать собственный pinned wrapper.
- Blockbench desktop: `/Applications/Blockbench.app` отсутствует.
- Blender: отсутствует.
- ffmpeg: отсутствует.

Docker daemon также недоступен: `docker version --format '{{.Server.Version}}'` не смог подключиться к `unix:///Users/luxvtz/.colima/default/docker.sock`.

Эти ограничения блокируют реальные Gradle/Minecraft, Blockbench desktop, 3D rendering, video verification и container-based isolation до установки и запуска соответствующих зависимостей.

Одобренная подготовка: JDK 21 и 25, Blockbench, Blender, ffmpeg и Docker/Colima. Gradle устанавливать глобально не требуется: используются target-specific wrappers.

## GitHub

- Приватный репозиторий: https://github.com/lukavtz/voxellume
- Рабочая ветка: `feat/plugin-foundation`.
- На момент исследования реализация первого target-resolution slice существует локально; push и PR не выполнялись.

## Доступность внешних справочных сервисов

- Context7: документация DeepSeek Harness получена через `/deepseek-ai/deepseek-harness`.
- AgentMemory: релевантных прошлых наблюдений не найдено.
- DeepWiki: попытка открыть `https://deepwiki.com/rehan-remade/universal-modder` получила HTTP 429; локальный source checkout использован вместо недоступной страницы.
- Codebase Memory: sparse checkout Universal Modder проиндексирован как `universal-modder-research`; 1,179 nodes и 3,198 edges. Индекс использован для подтверждения entry points и границ модулей, не как доказательство runtime behavior.
