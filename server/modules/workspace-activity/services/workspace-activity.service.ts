import { chatRunRegistry, countOpenTerminals } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/types.js';

/** What a deploy needs to know before it restarts the server. */
export type WorkspaceActivity = {
  /** Agent turns running now (chat, scheduled, REST); a restart cuts each off mid-turn. */
  activeRuns: Array<{ sessionId: string; provider: LLMProvider; startedAt: string }>;
  /** Terminal processes the server keeps; a restart closes them all. */
  openTerminals: number;
  /** The deploy may restart now without cutting off an agent. */
  quiet: boolean;
};

type ActivitySources = {
  listRunningRuns: () => Array<{ sessionId: string; provider: LLMProvider; startedAt: number }>;
  countOpenTerminals: () => number;
};

const defaultSources: ActivitySources = {
  listRunningRuns: () => chatRunRegistry.listRunningRuns(),
  countOpenTerminals,
};

/**
 * Used by the Workspace Activity route, which workspace-promote-release asks
 * before it restarts the server (A7: deploy only when no agent is mid-turn).
 * Only agent turns decide `quiet`; open terminals are reported, not waited
 * for — a terminal can stay open for days.
 */
export function readWorkspaceActivity(sources: ActivitySources = defaultSources): WorkspaceActivity {
  const activeRuns = sources.listRunningRuns().map((run) => ({
    sessionId: run.sessionId,
    provider: run.provider,
    startedAt: new Date(run.startedAt).toISOString(),
  }));
  return { activeRuns, openTerminals: sources.countOpenTerminals(), quiet: activeRuns.length === 0 };
}
