import { useCallback, useEffect, useState } from 'react';

/** The docks and drawers the workspace can open beside the active tab. */
type WorkspacePanelId = 'files' | 'terminal' | 'browser' | 'background' | 'builds' | 'memory';

type WorkspacePanelsState = Record<WorkspacePanelId, boolean>;

const STORAGE_KEY = 'workspace-panels-open';

const CLOSED_PANELS: WorkspacePanelsState = { files: false, terminal: false, browser: false, background: false, builds: false, memory: false };

// Remembered per browser so a reload keeps the layout the person left. Storage
// can throw in private windows; the workspace then simply starts closed.
function readSavedPanels(): WorkspacePanelsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return CLOSED_PANELS;
    const parsed = JSON.parse(raw) as Partial<WorkspacePanelsState>;
    return {
      // Off until opened, as in Cursor; then remembered like the other panels.
      files: parsed.files === true,
      terminal: parsed.terminal === true,
      browser: parsed.browser === true,
      // The cards float over the chat; reopening them on load would cover it.
      background: false,
      builds: false,
      memory: false,
    };
  } catch {
    return CLOSED_PANELS;
  }
}

/**
 * Open/closed state of the workspace's file explorer, terminal dock, browser
 * panel, the background-tasks and builds cards (which may be open
 * together, stacked over the chat) and the agent-memory card, plus their keyboard
 * shortcuts: Ctrl+Shift+E (files, as in Cursor and VS Code),
 * Ctrl+` (terminal), Ctrl+Shift+B (browser), Ctrl+Shift+J (background).
 */
export function useWorkspacePanels() {
  // Which panels are open; persisted so the layout survives a reload.
  const [openPanels, setOpenPanels] = useState<WorkspacePanelsState>(readSavedPanels);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(openPanels));
    } catch {
      // Not persisting is harmless.
    }
  }, [openPanels]);

  const togglePanel = useCallback((panel: WorkspacePanelId) => {
    setOpenPanels((previous) => ({ ...previous, [panel]: !previous[panel] }));
  }, []);

  const setPanelOpen = useCallback((panel: WorkspacePanelId, open: boolean) => {
    setOpenPanels((previous) => (previous[panel] === open ? previous : { ...previous, [panel]: open }));
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.shiftKey && event.code === 'KeyE') {
        event.preventDefault();
        togglePanel('files');
      } else if (!event.shiftKey && (event.code === 'Backquote' || event.key === '`')) {
        event.preventDefault();
        togglePanel('terminal');
      } else if (event.shiftKey && event.code === 'KeyB') {
        event.preventDefault();
        togglePanel('browser');
      } else if (event.shiftKey && event.code === 'KeyJ') {
        event.preventDefault();
        togglePanel('background');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePanel]);

  return { openPanels, togglePanel, setPanelOpen };
}
