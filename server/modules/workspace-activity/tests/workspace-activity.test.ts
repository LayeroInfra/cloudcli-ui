import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { readWorkspaceActivity } from '@/modules/workspace-activity/services/workspace-activity.service.js';
import { createWorkspaceActivityRouter } from '@/modules/workspace-activity/workspace-activity.routes.js';

test('only running agent turns make the server busy; terminals are reported', () => {
  const busy = readWorkspaceActivity({
    listRunningRuns: () => [{ sessionId: 's1', provider: 'claude', startedAt: Date.UTC(2026, 10, 28, 12) }],
    countOpenTerminals: () => 2,
  });
  assert.deepEqual(busy, {
    activeRuns: [{ sessionId: 's1', provider: 'claude', startedAt: '2026-11-28T12:00:00.000Z' }],
    openTerminals: 2,
    quiet: false,
  });
  const quiet = readWorkspaceActivity({ listRunningRuns: () => [], countOpenTerminals: () => 3 });
  assert.equal(quiet.quiet, true);
  assert.equal(quiet.openTerminals, 3);
});

test('the activity route answers a direct local request and hides from the gateway', async () => {
  const app = express();
  app.use('/internal/workspace', createWorkspaceActivityRouter(() => ({ activeRuns: [], openTerminals: 1, quiet: true })));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    const direct = await fetch(`http://127.0.0.1:${port}/internal/workspace/activity`);
    assert.equal(direct.status, 200);
    assert.deepEqual(await direct.json(), { activeRuns: [], openTerminals: 1, quiet: true });

    // Caddy also connects from 127.0.0.1 but always adds X-Forwarded-For.
    const proxied = await fetch(`http://127.0.0.1:${port}/internal/workspace/activity`, {
      headers: { 'X-Forwarded-For': '203.0.113.7' },
    });
    assert.equal(proxied.status, 404);
  } finally {
    server.close();
  }
});
