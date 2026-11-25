import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { PinnedConversationListItem, Project } from '@/shared/types';
import { buildPinnedSessionFamilies } from '@/modules/sidebar/utils/pinnedSessionFamilies';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 25, 12, minutes)).toISOString();
const session = (id: string, parent: string | null, minutes: number) => ({
  id, summary: id, __provider: 'claude', forkedFromSessionId: parent, lastActivity: at(minutes),
});
const PROJECTS = [{
  projectId: 'p1', displayName: 'cloud-cli', fullPath: '/srv/cloud-cli',
  sessions: [session('base', null, 0), session('root', 'base', 1), session('forkA', 'root', 3), session('forkB', 'root', 2), session('grand', 'forkA', 4), session('other', null, 5)],
}] as unknown as Project[];
const pin = (id: string, parent: string | null = null): PinnedConversationListItem => ({
  sessionId: id, provider: 'claude', projectId: 'p1', projectDisplayName: 'cloud-cli', sessionTitle: id, lastActivity: null, forkedFromSessionId: parent,
} as PinnedConversationListItem);

const shape = (families: ReturnType<typeof buildPinnedSessionFamilies>) =>
  families.map((family) => family.rows.map((row) => `${row.depth}:${row.session.id}`));

test('pinning a parent carries its whole fork tree, and a pinned fork is not repeated on its own', () => {
  const families = buildPinnedSessionFamilies([pin('forkA', 'root'), pin('root', 'base'), pin('other')], PROJECTS);

  assert.deepEqual(shape(families), [
    ['0:root', '1:forkA', '2:grand', '1:forkB'],
    ['0:other'],
  ]);
  assert.equal(families[0].projectDisplayName, 'cloud-cli');
});

test('a pinned fork alone brings its own descendants, never its unpinned ancestors', () => {
  assert.deepEqual(shape(buildPinnedSessionFamilies([pin('forkA', 'root')], PROJECTS)), [['0:forkA', '1:grand']]);
});

test('a pin whose session is not on a loaded page is still listed, from the pin itself', () => {
  const [family] = buildPinnedSessionFamilies([{ ...pin('off-page'), sessionTitle: 'Off page' }], PROJECTS);
  assert.deepEqual(family.rows.map((row) => [row.session.id, row.session.summary]), [['off-page', 'Off page']]);
});
