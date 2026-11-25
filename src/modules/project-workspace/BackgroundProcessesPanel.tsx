import { Bot, Check, ChevronRight, Loader2, Square, SquareTerminal, Workflow, X, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProcessingSessions } from '@/shared/context/SessionProtectionContext';
import type { BackgroundTaskStatus, BackgroundTaskSummary, Project, ProjectSession, SessionActivity, SessionBackgroundTask } from '@/shared/types';
import { cn, getSessionTitle } from '@/shared/utils';

type BackgroundProcessesPanelProps = {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  activeSessionId: string | null;
  /** The open session's background tasks, finished ones included, newest first. */
  sessionTasks: SessionBackgroundTask[];
  sendMessage: (message: unknown) => void;
  onOpenSession: (sessionId: string) => void;
};

type TaskKind = { icon: LucideIcon; labelKey: string; fallback: string };

const TASK_KINDS: Record<string, TaskKind> = {
  local_workflow: { icon: Workflow, labelKey: 'workspace.background.kindWorkflow', fallback: 'Workflow' },
  local_bash: { icon: SquareTerminal, labelKey: 'workspace.background.kindCommand', fallback: 'Command' },
  local_agent: { icon: Bot, labelKey: 'workspace.background.kindAgent', fallback: 'Agent' },
};

const SESSION_TASK_ICONS: Record<SessionBackgroundTask['kind'], LucideIcon> = {
  command: SquareTerminal,
  agent: Bot,
  workflow: Workflow,
};

