import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { inlineCodeReference } from '@/modules/chat/utils/workspaceReferences';

/**
 * File paths and `localhost:PORT` that a model writes as plain text or a code
 * span open on click, as they do in Claude Code's terminal.
 */

const { openFileInEditor, openDirectory } = vi.hoisted(() => ({
  openFileInEditor: vi.fn(),
  openDirectory: vi.fn(),
}));

vi.mock('@/modules/command-palette', () => ({
  usePaletteOps: () => ({ openFileInEditor, openDirectory }),
}));

const { Markdown } = await import('@/modules/chat/transcript/Markdown');

beforeEach(() => {
  openFileInEditor.mockClear();
  openDirectory.mockClear();
});

const links = (markdown: string) => {
  const { container, unmount } = render(<Markdown>{markdown}</Markdown>);
  const anchors = Array.from(container.querySelectorAll('a'));
  return { anchors, unmount };
};

test.each([
  ['Fixed in src/foo.ts:12.', 'src/foo.ts:12', ['src/foo.ts', 12]],
  ['See `src/modules/chat/Markdown.tsx:130` for it', 'src/modules/chat/Markdown.tsx:130', ['src/modules/chat/Markdown.tsx', 130]],
  ['Absolute /srv/Layero/cloud-cli/README.md works', '/srv/Layero/cloud-cli/README.md', ['/srv/Layero/cloud-cli/README.md', null]],
  ['A bare `Markdown.tsx:9:3`', 'Markdown.tsx:9:3', ['Markdown.tsx', 9]],
  ['Plain foo.ts:4 too', 'foo.ts:4', ['foo.ts', 4]],
])('%s opens the file at its line', (markdown, text, call) => {
  const { anchors, unmount } = links(markdown);
  const anchor = anchors.find((element) => element.textContent === text);
  assert.ok(anchor, `no link for ${text}`);
  fireEvent.click(anchor);
  assert.deepEqual(openFileInEditor.mock.calls[0], call);
  unmount();
});

test.each([
  'Call window.open here',
  'Use `window.open` here',
  'Ratio 1/2.5 or and/or',
  'Run `npm run build`',
  'Package `@types/node`',
  'Version 1.2.3:4',
  'Read README.md first',
])('%s stays text', (markdown) => {
  const { anchors, unmount } = links(markdown);
  assert.equal(anchors.length, 0);
  unmount();
});

test('localhost:PORT in text or code becomes an http link the Browser panel picks up', () => {
  const { anchors, unmount } = links('Dev server on localhost:5174/projects. Also `127.0.0.1:8080`.');
  assert.deepEqual(anchors.map((anchor) => anchor.getAttribute('href')), ['http://localhost:5174/projects', 'http://127.0.0.1:8080']);
  unmount();
});

test('a reference already inside a markdown link is not linked twice', () => {
  const { anchors, unmount } = links('See [`src/foo.ts:12`](src/foo.ts:12) and http://localhost:5174/x');
  assert.equal(anchors.length, 2);
  assert.equal(anchors[0].querySelector('a'), null);
  fireEvent.click(anchors[0]);
  assert.equal(openFileInEditor.mock.calls.length, 1);
  unmount();
});

test('paths inside fenced code are left alone', () => {
  const { anchors, unmount } = links('```\nsrc/foo.ts:12\n```');
  assert.equal(anchors.length, 0);
  unmount();
});

test('inlineCodeReference only accepts a whole reference', () => {
  assert.deepEqual(inlineCodeReference('src/a.ts:3:1'), { kind: 'file', path: 'src/a.ts', line: 3 });
  assert.deepEqual(inlineCodeReference('http://localhost:5174/'), { kind: 'url', url: 'http://localhost:5174/' });
  assert.equal(inlineCodeReference('cat src/a.ts'), null);
  assert.equal(inlineCodeReference('https://example.com/a.ts'), null);
});
