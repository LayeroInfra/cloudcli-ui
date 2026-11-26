import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { WorkspaceBuild } from '@/shared/types';

/** While a build waits or runs, the list follows it closely. */
const ACTIVE_POLL_MS = 3000;
/** With the drawer open and nothing running, a new build still shows up soon. */
const OPEN_POLL_MS = 15_000;
/** Closed and idle: only the header badge depends on it. */
const IDLE_POLL_MS = 60_000;

/** Woodpecker states in which a build has not finished yet. */
export const ACTIVE_BUILD_STATUSES = new Set(['pending', 'running', 'blocked']);

type BuildsResponse = { data?: { builds?: WorkspaceBuild[] }; error?: { message?: string } | string };

const readError = (payload: BuildsResponse | null, status: number): string => {
  const error = payload?.error;
  if (typeof error === 'string') return error;
  return error?.message || `Builds are unavailable (HTTP ${status}).`;
};

/**
 * Used by WorkspaceMain for the builds drawer and the header badge: the
 * signed-in user's builds, polled every 3 s while one is pending or running
 * and rarely otherwise, paused while the tab is hidden. `trigger` starts the
 * checks pipeline on the user's Mac and switches to close polling at once.
 */
export function useWorkspaceBuilds(panelOpen: boolean) {
  // The user's builds from the last successful answer, newest first.
  const [builds, setBuilds] = useState<WorkspaceBuild[]>([]);
  // Why the last request failed (no Woodpecker token, unreachable, ...); null when it worked.
  const [error, setError] = useState<string | null>(null);
  // True until the first answer, so the drawer shows a skeleton rather than "no builds".
  const [isLoading, setIsLoading] = useState(true);
  // Set while a trigger request is in flight, to disable the button.
  const [isTriggering, setIsTriggering] = useState(false);
  // Keeps close polling on right after a trigger, before the new build is listed.
  const expectingBuildUntil = useRef(0);
  // Bumped by a trigger so the polling schedule restarts at the close interval.
  const [pollEpoch, setPollEpoch] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const response = await api.workspaceBuilds.list();
      const payload = (await response.json().catch(() => null)) as BuildsResponse | null;
      if (!response.ok) {
        setError(readError(payload, response.status));
        return;
      }
      setBuilds(payload?.data?.builds ?? []);
      setError(null);
    } catch {
      setError('Builds are unavailable.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const hasActive = builds.some((build) => ACTIVE_BUILD_STATUSES.has(build.status));

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    const schedule = () => {
      const closePolling = hasActive || Date.now() < expectingBuildUntil.current;
      const delay = closePolling ? ACTIVE_POLL_MS : panelOpen ? OPEN_POLL_MS : IDLE_POLL_MS;
      timer = window.setTimeout(async () => {
        if (!document.hidden) await refresh();
        if (!cancelled) schedule();
      }, delay);
    };
    void refresh().then(() => {
      if (!cancelled) schedule();
    });
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasActive, panelOpen, pollEpoch, refresh]);

  const trigger = useCallback(async () => {
    setIsTriggering(true);
    try {
      const response = await api.workspaceBuilds.trigger();
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as BuildsResponse | null;
        setError(readError(payload, response.status));
        return;
      }
      expectingBuildUntil.current = Date.now() + 30_000;
      setPollEpoch((epoch) => epoch + 1);
    } catch {
      setError('The build could not be started.');
    } finally {
      setIsTriggering(false);
    }
  }, []);

  return {
    builds,
    error,
    isLoading,
    isTriggering,
    activeCount: builds.filter((build) => ACTIVE_BUILD_STATUSES.has(build.status)).length,
    refresh,
    trigger,
  };
}
