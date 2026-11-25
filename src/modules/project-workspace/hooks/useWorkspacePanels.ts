import { useCallback, useEffect, useState } from 'react';

/** The docks and drawers the workspace can open beside the active tab. */
type WorkspacePanelId = 'files' | 'terminal' | 'browser' | 'background' | 'builds';

type WorkspacePanelsState = Record<WorkspacePanelId, boolean>;

const STORAGE_KEY = 'workspace-panels-open';

const CLOSED_PANELS: WorkspacePanelsState = { files: false, terminal: false, browser: false, background: false, builds: false };

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
      // The background drawer is an overlay; reopening it on load would hide the chat.
      background: false,
      builds: false,
    };
  } catch {
    return CLOSED_PANELS;
  }
}

/** The right-hand drawers overlay the same space, so opening one closes the other. */
const DRAWERS: WorkspacePanelId[] = ['background', 'builds'];

const withDrawerClosed = (state: WorkspacePanelsState, opened: WorkspacePanelId): WorkspacePanelsState => {
  if (!DRAWERS.includes(opened) || !state[opened]) return state;
  const next = { ...state };
  for (const drawer of DRAWERS) if (drawer !== opened) next[drawer] = false;
  return next;
};

/**
 * Open/closed state of the workspace's file explorer, terminal dock, browser
 * panel and background-tasks and builds drawers, plus their keyboard
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
    setOpenPanels((previous) => withDrawerClosed({ ...previous, [panel]: !previous[panel] }, panel));
  }, []);

  const setPanelOpen = useCallback((panel: WorkspacePanelId, open: boolean) => {
    setOpenPanels((previous) => (previous[panel] === open ? previous : withDrawerClosed({ ...previous, [panel]: open }, panel)));
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
