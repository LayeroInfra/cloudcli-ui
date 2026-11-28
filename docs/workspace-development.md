# Разработка в Layero Workspace

Как сейчас устроена работа над CloudUI (этот репозиторий) и над панелью Layero
(`/srv/Layero/frontend`) в рабочем пространстве: что где запущено, где видно
результат, как проверять и выкатывать. Установка VM и Mac описана в
[`infra/README.md`](../infra/README.md), приложение Companion — в
[`companion/README.md`](../companion/README.md), куда класть код и что в
репозитории не используется — в [`workspace-code-map.md`](workspace-code-map.md).

Актуально на 27.11.2026. Если что-то здесь разошлось с системой, поправь
документ в том же коммите, где меняешь поведение.

## Где что работает

| Что | Где | Адрес |
|---|---|---|
| Рабочая копия CloudUI | VM, `/srv/Layero/cloud-cli`, ветка `dev/cloudui-workspace` | — |
| Релиз CloudUI (то, что видят люди) | VM, `frontend-cloudcli.service`, снимок `~/.local/share/cloudcli-releases/workspace-ui` | `127.0.0.1:3002` |
| Стенд ветки | VM, `workspace-stage.service`, сборка в `~/.local/share/cloudcli-stage/release`, данные в `~/.local/state/workspace-stage/home` | `127.0.0.1:3102`, снаружи — `:9443` с cookie (см. «Стенд») |
| HTTPS-шлюз | VM, `workspace-gateway.service` (Caddy) → `:3002`, со стендовой cookie → `:3102` | `:9443` |
| Companion | Mac, приложение Layero Workspace | UI `https://127.0.0.1:19443`, статус `http://127.0.0.1:19100` |
| Тоннель UI и сборок | Mac → VM, `start-tunnel.sh` | `19443`→`9443`, `19000`→`9000` |
| Тоннель превью | Mac → VM, `start-preview-tunnel.sh`, отдельный SSH | `5174`, `8080`, `25174`, `15173` (см. ниже) |
| CI | VM, Forgejo + Woodpecker server; агенты сборок — на Mac владельца | Woodpecker `127.0.0.1:8000` на VM |
| Клоны для проверок и стенда | Mac, `~/.cache/layero-workspace/{checks,stage}/cloud-cli` (коммит берётся с VM) | — |
| Checkout разработчика | Mac, путь из `~/.config/layero-workspace/identity.json` (из него собирается выкатка) | — |

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

Правило одно: **`main` всегда зелёный и годен к выкатке**, а всё, что в него
попадает, проверено на своём коммите.

1. **Ветка на задачу.** `feat/…`, `fix/…` от `main`. Агент работает в своём
   worktree (`git worktree add ../cloud-cli-<задача> -b feat/<задача> origin/main`
   или кнопкой worktree в UI), а не в общей копии: чекаут
   `/srv/Layero/cloud-cli` общий, в нём бывают чужие правки. Коммить поимённо.
2. **Коммить и пушь по ходу работы.** Проверки и стенд берут коммит прямо с VM,
   push для них не нужен, но PR и статус на GitHub — только для запушенного.
3. **Проверки** — `workspace-trigger-build --title "…" [--ref <ветка>]`
   (подробно ниже). Полный набор на чистом коммите; результат — статус
   `workspace/checks` на коммите в GitHub.
4. **Стенд**, если правку нужно увидеть или в ней миграция —
   `workspace-trigger-stage [--ref <ветка>]`, затем `:9443/__stage/on`
   (подробно ниже). Прод и его сессии стенд не трогает.
5. **PR в `main`** (`LayeroInfra/cloudcli-ui`). Сливать — только с зелёным
   `workspace/checks` на последнем коммите ветки.
6. **Выкатка** — `workspace-trigger-deploy` (только по просьбе человека). Едет
   только коммит из `origin/main`, и только зелёный: если у коммита слияния
   нет своего статуса, Mac сначала прогоняет проверки на нём и при красных
   ничего не выкатывает (код `6`). Дальше как раньше: сборка в отдельном
   worktree, `workspace-promote-release` на VM. Коды: `0` выкачено, `3` отказ
   (не из main, старый коммит, другой lockfile, битый stage), `4` smoke не
   прошёл — вернули прошлый, `5` идёт другой деплой, `6` проверки красные.
   Перезапуск `frontend-cloudcli` рвёт все сессии чата и терминалы. Если
   изменился `package-lock.json`, сначала обнови зависимости релиза
   (`~/src/cloudcli-ui`, `npm ci`). Обходы для оператора:
   `WORKSPACE_DEPLOY_ALLOW_BRANCH=1`, `WORKSPACE_DEPLOY_SKIP_CHECKS=1`.

