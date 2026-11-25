import { ChevronRight, CornerDownRight, GitFork } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Project, ProjectSession } from '@/shared/types';
import { useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
import { cn, getSessionTitle } from '@/shared/utils';
import WorkspacePopover from '@/modules/project-workspace/WorkspacePopover';

type WorkspaceSessionLineageProps = {
  selectedProject: Project;
  selectedSession: ProjectSession;
  onOpenSession: (sessionId: string) => void;
};

// Guards the parent walk against a cycle in damaged fork metadata.
const MAX_ANCESTOR_DEPTH = 12;

/**
 * Every session the project knows about by id: its loaded sessions plus the
 * ancestors the backend attached to them, which can sit on pages not loaded yet.
 */
function indexProjectSessions(project: Project): Map<string, ProjectSession> {
  const byId = new Map<string, ProjectSession>();
  for (const session of project.sessions ?? []) {
    byId.set(session.id, session);
    for (const ancestor of session.forkAncestors ?? []) {
      if (!byId.has(ancestor.id)) byId.set(ancestor.id, ancestor);
    }
  }
  return byId;
}

/**
 * Rendered by WorkspaceHeader above the session title: the chain of parent
 * sessions this one was forked from, each one click away, and a menu of the
 * sessions forked from this one, with the busy ones marked.
 */
export default function WorkspaceSessionLineage({ selectedProject, selectedSession, onOpenSession }: WorkspaceSessionLineageProps) {
  const { t } = useTranslation();
  const busySessionIds = useBusySessionIdSet();

  const { ancestors, children } = useMemo(() => {
    const byId = indexProjectSessions(selectedProject);
    const chain: ProjectSession[] = [];
    let parentId = selectedSession.forkedFromSessionId ?? null;
    while (parentId && chain.length < MAX_ANCESTOR_DEPTH) {
      const parent = byId.get(parentId);
      if (!parent || parent.id === selectedSession.id) break;
      chain.unshift(parent);
      parentId = parent.forkedFromSessionId ?? null;
    }
    const forks = (selectedProject.sessions ?? []).filter((session) => session.forkedFromSessionId === selectedSession.id);
    return { ancestors: chain, children: forks };
  }, [selectedProject, selectedSession]);

  if (ancestors.length === 0 && children.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-1 text-[11px] leading-tight text-muted-foreground">
      {ancestors.map((ancestor) => (
        <span key={ancestor.id} className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onOpenSession(ancestor.id)}
            title={t('workspace.lineage.openParent', { defaultValue: 'Open parent session' })}
            className="min-w-0 max-w-[10rem] truncate rounded px-0.5 hover:bg-accent hover:text-foreground"
          >
            {getSessionTitle(ancestor)}
          </button>
          <ChevronRight className="h-3 w-3 flex-shrink-0 opacity-60" />
        </span>
      ))}
      {children.length > 0 && (
        <WorkspacePopover
          trigger={({ open, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              className={cn(
                'flex flex-shrink-0 items-center gap-1 rounded px-1 py-px hover:bg-accent hover:text-foreground',
                open && 'bg-accent text-foreground',
              )}
            >
              <GitFork className="h-3 w-3" />
              {t('workspace.lineage.forks', {
                count: children.length,
                defaultValue_one: '{{count}} fork',
                defaultValue_other: '{{count}} forks',
              })}
              {children.some((child) => busySessionIds.has(child.id)) && (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-500" />
              )}
            </button>
          )}
        >
          {(close) => (
            <div className="max-h-80 overflow-y-auto text-xs">
              <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('workspace.lineage.forksTitle', { defaultValue: 'Forked from this session' })}
              </div>
              {children.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => {
                    close();
                    onOpenSession(child.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent"
                >
                  <CornerDownRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{getSessionTitle(child)}</span>
                  {busySessionIds.has(child.id) && <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-purple-500" />}
                </button>
              ))}
            </div>
          )}
        </WorkspacePopover>
      )}
    </div>
  );
}
