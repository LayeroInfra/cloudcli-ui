import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, userDb } from '@/modules/database/index.js';
import { resolveWorkspaceIdentityEnv } from '@/modules/websocket/services/workspace-identity.service.js';
import { buildWorkspaceIdentityEnv, normalizeWorkspaceOwner } from '@/shared/utils.js';

test('the identity env names the user, the build owner and, with a git profile, the commit author', () => {
  assert.deepEqual(buildWorkspaceIdentityEnv({ username: 'Alice.Smith', gitName: 'Alice Smith', gitEmail: 'alice@example.com' }), {
    WORKSPACE_USER: 'Alice.Smith',
    WORKSPACE_OWNER: 'alice-smith',
    GIT_AUTHOR_NAME: 'Alice Smith',
    GIT_AUTHOR_EMAIL: 'alice@example.com',
    GIT_COMMITTER_NAME: 'Alice Smith',
    GIT_COMMITTER_EMAIL: 'alice@example.com',
  });
  // Without a full git profile the checkout's own git config applies.
  assert.deepEqual(buildWorkspaceIdentityEnv({ username: 'bob', gitName: 'Bob', gitEmail: '  ' }), {
    WORKSPACE_USER: 'bob',
    WORKSPACE_OWNER: 'bob',
  });
  assert.deepEqual(buildWorkspaceIdentityEnv({ username: '---' }), {});
  assert.equal(normalizeWorkspaceOwner('  -Bob_1- '), 'bob_1');
});

test('a socket user resolves to their identity env; no user or an unknown one to none', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'workspace-identity-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    const { id } = userDb.createUser('valentin', 'not-a-real-hash');
    userDb.updateGitConfig(Number(id), 'Valentin', 'valentin@example.com');

    assert.deepEqual(resolveWorkspaceIdentityEnv(Number(id)), {
      WORKSPACE_USER: 'valentin',
      WORKSPACE_OWNER: 'valentin',
      GIT_AUTHOR_NAME: 'Valentin',
      GIT_AUTHOR_EMAIL: 'valentin@example.com',
      GIT_COMMITTER_NAME: 'Valentin',
      GIT_COMMITTER_EMAIL: 'valentin@example.com',
    });
    // Socket user ids arrive as numbers or strings.
    assert.equal(resolveWorkspaceIdentityEnv(String(id)).WORKSPACE_OWNER, 'valentin');
    assert.deepEqual(resolveWorkspaceIdentityEnv(null), {});
    assert.deepEqual(resolveWorkspaceIdentityEnv(9999), {});
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(directory, { recursive: true, force: true });
  }
});