**Где видно правку.** В проде (Companion и `:9443` без стендовой cookie) — только
после выкатки: шлюз ведёт на релиз `:3002`. Выкаченный коммит —
`~/.local/share/cloudcli-releases/workspace-ui/SHIPPED_FROM`. До слияния правку
показывает стенд. `cloudui-live.service` (Vite HMR из рабочей копии на unix-сокете
`~/.local/state/cloudcli-live/ui.sock`) запущен, но шлюзом не подключён.

### Проверки

На VM **не запускай** `npm run build`, `typecheck`, `test:client`, `vite`, `tsc`,
`vitest` для CloudUI — только Woodpecker на Mac.

- Запуск: `workspace-trigger-build --title "<что проверяешь>"` — текущая ветка
  и коммит `/srv/Layero/cloud-cli`; `--ref <ветка>` — другая ветка (worktree);
  `--steps lint,typecheck` — только часть шагов (статус в GitHub такой прогон
  не ставит). Кнопка **Run checks** в Builds проверяет текущий коммит копии на VM.
  Owner берётся только из `WORKSPACE_OWNER` сессии; `--owner` запрещён. Сервер
  кладёт в каждую сессию агента (Claude, Codex) и в терминал `WORKSPACE_OWNER`,
  `WORKSPACE_USER` и git-личность пользователя (`GIT_AUTHOR_*`,
  `GIT_COMMITTER_*` из профиля), так что агент запускает прогоны сам, а его
  коммиты подписаны инициатором. В сессиях OpenCode и в сессиях, начатых до
  выкатки этого (A1), их нет — тогда Run checks жмёт человек.
- **Результат прогона:** триггер печатает номер (`run #N`); `--wait` у
  `workspace-trigger-build`, `-stage`, `-make` или `workspace-run-wait <N>`
  ждёт конца и печатает сводку шагов и строки падений каждого упавшего шага
  (ошибки oxlint и tsc, `not ok` и `FAIL` тестов). Код выхода: `0` успех, `1`
  упал, `3` таймаут, `4` Woodpecker недоступен. Агент запускает его фоном и
  получает результат по завершении, а не опрашивает.
- **Что проверяется — коммит, не файлы.** Mac забирает коммит с VM по ключу
  companion в свой клон `~/.cache/layero-workspace/checks/cloud-cli`, рабочую
  копию разработчика не трогает. Незакоммиченное не проверяется (триггер
  предупредит). В логе — `workspace-run-checks … ref=<ветка> commit=<sha>`.
- **Шаги** (`companion/bin/lib/workspace-checks-steps.sh`): `swift`
  (`swiftc -typecheck` Companion), `shell` (`bash -n` скриптов), `lint`,
  `typecheck`, `test-server` (все `server/**/*.test.*`), `test-client` (весь
  vitest), `fake-agent` (контракт подставного Claude), `build`. Все шаги идут
  до конца, в конце — сводка с временем каждого. Новые тесты подхватываются
  сами; новый вид проверки — функция `step_<имя>` в этом файле.
- **Карантин** — `ci/checks-quarantine.txt`: тест, который сломан не твоей
  правкой, — туда, с причиной, номером прогона и датой. Список только
  сокращается: починил — удали строку в том же коммите.
- **Статус в GitHub** `workspace/checks` (`pending` → `success`/`failure`,
  `error` при обрыве) ставится, если на Mac выполнен вход `gh` и коммит уже
  запушен. Защита `main` на GitHub требует этот статус.
- Статус прогона: панель **Builds** (молоток в шапке), API
  `GET /api/workspace/builds[/:number]`; запасные — `workspace-pipeline-ls`,
  экран статуса Companion `:19100`. Лог: `woodpecker-cli pipeline log show
  buildadmin/cloudcli-checks <N>` с `WOODPECKER_SERVER=http://127.0.0.1:8000`
  и токеном из `~/.local/state/woodpecker/user.token`. Цикл перезапусков не крути.
- **Mac выключен** — прогона нет: раннеры только на Mac. Триггер сначала
  спрашивает Woodpecker, был ли агент владельца на связи последние 2 минуты, и
  если нет — отказывает сразу (код `6`, «the Mac of <owner> is offline»);
  `--queue` ставит прогон в очередь до пробуждения Mac. Долго в `pending` —
  сообщи статус и остановись.
- Название прогона: 2–6 слов о том, что проверяешь (`session rename`,
  `builds panel smoke`), на языке задачи; один прогон — одна причина. Без дат,
  номеров, `misc`/`fix`/`wip`, без `test`/`check` в одиночку. «Manual checks»
  ставит кнопка в UI, агент так не называет.

`infra/vm/install.sh` можно запускать и из worktree: файлы берутся из него,
а сервисы (`cloudui-live`, история для `workspace-promote-release`) остаются на
общей копии `/srv/Layero/cloud-cli` (`WORKSPACE_WORKING_COPY`).

