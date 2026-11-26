# Разработка в Layero Workspace

Как сейчас устроена работа над CloudUI (этот репозиторий) и над панелью Layero
(`/srv/Layero/frontend`) в рабочем пространстве: что где запущено, где видно
результат, как проверять и выкатывать. Установка VM и Mac описана в
[`infra/README.md`](../infra/README.md), приложение Companion — в
[`companion/README.md`](../companion/README.md).

Актуально на 26.11.2026. Если что-то здесь разошлось с системой, поправь
документ в том же коммите, где меняешь поведение.

## Где что работает

| Что | Где | Адрес |
|---|---|---|
| Рабочая копия CloudUI | VM, `/srv/Layero/cloud-cli`, ветка `dev/cloudui-workspace` | — |
| Релиз CloudUI (то, что видят люди) | VM, `frontend-cloudcli.service`, снимок `~/.local/share/cloudcli-releases/workspace-ui` | `127.0.0.1:3002` |
| HTTPS-шлюз | VM, `workspace-gateway.service` (Caddy) → `:3002` | `:9443` |
| Companion | Mac, приложение Layero Workspace | UI `https://127.0.0.1:19443`, статус `http://127.0.0.1:19100` |
| Тоннель UI и сборок | Mac → VM, `start-tunnel.sh` | `19443`→`9443`, `19000`→`9000` |
| Тоннель превью | Mac → VM, `start-preview-tunnel.sh`, отдельный SSH | `5174`, `8080`, `25174`, `15173` (см. ниже) |
| CI | VM, Forgejo + Woodpecker server; агенты сборок — на Mac владельца | Woodpecker `127.0.0.1:8000` на VM |
| Checkout для проверок | Mac, путь из `~/.config/layero-workspace/identity.json` | — |

Модель доступа — общий рабочий стол, не изоляция: разные логины CloudUI, один
OS-пользователь `layerodev`, общие проекты, сессии, терминал, `~/.claude` и
лимиты подписки. Новых людей добавляет только оператор:
`workspace-add-user <name> <pass>` (имя = owner: `a-z0-9_-`, от 3 символов, без
`-` по краям); саморегистрации нет. В Builds каждый видит свои прогоны — это
фильтр API, а не граница безопасности Woodpecker.

## Ресурсы VM

3.8 ГБ RAM, 2 vCPU, 2 ГБ zram (zstd, swappiness 150), earlyoom. Пики по
замерам: сборка клиента ~1.65 ГБ, `typecheck` ~0.95 ГБ, сборка сервера ~0.75 ГБ,
тесты клиента ~0.5 ГБ — рядом с сессиями Claude и dev-серверами это впритык.
Поэтому сборки и проверки CloudUI на VM не запускаются (см. «Проверки»).
`/tmp` — tmpfs в RAM: большие файлы туда не распаковывать.

## Цикл правки CloudUI

1. Правь в `/srv/Layero/cloud-cli` на ветке `dev/cloudui-workspace`.
2. **Коммить и пушь часто.** Mac синхронизирует эту ветку и убирает
   незакоммиченные правки VM в stash («agent: before sync»). Коммить файлы
   поимённо: чекаут общий, в нём бывают чужие правки.
3. **Проверки** (Builds → Run checks) идут на Mac, в его checkout, на
   запушенном коммите. Правки, которые есть только на VM, они не проверяют.
   В логе прогона смотри строку `workspace-run-checks … commit=<sha>`: зелёный
   прогон на другом коммите ничего не говорит о твоём.
4. **PR в `main`.** Ревью и слияние — как обычно на GitHub
   (`LayeroInfra/cloudcli-ui`).
5. **Выкатка** — `workspace-trigger-deploy` (только по просьбе человека).
   Mac собирает `origin/main` (или `WORKSPACE_DEPLOY_REF`) в отдельном worktree,
   VM ставит релиз через `workspace-promote-release`. Коды: `0` выкачено,
   `3` отказ (старый коммит, другой lockfile, битый stage), `4` smoke не прошёл —
   вернули прошлый, `5` идёт другой деплой. Перезапуск `frontend-cloudcli` рвёт
   все сессии чата и терминалы. Если изменился `package-lock.json`, сначала
   обнови зависимости релиза (`~/src/cloudcli-ui`, `npm ci`).