/** The status mark at the start of a task row, as Claude Code's task list draws it. */
function StatusMark({ status }: { status: BackgroundTaskStatus }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-purple-500 dark:text-purple-400" aria-hidden="true" />;
  if (status === 'completed') return <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
  if (status === 'failed') return <X className="h-3.5 w-3.5 flex-shrink-0 text-red-500" aria-hidden="true" />;
  return <Square className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/** One background task of the open session; expands to show what it reported. */
function SessionTaskRow({ task, now, onStop }: { task: SessionBackgroundTask; now: number; onStop?: () => void }) {
  const { t } = useTranslation();
  // Whether the task's report is unfolded under the row.
  const [expanded, setExpanded] = useState(false);
  const KindIcon = SESSION_TASK_ICONS[task.kind];
  const statusLabel = t(`workspace.background.status.${task.status}`, {
    defaultValue: { running: 'Running', completed: 'Done', failed: 'Failed', stopped: 'Stopped' }[task.status],
  });
  const hasResult = Boolean(task.result);
  return (
    <li className="border-b border-border/50 last:border-b-0" data-task-status={task.status}>
      <div className="flex items-center gap-2 px-2.5 py-2 text-xs">
        <button
          type="button"
          onClick={() => hasResult && setExpanded((value) => !value)}
          aria-expanded={hasResult ? expanded : undefined}
          disabled={!hasResult}
          className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:cursor-default"
        >
          <span className="mt-0.5"><StatusMark status={task.status} /></span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <KindIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate font-medium text-foreground" title={task.title}>{task.title}</span>
            </span>
            {task.detail && <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground" title={task.detail}>{task.detail}</span>}
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {statusLabel}
              {task.status === 'running' ? ` · ${formatElapsed(task.startedAt, now)}` : ''}
            </span>
          </span>
          {hasResult && <ChevronRight className={cn('mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} aria-hidden="true" />}
        </button>
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            title={t('workspace.background.stop', { defaultValue: 'Stop' })}
            aria-label={t('workspace.background.stop', { defaultValue: 'Stop' })}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
          >
            <Square className="h-3 w-3" />
          </button>
        )}
      </div>
      {expanded && task.result && (
        <pre className={cn(
          'mx-2.5 mb-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed',
          task.isError ? 'text-red-600 dark:text-red-400' : 'text-foreground/90',
        )}
        >
          {task.result}
        </pre>
      )}
    </li>
  );
}

/** "42s", "3m 05s", "1h 12m" — how long a process has been running. */
function formatElapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Finds a session by id across every loaded project, ancestors included. */
function indexSessions(projects: Project[]): Map<string, { session: ProjectSession; project: Project }> {
  const byId = new Map<string, { session: ProjectSession; project: Project }>();
  for (const project of projects) {
    for (const session of project.sessions ?? []) {
      byId.set(session.id, { session, project });
      for (const ancestor of session.forkAncestors ?? []) {
        if (!byId.has(ancestor.id)) byId.set(ancestor.id, { session: ancestor, project });
      }
    }
  }
  return byId;
}

/**
 * Counts what the header's background button shows: every background task
 * of every busy session, plus each session that is producing a reply.
 */
export function countRunningProcesses(activity: ReadonlyMap<string, SessionActivity>): number {
  let count = 0;
  for (const entry of activity.values()) {
    count += (entry.tasks?.length ?? 0) + (entry.background ? 0 : 1);
  }
  return count;
}

/**
 * Rendered by WorkspaceMain as a floating card over the chat, like Claude
 * Code's task list (stacked with the builds card when both are open): first every background task of the open session — commands, agents
 * and workflows, running or finished — with its status and, unfolded, what it
 * reported; then what other sessions are running, each with a jump to it.
 */
export default function BackgroundProcessesPanel({
  open,
  onClose,
  projects,
  activeSessionId,
  sessionTasks,
  sendMessage,
  onOpenSession,
}: BackgroundProcessesPanelProps) {
  const { t } = useTranslation();
  const activity = useProcessingSessions();
  const sessionsById = useMemo(() => indexSessions(projects), [projects]);
  // Ticks once a second while the drawer is open so elapsed times count up.
  const [now, setNow] = useState(() => Date.now());

  const hasRunningSessionTask = sessionTasks.some((task) => task.status === 'running');
  useEffect(() => {
    if (!open || (activity.size === 0 && !hasRunningSessionTask)) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, activity.size, hasRunningSessionTask]);

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

  // The open session's work is listed by its tasks above; the rest, longest-running first.
  const entries = [...activity.entries()]
    .filter(([sessionId]) => sessionId !== activeSessionId)
    .sort(([, a], [, b]) => a.startedAt - b.startedAt);
  const hasSessionTasks = Boolean(activeSessionId) && sessionTasks.length > 0;
  const sectionHeadingClass = 'px-1 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

  const stopTask = (sessionId: string, task: BackgroundTaskSummary) => {
    sendMessage({ type: 'chat.stop-task', sessionId, taskId: task.taskId });
  };

  return (
    <aside
      aria-label={t('workspace.background.title', { defaultValue: 'Background tasks' })}
      className="pointer-events-auto flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
    >
      <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="flex-1 text-sm font-semibold">{t('workspace.background.title', { defaultValue: 'Background tasks' })}</h2>
        <kbd className="hidden rounded border border-border px-1 text-[10px] text-muted-foreground sm:inline">Ctrl+Shift+J</kbd>
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
        {hasSessionTasks && (
          <section className="mb-3">
            <h3 className={sectionHeadingClass}>{t('workspace.background.thisSession', { defaultValue: 'This session' })}</h3>
            <ul className="rounded-lg border border-border/70">
              {sessionTasks.map((task) => (
                <SessionTaskRow
                  key={task.toolId}
                  task={task}
                  now={now}
                  onStop={task.status === 'running' && task.taskId && activeSessionId
                    ? () => sendMessage({ type: 'chat.stop-task', sessionId: activeSessionId, taskId: task.taskId })
                    : undefined}
                />
              ))}
            </ul>
          </section>
        )}
        {entries.length > 0 && hasSessionTasks && (
          <h3 className={sectionHeadingClass}>{t('workspace.background.otherSessions', { defaultValue: 'Other sessions' })}</h3>
        )}
        {entries.length === 0 && !hasSessionTasks ? (
          <div className="flex flex-col items-center justify-center gap-1 px-6 py-5 text-center">
            <p className="text-sm font-medium text-foreground">{t('workspace.background.emptyTitle', { defaultValue: 'Nothing is running' })}</p>
            <p className="text-xs text-muted-foreground">
              {t('workspace.background.emptyHint', { defaultValue: 'Agents, workflows and commands the sessions start in the background show up here.' })}
            </p>
          </div>
        ) : (
          entries.map(([sessionId, entry]) => {
            const known = sessionsById.get(sessionId);
            const title = known ? getSessionTitle(known.session) : sessionId.slice(0, 8);
            return (
              <section key={sessionId} className={cn('mb-2 rounded-lg border border-border/70', sessionId === activeSessionId && 'border-primary/40')}>
                <button
                  type="button"
                  onClick={() => onOpenSession(sessionId)}
                  className="flex w-full items-center gap-2 rounded-t-lg px-2.5 py-2 text-left hover:bg-accent/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-foreground">{title}</span>
                    {known && <span className="block truncate text-[11px] text-muted-foreground">{known.project.displayName}</span>}
                  </span>
                  {sessionId === activeSessionId && (
                    <span className="flex-shrink-0 rounded bg-primary/10 px-1 text-[10px] font-medium text-primary">
                      {t('workspace.background.current', { defaultValue: 'open' })}
                    </span>
                  )}
                </button>

                <ul className="border-t border-border/60">
                  {!entry.background && (
                    <li className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                      <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-emerald-500" />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {entry.statusText || t('workspace.background.replying', { defaultValue: 'Writing a reply' })}
                      </span>
                      <span className="flex-shrink-0 tabular-nums text-muted-foreground">{formatElapsed(entry.startedAt, now)}</span>
                      {entry.canInterrupt && (
                        <button
                          type="button"
                          onClick={() => sendMessage({ type: 'chat.abort', sessionId })}
                          title={t('workspace.background.interrupt', { defaultValue: 'Interrupt' })}
                          aria-label={t('workspace.background.interrupt', { defaultValue: 'Interrupt' })}
                          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                        >
                          <Square className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  )}
                  {(entry.tasks ?? []).map((task) => {
                    const kind = TASK_KINDS[task.taskType] ?? TASK_KINDS.local_agent;
                    const KindIcon = kind.icon;
                    const name = task.workflowName || task.description;
                    return (
                      <li key={task.taskId} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                        <KindIcon className="h-3.5 w-3.5 flex-shrink-0 text-purple-500 dark:text-purple-400" />
                        <span className="min-w-0 flex-1" title={name}>
                          <span className="font-medium text-foreground">{t(kind.labelKey, { defaultValue: kind.fallback })}</span>
                          {name && <span className="ml-1 text-muted-foreground">{name}</span>}
                          {task.nested && (
                            <span className="ml-1 text-[10px] text-muted-foreground/70">
                              {t('workspace.background.nested', { defaultValue: '(started by an agent)' })}
                            </span>
                          )}
                        </span>
                        <span className="flex-shrink-0 tabular-nums text-muted-foreground">{formatElapsed(task.startedAt, now)}</span>
                        <button
                          type="button"
                          onClick={() => stopTask(sessionId, task)}
                          title={t('workspace.background.stop', { defaultValue: 'Stop' })}
                          aria-label={t('workspace.background.stop', { defaultValue: 'Stop' })}
                          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </aside>
  );
}
