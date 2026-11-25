import { useEffect } from 'react';
import {
  ArrowUpRight,
  Brain,
  ChevronUp,
  Eye,
  Keyboard,
  Mic,
  Monitor,
  Moon,
  Settings,
  Sun,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { LanguageSelector } from '@/modules/i18n';
import { useProviderAuthStatus } from '@/modules/provider-auth';
import { useTheme } from '@/shared/context/ThemeContext';
import { useSetUiPreference, useUiPreferences } from '@/shared/context/UiPreferencesContext';
import type { ClaudeRateLimitWindow, LLMProvider, PreferenceToggleKey, ProviderAuthStatus, SettingsMainTab } from '@/shared/types';
import { AnchoredPopover, LLMProviderLogo } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { useClaudeRateLimits } from '@/modules/sidebar/hooks/useClaudeRateLimits';

const SOURCE_URL = 'https://github.com/LayeroInfra/cloudcli-ui';

/** Plan windows in the order Claude Code's /usage lists them; unknown ones follow. */
const WINDOW_ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];

/** The window the corner's single ring shows: the long one, which is the budget that runs out for good. */
const RING_WINDOW_TYPE = 'seven_day';

type ThemeOption = { mode: 'light' | 'dark' | 'system'; icon: LucideIcon; labelKey: string; fallback: string };

const THEME_OPTIONS: ThemeOption[] = [
  { mode: 'light', icon: Sun, labelKey: 'appearanceSettings.theme.light', fallback: 'Light' },
  { mode: 'dark', icon: Moon, labelKey: 'appearanceSettings.theme.dark', fallback: 'Dark' },
  { mode: 'system', icon: Monitor, labelKey: 'appearanceSettings.theme.system', fallback: 'System' },
];

type PreferenceRow = { key: PreferenceToggleKey; icon: LucideIcon; labelKey: string };

// The preferences the quick settings drawer used to hold, now in the profile menu.
const PREFERENCE_ROWS: PreferenceRow[] = [
  { key: 'showThinking', icon: Brain, labelKey: 'quickSettings.showThinking' },
  { key: 'showRawParameters', icon: Eye, labelKey: 'quickSettings.showRawParameters' },
  { key: 'sendByCtrlEnter', icon: Keyboard, labelKey: 'quickSettings.sendByCtrlEnter' },
  { key: 'voiceEnabled', icon: Mic, labelKey: 'quickSettings.voiceEnabled' },
];

type SidebarAccountProps = {
  provider: LLMProvider;
  currentVersion: string;
  isCompact: boolean;
  onShowSettings: (tab?: SettingsMainTab) => void;
  t: TFunction;
};

