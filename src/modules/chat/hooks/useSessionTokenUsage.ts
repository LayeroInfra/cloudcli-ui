import { useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';

/** The context-window figures the composer's meter draws. */
type SessionTokenUsage = {
  used: number;
  total: number | null;
};

type TokenUsageResponse = {
  success?: boolean;
  data?: { used?: unknown; total?: unknown; unsupported?: unknown };
};

const readCount = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * Used by chat's ComposerContextMeter: fetches the session's context-window
 * usage. Refetches whenever `refreshKey` changes — the caller bumps it when
 * the session's turn settles — so the meter moves after every reply without
 * polling. `isLoading` is true only until the first answer for a session, so
 * the meter shows a skeleton instead of a fake zero.
 */
export function useSessionTokenUsage(sessionId: string | null, refreshKey: unknown) {
  // The last answer for the current session; null while none has arrived or the provider has no figure.
  const [usage, setUsage] = useState<SessionTokenUsage | null>(null);
  // Whether the first fetch for this session is still in flight; drives the skeleton.
  const [isLoading, setIsLoading] = useState(false);
  const loadedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      loadedSessionRef.current = null;
      setUsage(null);
      setIsLoading(false);
      return;
    }

    const isNewSession = loadedSessionRef.current !== sessionId;
    if (isNewSession) {
      setUsage(null);
      setIsLoading(true);
    }

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.providers.sessionTokenUsage(sessionId);
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setUsage(null);
          return;
        }
        const payload = (await response.json()) as TokenUsageResponse;
        if (controller.signal.aborted) return;
        const data = payload.data;
        if (!data || data.unsupported) {
          setUsage(null);
          return;
        }
        const total = readCount(data.total);
        setUsage({ used: readCount(data.used), total: total || null });
      } catch {
        if (!controller.signal.aborted) setUsage(null);
      } finally {
        if (!controller.signal.aborted) {
          loadedSessionRef.current = sessionId;
          setIsLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [sessionId, refreshKey]);

  return { usage, isLoading };
}
