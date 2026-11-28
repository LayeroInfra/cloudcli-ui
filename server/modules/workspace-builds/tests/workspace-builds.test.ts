import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { normalizeBuildTitle, workspaceBuildsService } from '@/modules/workspace-builds/services/workspace-builds.service.js';
import { normalizeWorkspaceOwner } from '@/shared/utils.js';
import { createWorkspaceBuildsRouter } from '@/modules/workspace-builds/workspace-builds.routes.js';

const b64 = (text: string) => Buffer.from(`${text}\n`).toString('base64');

const PIPELINES = [
  { number: 13, status: 'running', branch: 'main', event: 'manual', created: 1795630072, started: 1795630072, finished: 0, variables: { WORKSPACE_OWNER: 'alice', WORKSPACE_JOB: 'deploy', WORKSPACE_BUILD_TITLE: 'ship builds panel' } },
  { number: 12, status: 'failure', branch: 'main', event: 'manual', created: 1795629805, started: 1795629805, finished: 1795629809, variables: { WORKSPACE_OWNER: 'bob' } },
  { number: 11, status: 'pending', branch: 'main', event: 'manual', created: 1795629750, started: 0, finished: 0, variables: { WORKSPACE_OWNER: 'alice' } },
  // Before owner routing: nobody's.
  { number: 7, status: 'success', branch: 'main', event: 'manual', created: 1795627586, started: 1795627586, finished: 1795627592 },
];

const DETAIL_12 = {
  ...PIPELINES[1],
  workflows: [{ name: 'woodpecker', children: [{ id: 41, name: 'session-tests', state: 'failure', exit_code: 1, started: 1795629805, finished: 1795629809 }] }],
};

type Created = { branch: string; variables: Record<string, string> };

function fakeWoodpecker(pipelines: unknown[] = PIPELINES) {
  const calls: string[] = [];
  const triggered: Created[] = [];
  const cancelled: number[] = [];
  workspaceBuildsService.setSource({
    serverUrl: 'http://woodpecker.test',
    repo: 'buildadmin/cloudcli-checks',
    branch: 'main',
    readToken: async () => 'token',
    fetch: async (url, init) => {
      calls.push(url);
      assert.equal(init?.headers?.Authorization, 'Bearer token');
      const path = url.replace('http://woodpecker.test', '');
      if (init?.method === 'POST' && /^\/api\/repos\/1\/pipelines\/\d+\/cancel$/.test(path)) {
        cancelled.push(Number(path.split('/')[5]));
        return { ok: true, status: 204, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } };
      }
      if (init?.method === 'POST' && path === '/api/repos/1/pipelines') {
        triggered.push(JSON.parse(init.body ?? '{}') as Created);
        return { ok: true, status: 200, json: async () => ({ number: 14, status: 'pending' }) };
      }
      const page = /^\/api\/repos\/1\/pipelines\?page=(\d+)&perPage=(\d+)$/.exec(path);
      const body = path === '/api/repos/lookup/buildadmin/cloudcli-checks' ? { id: 1 }
        : page ? pipelines.slice((Number(page[1]) - 1) * Number(page[2]), Number(page[1]) * Number(page[2]))
          : path === '/api/repos/1/pipelines/12' ? DETAIL_12
            : path === '/api/repos/1/pipelines/13' ? { ...PIPELINES[0], workflows: [] }
              : path === '/api/repos/1/logs/12/41' ? [{ line: 0, data: b64('+ workspace-run-checks') }, { line: 1, data: b64('\u001b[1m\u001b[31mFAIL\u001b[39m\u001b[22m session tests') }]
                : null;
      return { ok: body !== null, status: body === null ? 404 : 200, json: async () => body };
    },
  });
  return { calls, triggered, cancelled };
}

