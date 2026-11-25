import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Shimmer } from '@/shared/ui';
import type { BackgroundTaskSummary, CurrentAgentAction, SessionActivity } from '@/shared/types';
import { describeBackgroundTask, ownBackgroundTasks } from '@/modules/chat/utils/backgroundTasks';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
  /** What the turn is doing now, read from the transcript; falls back to a generic word. */
  action?: CurrentAgentAction | null;
};

const ACTION_KEYS = [
  'claudeStatus.actions.thinking',
  'claudeStatus.actions.processing',
  'claudeStatus.actions.analyzing',
  'claudeStatus.actions.working',
  'claudeStatus.actions.computing',
  'claudeStatus.actions.reasoning',
];
const DEFAULT_ACTION_WORDS = ['Thinking', 'Processing', 'Analyzing', 'Working', 'Computing', 'Reasoning'];
const EXIT_ANIMATION_MS = 220;

/** What the background work is: the one task by kind and name, or how many when there are several. */
function describeBackgroundTasks(allTasks: BackgroundTaskSummary[], t: TFunction): string {
  const tasks = ownBackgroundTasks(allTasks);
  return tasks.length === 1
    ? describeBackgroundTask(tasks[0], t)
    : t('claudeStatus.backgroundTask.count', { count: tasks.length, defaultValue: '{{count}} tasks' });
}

/**
 * The status line at the top of the composer card while the viewed session
 * works, as in Claude Code: what the agent is doing right now ("Running npm
 * test", "Editing ChatComposer.tsx"), how long the turn has run and that Esc
 * interrupts it. Stopping is the composer's send button, which turns into ■
 * while a turn runs, so the line itself has no Stop.
 *
 * A session whose turn has ended while the tasks it launched still run is
 * drawn in the workflow and agent cards' purple, naming the work.
 *
 * Rendered by chat's ChatComposer inside its PromptInput, above the textarea.
 */
export default function ActivityIndicator({ activity, action = null }: ActivityIndicatorProps) {
  const { t } = useTranslation('chat');
  // The last non-null activity, kept for the exit fade after the turn ends.
  const [renderedActivity, setRenderedActivity] = useState<SessionActivity | null>(activity);
  // Whether the line is fading out after its activity went away.
  const [isExiting, setIsExiting] = useState(false);
  const startedAt = renderedActivity?.startedAt ?? null;
  // Seconds since the turn (or the oldest background task) started; ticks every second.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (activity) {
      setRenderedActivity(activity);
      setIsExiting(false);
      return;
    }

    if (!renderedActivity) return;

    setIsExiting(true);
    const timer = setTimeout(() => {
      setRenderedActivity(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);

    return () => clearTimeout(timer);
  }, [activity, renderedActivity]);

  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!renderedActivity) return null;

  const isBackground = Boolean(renderedActivity.background);
  const actionWords = ACTION_KEYS.map((key, i) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[i] }));
  // A provider's own status text wins; then what the transcript says is
  // happening; only with neither does the line cycle generic words.
  const label = isBackground
    ? t('claudeStatus.backgroundWork', 'Background work')
    : (renderedActivity.statusText
      || (action ? t(`claudeStatus.now.${action.verb}`, { defaultValue: action.defaultVerb }) : null)
      || actionWords[Math.floor(elapsedSeconds / 4) % actionWords.length])
      .replace(/\.+$/, '');
  const detail = isBackground
    ? describeBackgroundTasks(renderedActivity.tasks ?? [], t)
    : (!renderedActivity.statusText && action?.target) || '';

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const elapsedLabel = minutes < 1
    ? t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' })
    : t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' });

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex min-w-0 items-center gap-2 px-4 pt-2.5 text-xs ${isExiting ? 'chat-activity-exit' : 'chat-activity-enter'}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 animate-pulse rounded-full ${
          isBackground ? 'bg-purple-500 dark:bg-purple-400' : 'bg-primary'
        }`}
        aria-hidden
      />
      <Shimmer className="shrink-0 font-medium">{`${label}…`}</Shimmer>
      {detail && (
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={detail}>{detail}</span>
      )}
      <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/70">
        {elapsedLabel}
        {renderedActivity.canInterrupt && !isBackground && (
          <span className="hidden sm:inline">
            {' · '}
            {t('claudeStatus.escToInterrupt', { defaultValue: 'esc to interrupt' })}
          </span>
        )}
      </span>
    </div>
  );
}
