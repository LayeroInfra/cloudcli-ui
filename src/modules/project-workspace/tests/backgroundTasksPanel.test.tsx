import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { SessionActivity, SessionBackgroundTask } from '@/shared/types';

const activity = new Map<string, SessionActivity>();
vi.mock('@/shared/context/SessionProtectionContext', () => ({ useProcessingSessions: () => activity }));

const { default: BackgroundProcessesPanel } = await import('@/modules/project-workspace/BackgroundProcessesPanel');

const TASKS: SessionBackgroundTask[] = [
  { toolId: 'run', taskId: 'b1', kind: 'command', title: 'Run tests', detail: 'npm test', status: 'running', startedAt: Date.now() - 5000 },
  { toolId: 'done', kind: 'agent', title: 'Survey the repo', status: 'completed', startedAt: Date.now() - 60_000, result: 'Found 3 modules' },
];

test('the open session lists its tasks with status, stop for a running one and the result on demand', () => {
  const sendMessage = vi.fn();
  render(
    <BackgroundProcessesPanel open onClose={() => {}} projects={[]} activeSessionId="s1" sessionTasks={TASKS} sendMessage={sendMessage} onOpenSession={() => {}} />,
  );

  assert.ok(screen.getByText('This session'));
  assert.ok(screen.getByText('Run tests'));
  assert.ok(screen.getByText('npm test'));
  assert.equal(screen.queryByText('Found 3 modules'), null, 'the result stays folded until asked for');

  fireEvent.click(screen.getByText('Survey the repo'));
  assert.ok(screen.getByText('Found 3 modules'));

  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  assert.deepEqual(sendMessage.mock.calls, [[{ type: 'chat.stop-task', sessionId: 's1', taskId: 'b1' }]]);
});

test('with no tasks and nothing running elsewhere the drawer says so', () => {
  render(
    <BackgroundProcessesPanel open onClose={() => {}} projects={[]} activeSessionId="s1" sessionTasks={[]} sendMessage={() => {}} onOpenSession={() => {}} />,
  );
  assert.ok(screen.getByText('Nothing is running'));
});
