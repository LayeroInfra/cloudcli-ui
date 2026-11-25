import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { ChatMessage } from '@/shared/types';
import { listSessionBackgroundTasks } from '@/modules/chat/utils/backgroundTasks';

const row = (overrides: Partial<ChatMessage>): ChatMessage => ({
  type: 'assistant', content: '', timestamp: '2026-11-25T10:00:00Z', isToolUse: true, ...overrides,
} as ChatMessage);

test('background commands, agents and workflows are listed newest first with their outcome', () => {
  const tasks = listSessionBackgroundTasks([
    row({ toolId: 'plain', toolName: 'Bash', toolInput: { command: 'ls' }, toolResult: { content: 'a b' } }),
    row({
      toolId: 'cmd', toolName: 'Bash', toolInput: { command: 'npm test', description: 'Run tests', run_in_background: true },
      toolResult: { content: '42 passed', toolUseResult: { backgroundTaskId: 'b1' } },
    }),
    row({
      toolId: 'agent', toolName: 'Agent', toolInput: { description: 'Survey', run_in_background: true },
      subagent: { id: 'a1', description: 'Survey the repo', type: 'Explore', status: 'completed' },
      toolResult: { content: [{ type: 'text', text: 'Found 3 modules' }], toolUseResult: { agentId: 'a1', isAsync: true } },
    }),
  ]);

  assert.deepEqual(tasks.map((task) => [task.toolId, task.kind, task.title, task.status, task.result]), [
    ['agent', 'agent', 'Survey the repo', 'completed', 'Found 3 modules'],
    ['cmd', 'command', 'Run tests', 'completed', '42 passed'],
  ]);
  assert.equal(tasks[1].detail, 'npm test');
  assert.equal(tasks[1].taskId, 'b1');
});

test('a command whose result is still the launch acknowledgement is running', () => {
  const [task] = listSessionBackgroundTasks([
    row({
      toolId: 'cmd', toolName: 'Bash', toolInput: { command: 'sleep 60', run_in_background: true },
      toolResult: { content: 'Command running in background with ID: b2', toolUseResult: { backgroundTaskId: 'b2' } },
    }),
  ]);
  assert.equal(task.status, 'running');
  assert.equal(task.title, 'sleep 60');
});

test('a live status outranks the inference, and a failed result reads as failed', () => {
  const [stopped, failed] = listSessionBackgroundTasks([
    row({ toolId: 'f', toolName: 'Bash', toolInput: { command: 'x', run_in_background: true }, toolResult: { content: 'boom', isError: true } }),
    row({ toolId: 's', toolName: 'Bash', toolInput: { command: 'y', run_in_background: true }, taskStatus: { status: 'stopped', taskId: 't' } }),
  ]);
  assert.equal(stopped.status, 'stopped');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.isError, true);
});

test('tool input arriving as JSON text, as chat rows carry it, still names the task', () => {
  const [task] = listSessionBackgroundTasks([
    row({
      toolId: 'cmd', toolName: 'Bash',
      toolInput: JSON.stringify({ command: 'npm run build', description: 'Build the app', run_in_background: true }, null, 2),
      toolResult: { content: 'Command running in background with ID: b3' },
    }),
  ]);
  assert.equal(task.title, 'Build the app');
  assert.equal(task.detail, 'npm run build');
  assert.equal(task.status, 'running');
});
