import { useTranslation } from 'react-i18next';

import { cn, formatTokenCount } from '@/shared/utils';
import { useSessionTokenUsage } from '@/modules/chat/hooks/useSessionTokenUsage';

type ComposerContextMeterProps = {
  sessionId: string | null;
  /** Changes whenever the session's turn settles, so the meter refetches after each reply. */
  refreshKey: unknown;
};

/**
 * Rendered by chat's ChatComposer in its bottom row: how much of the session's
 * context window is used, as a small bar and a figure, coloured amber past
 * 70 % and red past 90 % so a session nearing compaction is obvious at a glance.
 */
export default function ComposerContextMeter({ sessionId, refreshKey }: ComposerContextMeterProps) {
  const { t } = useTranslation();
  const { usage, isLoading } = useSessionTokenUsage(sessionId, refreshKey);

  if (!sessionId) return null;

  if (isLoading) {
    return (
      <div className="flex h-8 items-center gap-1.5 px-1.5" aria-busy="true" aria-label={t('workspace.usage.loading', { defaultValue: 'Loading usage' })}>
        <span className="h-1 w-10 animate-pulse rounded-full bg-muted" />
        <span className="h-3 w-12 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!usage) return null;

  // A used figure past the window means the window is stale (e.g. a 1M model
  // read as the 160K default); the bar then shows full rather than overflow.
  const ratio = usage.total ? Math.min(1, usage.used / usage.total) : null;
  const percent = ratio === null ? null : Math.round(ratio * 100);
  const tone = ratio === null ? 'bg-primary' : ratio >= 0.9 ? 'bg-red-500' : ratio >= 0.7 ? 'bg-amber-500' : 'bg-emerald-500';
  const title = usage.total
    ? t('workspace.usage.title', {
      used: usage.used.toLocaleString(),
      total: usage.total.toLocaleString(),
      percent,
      defaultValue: 'Context: {{used}} of {{total}} tokens ({{percent}}%)',
    })
    : t('workspace.usage.titleNoLimit', { used: usage.used.toLocaleString(), defaultValue: 'Context: {{used}} tokens' });

  return (
    <div className="flex h-8 items-center gap-1.5 px-1.5 text-[11px]" title={title} aria-label={title}>
      {ratio !== null && (
        <span className="relative h-1 w-10 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span className={cn('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: `${Math.max(2, ratio * 100)}%` }} />
        </span>
      )}
      <span className="whitespace-nowrap tabular-nums text-muted-foreground">
        <span className="text-foreground/80">{formatTokenCount(usage.used)}</span>
        {usage.total ? ` / ${formatTokenCount(usage.total)}` : ''}
      </span>
    </div>
  );
}
