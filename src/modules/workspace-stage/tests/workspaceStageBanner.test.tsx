import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAuthTokenStorageKey } from '@/shared/authToken';
import { WorkspaceStageBanner } from '@/modules/workspace-stage';

const setStageCookie = (on: boolean) => {
  document.cookie = on ? 'workspace_stage=1; path=/' : 'workspace_stage=; path=/; max-age=0';
};

afterEach(() => {
  cleanup();
  setStageCookie(false);
  vi.unstubAllGlobals();
});

describe('Workspace stage', () => {
  it('renders nothing and keeps the production token key off the stage', () => {
    render(<WorkspaceStageBanner />);
    expect(screen.queryByTestId('workspace-stage-banner')).toBeNull();
    expect(getAuthTokenStorageKey()).toBe('auth-token');
  });

  it('shows the branch build and keeps its own token key on the stage', async () => {
    setStageCookie(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ status: 'ok', stage: { ref: 'feat/x', sha: '0123456789abcdef' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    render(<WorkspaceStageBanner />);

    expect(getAuthTokenStorageKey()).toBe('workspace-stage-auth-token');
    await waitFor(() => expect(screen.getByTestId('workspace-stage-banner').textContent).toContain('feat/x @ 01234567'));
    expect(screen.getByRole('link').getAttribute('href')).toBe('/__stage/off');
  });
});
