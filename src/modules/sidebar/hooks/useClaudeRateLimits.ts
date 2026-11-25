import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { ClaudeRateLimitWindow } from '@/shared/types';

/** The server answers from memory, so a minute is cheap and keeps the figure current between turns. */
const REFRESH_INTERVAL_MS = 60_000;

type RateLimitsResponse = { data?: { windows?: unknown } };

const isWindow = (value: unknown): value is ClaudeRateLimitWindow =>
  Boolean(value) && typeof (value as ClaudeRateLimitWindow).type === 'string';

/**
 * The claude.ai plan windows the Claude CLI last reported, for the sidebar's
 * account block. Refetched every minute and when the tab regains focus; always
 * empty for API-key logins, which have no plan limits.
 */
export function useClaudeRateLimits(enabled: boolean): { windows: ClaudeRateLimitWindow[]; isLoading: boolean } {
  // The windows from the last successful answer; kept across a failed refetch.
  const [windows, setWindows] = useState<ClaudeRateLimitWindow[]>([]);
  // True until the first answer arrives, so the sidebar draws bar skeletons instead of an empty block.
  const [isLoading, setIsLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setWindows([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.providers.claudeRateLimits();
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as RateLimitsResponse;
        const list = Array.isArray(payload.data?.windows) ? payload.data.windows.filter(isWindow) : [];
        if (!cancelled) setWindows(list);
      } catch {
        // Keep the last reading; the next tick retries.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled]);

  return { windows, isLoading };
}