/** "Pro", "Max" — the plan as Claude Code stores it, capitalised for display. */
function formatPlan(plan: string | undefined): string | null {
  if (!plan) return null;
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** The account line itself: the email when the CLI knows one, else how the CLI is signed in. */
function describeAccount(status: ProviderAuthStatus, t: TFunction): string {
  if (!status.authenticated) return t('account.signedOut', { defaultValue: 'Not signed in' });
  if (status.email && status.email.includes('@')) return status.email;
  if (status.method === 'api_key') return t('account.apiKey', { defaultValue: 'API key' });
  return status.email || t('account.signedIn', { defaultValue: 'Signed in' });
}

function windowLabel(type: string, t: TFunction): string {
  switch (type) {
    case 'five_hour': return t('account.limits.fiveHour', { defaultValue: '5h' });
    case 'seven_day': return t('account.limits.week', { defaultValue: 'Week' });
    case 'seven_day_opus': return t('account.limits.weekOpus', { defaultValue: 'Week · Opus' });
    case 'seven_day_sonnet': return t('account.limits.weekSonnet', { defaultValue: 'Week · Sonnet' });
    default: return type.replace(/_/g, ' ');
  }
}

/** "2h 15m", "3d 4h", "12m" until the window resets. */
function formatResetIn(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null;
  const minutes = Math.max(0, Math.round((Date.parse(resetsAt) - now) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function usedPercent(window: ClaudeRateLimitWindow | undefined): number | null {
  if (!window) return null;
  if (window.status === 'rejected') return 100;
  return window.utilization;
}

function toneFor(window: ClaudeRateLimitWindow | undefined): 'ok' | 'warn' | 'over' | 'none' {
  const used = usedPercent(window);
  if (used === null) return 'none';
  if (window?.status === 'rejected' || used >= 90) return 'over';
  if (window?.status === 'allowed_warning' || used >= 70) return 'warn';
  return 'ok';
}

const BAR_TONE = { ok: 'bg-emerald-500', warn: 'bg-amber-500', over: 'bg-red-500', none: 'bg-transparent' };
const RING_TONE = { ok: 'text-emerald-500', warn: 'text-amber-500', over: 'text-red-500', none: 'text-transparent' };

function LimitBar({ window }: { window: ClaudeRateLimitWindow }) {
  const used = usedPercent(window);
  return (
    <span className="relative block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      {used !== null && (
        <span className={cn('absolute inset-y-0 left-0 rounded-full', BAR_TONE[toneFor(window)])} style={{ width: `${Math.max(3, used)}%` }} />
      )}
    </span>
  );
}

/** The corner's progress ring; an unknown figure draws the empty track only. */
function LimitRing({ window }: { window: ClaudeRateLimitWindow | undefined }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const used = usedPercent(window);
  return (
    <svg viewBox="0 0 18 18" className="h-5 w-5 -rotate-90" aria-hidden="true">
      <circle cx="9" cy="9" r={radius} fill="none" strokeWidth="2.5" className="stroke-muted" />
      {used !== null && (
        <circle
          cx="9"
          cy="9"
          r={radius}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          stroke="currentColor"
          className={RING_TONE[toneFor(window)]}
          strokeDasharray={`${(Math.max(2, used) / 100) * circumference} ${circumference}`}
        />
      )}
    </svg>
  );
}

function Switch({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-flex h-4 w-7 flex-shrink-0 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted-foreground/30')}
    >
      <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-background shadow transition-transform', checked ? 'translate-x-3.5' : 'translate-x-0.5')} />
    </span>
  );
}

const MENU_ROW = 'flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent';

/**
 * Rendered by SidebarFooter in the bottom-left corner, like the profile menu
 * of a web platform: a profile button (email, plan) whose menu holds the
 * theme switch, the language, the chat display and input preferences,
 * settings and the edition's source link; and, right of it, one ring for the
 * weekly plan limit whose hover card lists the 5-hour and weekly limits.
 */
export default function SidebarAccount({ provider, currentVersion, isCompact, onShowSettings, t }: SidebarAccountProps) {
  const { t: tSettings } = useTranslation('settings');
  const { providerAuthStatus, checkProviderAuthStatus } = useProviderAuthStatus();
  const status = providerAuthStatus[provider];
  const { themeMode, setThemeMode } = useTheme();
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();

  useEffect(() => {
    void checkProviderAuthStatus(provider);
  }, [checkProviderAuthStatus, provider]);

  // Plan limits exist only for a Claude subscription login.
  const hasPlanLimits = provider === 'claude' && status.authenticated && status.method !== 'api_key';
  const { windows: rawWindows, isLoading: limitsLoading } = useClaudeRateLimits(hasPlanLimits);
  const windows = [...rawWindows].sort((a, b) => {
    const rank = (type: string) => (WINDOW_ORDER.includes(type) ? WINDOW_ORDER.indexOf(type) : WINDOW_ORDER.length);
    return rank(a.type) - rank(b.type);
  });
  const ringWindow = windows.find((window) => window.type === RING_WINDOW_TYPE);
  const plan = formatPlan(status.plan);
  const account = describeAccount(status, t);
  const now = Date.now();

  const ringPercent = usedPercent(ringWindow);
  const ringResetIn = ringWindow ? formatResetIn(ringWindow.resetsAt, now) : null;
  const ringTitle = ringPercent === null
    ? `${windowLabel(RING_WINDOW_TYPE, t)}: ${t('account.limits.unavailable', { defaultValue: 'no data' })}`
    : [
      `${windowLabel(RING_WINDOW_TYPE, t)}: ${Math.round(ringPercent)}%`,
      ringResetIn ? t('account.limits.resetsIn', { time: ringResetIn, defaultValue: 'Resets in {{time}}' }) : null,
    ].filter(Boolean).join(' · ');

  // Voice stays hidden until it is switched on in settings, as in the old drawer.
  const preferenceRows = PREFERENCE_ROWS.filter((row) => row.key !== 'voiceEnabled' || preferences.voiceEnabled);

  // The 5-hour and weekly windows, as the usage card lists them.
  const limitsList = windows.length === 0 ? (
    limitsLoading ? (
      [0, 1].map((row) => <span key={row} className="block h-6 animate-pulse rounded bg-muted" aria-hidden="true" />)
    ) : (
      <div className="text-xs text-muted-foreground">
        {t('account.limits.empty', { defaultValue: 'No data from Claude yet.' })}
      </div>
    )
  ) : windows.map((window) => {
    const resetIn = formatResetIn(window.resetsAt, now);
    const used = usedPercent(window);
    return (
      <div key={window.type} className="space-y-1 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-foreground">{windowLabel(window.type, t)}</span>
          <span className="tabular-nums text-muted-foreground">
            {window.status === 'rejected'
              ? t('account.limits.reached', { defaultValue: 'Limit reached' })
              : used === null ? '—' : `${Math.round(used)}%`}
            {resetIn && ` · ${t('account.limits.resetsIn', { time: resetIn, defaultValue: 'Resets in {{time}}' })}`}
          </span>
        </div>
        <LimitBar window={window} />
      </div>
    );
  });

  return (
    <div className={cn('flex w-full items-center gap-1', isCompact ? 'px-3 py-2' : 'px-2 py-2')}>
      <AnchoredPopover
        side="top"
        align="left"
        className="max-h-[calc(100vh-5rem)] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto"
        rootClassName="min-w-0 flex-1"
        trigger={({ open, toggle }) => (
          // Clicking the profile opens its menu; the usage ring beside it is separate.
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={t('account.label', { defaultValue: 'Account' })}
            className={cn(
              'flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-transparent px-2.5 text-left transition-colors hover:bg-accent/60',
              isCompact ? 'min-h-12 py-2' : 'min-h-11 py-2',
              open && 'border-border bg-accent/60',
            )}
          >
            <LLMProviderLogo provider={provider} className="h-6 w-6 flex-shrink-0" />
            {status.loading ? (
              <span className="block h-3.5 w-40 animate-pulse rounded bg-muted" aria-hidden="true" />
            ) : (
              <span className={cn('flex min-w-0 flex-1 items-center gap-2 text-sm', !status.authenticated && 'text-destructive')}>
                <span className="min-w-0 truncate font-medium">{account}</span>
                {plan && (
                  <span className="flex-shrink-0 rounded bg-primary/10 px-1.5 text-[10px] font-semibold uppercase leading-5 tracking-wide text-primary">
                    {plan}
                  </span>
                )}
              </span>
            )}
            <ChevronUp className={cn('h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform', !open && 'rotate-180')} />
          </button>
        )}
      >
        {(close) => (
          <div className="py-1 text-sm">
            {/* Who */}
            <div className="flex items-center gap-2.5 px-3 pb-2 pt-1.5">
              <LLMProviderLogo provider={provider} className="h-7 w-7 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-foreground">{account}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {[plan, status.organization, status.method === 'api_key' ? t('account.apiKey', { defaultValue: 'API key' }) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  close();
                  onShowSettings();
                }}
                aria-label={t('actions.settings')}
                title={t('actions.settings')}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
            {status.subscriptionOverride && (
              <div className="px-3 pb-2 text-xs text-amber-600 dark:text-amber-400">
                {t('account.keyOverridesLogin', { defaultValue: 'An API key is used instead of the subscription login' })}
              </div>
            )}
            {!status.authenticated && status.error && <div className="px-3 pb-2 text-xs text-destructive">{status.error}</div>}

            {/* Theme */}
            <div className="my-1 h-px bg-border" />
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-foreground">{tSettings('appearanceSettings.theme.label', { defaultValue: 'Theme' })}</span>
              <div role="radiogroup" className="flex rounded-full border border-border bg-muted/60 p-0.5">
                {THEME_OPTIONS.map(({ mode, icon: Icon, labelKey, fallback }) => {
                  const label = tSettings(labelKey, { defaultValue: fallback });
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={themeMode === mode}
                      aria-label={label}
                      title={label}
                      onClick={() => setThemeMode(mode)}
                      className={cn(
                        'flex h-7 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors',
                        themeMode === mode ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  );
                })}
              </div>
            </div>
            <LanguageSelector inline />

            {/* Chat preferences */}
            <div className="my-1 h-px bg-border" />
            {preferenceRows.map(({ key, icon: Icon, labelKey }) => (
              <button
                key={key}
                type="button"
                role="switch"
                aria-checked={preferences[key]}
                onClick={() => setPreference(key, !preferences[key])}
                className={MENU_ROW}
              >
                <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{tSettings(labelKey)}</span>
                <Switch checked={preferences[key]} />
              </button>
            ))}

            {/* Places */}
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={() => {
                close();
                onShowSettings('agents');
              }}
              className={MENU_ROW}
            >
              <UsersRound className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <span className="flex-1">{t('account.manage', { defaultValue: 'Accounts and agents' })}</span>
            </button>
            <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" onClick={close} className={MENU_ROW}>
              <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0 fill-muted-foreground" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <span className="flex-1">{t('account.source', { defaultValue: 'Source code · Layero edition' })}</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
            </a>
            <div className="px-3 pb-1 pt-1.5 text-[10px] text-muted-foreground/70">CloudCLI v{currentVersion}</div>
          </div>
        )}
      </AnchoredPopover>

      {/* Plan usage, right of the profile: hovering (or focusing) it shows the
          5-hour and weekly limits; it opens nothing. */}
      {hasPlanLimits && (
        <div className="group/usage relative flex-shrink-0">
          {limitsLoading && !ringWindow ? (
            <span className="block h-9 w-9 p-2" aria-hidden="true">
              <span className="block h-5 w-5 animate-pulse rounded-full bg-muted" />
            </span>
          ) : (
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={ringTitle}
              aria-label={ringTitle}
              data-testid="account-limit-ring"
            >
              <LimitRing window={ringWindow} />
            </button>
          )}
          <div
            role="tooltip"
            className="pointer-events-none invisible absolute bottom-full right-0 z-50 mb-2 w-64 rounded-lg border border-border bg-popover p-3 text-popover-foreground opacity-0 shadow-lg transition-opacity group-focus-within/usage:visible group-focus-within/usage:opacity-100 group-hover/usage:visible group-hover/usage:opacity-100"
          >
            <div className="mb-2 text-xs font-semibold text-foreground">{t('account.limits.title', { defaultValue: 'Plan usage limits' })}</div>
            <div className="space-y-2.5" data-testid="account-plan-limits">{limitsList}</div>
          </div>
        </div>
      )}
    </div>
  );
}
