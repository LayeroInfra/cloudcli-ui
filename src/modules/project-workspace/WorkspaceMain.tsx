import React, { useCallback, useEffect, type Dispatch, type SetStateAction, useState } from 'react';

import { ChatInterface } from '@/modules/chat';
import { FileTree } from '@/modules/file-tree';
import { usePaletteOpsRegister } from '@/modules/command-palette';
import { useTaskMasterProjectSync } from '@/modules/task-master';
import type { AppTab, DirectoryRevealRequest, Project, ProjectSession, SessionBackgroundTask, SessionEstablishedContext, SessionNavigationOptions, SettingsMainTab } from '@/shared/types';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { useFileOpenResolver } from '@/modules/project-workspace/hooks/useFileOpenResolver';
import { EditorSidebar, useEditorSidebar } from '@/modules/code-editor';
import { SitePreviewPanel } from '@/modules/site-preview';
import { useProcessingSessions } from '@/shared/context/SessionProtectionContext';
import BackgroundProcessesPanel, { countRunningProcesses } from '@/modules/project-workspace/BackgroundProcessesPanel';
import TerminalDock from '@/modules/project-workspace/TerminalDock';
import { useWorkspacePanels } from '@/modules/project-workspace/hooks/useWorkspacePanels';
import { useWorkspaceBuilds } from '@/modules/project-workspace/hooks/useWorkspaceBuilds';
import WorkspaceBuildsPanel from '@/modules/project-workspace/WorkspaceBuildsPanel';
import AgentMemoryPanel from '@/modules/project-workspace/AgentMemoryPanel';
import WorkspaceHeader from '@/modules/project-workspace/WorkspaceHeader';
import WorkspaceStateView from '@/modules/project-workspace/WorkspaceStateView';
import WorkspaceErrorBoundary from '@/modules/project-workspace/WorkspaceErrorBoundary';

type WorkspaceMainProps = {
  /** Every loaded project, for naming sessions in the background-tasks card. */
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  isMobile: boolean;
  onMenuClick: () => void;
  isLoading: boolean;
  onNavigateToSession: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished: (sessionId: string, context: SessionEstablishedContext) => void;
  onShowSettings: (tab?: SettingsMainTab) => void;
  externalMessageUpdate: number;
  newSessionTrigger: number;
  /** Switches the app to another project — used by the git panel's Worktrees view. */
  onProjectSelect: (project: Project) => void;
  /** Silently re-syncs the sidebar project list after worktree projects change. */
  onProjectsRefresh: () => void;
  /** Persists a new title for a session; resolves false when the backend refuses it. Used by the header's inline rename. */
  onRenameSession: (sessionId: string, summary: string) => Promise<boolean>;
};

/**
 * Rendered by ProjectMainRegion: the workspace header, the selected project's active tab
 * (chat, files, git, tasks, browser-use or a plugin) with the terminal dock under it, the
 * site-preview browser beside it and the background-tasks and builds cards over the chat.
 */
