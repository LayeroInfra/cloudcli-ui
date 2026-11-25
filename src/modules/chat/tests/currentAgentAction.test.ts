import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { ChatMessage } from '@/shared/types';
import { getCurrentAgentAction } from '@/modules/chat/utils/currentAgentAction';

const user = (content: string): ChatMessage => ({ type: 'user', content, timestamp: 1 } as ChatMessage);
const tool = (toolName: string, toolInput: unknown, done = false): ChatMessage => ({
  type: 'assistant', content: '', timestamp: 1, isToolUse: true, toolName, toolInput,
  toolResult: done ? { content: 'ok', isError: false } : null,
} as ChatMessage);

test('the newest unfinished tool call of the turn is what the agent is doing', () => {
  const action = getCurrentAgentAction([
    user('go'),
    tool('Read', { file_path: '/srv/app/src/a.ts' }, true),
    tool('Bash', { command: 'npm test -- --watch=false', description: 'Run the unit tests' }),
  ]);
  assert.deepEqual(action, { verb: 'running', defaultVerb: 'Running', target: 'Run the unit tests' });
});

test('files are named by their basename and MCP tools by their readable name', () => {
  assert.equal(getCurrentAgentAction([user('x'), tool('Edit', { file_path: '/a/b/ChatComposer.tsx' })])?.target, 'ChatComposer.tsx');
  assert.equal(getCurrentAgentAction([user('x'), tool('WebFetch', { url: 'https://docs.example.com/page' })])?.target, 'docs.example.com');
  assert.deepEqual(getCurrentAgentAction([user('x'), tool('mcp__github__create_issue', {})]), {
    verb: 'tool', defaultVerb: 'Using', target: 'create_issue (github)',
  });
});

test('a streaming reply or thinking is reported when no tool is running', () => {
  const reply = { type: 'assistant', content: 'Hel', timestamp: 1, isStreaming: true } as ChatMessage;
  assert.equal(getCurrentAgentAction([user('x'), tool('Read', { file_path: 'a' }, true), reply])?.verb, 'replying');
  assert.equal(getCurrentAgentAction([user('x'), { ...reply, isThinking: true }])?.verb, 'thinking');
});

test('an unfinished call from an earlier turn never shows', () => {
  assert.equal(getCurrentAgentAction([tool('Bash', { command: 'sleep 99' }), user('next')]), null);
});

test('tool input arriving as JSON text still names the action', () => {
  const action = getCurrentAgentAction([user('x'), tool('Bash', JSON.stringify({ command: 'npm test' }, null, 2))]);
  assert.equal(action?.target, 'npm test');
});
