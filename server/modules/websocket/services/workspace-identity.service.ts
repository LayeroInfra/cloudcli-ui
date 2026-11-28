import { userDb } from '@/modules/database/index.js';
import { buildWorkspaceIdentityEnv } from '@/shared/utils.js';

/**
 * Used by the chat and shell sockets: the environment that names the
 * Workspace user behind a run or a terminal — `WORKSPACE_OWNER`,
 * `WORKSPACE_USER` and their git identity (see `buildWorkspaceIdentityEnv`).
 * With it an agent can run `workspace-trigger-build` and
 * `workspace-trigger-stage` itself, and its commits carry the user's name.
 *
 * Empty when the socket has no signed-in user (platform mode, tests) or the
 * user no longer exists: the child then runs as before, without identity.
 */
export function resolveWorkspaceIdentityEnv(userId: string | number | null | undefined): Record<string, string> {
  const id = typeof userId === 'number' ? userId : Number.parseInt(String(userId ?? ''), 10);
  if (!Number.isInteger(id) || id <= 0) return {};
  try {
    const user = userDb.getUserById(id);
    if (!user?.username) return {};
    const git = userDb.getGitConfig(id);
    return buildWorkspaceIdentityEnv({ username: user.username, gitName: git?.git_name, gitEmail: git?.git_email });
  } catch {
    // An unreadable database must not stop a chat or a terminal from starting.
    return {};
  }
}