function WorkspaceMain({
  projects,
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  externalMessageUpdate,
  newSessionTrigger,
  onProjectSelect,
  onProjectsRefresh,
  onRenameSession,
}: WorkspaceMainProps) {
  const preferences = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;

  useTaskMasterProjectSync(selectedProject);
  const { openPanels, togglePanel, setPanelOpen } = useWorkspacePanels();
  const processingSessions = useProcessingSessions();
  const runningProcessCount = countRunningProcesses(processingSessions);
  // The open session's background tasks, finished ones included, as the chat
  // read them from its transcript; listed by the background-tasks card.
  const [sessionBackgroundTasks, setSessionBackgroundTasks] = useState<SessionBackgroundTask[]>([]);
  const selectedSessionId = selectedSession?.id ?? null;

  const openSession = useCallback((sessionId: string) => {
    setActiveTab('chat');
    onNavigateToSession(sessionId);
  }, [onNavigateToSession, setActiveTab]);

  const closeBackgroundPanel = useCallback(() => setPanelOpen('background', false), [setPanelOpen]);
  const closeBuildsPanel = useCallback(() => setPanelOpen('builds', false), [setPanelOpen]);
  const closeMemoryPanel = useCallback(() => setPanelOpen('memory', false), [setPanelOpen]);
  // The signed-in user's Woodpecker builds, for the builds card and its header badge.
  const workspaceBuilds = useWorkspaceBuilds(openPanels.builds);
  const closeTerminal = useCallback(() => setPanelOpen('terminal', false), [setPanelOpen]);
  const setBrowserOpen = useCallback((open: boolean) => setPanelOpen('browser', open), [setPanelOpen]);

  // The workspace is the chat alone, as in Cursor: the old tabs are gone.
  // Links and the command palette that still ask for one land on its panel
  // (files → explorer, shell → terminal dock) or simply stay on the chat.
  useEffect(() => {
    if (activeTab === 'chat') return;
    if (activeTab === 'shell') setPanelOpen('terminal', true);
    if (activeTab === 'files') setPanelOpen('files', true);
    setActiveTab('chat');
  }, [activeTab, setActiveTab, setPanelOpen]);
  const closeFilesPanel = useCallback(() => setPanelOpen('files', false), [setPanelOpen]);
  // The folder an in-chat `path/` reference asked to reveal. Held as an object
  // so that re-clicking the same folder is a new request the tree acts on.
  const [revealDirectory, setRevealDirectory] = useState<DirectoryRevealRequest | null>(null);

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
    handleUnsavedChangesChange,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  // Resolves bare/partial file references (e.g. links inside chat messages) to
  // real project files before opening them in the in-app editor.
  const resolvedFileOpen = useFileOpenResolver(selectedProject, handleFileOpen);

  // Opens the file in the editor beside the chat; the explorer stays as it was.
  const openFile = useCallback((filePath: string) => {
    handleFileOpen(filePath);
  }, [handleFileOpen]);

  // Opens the editor side panel in place, keeping the current tab (e.g. chat).
  const openFileInEditor = useCallback((filePath: string, line?: number | null) => {
    resolvedFileOpen(filePath, undefined, line);
  }, [resolvedFileOpen]);

  // Directories cannot be read as text: reveal them in the explorer instead.
  const openDirectory = useCallback((directoryPath: string) => {
    setPanelOpen('files', true);
    setRevealDirectory({ path: directoryPath });
  }, [setPanelOpen]);

  // Stable arguments keep usePaletteOpsRegister's effect from tearing down and
  // rewriting the whole palette registry on every render.
  usePaletteOpsRegister({ openFile, openFileInEditor, openDirectory });

  if (isLoading) {
    return <WorkspaceStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    return <WorkspaceStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  return (
    <div className="relative flex h-full flex-col">
      <WorkspaceHeader
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
        onRenameSession={onRenameSession}
        onOpenSession={openSession}
        background={{ open: openPanels.background, onToggle: () => togglePanel('background'), runningCount: runningProcessCount }}
        terminal={{ open: openPanels.terminal, onToggle: () => togglePanel('terminal') }}
        browser={{ open: openPanels.browser, onToggle: () => togglePanel('browser') }}
        files={{ open: openPanels.files, onToggle: () => togglePanel('files') }}
        builds={{ open: openPanels.builds, onToggle: () => togglePanel('builds'), activeCount: workspaceBuilds.activeCount }}
        memory={{ open: openPanels.memory, onToggle: () => togglePanel('memory') }}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Explorer, as in Cursor: off by default, beside the chat (over it on mobile). */}
        {openPanels.files && (
          <aside
            aria-label="Files"
            className={isMobile
              ? 'absolute inset-0 z-30 flex flex-col bg-background'
              : 'flex w-64 flex-shrink-0 flex-col overflow-hidden border-r border-border/60 lg:w-72'}
          >
            <FileTree
              selectedProject={selectedProject}
              onFileOpen={(filePath) => {
                handleFileOpen(filePath);
                if (isMobile) closeFilesPanel();
              }}
              revealDirectory={revealDirectory}
            />
          </aside>
        )}

        <div className={`relative flex min-h-0 min-w-[200px] flex-col overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}>
          <WorkspaceErrorBoundary showDetails>
            <ChatInterface
              isActive
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              ws={ws}
              sendMessage={sendMessage}
              onFileOpen={handleFileOpen}
              onNavigateToSession={onNavigateToSession}
              onSessionEstablished={onSessionEstablished}
              onShowSettings={onShowSettings}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              sendByCtrlEnter={sendByCtrlEnter}
              externalMessageUpdate={externalMessageUpdate}
              newSessionTrigger={newSessionTrigger}
              onShowAllTasks={null}
              onBackgroundTasksChange={setSessionBackgroundTasks}
            />
          </WorkspaceErrorBoundary>

          {/* Background tasks and builds float over the chat as cards, as in
              Claude Code; opened together they stack and share the height.
              They live in the chat column, so an open browser panel stays clear. */}
          {(openPanels.background || openPanels.builds) && (
            <div className="pointer-events-none absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-[min(24rem,calc(100%-1.5rem))] flex-col gap-2">
              <BackgroundProcessesPanel
                open={openPanels.background}
                onClose={closeBackgroundPanel}
                projects={projects}
                activeSessionId={selectedSessionId}
                sessionTasks={sessionBackgroundTasks}
                sendMessage={sendMessage}
                onOpenSession={openSession}
              />
              <WorkspaceBuildsPanel
                open={openPanels.builds}
                onClose={closeBuildsPanel}
                builds={workspaceBuilds.builds}
                error={workspaceBuilds.error}
                isLoading={workspaceBuilds.isLoading}
                isTriggering={workspaceBuilds.isTriggering}
                onTrigger={() => void workspaceBuilds.trigger()}
                onRefresh={() => void workspaceBuilds.refresh()}
              />
            </div>
          )}

          {/* Agent memory is read at length and edited, so it takes a wider
              card over the right of the chat, above the other cards. */}
          {openPanels.memory && (
            <div className="pointer-events-none absolute bottom-3 right-3 top-3 z-40 flex w-[min(40rem,calc(100%-1.5rem))] flex-col">
              <AgentMemoryPanel
                open={openPanels.memory}
                onClose={closeMemoryPanel}
                projectPath={selectedProject.fullPath || null}
                onOpenFile={openFile}
              />
            </div>
          )}
        </div>

        <EditorSidebar
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          onUnsavedChangesChange={handleUnsavedChangesChange}
          projectPath={selectedProject.path}
          fillSpace={false}
        />
        </div>

        <TerminalDock
          open={openPanels.terminal}
          onClose={closeTerminal}
          project={selectedProject}
          session={selectedSession}
        />
        </div>

        {!isMobile && <SitePreviewPanel open={openPanels.browser} onOpenChange={setBrowserOpen} />}
      </div>

    </div>
  );
}

export default React.memo(WorkspaceMain);