**Где видно правку.** И клиент, и сервер в Companion и на `:9443` — только
после выкатки: шлюз ведёт на релиз `:3002`. Выкаченный коммит —
`~/.local/share/cloudcli-releases/workspace-ui/SHIPPED_FROM`.
`cloudui-live.service` (Vite HMR из рабочей копии на unix-сокете
`~/.local/state/cloudcli-live/ui.sock`) запущен, но шлюзом сейчас не подключён.

### Проверки и прогоны Woodpecker

На VM **не запускай** `npm run build`, `typecheck`, `test:client`, `vite`, `tsc`,
`vitest` для CloudUI — только Woodpecker.

- Запуск: `workspace-trigger-build --title "<что проверяешь>"` (один раз) или
  кнопка **Run checks** в Builds. Owner берётся только из `WORKSPACE_OWNER`
  сессии; `--owner` запрещён. Если в сессии нет `WORKSPACE_OWNER` (так бывает),
  попроси человека нажать Run checks.
- Статус: панель **Builds** (молоток в шапке) — очередь, шаги, хвост лога;
  API `GET /api/workspace/builds[/:number]`, `POST /api/workspace/builds`.
  Запасные: `workspace-pipeline-ls`, экран статуса Companion `:19100`.
- Лог: `woodpecker-cli pipeline log show buildadmin/cloudcli-checks <N>` с
  `WOODPECKER_SERVER=http://127.0.0.1:8000` и токеном из
  `~/.local/state/woodpecker/user.token`. Цикл перезапусков не крути.
- Долго в `pending` — сообщи статус и остановись: раннеры только на Mac,
  в сеть VM их нет.
- Название прогона: 2–6 слов о том, что проверяешь (`session rename`,
  `builds panel smoke`), на языке задачи; один прогон — одна причина. Без дат,
  номеров, `misc`/`fix`/`wip`, без `test`/`check` в одиночку. «Manual checks»
  ставит кнопка в UI, агент так не называет.

Что гоняет прогон — `companion/bin/workspace-run-checks`: `swiftc -typecheck`
для Companion, выбранные серверные тесты (`tsx --test`) и выбранные тесты
клиента (`vitest`). Новый тест добавляй в этот список, иначе он не запустится.
Mac запускает **установленную** копию скрипта: после её правки на Mac нужно
обновить runtime (`companion/bin/install.sh`).

### `make` в core и cli — тоже только через Woodpecker

Гейты и корпуса Layero (`make check`, `make ship`, `make e2e-*`) на VM не
запускаются: она для них мала. Их выполняет Mac владельца:

```bash
WORKSPACE_OWNER=<owner> workspace-trigger-make core check
WORKSPACE_OWNER=<owner> workspace-trigger-make core ship DRY=1
WORKSPACE_OWNER=<owner> workspace-trigger-make core image C=builder TAG=v123
```

- Запуск берёт текущий коммит и ветку `/srv/Layero/<repo>` на VM;
  незакоммиченное не уезжает (скрипт предупредит). Пушить заранее не нужно:
  Mac забирает коммит с VM по ключу companion.
- На Mac (`companion/bin/workspace-run-make`) — свои клоны в
  `~/.cache/layero-workspace/make/{core,cli,frontend}`, рабочий чекаут
  разработчика не трогается. Соседи (`../cli`, `../frontend`) — на
  `origin/main`. Один прогон на репозиторий за раз.
- Разрешённые цели и переменные — списки в начале `workspace-run-make`
  (`check`, `ship`, `doctor`, `e2e-builder`, `image`…; `DRY`, `FIX`, `FORCE`,
  `LOCAL_CORPUS`, `C`, `TAG`).
- `make ship` пушит в GitHub доступом владельца Mac. После него rebase
  делается в клоне на Mac — чекаут на VM подтяни: `git pull --rebase`.
- В панели Builds такой прогон пока показан как «checks»: сервер знает только
  `checks|deploy`. Различай по названию «make <цель> (<repo>)».

