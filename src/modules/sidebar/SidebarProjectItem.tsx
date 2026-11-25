import { memo, useEffect, useRef } from 'react';
import { CheckSquare, ChevronRight, Edit3, Plus, Settings, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ActionMenu } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { LLMProvider, MCPServerStatus, Project, ProjectSession, SessionWithProvider, SidebarSessionSelection } from '@/shared/types';
import { getTaskIndicatorStatus } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import TaskIndicator from '@/modules/sidebar/TaskIndicator';
import SidebarProjectSessions from '@/modules/sidebar/SidebarProjectSessions';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  /** Resolved for this row: only the project being renamed re-renders on a keystroke. */
  isEditing: boolean;
  renameDraft: string;
  includeOffPagePins?: boolean;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  /** The session being renamed, when it belongs to this project. */
  sessionRenameId: string | null;
  sessionRenameDraft: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  onRenameDraftChange: (name: string) => void;
  onToggleProject: (projectId: string) => void;
  onProjectSelect: (project: Project) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectId: string, nextName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  onForkSession?: (session: SessionWithProvider) => void;
  onLoadMoreSessions: (projectId: string) => void;
  activeSessions: ReadonlySet<string>;
  backgroundSessionIds: ReadonlySet<string>;
  attentionSessionIds: ReadonlySet<string>;
  onNewSession: (project: Project) => void;
  onStartEditingSession: (projectId: string, sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  /** The sessions ticked in this project's list, or null when it is not the one selecting. */
  selectedSessionIds: ReadonlySet<string> | null;
  onSetSessionSelection: (selection: SidebarSessionSelection) => void;
  onToggleSessionSelected: (projectId: string, sessionId: string) => void;
  onCancelSessionSelection: () => void;
  onDeleteSelectedSessions: (sessionIds: string[]) => void;
  t: TFunction;
};


/**
 * Rendered by SidebarProjectList for one project row: a minimal expandable name,
 * with "+" (new session in this project) and a settings menu (rename, select
 * sessions, delete) shown on hover, always on touch.
 */
