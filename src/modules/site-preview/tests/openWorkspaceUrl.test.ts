import assert from 'node:assert/strict';

import { afterEach, test, vi } from 'vitest';

import { OPEN_URL_EVENT, openWorkspaceUrl, previewUrlOrNull } from '@/modules/site-preview/openWorkspaceUrl';

afterEach(() => {
  vi.restoreAllMocks();
});

test('tunneled localhost ports map to the local port that reaches them', () => {
  assert.equal(previewUrlOrNull('localhost:5173/a'), 'http://localhost:15173/a');
  assert.equal(previewUrlOrNull('http://127.0.0.1:5174/'), 'http://localhost:5174/');
  assert.equal(previewUrlOrNull('http://localhost:3000/'), null);
  assert.equal(previewUrlOrNull('https://localhost:5174/'), null);
  assert.equal(previewUrlOrNull('http://example.com:5174/'), null);
});

test('a URL the Browser panel takes does not open a window', () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const take = (event: Event) => event.preventDefault();
  window.addEventListener(OPEN_URL_EVENT, take);
  try {
    assert.equal(openWorkspaceUrl('http://localhost:5174/'), true);
    assert.equal(open.mock.calls.length, 0);
  } finally {
    window.removeEventListener(OPEN_URL_EVENT, take);
  }
});

test('anything else opens a new window without an opener; other schemes are refused', () => {
  const opened = { opener: 'set' } as unknown as Window;
  const open = vi.spyOn(window, 'open').mockReturnValue(opened);
  assert.equal(openWorkspaceUrl('https://github.com/login/device'), true);
  assert.deepEqual(open.mock.calls[0], ['https://github.com/login/device', '_blank']);
  assert.equal(opened.opener, null);

  assert.equal(openWorkspaceUrl('javascript:alert(1)'), false);
  assert.equal(open.mock.calls.length, 1);
});