**Скрипты задач берутся из коммита задачи.** Установлен на Mac только
загрузчик `~/.local/bin/workspace-run-job`; он распаковывает `companion/bin`
нужного коммита в `~/.cache/layero-workspace/runner/<sha>` и запускает скрипт
оттуда: для checks и stage — проверяемый коммит, для deploy — `origin/main`,
для make — вершину ветки копии на VM. Правка `companion/bin` действует со
своим коммитом, `install.sh` на Mac для неё не нужен. В логе — строка
`workspace-run-job: scripts from commit <sha>`; если коммит не достался, идёт
установленная копия и лог пишет почему (`WORKSPACE_RUNNER=installed` —
принудительно). Сам загрузчик и Swift-приложение по-прежнему обновляет
`companion/bin/install.sh`.

### Стенд

Сборка ветки рядом с продом: свой сервер на VM (`workspace-stage.service`,
`127.0.0.1:3102`), свой `HOME` (а значит своя база `~/.cloudcli/auth.db`, свой
`~/.claude`, свои терминалы), подставной Claude вместо настоящего
(`ci/fake-claude`, ответ «Fake reply: <текст>»). Одновременно — один стенд.

- **Поднять:** `workspace-trigger-stage [--ref <ветка>]` — Mac собирает коммит,
  кладёт на VM, VM запускает (`workspace-stage up`), потом Mac прогоняет e2e-smoke
  (`ci/e2e`, Playwright WebKit) против стенда. Данные между запусками
  сохраняются; `--reset` — заново из фикстур.
- **Данные:** фикстуры — пользователи `stage-admin`, `stage-alice`, `stage-bob`
  (пароль — `workspace-stage status`), git-проекты `demo-app`, `demo-docs`.
  Для миграций — `--reset --data prod-copy`: копия прод-базы без секретов
  (ключи, токены, push, JWT-секрет удалены), у всех пароль стенда, пути
  транскриптов очищены, пути проектов перенесены под `/nonexistent` — стенд не
  может прочитать или удалить прод-файлы.
- **Открыть:** в Companion (или браузере) `https://…:9443/__stage/on` — cookie
  `workspace_stage=1` переключает этот браузер на стенд, внизу полоса «Stage:
  <ветка> @ <sha>». Вернуться — `/__stage/off` (ссылка в полосе). Вход на
  стенде хранится под своим ключом и прод-вход не трогает. Стенд остановлен —
  шлюз показывает страницу «Стенд не запущен» со ссылкой назад.
- **Снимки для агента:** `--shots "/,/session/<id>"` (по умолчанию `/`) — после
  e2e Mac снимает эти страницы под `stage-admin` в двух размерах (1440×900 и
  390×844) и кладёт на VM в `~/.local/state/workspace-stage/shots/<sha>/shots/`;
  там же `playwright/` — скриншоты и трассы упавших тестов. Агент открывает PNG
  сам (Read), без пересказа человека.
- **На VM:** `workspace-stage status | down | reset | password`.
- **Ограничение:** ветка с изменённым `package-lock.json` на стенд не встаёт
  (стенд работает на `node_modules` релиза, как прод) — сначала зависимости.

### Тесты для фаз

- **Подставной агент** — `ci/fake-claude/claude.mjs`: настоящий Agent SDK гоняет
  на нём ходы, возобновляет сессии, транскрипт пишется туда же, где у Claude.
  Метки в тексте: `[fake:error]` — ход с ошибкой, `[fake:ask]` — ответ-вопрос;
  `FAKE_CLAUDE_DELAY_MS` — задержка ответа. Контракт проверяет шаг `fake-agent`.
- **e2e** — `ci/e2e/*.spec.mjs` (свой `package.json`, в lockfile приложения
  Playwright не попадает). Готовность фазы — её тесты в проверках и её
  сценарий в e2e на стенде.

### `make` в core и cli — тоже только через Woodpecker

Гейты и корпуса Layero (`make check`, `make ship`, `make e2e-*`) на VM не
запускаются: она для них мала. Их выполняет Mac владельца:

```bash
WORKSPACE_OWNER=<owner> workspace-trigger-make core check
WORKSPACE_OWNER=<owner> workspace-trigger-make core ship DRY=1
WORKSPACE_OWNER=<owner> workspace-trigger-make core image C=builder TAG=v123
```

- Запуск берёт текущий коммит и ветку `/srv/Layero/<repo>` на VM (`--ref <ветка>` — другую ветку, например worktree);
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

- `WORKSPACE_OWNER` в сессиях появится только после выкатки A1; OpenCode его
  пока не получает. План остальных упоров агента — [`workspace-roadmap.md`](workspace-roadmap.md).
- `cloudui-live` не подключён к шлюзу — правки клиента CloudUI видны на стенде,
  но не вживую (HMR).
- Панель Builds знает только `checks|deploy`: прогоны `make` и `stage` показаны
  как «checks», различай по названию.
- Стенд для ветки с новыми зависимостями: нужен свой `npm ci` для стенда.
- Агент не видит панель Browser (скриншот, консоль, сеть, выбор элемента).
- `$BROWSER` из сессии агента не открывает URL сам — только печатает.
