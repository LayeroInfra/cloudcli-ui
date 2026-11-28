# Карта кода Layero Workspace

Репозиторий — **hard fork** CloudCLI UI (`siteboon/claudecodeui`, AGPL-3.0)
с 24.11.2026. Upstream не подтягиваем и в него не отправляем: код ниже
целиком наш, и правим мы его по своим правилам. Лицензия и атрибуция
(`LICENSE`, `NOTICE`) остаются.

Документ отвечает на два вопроса: куда класть новый код и что в репозитории
не используется. Флоу разработки — в [`workspace-development.md`](workspace-development.md).

## Куда класть код

| Что | Где |
|---|---|
| Функции Workspace на сервере | `server/modules/workspace-*` (пример — `workspace-builds`), правила — `.agents/skills/backend-module-standards` |
| Функции Workspace в клиенте | `src/modules/workspace-*` или существующий модуль, если это его функция; правила — `.agents/skills/frontend-module-standards` |
| Приложение для Mac | `companion/app/CompanionApp/*.swift` |
| Задачи, которые выполняет Mac (проверки, сборки, выкатка, стенд) | `companion/bin/workspace-run-*` |
| Установка и сервисы VM | `infra/vm/` (`install.sh` — единственный источник конфигурации VM) |
| Пайплайн Woodpecker, карантин тестов, тестовые стенды | `ci/` |
| Подставной агент и данные для e2e | `ci/fake-claude/`, `ci/e2e/` |

Правило для общих модулей (`chat`, `sidebar`, `providers`, `projects`…):
меняем их свободно, это наш код. Но новую самостоятельную функцию (снимки,
права, процессы) выделяем в свой модуль, а в общем модуле оставляем точку
подключения. Так у каждой фазы есть своё место для тестов.

## Что уже переделано под Workspace

Изменения с момента форка (по `git diff 488bb303 HEAD`, без тестов):

- **Целиком наше:** `companion/`, `infra/`, `ci/`, `server/modules/workspace-builds`,
  `server/modules/agent-memory`, `server/shared/workspace-browser.ts`,
  `src/modules/project-workspace` (панель сборок, индикатор связи),
  `docs/workspace-*.md`.
- **Сильно переделано:** `src/modules/sidebar` (закрепы, ветки сессий),
  `src/modules/chat` (composer, ссылки на файлы и localhost), `src/modules/quick-settings-panel`,
  `src/modules/shell` (`$BROWSER`, открытие URL), `src/modules/site-preview`,
  `src/modules/i18n/locales` (ребрендинг), `public/` (иконки, шрифты, `sw.js`).
- **Точечно:** `server/modules/providers` (сессии и лимиты Claude), `projects`,
  `database`, `websocket`, `auth`, `onboarding`.

## Не используется — помечено, не удалено

Решение от 27.11.2026: пока только помечаем (здесь: файлы `.github/workflows` с VM не правятся — у токена VM нет права `workflow`). Удалять — отдельной задачей,
когда будет полный прогон проверок (удаление должно оставлять его зелёным).

| Что | Почему не нужно | Риск, если тронуть |
|---|---|---|
| `.github/workflows/release.yml` | Публикует пакет `@cloudcli-ai/cloudcli` в npm и релиз upstream | **Не запускать**: публикация под чужим именем. Запуск только ручной (`workflow_dispatch`) |
| `.github/workflows/discord-release.yml` | Анонс релизов upstream в Discord | Не запускать |
| `.github/workflows/docker.yml` | Образ upstream в его реестр | Не запускать |
| `.github/workflows/desktop-*.yml` | Electron-сборки для macOS/Windows/Linux | Срабатывают на push в свои ветки; наша оболочка — Companion |
| `electron/`, скрипты `desktop:*` в `package.json`, `electron`, `electron-builder` в devDependencies | Electron-оболочка upstream | Удаление меняет `package-lock.json` → нужен `npm ci` релиза на VM |
| `release.sh`, `.release-it`-конфиг, `redirect-package/` | Выпуск npm-пакета upstream | — |
| `docker/` | Образы upstream | — |
| `docs/README.*.md` (переводы), `docs/architecture` | Документация upstream, не про Workspace | — |
| `scripts/release/` | Сборка desktop-пакетов и server bundle upstream | — |

**Под вопросом** (используются ли людьми — решить при чистке):
провайдер `cursor`, модули `taskmaster`/`task-master`, `prd-editor`, `voice`,
`plugins`, `browser-use` (headless-браузер на VM; встроенный браузер Companion
его, вероятно, заменит).
