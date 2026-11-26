# Доступ и сборки

## Модель доступа (доверенная команда)

Layero Workspace — **общий рабочий стол** с разными логинами, не изоляция пользователей.

| Есть | Нет |
|------|-----|
| Отдельные учётные записи Layero Workspace | Свой OS-пользователь / `$HOME` на каждого |
| Свои пины, настройки, черновики, список Builds в UI | Разделение проектов, сессий, терминала и файлов |
| Сборка на Mac по `owner` = имя пользователя Layero Workspace | Жёсткая граница от чужого доступа к Woodpecker из терминала |

## Новому человеку

1. Оператор: DNS-запись пространства указывает на IP его VM; `workspace-add-user <username> <password>`.
2. Человек открывает **Layero Workspace.app** (из zip).
3. В брендированном окне Layero заполняет пространство, username и пароль (на одном экране).
4. UI открывается на `https://127.0.0.1:19443` уже с сессией; туннель и агент подняты.

Никакой ручной настройки SSH, Woodpecker или launchd.

## Оператор / разработка на Mac

```bash
WORKSPACE_RUNTIME_DIR=/path/to/private-runtime ./companion/bin/install.sh
open ~/Applications/Layero\ Workspace.app
# zip для команды:
WORKSPACE_RUNTIME_DIR=/path/to/private-runtime ./companion/bin/package.sh
```

## Сборки

- **Run checks** в Layero Workspace или агент с `workspace-trigger-build --title "…"`.
- Owner только из сессии / `WORKSPACE_OWNER` (флаг `--owner` запрещён).
- Агент на Mac забирает только jobs с `owner=<свой username>`.

### Как устроен прогон

| Где | Что |
|-----|-----|
| [`ci/cloudcli-checks.woodpecker.yml`](../../ci/cloudcli-checks.woodpecker.yml) | Исходник `.woodpecker.yml` в Forgejo `buildadmin/cloudcli-checks`; оператор копирует его туда после правки |
| `companion/bin/workspace-run-job` | Единственная команда шага; по `WORKSPACE_JOB` вызывает checks или deploy |
| `companion/bin/workspace-run-checks` | Тесты в checkout из `identity.json` — как он лежит на диске, с незакоммиченными правками |
| `companion/bin/workspace-run-deploy` | Сборка `origin/main` в отдельном worktree `~/.cache/layero-workspace/ship`, rsync на VM, вызов promote |
| `companion/vm/workspace-promote-release` | На VM (`~/.local/bin`): flock, запрет более старого коммита, сверка `package-lock.json` с установленными `node_modules`, smoke и откат |

Коды `workspace-promote-release`: `0` выкачено, `3` отказ (старый коммит / зависимости / битый stage), `4` smoke не прошёл — вернули прошлый релиз, `5` идёт другой деплой.
Обойти: `WORKSPACE_DEPLOY_ALLOW_OLDER=1` (откат на старый коммит), `WORKSPACE_DEPLOY_DEPS_OK=1` (оператор уже обновил `node_modules`).

## Порты

| Порт | Где | Сервис |
|------|-----|--------|
| 9443 | публично / туннель 19443 | Caddy → Layero Workspace |
| 9000 | loopback / туннель 19000 | Woodpecker gRPC |
| 8000 | loopback | Woodpecker HTTP |
| 3030 | loopback | Forgejo |
