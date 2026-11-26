import { Ban, Check, ChevronRight, Clock, Hammer, Loader2, Play, RefreshCw, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import type { WorkspaceBuild, WorkspaceBuildDetail } from '@/shared/types';
import { cn } from '@/shared/utils';
import { ACTIVE_BUILD_STATUSES } from '@/modules/project-workspace/hooks/useWorkspaceBuilds';

type WorkspaceBuildsPanelProps = {
  open: boolean;
  onClose: () => void;
  builds: WorkspaceBuild[];
  error: string | null;
  isLoading: boolean;
  isTriggering: boolean;
  onTrigger: () => void;
  onRefresh: () => void;
};

type StatusLook = { icon: LucideIcon; className: string; label: string; spin?: boolean };

const STATUS_LOOK: Record<string, StatusLook> = {
  pending: { icon: Clock, className: 'text-amber-500', label: 'Queued' },
  blocked: { icon: Clock, className: 'text-amber-500', label: 'Waiting for approval' },
  running: { icon: Loader2, className: 'text-blue-500', label: 'Running', spin: true },
  success: { icon: Check, className: 'text-emerald-600 dark:text-emerald-400', label: 'Passed' },
  failure: { icon: X, className: 'text-red-500', label: 'Failed' },
  error: { icon: X, className: 'text-red-500', label: 'Error' },
  killed: { icon: Ban, className: 'text-muted-foreground', label: 'Cancelled' },
};
const UNKNOWN_LOOK: StatusLook = { icon: Clock, className: 'text-muted-foreground', label: '' };

const lookFor = (status: string): StatusLook => STATUS_LOOK[status] ?? { ...UNKNOWN_LOOK, label: status };

/** A queued build no agent has taken after this long most likely means the owner's Mac is offline. */
export const STALE_PENDING_MS = 2 * 60_000;

const isStalePending = (build: WorkspaceBuild, now: number): boolean =>
  build.status === 'pending' && !!build.createdAt && now - Date.parse(build.createdAt) > STALE_PENDING_MS;

/** "12s", "3m 05s" between two ISO times, or from the start until now. */
function formatDuration(start: string | null, end: string | null, now: number): string | null {
  if (!start) return null;
  const seconds = Math.max(0, Math.round(((end ? Date.parse(end) : now) - Date.parse(start)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** "14:32" today, else "25 Nov 14:32". */
function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function StatusIcon({ status }: { status: string }) {
  const look = lookFor(status);
  const Icon = look.icon;
  return <Icon className={cn('h-4 w-4 flex-shrink-0', look.className, look.spin && 'animate-spin')} aria-hidden="true" />;
}

/** The steps and log tail of one build, refetched every 3 s while it is still active. */
function BuildDetail({ number, active }: { number: number; active: boolean }) {
  const { t } = useTranslation();
  // The last detail answer; null until the first one arrives.
  const [detail, setDetail] = useState<WorkspaceBuildDetail | null>(null);
  // Why the detail could not be read, if it could not.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await api.workspaceBuilds.get(number);
        const payload = (await response.json().catch(() => null)) as { data?: WorkspaceBuildDetail } | null;
        if (cancelled) return;
        if (response.ok && payload?.data) {
          setDetail(payload.data);
          setError(null);
        } else {
          setError(t('workspace.builds.detailUnavailable', { defaultValue: 'Could not load this build.' }));
        }
      } catch {
        if (!cancelled) setError(t('workspace.builds.detailUnavailable', { defaultValue: 'Could not load this build.' }));
      }
      if (!cancelled && active) timer = window.setTimeout(load, 3000);
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [number, active, t]);

  if (error) return <p className="px-3 pb-3 text-xs text-destructive">{error}</p>;
  if (!detail) return <div className="mx-3 mb-3 h-16 animate-pulse rounded-md bg-muted" aria-hidden="true" />;

  const logStep = detail.steps.find((step) => step.id === detail.logStepId);
  return (
    <div className="space-y-2 px-3 pb-3" data-testid={`build-detail-${number}`}>
      {detail.steps.length > 0 && (
        <ul className="space-y-1">
          {detail.steps.map((step) => (
            <li key={step.id} className="flex items-center gap-2 text-xs">
              <StatusIcon status={step.state} />
              <span className="min-w-0 flex-1 truncate font-mono">{step.name}</span>
              {step.exitCode !== null && step.exitCode !== 0 && (
                <span className="text-red-500">{t('workspace.builds.exitCode', { code: step.exitCode, defaultValue: 'exit {{code}}' })}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {detail.logTail.length > 0 ? (
        <div>
          {logStep && <div className="mb-1 text-[11px] text-muted-foreground">{t('workspace.builds.logOf', { step: logStep.name, defaultValue: 'Log · {{step}}' })}</div>}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
            {detail.logTail.join('\n')}
          </pre>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {ACTIVE_BUILD_STATUSES.has(detail.status)
            ? t('workspace.builds.noLogYet', { defaultValue: 'No log yet: waiting for your Mac to pick the build up.' })
            : t('workspace.builds.noLog', { defaultValue: 'No log.' })}
        </p>
      )}
    </div>
  );
}

/**
 * Rendered by WorkspaceMain as a floating card over the chat, stacked with
 * the background-tasks card when both are open: the signed-in user's
 * builds of the CloudUI checks pipeline — queued, running, passed or failed —
 * with a button to start one on their Mac. Unfolding a build shows its steps
 * and the tail of its log; a failed one unfolds by itself.
 */
export default function WorkspaceBuildsPanel({ open, onClose, builds, error, isLoading, isTriggering, onTrigger, onRefresh }: WorkspaceBuildsPanelProps) {
  const { t } = useTranslation();
  // Which builds are unfolded; the newest failure starts unfolded.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Ticks each second while a build runs, so its duration counts up.
  const [now, setNow] = useState(() => Date.now());
  const hasActive = builds.some((build) => ACTIVE_BUILD_STATUSES.has(build.status));
  const hasStalePending = builds.some((build) => isStalePending(build, now));
  const newestFailure = builds[0] && (builds[0].status === 'failure' || builds[0].status === 'error') ? builds[0].number : null;

  useEffect(() => {
    if (newestFailure !== null) setExpanded((previous) => (previous.has(newestFailure) ? previous : new Set(previous).add(newestFailure)));
  }, [newestFailure]);

  useEffect(() => {
    if (!open || !hasActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, hasActive]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (number: number) => setExpanded((previous) => {
    const next = new Set(previous);
    if (!next.delete(number)) next.add(number);
    return next;
  });

  return (
    <aside
      aria-label={t('workspace.builds.title', { defaultValue: 'Builds' })}
      className="pointer-events-auto flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
    >
      <div className="flex h-10 flex-shrink-0 items-center gap-1 border-b border-border px-3">
        <Hammer className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="ml-1 flex-1 text-sm font-semibold">{t('workspace.builds.title', { defaultValue: 'Builds' })}</h2>
        <button
          type="button"
          onClick={onTrigger}
          disabled={isTriggering}
          className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {isTriggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {t('workspace.builds.run', { defaultValue: 'Run checks' })}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          aria-label={t('workspace.builds.refresh', { defaultValue: 'Refresh' })}
          title={t('workspace.builds.refresh', { defaultValue: 'Refresh' })}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('workspace.close', { defaultValue: 'Close' })}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && (
          <p role="alert" className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        )}
        {hasStalePending && (
          <p className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300" data-testid="builds-stale-pending">
            {t('workspace.builds.stalePending', { defaultValue: 'A build has been queued for over 2 minutes: your Mac has not picked it up. Is Layero Workspace running there?' })}
          </p>
        )}
        {isLoading ? (
          [0, 1, 2].map((row) => <div key={row} className="mb-1 h-12 animate-pulse rounded-lg bg-muted" aria-hidden="true" />)
        ) : builds.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 px-6 py-5 text-center">
            <p className="text-sm font-medium text-foreground">{t('workspace.builds.emptyTitle', { defaultValue: 'No builds yet' })}</p>
            <p className="text-xs text-muted-foreground">
              {t('workspace.builds.emptyHint', { defaultValue: 'Run the checks here or ask the agent to; they run on your Mac and show up in this list.' })}
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {builds.map((build) => {
              const look = lookFor(build.status);
              const active = ACTIVE_BUILD_STATUSES.has(build.status);
              const duration = formatDuration(build.startedAt, build.finishedAt, now);
              const isOpen = expanded.has(build.number);
              return (
                <li key={build.number} className="rounded-lg border border-border/70" data-build-status={build.status}>
                  <button
                    type="button"
                    onClick={() => toggle(build.number)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-accent/50"
                  >
                    <StatusIcon status={build.status} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm">
                        <span className="font-medium text-foreground">#{build.number}</span>
                        {build.title && <span className="min-w-0 truncate text-foreground/90">{build.title}</span>}
                        {build.job === 'deploy' && (
                          <span className="rounded border border-border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {t('workspace.builds.deploy', { defaultValue: 'Deploy' })}
                          </span>
                        )}
                        <span className={cn('flex-shrink-0 text-xs', look.className)}>{look.label}</span>
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[build.branch, formatWhen(build.createdAt), duration && (active ? `${duration}…` : duration)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <ChevronRight className={cn('h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} aria-hidden="true" />
                  </button>
                  {isOpen && <BuildDetail number={build.number} active={active} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