function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  isEditing,
  renameDraft,
  includeOffPagePins = true,
  sessions,
  initialSessionsLoaded,
  isLoadingMoreSessions,
  currentTime,
  sessionRenameId,
  sessionRenameDraft,
  tasksEnabled,
  mcpServerStatus,
  onRenameDraftChange,
  onToggleProject,
  onProjectSelect,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onArchiveSession,
  onDeleteSession,
  onForkSession,
  onLoadMoreSessions,
  activeSessions,
  backgroundSessionIds,
  attentionSessionIds,
  onNewSession,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  selectedSessionIds,
  onSetSessionSelection,
  onToggleSessionSelected,
  onCancelSessionSelection,
  onDeleteSelectedSessions,
  t,
}: SidebarProjectItemProps) {
  // Project identity is tracked by the DB-assigned `projectId` everywhere
  // after the projectName → projectId migration.
  const isSelected = selectedProject?.projectId === project.projectId;
  const taskStatus = getTaskIndicatorStatus(project, mcpServerStatus);
  const mobileRenameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing || !mobileRenameInputRef.current) {
      return;
    }

    let animationFrame = 0;
    const revealInput = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        mobileRenameInputRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    };

    revealInput();
    window.visualViewport?.addEventListener('resize', revealInput);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.visualViewport?.removeEventListener('resize', revealInput);
    };
  }, [isEditing]);

  const isCompact = useCompactSidebar();

  const toggleProject = () => onToggleProject(project.projectId);

  const saveProjectName = () => {
    onSaveProjectName(project.projectId, renameDraft);
  };

  const selectAndToggleProject = () => {
    if (selectedProject?.projectId !== project.projectId) {
      onProjectSelect(project);
    }

    toggleProject();
  };

  const canSelectSessions = initialSessionsLoaded && sessions.length > 0;
  const startNewSession = () => {
    if (selectedProject?.projectId !== project.projectId) onProjectSelect(project);
    if (!isExpanded) toggleProject();
    onNewSession(project);
  };

  return (
    <div className={cn(isDeleting && 'pointer-events-none opacity-50')}>
      <div
        className={cn(
          'group sticky top-0 z-10 flex items-center gap-1 rounded-md bg-background pr-1 transition-colors',
          isCompact ? 'mx-2 min-h-11' : 'min-h-8',
          isSelected ? 'bg-accent' : 'hover:bg-accent/50',
        )}
      >
        {isEditing ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1">
            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <input
              ref={mobileRenameInputRef}
              type="text"
              value={renameDraft}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onBlur={saveProjectName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveProjectName();
                if (event.key === 'Escape') {
                  // Cancelling the rename must not also close the code editor.
                  event.stopPropagation();
                  onCancelEditingProject();
                }
              }}
              placeholder={t('projects.projectNamePlaceholder')}
              aria-label={t('tooltips.renameProject')}
              autoFocus
              autoComplete="off"
              enterKeyHint="done"
              className={cn(
                'min-w-0 flex-1 rounded border border-primary/50 bg-background px-1.5 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary',
                // 16px keeps iOS from zooming into the field.
                isCompact ? 'text-base' : 'text-sm',
              )}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={selectAndToggleProject}
            aria-expanded={isExpanded}
            title={project.fullPath}
            className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-2 text-left"
          >
            <ChevronRight
              className={cn('h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-90')}
            />
            <span className={cn('min-w-0 flex-1 truncate text-sm text-foreground', isSelected && 'font-medium')}>
              {project.displayName}
            </span>
            {tasksEnabled && <TaskIndicator status={taskStatus} size="xs" className="flex-shrink-0" />}
          </button>
        )}

        {!isEditing && (
          <div
            className={cn(
              'flex flex-shrink-0 items-center',
              // Hover reveals the actions on desktop; touch has no hover, so they stay.
              !isCompact && 'opacity-0 focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100',
            )}
          >
            <button
              type="button"
              onClick={startNewSession}
              title={t('sessions.newSession')}
              aria-label={`${t('sessions.newSession')}: ${project.displayName}`}
              className={cn(
                'flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
                isCompact ? 'h-9 w-9' : 'h-7 w-7',
              )}
            >
              <Plus className="h-4 w-4" />
            </button>
            <ActionMenu
              label={t('projects.options', 'Project options')}
              ariaLabel={`${t('projects.options', 'Project options')}: ${project.displayName}`}
              icon={Settings}
              iconOnly
              portal
              variant="ghost"
              size="icon"
              triggerClassName={cn('text-muted-foreground hover:bg-muted hover:text-foreground', isCompact ? 'h-9 w-9' : 'h-7 w-7')}
              menuClassName="w-56 rounded-xl p-1.5 shadow-xl"
              header={(
                <div className="mb-1 border-b border-border px-3 py-2">
                  <p className="truncate text-xs font-medium text-foreground">{project.displayName}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={project.fullPath}>{project.fullPath}</p>
                </div>
              )}
              items={[
                {
                  key: 'rename',
                  label: t('tooltips.renameProject'),
                  icon: Edit3,
                  onSelect: () => onStartEditingProject(project),
                },
                ...(canSelectSessions ? [{
                  key: 'select',
                  label: t('sessions.select'),
                  icon: CheckSquare,
                  onSelect: () => {
                    if (!isExpanded) toggleProject();
                    onSetSessionSelection({ projectId: project.projectId, sessionIds: new Set<string>() });
                  },
                }] : []),
                {
                  key: 'delete',
                  label: t('tooltips.deleteProject'),
                  icon: Trash2,
                  isDanger: true,
                  showDividerBefore: true,
                  onSelect: () => onDeleteProject(project),
                },
              ]}
            />
          </div>
        )}
      </div>

      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        includeOffPagePins={includeOffPagePins}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        hasMoreSessions={Boolean(project.sessionMeta?.hasMore)}
        isLoadingMoreSessions={isLoadingMoreSessions}
        activeSessions={activeSessions}
        backgroundSessionIds={backgroundSessionIds}
        attentionSessionIds={attentionSessionIds}
        currentTime={currentTime}
        sessionRenameId={sessionRenameId}
        sessionRenameDraft={sessionRenameDraft}
        onRenameDraftChange={onRenameDraftChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        onArchiveSession={onArchiveSession}
        onDeleteSession={onDeleteSession}
        onForkSession={onForkSession}
        onLoadMoreSessions={onLoadMoreSessions}
        selectedSessionIds={selectedSessionIds}
        onSetSessionSelection={onSetSessionSelection}
        onToggleSessionSelected={onToggleSessionSelected}
        onCancelSessionSelection={onCancelSessionSelection}
        onDeleteSelectedSessions={onDeleteSelectedSessions}
        t={t}
      />
    </div>
  );
}

/**
 * Memoized: a websocket session delta re-renders the sidebar roughly every
 * 0.5-2s during a run, and a rename keystroke re-renders it per character.
 *
 * Both renames are resolved to scalars by SidebarProjectList and the sorted
 * session array is cached per project, so a keystroke changes props on exactly
 * one row and every other row's compare succeeds. See sidebarRowProps.test.tsx.
 */
export default memo(SidebarProjectItem);