test('owners are normalised the way workspace-trigger-build normalises them', () => {
  assert.equal(normalizeWorkspaceOwner('Alice.Smith'), 'alice-smith');
  assert.equal(normalizeWorkspaceOwner('  -Bob_1- '), 'bob_1');
  assert.equal(normalizeWorkspaceOwner('***'), '');
});

test('a user lists only their own builds, never another owner\'s or unowned ones', async () => {
  fakeWoodpecker();
  try {
    assert.deepEqual((await workspaceBuildsService.listBuilds('Alice')).map((build) => [build.number, build.status]), [[13, 'running'], [11, 'pending']]);
    assert.deepEqual((await workspaceBuildsService.listBuilds('bob')).map((build) => build.number), [12]);
    assert.deepEqual(await workspaceBuildsService.listBuilds('carol'), []);
    const [running] = await workspaceBuildsService.listBuilds('alice');
    assert.equal(running.startedAt, new Date(1795630072 * 1000).toISOString());
    assert.equal(running.finishedAt, null);
    assert.equal(running.job, 'deploy');
    assert.equal(running.title, 'ship builds panel');
    // Runs from before WORKSPACE_JOB and titles read as untitled checks.
    const [old] = await workspaceBuildsService.listBuilds('bob');
    assert.equal(old.job, 'checks');
    assert.equal(old.title, '');
  } finally {
    workspaceBuildsService.setSource();
  }
});

test('a failed build shows its failed step and the tail of that step\'s log', async () => {
  fakeWoodpecker();
  try {
    const build = await workspaceBuildsService.getBuild('bob', 12);
    assert.equal(build.status, 'failure');
    assert.deepEqual(build.steps.map((step) => [step.name, step.state, step.exitCode]), [['session-tests', 'failure', 1]]);
    assert.equal(build.logStepId, 41);
    assert.deepEqual(build.logTail, ['+ workspace-run-checks', 'FAIL session tests']);
  } finally {
    workspaceBuildsService.setSource();
  }
});

test('another owner\'s build, or one that does not exist, reads as not found', async () => {
  fakeWoodpecker();
  try {
    await assert.rejects(workspaceBuildsService.getBuild('alice', 12), { code: 'BUILD_NOT_FOUND', statusCode: 404 });
    await assert.rejects(workspaceBuildsService.getBuild('alice', 999), { code: 'BUILD_NOT_FOUND', statusCode: 404 });
  } finally {
    workspaceBuildsService.setSource();
  }
});

test('a user\'s builds behind other users\' runs are still found, a few pages deep', async () => {
  const others = Array.from({ length: 60 }, (_, index) => ({ number: 200 - index, status: 'success', variables: { WORKSPACE_OWNER: 'bob' } }));
  const { calls } = fakeWoodpecker([...others, { number: 100, status: 'success', variables: { WORKSPACE_OWNER: 'alice' } }]);
  try {
    assert.deepEqual((await workspaceBuildsService.listBuilds('alice')).map((build) => build.number), [100]);
    assert.equal(calls.filter((url) => url.includes('/pipelines?page=')).length, 2);
  } finally {
    workspaceBuildsService.setSource();
  }
});

test('a build is started for the session owner only, as a titled checks run, and reports its number', async () => {
  const { triggered } = fakeWoodpecker();
  try {
    assert.deepEqual(await workspaceBuildsService.triggerBuild('Alice'), { number: 14 });
    assert.deepEqual(await workspaceBuildsService.triggerBuild('alice', { title: '  session\n rename ' }), { number: 14 });
    assert.deepEqual(triggered, [
      { branch: 'main', variables: { WORKSPACE_OWNER: 'alice', WORKSPACE_JOB: 'checks', WORKSPACE_BUILD_TITLE: 'Manual checks' } },
      { branch: 'main', variables: { WORKSPACE_OWNER: 'alice', WORKSPACE_JOB: 'checks', WORKSPACE_BUILD_TITLE: 'session rename' } },
    ]);
  } finally {
    workspaceBuildsService.setSource();
  }
});

