// The dev-server ports the Companion preview tunnel forwards
// (companion/bin/start-preview-tunnel.sh), mapped to the local port that
// reaches them. 5173 inside the workspace is served on 15173 locally.
const TUNNELED_PORTS: Record<string, string> = { 5174: '5174', 8080: '8080', 15173: '15173', 5173: '15173' };

export const PREVIEW_PORTS_LABEL = '5174, 8080, 5173 and 15173';

/** A bare `localhost:5174/x` as people and dev servers print it. */
const BARE_LOCALHOST = /^(localhost|127\.0\.0\.1)(:|\/|$)/i;

/**
 * Turns what the person typed or clicked into a previewable URL, or throws.
 * Only plain-http localhost on a tunneled port is allowed: anything else
 * would load from the viewer's own machine, not the workspace.
 */
export function normalizePreviewUrl(text: string): string {
  const trimmed = text.trim();
  const url = new URL(BARE_LOCALHOST.test(trimmed) ? `http://${trimmed}` : trimmed);
  if (
    url.protocol !== 'http:'
    || url.username
    || url.password
    || !['localhost', '127.0.0.1'].includes(url.hostname)
    || !TUNNELED_PORTS[url.port]
  ) {
    throw new Error('not previewable');
  }
  url.hostname = 'localhost';
  url.port = TUNNELED_PORTS[url.port];
  return url.href;
}

/** The preview URL for `text`, or null when the Browser panel cannot show it. */
export function previewUrlOrNull(text: string): string | null {
  try {
    return normalizePreviewUrl(text);
  } catch {
    return null;
  }
}

/** Dispatched on `window`; the Browser panel cancels it when it takes the URL. */
export const OPEN_URL_EVENT = 'workspace:open-url';

export type OpenUrlEventDetail = { url: string };

/**
 * Opens a URL the way a click on it would: a workspace dev server in the
 * Browser panel, anything else in a new window (a Companion browser window
 * in the Mac app). Returns false when a browser blocked the new window, which
 * happens outside a click.
 */
export function openWorkspaceUrl(url: string): boolean {
  const event = new CustomEvent<OpenUrlEventDetail>(OPEN_URL_EVENT, { detail: { url }, cancelable: true });
  if (!window.dispatchEvent(event)) {
    return true;
  }
  let target: string;
  try {
    target = new URL(BARE_LOCALHOST.test(url.trim()) ? `http://${url.trim()}` : url.trim()).href;
  } catch {
    return false;
  }
  if (!/^https?:/i.test(target)) {
    return false;
  }
  // Not the `noopener` feature: with it window.open always returns null.
  const opened = window.open(target, '_blank');
  if (opened) opened.opener = null;
  return opened !== null;
}
