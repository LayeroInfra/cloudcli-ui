import type { Nodes, Parent, PhrasingContent, Root } from 'mdast';

/**
 * File paths and workspace dev-server addresses as models write them in
 * prose and code spans (`src/foo.ts:12`, `localhost:5174`), turned into
 * links the way Claude Code makes them clickable in a terminal.
 *
 * Deliberately narrower than the link renderer's `looksLikeFilePath`: a
 * reference here is found in free text, so it needs a directory and a
 * letter-led extension (`src/foo.ts`, `/srv/a/b.md`), or a bare file name
 * with a line (`foo.ts:12`). `window.open`, `1/2.5` and `and/or` stay text.
 */
const SEGMENT = String.raw`[\w@+-][\w@.+-]*`;
const EXTENSION = String.raw`\.[A-Za-z][A-Za-z0-9]{0,9}`;
const LINE = String.raw`:\d+(?::\d+)?`;
const DIRECTORY_PATH = String.raw`(?:\.{1,2}\/|\/)?(?:${SEGMENT}\/)+${SEGMENT}${EXTENSION}(?:${LINE})?`;
const BARE_FILE_WITH_LINE = String.raw`${SEGMENT}${EXTENSION}${LINE}`;
const FILE_REFERENCE = `(?:${DIRECTORY_PATH}|${BARE_FILE_WITH_LINE})`;
const LOCALHOST = String.raw`(?:localhost|127\.0\.0\.1):\d{2,5}(?:\/[^\s<>()\[\]'"\x60]*)?`;

const WHOLE_FILE_REFERENCE = new RegExp(`^${FILE_REFERENCE}$`);
const WHOLE_LOCALHOST = new RegExp(`^(?:https?:\\/\\/)?${LOCALHOST}$`, 'i');

// Not preceded by a path or URL character, so the middle of `a/b/c.ts` or of
// `http://localhost:5174` is never a match of its own.
const IN_TEXT = new RegExp(`(?<![\\w@./:~-])(?:(${LOCALHOST})|(${FILE_REFERENCE}))(?![\\w/])`, 'gi');

const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

export type WorkspaceReference =
  | { kind: 'file'; path: string; line: number | null }
  | { kind: 'url'; url: string };

const splitLine = (reference: string): { path: string; line: number | null } => {
  const match = reference.match(/:(\d+)(?::\d+)?$/);
  return match
    ? { path: reference.slice(0, match.index), line: Number(match[1]) }
    : { path: reference, line: null };
};

/** What a whole code span refers to, or null for ordinary code. */
export function inlineCodeReference(text: string): WorkspaceReference | null {
  const value = text.trim();
  if (WHOLE_LOCALHOST.test(value)) {
    return { kind: 'url', url: /^https?:/i.test(value) ? value : `http://${value}` };
  }
  if (WHOLE_FILE_REFERENCE.test(value)) {
    return { kind: 'file', ...splitLine(value) };
  }
  return null;
}

/**
 * The href for a reference. A bare `foo.ts:12` would read as a `foo.ts:` URL
 * scheme and be dropped by the URL sanitizer; the link renderer then falls
 * back to the link text, which is the reference itself.
 */
const referenceUrl = (reference: WorkspaceReference, text: string): string =>
  reference.kind === 'url' ? reference.url : text;

const SKIPPED_PARENTS = new Set(['link', 'linkReference', 'definition', 'code', 'inlineCode', 'html', 'math', 'inlineMath']);

function linkifyText(value: string): PhrasingContent[] | null {
  const pieces: PhrasingContent[] = [];
  let last = 0;
  for (const match of value.matchAll(IN_TEXT)) {
    let found = match[0];
    const isUrl = Boolean(match[1]);
    // A sentence ending right after a URL keeps its full stop.
    if (isUrl) found = found.replace(TRAILING_PUNCTUATION, '');
    const start = match.index ?? 0;
    if (start > last) pieces.push({ type: 'text', value: value.slice(last, start) });
    pieces.push({
      type: 'link',
      url: isUrl ? `http://${found}` : found,
      children: [{ type: 'text', value: found }],
    });
    last = start + found.length;
  }
  if (last === 0) return null;
  if (last < value.length) pieces.push({ type: 'text', value: value.slice(last) });
  return pieces;
}

/** remark plugin: plain-text file references and `localhost:PORT` become links. */
export const remarkWorkspaceReferences = () => (tree: Root) => {
  const visit = (node: Nodes) => {
    if (!('children' in node) || SKIPPED_PARENTS.has(node.type)) return;
    const parent = node as Parent;
    const next: Parent['children'] = [];
    let changed = false;
    for (const child of parent.children) {
      if (child.type === 'inlineCode') {
        // A whole code span that is a reference becomes a link around the
        // code; links are never descended into, so no anchor nests in another.
        const reference = inlineCodeReference(child.value);
        if (reference) {
          next.push({ type: 'link', url: referenceUrl(reference, child.value.trim()), children: [child] });
          changed = true;
          continue;
        }
      } else if (child.type === 'text') {
        const pieces = linkifyText(child.value);
        if (pieces) {
          next.push(...pieces);
          changed = true;
          continue;
        }
      } else {
        visit(child);
      }
      next.push(child);
    }
    if (changed) parent.children = next;
  };
  visit(tree);
};
