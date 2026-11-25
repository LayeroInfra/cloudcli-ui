import type { TFunction } from 'i18next';

import { SquarePen } from 'lucide-react';

import { ScrollArea } from '@/shared/ui';
import type { Project, SidebarProjectListProps, SettingsMainTab } from '@/shared/types';
import SidebarFooter from '@/modules/sidebar/SidebarFooter';
import SidebarHeader from '@/modules/sidebar/SidebarHeader';
import SidebarProjectList from '@/modules/sidebar/SidebarProjectList';
import SidebarPinnedSessions from '@/modules/sidebar/SidebarPinnedSessions';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projects: Project[];
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  restartRequired: boolean;
  currentVersion: string;
  onShowSettings: (tab?: SettingsMainTab) => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

/**
 * Rendered by Sidebar for the expanded panel. One view only: projects
 * (workspaces), each holding its sessions as a parent/fork tree — no separate
 * conversations, running or archive tabs.
 */
/** The project with the most recent session activity, else the first listed. */
function pickLastActiveProject(projects: Project[]): Project | null {
  let best: Project | null = null;
  let bestTime = -Infinity;
  for (const project of projects) {
    const time = Math.max(0, ...(project.sessions ?? []).map((session) => Date.parse(String(session.lastActivity ?? '')) || 0));
    if (time > bestTime) {
      best = project;
      bestTime = time;
    }
  }
  return best;
}

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  projects,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  restartRequired,
  currentVersion,
  onShowSettings,
  projectListProps,
  t,
}: SidebarContentProps) {
  const isRenamingOnMobile = isMobile && projectListProps.activeRename !== null;
  const isCompact = useCompactSidebar();
  // "New chat" opens in the project in view, else the one worked in last.
  const newChatProject = projectListProps.selectedProject ?? pickLastActiveProject(projects);

  return (
    <div className="flex h-full flex-col bg-background/80 backdrop-blur-sm md:w-full md:select-none">
      <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        isLoading={isLoading}
        projectsCount={projects.length}
        searchFilter={searchFilter}
        onSearchFilterChange={onSearchFilterChange}
        onClearSearchFilter={onClearSearchFilter}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
        t={t}
      />

      {newChatProject && (
        <div className="flex-shrink-0 px-3 pt-2 md:px-2">
          <button
            type="button"
            onClick={() => projectListProps.onNewSession(newChatProject)}
            title={t('sessions.newChatIn', { project: newChatProject.displayName, defaultValue: 'New chat in {{project}}' })}
            className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/70"
          >
            <SquarePen className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{t('sessions.newChat', { defaultValue: 'New chat' })}</span>
            <span className="ml-auto min-w-0 truncate text-xs font-normal text-muted-foreground">{newChatProject.displayName}</span>
          </button>
        </div>
      )}

      <ScrollArea className="flex-1 overflow-y-auto overscroll-contain md:px-1.5 md:py-2">
        <SidebarPinnedSessions
          projects={projects}
          selectedSession={projectListProps.selectedSession}
          currentTime={projectListProps.currentTime}
          isCompact={isCompact}
          onSessionSelect={projectListProps.onSessionSelect}
          t={t}
        />
        <SidebarProjectList {...projectListProps} includeOffPagePins />
      </ScrollArea>

      {!isRenamingOnMobile && (
        <SidebarFooter
          restartRequired={restartRequired}
          currentVersion={currentVersion}
          onShowSettings={onShowSettings}
          provider={projectListProps.selectedSession?.__provider ?? 'claude'}
          t={t}
        />
      )}
    </div>
  );
}
