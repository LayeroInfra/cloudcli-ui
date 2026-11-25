import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { WorkspaceBuild, WorkspaceBuildDetail } from '@/shared/types';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: { workspaceBuilds: { get: mocks.get, list: vi.fn(), trigger: vi.fn() } } }));

const { default: WorkspaceBuildsPanel } = await import('@/modules/project-workspace/WorkspaceBuildsPanel');

const now = Date.now();
const BUILDS: WorkspaceBuild[] = [
  { number: 14, status: 'failure', branch: 'main', event: 'manual', message: '', createdAt: new Date(now - 60_000).toISOString(), startedAt: new Date(now - 60_000).toISOString(), finishedAt: new Date(now - 50_000).toISOString() },
  { number: 13, status: 'running', branch: 'main', event: 'manual', message: '', createdAt: new Date(now - 20_000).toISOString(), startedAt: new Date(now - 20_000).toISOString(), finishedAt: null },
  { number: 12, status: 'pending', branch: 'main', event: 'manual', message: '', createdAt: new Date(now - 5_000).toISOString(), startedAt: null, finishedAt: null },
];

const DETAIL: WorkspaceBuildDetail = {
  ...BUILDS[0],
  steps: [{ id: 41, name: 'session-tests', state: 'failure', exitCode: 1, startedAt: null, finishedAt: null }],
  logStepId: 41,
  logTail: ['+ workspace-run-checks', 'FAIL session tests'],
};

const props = (overrides: Partial<Parameters<typeof WorkspaceBuildsPanel>[0]> = {}) => ({
  open: true, onClose: vi.fn(), builds: BUILDS, error: null, isLoading: false, isTriggering: false,
  onTrigger: vi.fn(), onRefresh: vi.fn(), ...overrides,
});

test('builds show as queued, running and failed, and the newest failure unfolds its log', async () => {
  mocks.get.mockResolvedValue({ ok: true, json: async () => ({ data: DETAIL }) });
  render(<WorkspaceBuildsPanel {...props()} />);

  assert.ok(screen.getByText('Failed'));
  assert.ok(screen.getByText('Running'));
  assert.ok(screen.getByText('Queued'));
  const log = await waitFor(() => screen.getByText(/FAIL session tests/));
  assert.ok(log);
  assert.ok(screen.getByText('exit 1'));
  assert.deepEqual(mocks.get.mock.calls[0], [14]);
});

test('run checks starts a build; an error from the API is shown', () => {
  const onTrigger = vi.fn();
  render(<WorkspaceBuildsPanel {...props({ builds: [], onTrigger, error: 'Woodpecker is unreachable.' })} />);

  assert.ok(screen.getByRole('alert').textContent?.includes('Woodpecker is unreachable.'));
  assert.ok(screen.getByText('No builds yet'));
  fireEvent.click(screen.getByRole('button', { name: /Run checks/ }));
  assert.equal(onTrigger.mock.calls.length, 1);
});

test('a closed drawer renders nothing', () => {
  const { container } = render(<WorkspaceBuildsPanel {...props({ open: false })} />);
  assert.equal(container.firstChild, null);
});
