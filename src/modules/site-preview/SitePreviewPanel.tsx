import { ArrowLeft, ArrowRight, ExternalLink, Globe, Plus, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import {
  OPEN_URL_EVENT,
  PREVIEW_PORTS_LABEL,
  normalizePreviewUrl,
  previewUrlOrNull,
  type OpenUrlEventDetail,
} from '@/modules/site-preview/openWorkspaceUrl';

type SitePreviewPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** One browser tab: its own back/forward stack, since a cross-origin frame's history cannot be read. */
type PreviewTab = {
  id: number;
  history: string[];
  index: number;
  /** Bumped by Reload so the frame remounts even when the URL is unchanged. */
  reloadKey: number;
};

const HOME_URL = 'http://localhost:5174/';
const TABS_KEY = 'site-preview-tabs';
const WIDTH_KEY = 'site-preview-width';
const DEFAULT_WIDTH_PERCENT = 46;

function tabLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host + (parsed.pathname === '/' ? '' : parsed.pathname);
  } catch {
    return url;
  }
}

let nextTabId = 1;
const createTab = (url: string): PreviewTab => ({ id: nextTabId++, history: [url], index: 0, reloadKey: 0 });

function readSavedTabs(): { tabs: PreviewTab[]; activeIndex: number } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TABS_KEY) ?? 'null') as { urls?: string[]; index?: number } | null;
    const tabs = (saved?.urls ?? []).flatMap((url) => {
      try {
        return [createTab(normalizePreviewUrl(url))];
      } catch {
        return [];
      }
    });
    if (tabs.length > 0) return { tabs, activeIndex: Math.min(saved?.index ?? 0, tabs.length - 1) };
  } catch {
    // Fall through to a fresh tab.
  }
  return { tabs: [createTab(HOME_URL)], activeIndex: 0 };
}

function readSavedWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved >= 20 && saved <= 78 ? saved : DEFAULT_WIDTH_PERCENT;
  } catch {
    return DEFAULT_WIDTH_PERCENT;
  }
}

/**
 * The project-workspace module renders this beside the active tab: a
 * Chrome-style browser for the workspace's tunneled dev servers — tabs with
 * close and new-tab, back/forward/reload, an omnibox and a resizable width.
 * It stays mounted while closed so a click on a localhost link anywhere in
 * the app opens that page here.
 */
