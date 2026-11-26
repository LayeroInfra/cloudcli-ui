# Установка Layero Workspace

Всё, что нужно для рабочего пространства, кроме самого релиза UI, лежит здесь: версии инструментов, конфиги, юниты systemd, скрипты сборки и выкатки. Секреты в репо не попадают — их создаёт VM в `~/.local/state`.

```
infra/
├── versions.env            версии node / woodpecker / forgejo / caddy и их контрольные суммы
├── lib/fetch.sh            загрузка с проверкой суммы (VM и Mac)
└── vm/
    ├── install.sh          установка и проверка VM
    ├── bin/                → ~/.local/bin (workspace-*, npm, layero-run-build, …)
    ├── systemd/            → ~/.config/systemd/user
    └── config/             шаблоны app.ini, server.env, Caddyfile
ci/cloudcli-checks.woodpecker.yml   пайплайн; install.sh кладёт его в Forgejo
companion/                          приложение и скрипты для Mac
```

## VM

Под пользователем пространства (не root), из клона репо в `/srv/Layero/cloud-cli`:

```bash
WORKSPACE_PUBLIC_IP=<IP VM> infra/vm/install.sh   # первый раз
infra/vm/install.sh                               # обновить после git pull
infra/vm/install.sh --check                       # ничего не менять, показать расхождения (exit 1)
infra/vm/install.sh --restart                     # заодно перезапустить изменённые сервисы
```

Что делает:
1. Ставит node, woodpecker-server/cli, forgejo, caddy закреплённых версий, сверяя контрольные суммы.
2. Раскладывает `bin/`, рендерит конфиги и юниты, `daemon-reload`, `enable`, запускает то, что не запущено.
3. Создаёт секреты один раз (или берёт уже существующие из живых конфигов).
4. Поднимает Forgejo: админ `buildadmin`, токен API, репозиторий `buildadmin/cloudcli-checks`, OAuth-приложение для Woodpecker.
5. Синхронизирует `ci/cloudcli-checks.woodpecker.yml` в Forgejo; активирует репозиторий в Woodpecker.

Сервисы, у которых реально изменились параметры, без `--restart` не перезапускаются — скрипт пишет команду в «still to do». `frontend-cloudcli` при перезапуске рвёт все сессии чата и терминалы.

**Руками, один раз** (скрипт напомнит в конце):
- root: `loginctl enable-linger <user>` — сервисы живут без логина и стартуют при загрузке;
- вход в Woodpecker: на Mac `companion/bin/setup-ci-tunnel.sh <host>`, открыть `http://127.0.0.1:8000`, войти через Forgejo как `buildadmin` (пароль в `~/.local/state/layero-infra/forgejo-buildadmin.password`), создать персональный токен, положить его в `~/.local/state/woodpecker/user.token` (chmod 600), повторить `install.sh`;
- зависимости релиза: клон UI в `~/src/cloudcli-ui` и `npm ci` там (релиз ссылается на его `node_modules`);
- первый релиз: deploy с Mac (см. ниже).

Пользователи: `workspace-add-user <name> <password>`.

## Mac

1. Оператор на VM: `workspace-mac-runtime` → `~/layero-mac-runtime.tar.gz` (SSH-ключ companion, секрет агента, `woodpecker-agent` для darwin/arm64). Передать человеку приватно.
2. Человек на Mac (Apple Silicon, Xcode CLT), из клона репо:

   ```bash
   companion/bin/install.sh --runtime ~/Downloads/layero-mac-runtime.tar.gz
   open ~/Applications/Layero\ Workspace.app
   ```

   Ставит node закреплённой версии в `~/.local/lib`, приложение, агент сборок и `workspace-run-*`.
3. В окне входа: адрес пространства, username, пароль, папка checkout.

zip для людей без клона: `companion/bin/package.sh ~/layero-mac-runtime.tar.gz`.

## Сборки и выкатка

- **checks** — Builds → Run checks (или `workspace-trigger-build --title "…"`): тесты в checkout на Mac владельца.
- **deploy** — `workspace-trigger-deploy`: Mac собирает `origin/main` в отдельном worktree, отправляет на VM, `workspace-promote-release` ставит релиз. Коды: `0` выкачено, `3` отказ (более старый коммит / другой lockfile / битый stage), `4` smoke не прошёл — вернули прошлый, `5` идёт другой деплой.

## Обновить версию инструмента

Поменять версию и сумму в `versions.env` (суммы — из файла checksums релиза, ссылки там же), затем `infra/vm/install.sh` на VM и `companion/bin/install.sh` на Mac.
