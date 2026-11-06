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

## Текущие prerequisites

Первоначальное исследование фиксировало отсутствие JDK, Docker daemon, Blockbench, Blender и ffmpeg. После установки состояние проверено повторно:

- JDK `21.0.13` и `25.0.5` зарегистрированы в `~/Library/Java/JavaVirtualMachines`; оба обнаруживаются через `/usr/libexec/java_home`.
- Colima работает; Docker client `29.9.2` подключается к server `29.5.2`.
- `/Applications/Blockbench.app` версии `5.2.2` присутствует.
- Blender `5.2.3`, ffmpeg `9.0.2`, gitleaks `8.30.1`, osv-scanner `2.7.0` и semgrep `1.183.0` установлены.

Глобальный Gradle не требуется: target-проекты используют собственные pinned wrappers.

## GitHub

- Приватный репозиторий: https://github.com/lukavtz/voxellume
- Рабочая ветка: `feat/plugin-foundation`.
- Baseline `main` на commit `e291e3a` отправлен через HTTPS после ошибки SSH `publickey`.

## Доступность внешних справочных сервисов

- Context7: документация DeepSeek Harness получена через `/deepseek-ai/deepseek-harness`.
- AgentMemory: релевантных прошлых наблюдений не найдено.
- DeepWiki: попытка открыть `https://deepwiki.com/rehan-remade/universal-modder` получила HTTP 429; локальный source checkout использован вместо недоступной страницы.
- Codebase Memory: sparse checkout Universal Modder проиндексирован как `universal-modder-research`; 1,179 nodes и 3,198 edges. Индекс использован для подтверждения entry points и границ модулей, не как доказательство runtime behavior.
