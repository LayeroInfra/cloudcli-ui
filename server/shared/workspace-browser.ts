import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * `$BROWSER` and `xdg-open` for programs started from the UI: the terminal
 * and Claude sessions. The workspace has no desktop browser, so `gh auth
 * login`, `vite --open` or `claude /login` used to open nothing.
 *
 * The shim writes `OPEN_URL: <url>` to the controlling terminal. The shell
 * websocket already turns that marker into an `auth_url` frame with
 * `autoOpen`, and the client opens it: a workspace dev server in the Browser
 * panel, anything else in a new window (a Companion window in the Mac app).
 * Without a terminal (a Claude session's Bash tool) it prints the URL, which
 * the transcript shows as a link.
 *
 * Release builds ship only `dist-server`, so the server writes the script
 * itself instead of pointing at a file in the repo.
 */
const SHIM = `#!/bin/sh
# Written by CloudUI (server/shared/workspace-browser.ts); rewritten on start.
url="$1"
if [ -z "$url" ]; then
  echo "usage: $(basename "$0") URL" >&2
  exit 2
fi
case "$url" in
  http://*|https://*) ;;
  *)
    echo "Layero Workspace: open $url from the file tree or the chat" >&2
    exit 0
    ;;
esac
if { printf 'OPEN_URL: %s\\r\\n' "$url" >/dev/tty; } 2>/dev/null; then
  exit 0
fi
printf 'Open in the browser: %s\\n' "$url" >&2
exit 0
`;

const SHIM_NAMES = ['cloudui-open', 'xdg-open'] as const;

export type WorkspaceBrowserDependencies = {
  directory?: string;
  platform?: NodeJS.Platform;
  fileSystem?: Pick<typeof fs, 'mkdirSync' | 'readFileSync' | 'writeFileSync' | 'chmodSync'>;
};

let cachedDirectory: string | null | undefined;

/** Writes the shim when missing or stale; returns its directory, or null when it cannot. */
export function ensureWorkspaceBrowserShim(dependencies: WorkspaceBrowserDependencies = {}): string | null {
  const useCache = Object.keys(dependencies).length === 0;
  if (useCache && cachedDirectory !== undefined) return cachedDirectory;

  const platform = dependencies.platform ?? process.platform;
  const fileSystem = dependencies.fileSystem ?? fs;
  const directory = dependencies.directory ?? path.join(os.homedir(), '.cloudcli', 'bin');
  let result: string | null = null;
  if (platform !== 'win32') {
    try {
      fileSystem.mkdirSync(directory, { recursive: true });
      for (const name of SHIM_NAMES) {
        const file = path.join(directory, name);
        let current: string | null = null;
        try {
          current = fileSystem.readFileSync(file, 'utf8');
        } catch {
          current = null;
        }
        if (current !== SHIM) fileSystem.writeFileSync(file, SHIM);
        fileSystem.chmodSync(file, 0o755);
      }
      result = directory;
    } catch (error) {
      console.warn('[workspace-browser] could not write the $BROWSER shim:', error);
      result = null;
    }
  }
  if (useCache) cachedDirectory = result;
  return result;
}

/**
 * Variables to merge over a child's environment: `BROWSER` and the shim
 * directory first on `PATH` (for tools that call `xdg-open` directly). A
 * `BROWSER` the host already sets wins. Empty when the shim is unavailable.
 */
export function workspaceBrowserEnv(
  env: NodeJS.ProcessEnv,
  dependencies: WorkspaceBrowserDependencies = {},
): Record<string, string> {
  const directory = ensureWorkspaceBrowserShim(dependencies);
  if (!directory) return {};
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const entries = (env[pathKey] ?? '').split(path.delimiter).filter((entry) => entry && entry !== directory);
  return {
    ...(env.BROWSER ? {} : { BROWSER: path.join(directory, SHIM_NAMES[0]) }),
    [pathKey]: [directory, ...entries].join(path.delimiter),
  };
}