test('a user cancels their own queued or running build, not a finished one or another user\'s', async () => {
  const { cancelled } = fakeWoodpecker();
  try {
    assert.deepEqual(await workspaceBuildsService.cancelBuild('alice', 13), { cancelled: true });
    assert.deepEqual(await workspaceBuildsService.cancelBuild('bob', 12), { cancelled: false });
    await assert.rejects(workspaceBuildsService.cancelBuild('alice', 12), { code: 'BUILD_NOT_FOUND', statusCode: 404 });
    assert.deepEqual(cancelled, [13]);
  } finally {
    workspaceBuildsService.setSource();
  }
});

test('titles are one line of at most 80 characters, with a default per job', () => {
  assert.equal(normalizeBuildTitle(undefined, 'checks'), 'Manual checks');
  assert.equal(normalizeBuildTitle('   ', 'deploy'), 'Deploy workspace-ui');
  assert.equal(normalizeBuildTitle('a\tb\r\nc', 'checks'), 'a b c');
  assert.equal(normalizeBuildTitle('x'.repeat(200), 'checks').length, 80);
});

test('Woodpecker errors other than not-found stay unavailable, not a missing build', async () => {
  workspaceBuildsService.setSource({
    serverUrl: 'http://woodpecker.test',
    readToken: async () => 'token',
    fetch: async (url) => (url.endsWith('/lookup/buildadmin/cloudcli-checks')
      ? { ok: true, status: 200, json: async () => ({ id: 1 }) }
      : { ok: false, status: 500, json: async () => null }),
  });
  try {
    await assert.rejects(workspaceBuildsService.getBuild('alice', 12), { code: 'BUILDS_UNAVAILABLE', statusCode: 503 });
  } finally {
    workspaceBuildsService.setSource();
  }
});

test('without a Woodpecker token the API says builds are unavailable', async () => {
  workspaceBuildsService.setSource({ readToken: async () => null });
  try {
    await assert.rejects(workspaceBuildsService.listBuilds('alice'), { code: 'BUILDS_UNAVAILABLE', statusCode: 503 });
  } finally {
    workspaceBuildsService.setSource();
  }
});

test('the HTTP API scopes every call to the authenticated user, whatever the request says', async () => {
  const { triggered } = fakeWoodpecker();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = { id: 1, username: String(req.headers['x-test-user'] ?? '') };
    next();
  });
  app.use('/api/workspace/builds', createWorkspaceBuildsRouter());
  app.use((err: { statusCode?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode ?? 500).json({ success: false, error: { code: err.code } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/workspace/builds`;
  const as = (user: string, path = '', init: RequestInit = {}) => fetch(`${base}${path}`, { ...init, headers: { 'x-test-user': user, 'content-type': 'application/json' } });
  try {
    const alice = await (await as('alice')).json() as { data: { builds: Array<{ number: number }> } };
    assert.deepEqual(alice.data.builds.map((build) => build.number), [13, 11]);

    // Asking for bob's build as alice, even via a query, is not found.
    assert.equal((await as('alice', '/12?owner=bob')).status, 404);
    assert.equal((await as('bob', '/12')).status, 200);
    assert.equal((await as('bob', '/abc')).status, 400);

    // A body naming another owner is ignored: the build goes to the session user.
    const started = await as('alice', '', { method: 'POST', body: JSON.stringify({ owner: 'bob', title: 'auth login form' }) });
    assert.equal(started.status, 202);
    assert.deepEqual(triggered.map((run) => [run.variables.WORKSPACE_OWNER, run.variables.WORKSPACE_BUILD_TITLE]), [['alice', 'auth login form']]);

    assert.equal((await as('bob', '/13/cancel', { method: 'POST' })).status, 404);
    assert.equal((await as('alice', '/13/cancel', { method: 'POST' })).status, 200);

    assert.equal((await as('')).status, 401);
  } finally {
    server.close();
    workspaceBuildsService.setSource();
  }
});
