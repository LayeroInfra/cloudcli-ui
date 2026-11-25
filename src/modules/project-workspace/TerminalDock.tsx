import { SquareTerminal, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { StandaloneShell } from '@/modules/standalone-shell';
import type { Project, ProjectSession } from '@/shared/types';
import { LLMProviderLogo } from '@/shared/ui';
import { cn } from '@/shared/utils';

type TerminalDockProps = {
  open: boolean;
  onClose: () => void;
  project: Project;
  session: ProjectSession | null;
};

type TerminalMode = 'shell' | 'agent';

const HEIGHT_KEY = 'workspace-terminal-height';
const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 140;

// A login shell in the project folder. Passed as a command because the
// server runs every launch through `bash -c`, which exits on an empty one.
const LOGIN_SHELL_COMMAND = 'exec "${SHELL:-bash}" -l';

function readSavedHeight(): number {
  try {
    const saved = Number(localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(saved) && saved >= MIN_HEIGHT ? saved : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

/**
 * Rendered by WorkspaceMain under the active tab: a resizable terminal dock,
 * toggled with Ctrl+`, holding a plain login shell in the project folder and
 * the agent's own CLI attached to the selected session. Both stay mounted once
 * opened so closing the dock keeps their scrollback.
 */
export default function TerminalDock({ open, onClose, project, session }: TerminalDockProps) {
  const { t } = useTranslation();
  // Which terminal the dock shows.
  const [mode, setMode] = useState<TerminalMode>('shell');
  // Dock height in px; persisted per browser.
  const [height, setHeight] = useState(readSavedHeight);
  // Which terminals have been shown at least once, so they mount lazily and then stay mounted.
  const [mounted, setMounted] = useState<Record<TerminalMode, boolean>>({ shell: false, agent: false });
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setMounted((previous) => (previous[mode] ? previous : { ...previous, [mode]: true }));
  }, [open, mode]);

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const bottom = dockRef.current?.getBoundingClientRect().bottom ?? window.innerHeight;
    const parentHeight = dockRef.current?.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
    let latest = height;
    const handleMove = (moveEvent: PointerEvent) => {
      latest = Math.round(Math.min(parentHeight - 120, Math.max(MIN_HEIGHT, bottom - moveEvent.clientY)));
      setHeight(latest);
    };
    const handleUp = () => {
      handle.removeEventListener('pointermove', handleMove);
      handle.removeEventListener('lostpointercapture', handleUp);
      try {
        localStorage.setItem(HEIGHT_KEY, String(latest));
      } catch {
        // Not persisting is harmless.
      }
    };
    handle.addEventListener('pointermove', handleMove);
    handle.addEventListener('lostpointercapture', handleUp);
  }, [height]);

  if (!mounted.shell && !mounted.agent && !open) return null;

  const tabClass = (active: boolean) => cn(
    'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
    active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
  );

  return (
    <div
      ref={dockRef}
      className={cn('relative flex flex-shrink-0 flex-col border-t border-border bg-background', !open && 'hidden')}
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('workspace.terminal.resize', { defaultValue: 'Resize terminal' })}
        onPointerDown={handleResizeStart}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize hover:bg-primary/20"
      />
      <div className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <button type="button" onClick={() => setMode('shell')} className={tabClass(mode === 'shell')}>
          <SquareTerminal className="h-3.5 w-3.5" />
          {t('workspace.terminal.shell', { defaultValue: 'Terminal' })}
        </button>
        <button type="button" onClick={() => setMode('agent')} className={tabClass(mode === 'agent')}>
          <LLMProviderLogo provider={session?.__provider} className="h-3.5 w-3.5" />
          {t('workspace.terminal.agent', { defaultValue: 'Agent CLI' })}
        </button>
        <span className="ml-2 min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{project.fullPath}</span>
        <kbd className="hidden rounded border border-border px-1 text-[10px] text-muted-foreground sm:inline">Ctrl+`</kbd>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('workspace.close', { defaultValue: 'Close' })}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {mounted.shell && (
          <div className={cn('absolute inset-0', mode !== 'shell' && 'hidden')}>
            <StandaloneShell
              project={project}
              command={LOGIN_SHELL_COMMAND}
              isPlainShell
              showHeader={false}
              isActive={open && mode === 'shell'}
            />
          </div>
        )}
        {mounted.agent && (
          <div className={cn('absolute inset-0', mode !== 'agent' && 'hidden')}>
            <StandaloneShell
              project={project}
              session={session}
              showHeader={false}
              isActive={open && mode === 'agent'}
            />
          </div>
        )}
      </div>
    </div>
  );
}
