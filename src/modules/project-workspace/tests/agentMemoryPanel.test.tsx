import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { AgentMemoryMap } from '@/shared/types';

const mocks = vi.hoisted(() => ({ map: vi.fn(), instructions: vi.fn(), saveInstructions: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: { agentMemory: mocks } }));

const { default: AgentMemoryPanel } = await import('@/modules/project-workspace/AgentMemoryPanel');

const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => (status < 400 ? { data } : { error: { message: data } }) });

const MAP: AgentMemoryMap = {
  root: '/home/dev/.claude/projects',
  stores: [
    {
      id: '-srv-app',
      projectPath: '/srv/app',
      index: { exists: true, lines: 1, entries: [], raw: '- [VM limits](vm-limits.md) — RAM' },
      facts: [
        { file: 'vm-limits.md', name: 'vm-limits', description: '3.8GB RAM, no swap', type: 'project', body: 'See [[builds-flow]].', links: ['builds-flow'], hasFrontmatter: true, inIndex: true, size: 120, updatedAt: new Date().toISOString() },
        { file: 'tone.md', name: 'tone', description: 'Short answers', type: 'feedback', body: 'Keep it short.', links: [], hasFrontmatter: true, inIndex: false, size: 40, updatedAt: new Date().toISOString() },
      ],
      issues: [
        { kind: 'broken-link', file: 'vm-limits.md', detail: '[[builds-flow]] matches no memory yet.' },
        { kind: 'not-indexed', file: 'tone.md', detail: 'Not listed in MEMORY.md, so sessions never see it.' },
      ],
      updatedAt: new Date().toISOString(),
    },
    { id: '-srv-empty', projectPath: null, index: { exists: false, lines: 0, entries: [], raw: '' }, facts: [], issues: [], updatedAt: null },
  ],
};

const INSTRUCTIONS = {
  path: '/home/dev/.claude/CLAUDE.md', exists: false, content: '', updatedAt: null,
  projectFiles: [{ path: '/srv/app/CLAUDE.local.md', name: 'CLAUDE.local.md', exists: true }, { path: '/srv/app/CLAUDE.md', name: 'CLAUDE.md', exists: false }],
};

const props = (overrides = {}) => ({ open: true, onClose: vi.fn(), projectPath: '/srv/app', onOpenFile: vi.fn(), ...overrides });

test('projects start folded; a type filter unfolds matches; a fact unfolds with its issues', async () => {
  mocks.map.mockResolvedValue(ok(MAP));
  mocks.instructions.mockResolvedValue(ok(INSTRUCTIONS));
  render(<AgentMemoryPanel {...props()} />);

  const group = await waitFor(() => screen.getByRole('button', { expanded: false, name: /^app/ }));
  assert.ok(screen.getByText('facts in 1 projects'));
  assert.ok(screen.getByText('1 projects with empty memory'));
  assert.equal(screen.queryByText('vm-limits'), null);

  fireEvent.click(screen.getByRole('button', { name: /^feedback/ }));
  assert.ok(screen.getByText('tone'));
  assert.equal(screen.queryByText('vm-limits'), null);
  fireEvent.click(screen.getByRole('button', { name: /^All/ }));
  assert.equal(screen.queryByText('tone'), null);

  fireEvent.click(group);
  fireEvent.click(screen.getByText('vm-limits'));
  assert.ok(screen.getByText('See [[builds-flow]].'));
  assert.ok(screen.getByText('[[builds-flow]] matches no memory yet.'));
});

test('instructions create the global CLAUDE.md and open the project files in the editor', async () => {
  mocks.map.mockResolvedValue(ok(MAP));
  mocks.instructions.mockResolvedValue(ok(INSTRUCTIONS));
  mocks.saveInstructions.mockResolvedValue(ok({ ...INSTRUCTIONS, exists: true, content: '# Rules\n', updatedAt: new Date().toISOString() }));
  const onOpenFile = vi.fn();
  render(<AgentMemoryPanel {...props({ onOpenFile })} />);

  fireEvent.click(screen.getByRole('tab', { name: 'Instructions' }));
  const editor = await waitFor(() => screen.getByLabelText('CLAUDE.md'));
  assert.ok(screen.getByText('not created'));
  fireEvent.change(editor, { target: { value: '# Rules\n' } });
  fireEvent.click(screen.getByRole('button', { name: /Create/ }));
  await waitFor(() => assert.deepEqual(mocks.saveInstructions.mock.calls[0], ['# Rules\n', null]));
  await waitFor(() => screen.getByRole('button', { name: /Save/ }));

  fireEvent.click(screen.getByRole('button', { name: /CLAUDE\.local\.md/ }));
  assert.deepEqual(onOpenFile.mock.calls[0], ['/srv/app/CLAUDE.local.md']);
});

test('a refused stale save offers a reload', async () => {
  mocks.map.mockResolvedValue(ok(MAP));
  mocks.instructions.mockResolvedValue(ok({ ...INSTRUCTIONS, exists: true, content: 'old', updatedAt: '2026-11-26T08:00:00.000Z' }));
  mocks.saveInstructions.mockResolvedValue(ok('CLAUDE.md changed since it was opened.', 409));
  render(<AgentMemoryPanel {...props()} />);

  fireEvent.click(screen.getByRole('tab', { name: 'Instructions' }));
  const editor = await waitFor(() => screen.getByLabelText('CLAUDE.md'));
  fireEvent.change(editor, { target: { value: 'mine' } });
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() => screen.getByRole('alert'));
  assert.ok(screen.getByRole('alert').textContent?.includes('changed since it was opened'));
  assert.ok(screen.getByRole('button', { name: 'Reload' }));
});
