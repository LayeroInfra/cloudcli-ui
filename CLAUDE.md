@AGENTS.md

# Layero Workspace

Этот репозиторий — CloudUI (обёртка над Claude Code) для Layero Workspace.
Полный флоу разработки — [`docs/workspace-development.md`](docs/workspace-development.md):
что где запущено, где видно правку, проверки, выкатка, превью, Companion.
Если меняешь этот флоу, поправь документ в том же коммите.

Обязательное для агента:

- **Рабочая копия** — `/srv/Layero/cloud-cli`, ветка `dev/cloudui-workspace`.
  `/srv/Layero/frontend` — панель Layero, другой репозиторий.
- **Коммить и пушь по ходу работы**, файлы — поимённо. Mac синхронизирует
  ветку и прячет незакоммиченные правки VM в stash; чекаут общий.
- **Не запускай на VM** `npm run build`, `typecheck`, `test:client`, `vite`,
  `tsc`, `vitest` — VM мала (3.8 ГБ + zram), проверки идут через Woodpecker.
- **Проверки:** `workspace-trigger-build --title "<2–6 слов о том, что
  проверяешь>"`, один раз. Owner — только из `WORKSPACE_OWNER`; `--owner`
  запрещён. Нет `WORKSPACE_OWNER` в окружении — попроси человека нажать
  Builds → Run checks. Статус — `workspace-pipeline-ls`; долго `pending` —
  сообщи и остановись.
- **Зелёный прогон ≠ проверены твои правки.** Прогон идёт на Mac на
  запушенном коммите: сверь `commit=` в логе. Новый тест добавь в
  `companion/bin/workspace-run-checks`, иначе он не запустится.
- **Swift (Companion)** компилируется только на Mac; на VM — пиши код,
  shell-скрипты проверяй `bash -n`.
- **Выкатка** (`workspace-trigger-deploy`) и перезапуск `frontend-cloudcli`
  рвут все сессии — только по просьбе человека. Правки клиента и сервера
  видны в Companion и на `:9443` лишь после выкатки.
- **Браузер и файлы — внутри Companion:** не предлагай Cursor и системный
  браузер. Путь `src/foo.ts:12` или `localhost:5174` в ответе кликабелен.
- **Доступ — общий рабочий стол:** не обещай, что чужие сессии или файлы
  недоступны. Пользователей добавляет оператор (`workspace-add-user`).
