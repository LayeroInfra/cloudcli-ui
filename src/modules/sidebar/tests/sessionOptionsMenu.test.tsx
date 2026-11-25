import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { TFunction } from 'i18next';
import { test, vi } from 'vitest';

import SessionOptions from '@/modules/sidebar/SessionOptions';

vi.mock('@/shared/api', () => ({
  api: {
    providerSessionId: async () => ({
      ok: true,
      json: async () => ({ data: { sessionId: 'native-session-1' } }),
    }),
    providers: {
      capabilities: async () => ({
        json: async () => ({ success: true, data: { providers: [] } }),
      }),
    },
  },
}));

const t = ((key: string) => key) as TFunction;
const noop = () => {};

const optionsProps = (
  overrides: Partial<ComponentProps<typeof SessionOptions>> = {},
): ComponentProps<typeof SessionOptions> => ({
  sessionId: 'session-1',
  sessionName: 'Session one',
  provider: 'claude',
  projectId: 'project-1',
  isProcessing: false,
  isEditing: false,
  renameDraft: '',
  onRenameDraftChange: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  onDeleteSession: noop,
  t,
  ...overrides,
});

const openMenu = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'sessions.options: Session one' }));
  });
};

test('one settings menu holds rename and delete, and no archive', async () => {
  const onStartEditingSession = vi.fn();
  const onDeleteSession = vi.fn();
  render(<SessionOptions {...optionsProps({ onStartEditingSession, onDeleteSession })} />);
  await openMenu();

  assert.equal(screen.queryByRole('menuitem', { name: /archive/i }), null);
  const remove = screen.getByRole('menuitem', { name: /sessions\.delete/ });
  assert.ok(/red/.test(remove.className));

  fireEvent.click(screen.getByRole('menuitem', { name: /sessions\.rename/ }));
  assert.deepEqual(onStartEditingSession.mock.calls, [['project-1', 'session-1', 'Session one']]);

  await openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: /sessions\.delete/ }));
  assert.deepEqual(onDeleteSession.mock.calls, [['session-1', 'Session one']]);
});

test('a running session cannot be deleted from the menu', async () => {
  render(<SessionOptions {...optionsProps({ isProcessing: true })} />);
  await openMenu();
  assert.equal(screen.queryByRole('menuitem', { name: /sessions\.delete/ }), null);
});
