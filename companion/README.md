# Layero Workspace

Одно приложение на Mac: рабочее пространство, SSH-туннель к CI и агент сборок пользователя.

## Новому человеку

1. Получить zip `Layero-Workspace-macOS.zip` (или эту папку).
2. Открыть **Layero Workspace.app** — иконка остаётся в Dock, пока приложение работает.
3. В окне Layero заполнить: адрес пространства, username, пароль.
4. При необходимости — папку репозитория для сборок.
5. **Quit (Cmd+Q)** останавливает туннель, агент сборок и companion.

Приложение находит IP сервера по DNS введённого адреса. Через SSH-туннель рабочее пространство открывается на `https://127.0.0.1:19443`.

Аккаунт на сервере создаёт оператор:

```bash
workspace-add-user <username> <password>
```

## Сборка и установка на Mac

Исходники клиента находятся в `companion/`. Сборка требует Swift и утилит Xcode Command Line Tools.

```bash
./companion/bin/build-app.sh
WORKSPACE_RUNTIME_DIR=/path/to/private-runtime ./companion/bin/install.sh
open ~/Applications/Layero\ Workspace.app
```

Оператор готовит закрытую папку с `secrets/ssh/id_ed25519`, `agent/agent.secret`,
`agent/agent.conf` и бинарником `bin/woodpecker-agent` для macOS. Эти файлы
хранятся вне Git. Архив для команды собирается локально и включает эти данные доступа.

```bash
WORKSPACE_RUNTIME_DIR=/path/to/private-runtime ./companion/bin/package.sh
# → companion/dist/Layero-Workspace-macOS.zip
```

## Что поднимается

| Компонент | Назначение |
|-----------|------------|
| UI | `https://127.0.0.1:19443` через туннель |
| SSH-туннель | HostName = DNS IP пространства; UI `:9443` и Woodpecker `:9000` |
| woodpecker-agent | labels `owner=<username>,backend=local` |
| Status | `http://127.0.0.1:19100` — что собирается на этом Mac |

Конфиг: `~/.config/layero-workspace/identity.json`.
Токен сессии хранится в Связке ключей macOS. Пункт «Сменить пространство» в меню профиля сбрасывает сохранённую сессию и открывает форму входа. После истечения сессии приложение снова попросит пароль.

Если имя SSH-пользователя отличается от имени учётной записи Workspace, оператор добавляет строку `<адрес пространства> <имя SSH>` в `~/.config/layero-workspace/ssh-users`. Существующая локальная настройка SSH сохраняется. Пароль не хранится.
