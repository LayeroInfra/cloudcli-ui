@AGENTS.md

# Layero Workspace

Этот репозиторий — CloudUI (обёртка над Claude Code) для Layero Workspace.
Полный флоу разработки — [`docs/workspace-development.md`](docs/workspace-development.md):
что где запущено, где видно правку, проверки, выкатка, превью, Companion.
Куда класть код и что не используется — [`docs/workspace-code-map.md`](docs/workspace-code-map.md)
(репозиторий — hard fork CloudCLI UI, upstream не подтягиваем).
Если меняешь этот флоу, поправь документ в том же коммите.

Обязательное для агента:

- **Рабочая копия** — `/srv/Layero/cloud-cli` (общая). Задача — своя ветка
  `feat/…`/`fix/…` от `main`, лучше в своём worktree; в `main` — только через
  PR с зелёным `workspace/checks`. `/srv/Layero/frontend` — панель Layero,
  другой репозиторий.
- **Коммить и пушь по ходу работы**, файлы — поимённо: чекаут общий.
- **Не запускай на VM** `npm run build`, `typecheck`, `test:client`, `vite`,
  `tsc`, `vitest` — VM мала (3.8 ГБ + zram), проверки идут через Woodpecker.
- **Проверки:** `workspace-trigger-build --title "<2–6 слов о том, что
  проверяешь>" [--ref <ветка>]`, один раз — полный набор на коммите. Owner — только из `WORKSPACE_OWNER`; `--owner`
  запрещён. Нет `WORKSPACE_OWNER` в окружении — попроси человека нажать
  Builds → Run checks. Статус — `workspace-pipeline-ls`; долго `pending` —
  сообщи и остановись.
- **Проверяется коммит, а не файлы.** Mac берёт коммит с VM (push не нужен),
  незакоммиченное не проверяется: сверь `commit=` в логе. Новые тесты
  подхватываются сами; сломанный не твоей правкой — в
  `ci/checks-quarantine.txt` с причиной.
- **Стенд:** `workspace-trigger-stage [--ref <ветка>] [--reset]` — ветка рядом
  с продом (свои данные, подставной Claude), открыть `:9443/__stage/on`,
  назад `/__stage/off`. Миграции — на стенде с `--data prod-copy`, не на проде.
- **Swift (Companion)** компилируется только на Mac; на VM — пиши код,
  shell-скрипты проверяй `bash -n`.
- **Выкатка** (`workspace-trigger-deploy`, только зелёный коммит `main`) и
  перезапуск `frontend-cloudcli` рвут все сессии — только по просьбе человека. Правки клиента и сервера
  видны в Companion и на `:9443` лишь после выкатки.
- **Браузер и файлы — внутри Companion:** не предлагай Cursor и системный
  браузер. Путь `src/foo.ts:12` или `localhost:5174` в ответе кликабелен.
- **Доступ — общий рабочий стол:** не обещай, что чужие сессии или файлы
  недоступны. Пользователей добавляет оператор (`workspace-add-user`).
