import { Activity, FolderTree, Globe, Hammer, SquareTerminal, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Project, ProjectSession } from '@/shared/types';
import { Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';
import MobileMenuButton from '@/modules/project-workspace/MobileMenuButton';
import WorkspaceConnectionStatus from '@/modules/project-workspace/WorkspaceConnectionStatus';
import WorkspaceTitle from '@/modules/project-workspace/WorkspaceTitle';

type PanelToggle = {
  open: boolean;
  onToggle: () => void;
};

type WorkspaceHeaderProps = {
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  isMobile: boolean;
  onMenuClick: () => void;
  /** Persists a new title for a session; resolves false when the backend refuses it. */
  onRenameSession: (sessionId: string, summary: string) => Promise<boolean>;
  onOpenSession: (sessionId: string) => void;
  /** The file explorer beside the chat, off by default as in Cursor. */
  files: PanelToggle;
  terminal: PanelToggle;
  browser: PanelToggle;
  background: PanelToggle & { runningCount: number };
  /** The user's Woodpecker builds drawer; the badge counts queued and running builds. */
  builds: PanelToggle & { activeCount: number };
};

type PanelButtonProps = {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
};

function PanelButton({ icon: Icon, label, shortcut, active, onClick, badge }: PanelButtonProps) {
  return (
    <Tooltip content={shortcut ? `${label} · ${shortcut}` : label} position="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={label}
        className={cn(
          'relative flex h-8 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
          active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
        )}
      >
        <Icon className="h-4 w-4" />
        {badge !== undefined && badge > 0 && (
          <span className="min-w-[1.1rem] rounded-full bg-purple-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {badge}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

/**
 * Rendered by WorkspaceMain: one compact bar in the spirit of Cursor and
 * Claude Code — the explorer toggle and the session (with its parent and
 * forks) on the left; there are no view tabs, the workspace is the chat. On
 * the right the toggles for the builds and background drawers, the terminal
 * dock and the browser.
 */
export default function WorkspaceHeader({
  selectedProject,
  selectedSession,
  isMobile,
  onMenuClick,
  onRenameSession,
  onOpenSession,
  files,
  terminal,
  browser,
  background,
  builds,
}: WorkspaceHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="pwa-header-safe relative z-30 flex-shrink-0 border-b border-border/60 bg-background px-2 py-1.5 sm:px-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        <div className="flex min-w-0 flex-[1_1_14rem] items-center gap-2">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
          <PanelButton
            icon={FolderTree}
            label={t('workspace.files.title', { defaultValue: 'Files' })}
            shortcut="Ctrl+Shift+E"
            active={files.open}
            onClick={files.onToggle}
          />
          <WorkspaceTitle
            activeTab="chat"
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            shouldShowTasksTab={false}
            onRenameSession={onRenameSession}
            onOpenSession={onOpenSession}
          />
          <WorkspaceConnectionStatus />
        </div>

        <div className="ml-auto flex flex-shrink-0 items-center gap-1">
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <PanelButton
            icon={Activity}
            label={t('workspace.background.title', { defaultValue: 'Background tasks' })}
            shortcut="Ctrl+Shift+J"
            active={background.open}
            onClick={background.onToggle}
            badge={background.runningCount}
          />
          <PanelButton
            icon={Hammer}
            label={t('workspace.builds.title', { defaultValue: 'Builds' })}
            active={builds.open}
            onClick={builds.onToggle}
            badge={builds.activeCount}
          />
          <PanelButton
            icon={SquareTerminal}
            label={t('workspace.terminal.title', { defaultValue: 'Terminal' })}
            shortcut="Ctrl+`"
            active={terminal.open}
            onClick={terminal.onToggle}
          />
          {!isMobile && (
            <PanelButton
              icon={Globe}
              label={t('workspace.browser.title', { defaultValue: 'Browser' })}
              shortcut="Ctrl+Shift+B"
              active={browser.open}
              onClick={browser.onToggle}
            />
          )}
        </div>
      </div>
    </header>
  );
}