export default function SitePreviewPanel({ open, onOpenChange }: SitePreviewPanelProps) {
  const { t } = useTranslation();
  // The tabs restored from this browser tab's session, read once to seed the two states below.
  const [restored] = useState(readSavedTabs);
  // The open tabs.
  const [tabs, setTabs] = useState<PreviewTab[]>(restored.tabs);
  // Id of the tab on screen.
  const [activeId, setActiveId] = useState<number>(restored.tabs[restored.activeIndex].id);
  // What the omnibox holds while the person edits it; null shows the active tab's URL.
  const [addressDraft, setAddressDraft] = useState<string | null>(null);
  // Why the last omnibox entry was refused; cleared on the next edit.
  const [addressError, setAddressError] = useState<string | null>(null);
  // Panel width as a percentage of the workspace; persisted per browser.
  const [widthPercent, setWidthPercent] = useState(readSavedWidth);
  const addressRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const activeUrl = activeTab.history[activeTab.index];

  useEffect(() => {
    try {
      sessionStorage.setItem(
        TABS_KEY,
        JSON.stringify({ urls: tabs.map((tab) => tab.history[tab.index]), index: tabs.indexOf(activeTab) }),
      );
    } catch {
      // Not persisting is harmless.
    }
  }, [tabs, activeTab]);

  const updateTab = useCallback((id: number, change: (tab: PreviewTab) => PreviewTab) => {
    setTabs((previous) => previous.map((tab) => (tab.id === id ? change(tab) : tab)));
  }, []);

  const navigateActive = (url: string) => {
    updateTab(activeTab.id, (tab) => ({ ...tab, history: [...tab.history.slice(0, tab.index + 1), url], index: tab.index + 1 }));
    setAddressDraft(null);
  };

  const openTab = useCallback((url: string, focusAddress = false) => {
    const tab = createTab(url);
    setTabs((previous) => [...previous, tab]);
    setActiveId(tab.id);
    setAddressDraft(null);
    if (focusAddress) {
      window.requestAnimationFrame(() => {
        addressRef.current?.focus();
        addressRef.current?.select();
      });
    }
  }, []);

  const closeTab = (id: number) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const remaining = tabs.filter((tab) => tab.id !== id);
    if (remaining.length === 0) {
      const fresh = createTab(HOME_URL);
      setTabs([fresh]);
      setActiveId(fresh.id);
      onOpenChange(false);
      return;
    }
    setTabs(remaining);
    if (id === activeId) setActiveId(remaining[Math.min(index, remaining.length - 1)].id);
  };

  const showUrl = useCallback((url: string) => {
    const existing = tabs.find((tab) => tab.history[tab.index] === url);
    if (existing) setActiveId(existing.id);
    else openTab(url);
    onOpenChange(true);
  }, [tabs, openTab, onOpenChange]);

  // A localhost link clicked anywhere in the app opens here instead of a new
  // browser window, which could not reach the workspace's dev server.
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || panelRef.current?.contains(anchor)) return;
      const url = previewUrlOrNull(anchor.href);
      if (!url) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showUrl(url);
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [showUrl]);

  // openWorkspaceUrl: terminal links, `$BROWSER` from the workspace, chat paths.
  useEffect(() => {
    const handleOpen = (event: Event) => {
      const url = previewUrlOrNull((event as CustomEvent<OpenUrlEventDetail>).detail?.url ?? '');
      if (!url) return;
      event.preventDefault();
      showUrl(url);
    };
    window.addEventListener(OPEN_URL_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_URL_EVENT, handleOpen);
  }, [showUrl]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    try {
      navigateActive(normalizePreviewUrl(addressDraft ?? activeUrl));
      setAddressError(null);
      addressRef.current?.blur();
    } catch {
      setAddressError(t('workspace.browser.invalidAddress', { defaultValue: `Only localhost on ports ${PREVIEW_PORTS_LABEL} can be opened.` }));
    }
  };

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const container = panelRef.current?.parentElement?.getBoundingClientRect();
    if (!container) return;
    // The frames would swallow pointer events mid-drag.
    document.body.classList.add('select-none');
    panelRef.current?.classList.add('[&_iframe]:pointer-events-none');
    let latest = widthPercent;
    const handleMove = (moveEvent: PointerEvent) => {
      latest = Math.max(20, Math.min(78, (100 * (container.right - moveEvent.clientX)) / container.width));
      setWidthPercent(latest);
    };
    const handleUp = () => {
      handle.removeEventListener('pointermove', handleMove);
      handle.removeEventListener('lostpointercapture', handleUp);
      document.body.classList.remove('select-none');
      panelRef.current?.classList.remove('[&_iframe]:pointer-events-none');
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(latest)));
      } catch {
        // Not persisting is harmless.
      }
    };
    handle.addEventListener('pointermove', handleMove);
    handle.addEventListener('lostpointercapture', handleUp);
  };

  const iconButton = 'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35';

  return (
    <aside
      ref={panelRef}
      aria-label={t('workspace.browser.title', { defaultValue: 'Browser' })}
      className={cn('relative flex min-w-[280px] flex-shrink-0 flex-col border-l border-border bg-muted/40', !open && 'hidden')}
      style={{ width: `${widthPercent}%` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('workspace.browser.resize', { defaultValue: 'Resize browser' })}
        onPointerDown={handleResizeStart}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-primary/20"
      />

      {/* Tab strip */}
      <div role="tablist" className="scrollbar-hide flex h-9 flex-shrink-0 items-end gap-px overflow-x-auto px-1.5 pt-1.5">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab.id;
          const url = tab.history[tab.index];
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              title={url}
              onClick={() => {
                setActiveId(tab.id);
                setAddressDraft(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setActiveId(tab.id);
              }}
              onAuxClick={(event) => {
                if (event.button === 1) closeTab(tab.id);
              }}
              className={cn(
                'group flex h-full min-w-[7rem] max-w-[12rem] flex-1 cursor-default items-center gap-1.5 rounded-t-lg pl-2.5 pr-1 text-xs',
                isActive ? 'bg-background text-foreground shadow-[0_-1px_0_0_hsl(var(--border))]' : 'text-muted-foreground hover:bg-background/60',
              )}
            >
              <Globe className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate">{tabLabel(url)}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label={t('workspace.browser.closeTab', { defaultValue: 'Close tab' })}
                className={cn('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full hover:bg-muted', !isActive && 'opacity-0 group-hover:opacity-100')}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => openTab(HOME_URL, true)}
          aria-label={t('workspace.browser.newTab', { defaultValue: 'New tab' })}
          className="mb-1 flex h-6 w-6 flex-shrink-0 items-center justify-center self-center rounded-full text-muted-foreground hover:bg-background/70 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label={t('workspace.browser.close', { defaultValue: 'Close browser' })}
          title="Ctrl+Shift+B"
          className="mb-1 flex h-6 w-6 flex-shrink-0 items-center justify-center self-center rounded-full text-muted-foreground hover:bg-background/70 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex h-10 flex-shrink-0 items-center gap-1 bg-background px-2">
        <button
          type="button"
          className={iconButton}
          disabled={activeTab.index === 0}
          onClick={() => updateTab(activeTab.id, (tab) => ({ ...tab, index: tab.index - 1 }))}
          aria-label={t('workspace.browser.back', { defaultValue: 'Back' })}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={iconButton}
          disabled={activeTab.index >= activeTab.history.length - 1}
          onClick={() => updateTab(activeTab.id, (tab) => ({ ...tab, index: tab.index + 1 }))}
          aria-label={t('workspace.browser.forward', { defaultValue: 'Forward' })}
        >
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={iconButton}
          onClick={() => updateTab(activeTab.id, (tab) => ({ ...tab, reloadKey: tab.reloadKey + 1 }))}
          aria-label={t('workspace.browser.reload', { defaultValue: 'Reload' })}
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <form onSubmit={handleSubmit} className="relative min-w-0 flex-1">
          <input
            ref={addressRef}
            value={addressDraft ?? activeUrl}
            onChange={(event) => {
              setAddressDraft(event.target.value);
              setAddressError(null);
            }}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => {
              if (!addressError) setAddressDraft(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setAddressDraft(null);
                setAddressError(null);
                event.currentTarget.blur();
              }
            }}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('workspace.browser.address', { defaultValue: 'Address' })}
            aria-invalid={Boolean(addressError)}
            className={cn(
              'h-7 w-full rounded-full border border-transparent bg-muted px-3 text-xs text-foreground outline-none transition-colors focus:border-primary/60 focus:bg-background',
              addressError && 'border-destructive/70',
            )}
          />
          {addressError && (
            <div role="alert" className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-destructive/40 bg-popover px-2.5 py-1.5 text-xs text-destructive shadow-md">
              {addressError}
            </div>
          )}
        </form>
        <a
          href={activeUrl}
          target="_blank"
          rel="noopener noreferrer"
          // Bypasses the link capture above: this one is meant to leave the app.
          onClickCapture={(event) => event.stopPropagation()}
          className={iconButton}
          aria-label={t('workspace.browser.openExternal', { defaultValue: 'Open in a new window' })}
          title={t('workspace.browser.openExternal', { defaultValue: 'Open in a new window' })}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* Pages: every tab stays mounted so switching keeps its state. */}
      <div className="relative min-h-0 flex-1 border-t border-border bg-background">
        {tabs.map((tab) => (
          <iframe
            key={`${tab.id}:${tab.index}:${tab.reloadKey}`}
            src={tab.history[tab.index]}
            title={tabLabel(tab.history[tab.index])}
            sandbox="allow-scripts allow-forms allow-same-origin"
            referrerPolicy="no-referrer"
            className={cn('absolute inset-0 h-full w-full border-0 bg-white', tab.id !== activeTab.id && 'hidden')}
          />
        ))}
      </div>
    </aside>
  );
}
