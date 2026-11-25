import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';

/** One plan window as the account menu shows it. */
type ClaudeRateLimitWindow = {
  /** The CLI's window id: 'five_hour', 'seven_day', 'seven_day_opus', ... */
  type: string;
  /** 'allowed' | 'allowed_warning' | 'rejected', as the CLI reported it. */
  status: string;
  /** Share of the window used, 0-100, when the CLI reported one. */
  utilization: number | null;
  /** ISO timestamp the window resets at, when known. */
  resetsAt: string | null;
  /** ISO timestamp this reading arrived. */
  observedAt: string;
};

const windows = new Map<string, ClaudeRateLimitWindow>();

/** The plan windows the account usage endpoint reports that the sidebar shows. */
const USAGE_WINDOW_TYPES = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
/** The endpoint is what Claude Code's /usage reads; a minute between calls is plenty for a sidebar meter. */
const USAGE_CACHE_MS = 60_000;
const USAGE_TIMEOUT_MS = 8_000;

type UsageFetcher = (url: string, init: RequestInit) => Promise<Response>;

let usageCache: { at: number; windows: ClaudeRateLimitWindow[] } | null = null;
let usageInFlight: Promise<ClaudeRateLimitWindow[]> | null = null;
let fetchUsage: UsageFetcher = (url, init) => fetch(url, init);
let readAccessToken = readClaudeAccessToken;

/**
 * The live access token of the `claude /login` subscription, or null when
 * there is none or it has expired. An expired token is not refreshed here:
 * the CLI renews it on its next run, and until then the event readings stand.
 */
async function readClaudeAccessToken(): Promise<string | null> {
  try {
    const content = await readFile(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8');
    const oauth = (JSON.parse(content) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } }).claudeAiOauth;
    const token = typeof oauth?.accessToken === 'string' ? oauth.accessToken : '';
    const expiresAt = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : undefined;
    if (!token || (expiresAt !== undefined && Date.now() >= expiresAt)) return null;
    return token;
  } catch {
    return null;
  }
}

/** The usage endpoint's utilization is already a percentage (35.0 = 35 %). */
function readUsagePercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.min(100, Math.round(value * 10) / 10);
}

/** Asks the account usage endpoint for the plan windows; any failure reads as "nothing new". */
async function loadAccountUsage(): Promise<ClaudeRateLimitWindow[]> {
  const token = await readAccessToken();
  if (!token) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);
  try {
    const response = await fetchUsage(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const body = (await response.json()) as Record<string, unknown>;
    const observedAt = new Date().toISOString();
    return USAGE_WINDOW_TYPES.flatMap((type) => {
      const entry = body[type] as { utilization?: unknown; resets_at?: unknown } | null | undefined;
      if (!entry || typeof entry !== 'object') return [];
      const utilization = readUsagePercent(entry.utilization);
      if (utilization === null) return [];
      const resetsAt = typeof entry.resets_at === 'string' && !Number.isNaN(Date.parse(entry.resets_at))
        ? new Date(entry.resets_at).toISOString()
        : null;
      return [{ type, status: utilization >= 100 ? 'rejected' : 'allowed', utilization, resetsAt, observedAt }];
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function getAccountUsage(now: number): Promise<ClaudeRateLimitWindow[]> {
  if (usageCache && now - usageCache.at < USAGE_CACHE_MS) return usageCache.windows;
  usageInFlight ??= loadAccountUsage().finally(() => {
    usageInFlight = null;
  });
  const fetched = await usageInFlight;
  // A failed call keeps the previous answer rather than blanking the meter.
  usageCache = { at: now, windows: fetched.length > 0 ? fetched : usageCache?.windows ?? [] };
  return usageCache.windows;
}

/**
 * The CLI sends `utilization` either as a fraction (0-1) or as a percentage
 * depending on its version; normalise to 0-100.
 */
function toPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const percent = value <= 1 ? value * 100 : value;
  return Math.min(100, Math.round(percent * 10) / 10);
}

/** `resetsAt` arrives in epoch seconds; tolerate milliseconds too. */
function toIso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value < 1e12 ? value * 1000 : value).toISOString();
}

/**
 * Latest claude.ai plan rate-limit readings, kept in memory.
 *
 * The Claude CLI emits a `rate_limit_event` on each request of a subscription
 * session; the Claude runtime records them here. The account usage endpoint
 * (what Claude Code's /usage reads) supplies the same windows on demand, so
 * the sidebar's account block has figures before any turn has run.
 */
export const claudeRateLimitsService = {
  record(info: SDKRateLimitInfo | undefined | null): void {
    if (!info || typeof info !== 'object') return;
    const type = typeof info.rateLimitType === 'string' ? info.rateLimitType : 'unknown';
    const previous = windows.get(type);
    const utilization = toPercent(info.utilization);
    windows.set(type, {
      type,
      status: typeof info.status === 'string' ? info.status : 'allowed',
      // A reading without a figure keeps the last known one for that window.
      utilization: utilization ?? previous?.utilization ?? null,
      resetsAt: toIso(info.resetsAt) ?? previous?.resetsAt ?? null,
      observedAt: new Date().toISOString(),
    });
  },

  /** Every window seen so far, a window whose reset has passed dropped. */
  list(now = Date.now()): ClaudeRateLimitWindow[] {
    for (const [type, window] of windows) {
      if (window.resetsAt && Date.parse(window.resetsAt) <= now) windows.delete(type);
    }
    return [...windows.values()];
  },

  /**
   * The plan windows for the sidebar: the account usage endpoint's figures
   * (cached for a minute), so the 5-hour and weekly limits show right after a
   * restart, with the CLI's own event readings filling any window the
   * endpoint left out. A `rejected` event status outranks the endpoint's.
   */
  async listWithAccountUsage(now = Date.now()): Promise<ClaudeRateLimitWindow[]> {
    const merged = new Map(this.list(now).map((window) => [window.type, window]));
    for (const window of await getAccountUsage(now)) {
      const fromEvents = merged.get(window.type);
      merged.set(window.type, fromEvents?.status === 'rejected' ? { ...window, status: 'rejected' } : window);
    }
    return [...merged.values()];
  },

  /** Test hook: forget every reading and the cached account usage. */
  reset(): void {
    windows.clear();
    usageCache = null;
    usageInFlight = null;
  },

  /** Test hook: replace the network call and the token read. */
  setAccountUsageSource(source: { fetch?: UsageFetcher; readToken?: () => Promise<string | null> } = {}): void {
    fetchUsage = source.fetch ?? ((url, init) => fetch(url, init));
    readAccessToken = source.readToken ?? readClaudeAccessToken;
  },
};