### Companion (Swift и скрипты Mac)

Код — `companion/app/CompanionApp/*.swift`, скрипты — `companion/bin/`.
Компилируется и проверяется только на Mac: `swiftc -typecheck` в прогоне, руками —
после `companion/bin/install.sh` и перезапуска приложения. На VM можно только
писать код и проверять shell-скрипты `bash -n`.

## Браузер и файлы — всё внутри Companion

Решение: никаких передач в Cursor или системный браузер.

- **Панель Browser** показывает localhost-превью. В Companion это нативный
  WKWebView поверх iframe (`WorkspacePreview.swift`); в обычном браузере — iframe.
- **Внешние ссылки**, `target=_blank`, `window.open`, «Open in a new window» —
  окно-браузер Companion (`BrowserWindow.swift`). Превью в панели и окна
  делят одно постоянное хранилище: вход и флаги сохраняются между запусками.
  Сброс — меню приложения → «Сбросить данные localhost-превью».
- Скачивание — в `~/Downloads` на Mac; `<input type=file>`, `alert`/`confirm`
  работают; веб-инспектор включается в меню приложения.
- **Файлы** открываются только во встроенном редакторе по путям VM. Пути
  `src/foo.ts:12` и адреса `localhost:5174` в чате кликабельны (простым текстом
  и в `code`); клик по URL в терминале идёт туда же (`openWorkspaceUrl`).
- **`$BROWSER` и `xdg-open`** в терминале CloudUI и в сессиях Claude — шим из
  `~/.cloudcli/bin`, его пишет сервер. В терминале URL открывается сам
  (localhost — в панели, остальное — в окне Companion); из Bash-инструмента
  агента шим только печатает ссылку.

### Порты превью

| На Mac | Куда на VM | Что |
|---|---|---|
| `localhost:5174` | `25174`, иначе `5174` | Панель Browser сначала открывает последнюю успешную сборку `/srv/Layero/frontend` (`workspace-built-preview`, таймер собирает текущий коммит), если её нет — Vite dev |
| `localhost:15173` | `5174`, если есть сборка, иначе `5173` | Vite dev с hot reload |
| `localhost:8080` | `8080` | любой dev-сервер |

`8000` не пробрасывается: на VM это Woodpecker. Занятый на Mac порт
пропускается, это видно на `:19100`.

## Работа над панелью Layero (`/srv/Layero/frontend`)

Правила репозитория — его `CLAUDE.md`/`AGENTS.md` и `Makefile`. Здесь — то, что
относится к Workspace.

- **Стенд:** `make dev` — Vite строго на `5174` (другой порт ломает CORS и
  OAuth). Hot reload в Companion — `localhost:15173`; `localhost:5174` в панели
  показывает последнюю собранную версию, а не правки в рабочей копии.
- **API:** локального core на VM нет. Прод-API (`api.layero.ru`) пускает только
  `app.layero.ru`, а вход через Яндекс с localhost запрещён. Поэтому на стенде —
  **демо-режим**: `http://localhost:5174/?demo=1` (`?demo=0` — выключить,
  `?slow=800` — задержка для скелетонов). Флаг запоминается в хранилище превью.
- **Проверки:** `make check` (tsc, eslint, vitest и проверки лендинга) тяжёлый
  для VM рядом со стендом; Woodpecker для frontend пока нет.
- **Выкатка:** push в `main` с изменениями в `control-plane/**` запускает
  деплой панели в GitHub Actions — пушь только по просьбе человека.

## Открытые вопросы

- В сессиях CloudUI нет `WORKSPACE_OWNER` — агент не может сам запустить прогон
  (сервер подставляет owner только в `POST /api/workspace/builds`, в окружение
  сессии Claude и терминала не передаёт). Пока человек называет owner сам.
- `cloudui-live` не подключён к шлюзу — правки клиента CloudUI не видны до выкатки.
- Агент не видит панель Browser (скриншот, консоль, сеть, выбор элемента).
- `$BROWSER` из сессии агента не открывает URL сам — только печатает.
