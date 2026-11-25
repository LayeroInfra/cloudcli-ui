import { useMemo } from 'react';
import { PinOff } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { Project, ProjectSession, SessionWithProvider } from '@/shared/types';
import { cn, getSessionTitle } from '@/shared/utils';
import { useSessionPins } from '@/modules/sidebar/hooks/useSessionPins';
import { formatCompactAge } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import { buildPinnedSessionFamilies } from '@/modules/sidebar/utils/pinnedSessionFamilies';

const INDENT_PX = 14;

type SidebarPinnedSessionsProps = {
  projects: Project[];
  selectedSession: ProjectSession | null;
  currentTime: Date;
  isCompact: boolean;
  onSessionSelect: (session: SessionWithProvider, projectId: string) => void;
  t: TFunction;
};

/**
 * Rendered by SidebarContent above the projects, as in Claude Code: every
 * pinned session again, with its project's name and, under it, its whole fork
 * tree. The sessions stay in their projects too; this is a shortcut, not a
 * move. Unpinning is one click on the pin row.
 */
export default function SidebarPinnedSessions({ projects, selectedSession, currentTime, isCompact, onSessionSelect, t }: SidebarPinnedSessionsProps) {
  const pins = useSessionPins();
  const families = useMemo(
    () => (pins ? buildPinnedSessionFamilies(pins.sessions, projects) : []),
    [pins, projects],
  );

  if (!pins || families.length === 0) return null;

  return (
    <section className={cn('pb-2', isCompact ? 'px-3' : 'px-1')} data-testid="pinned-sessions-section" aria-label={t('pinned.title', 'Pinned')}>
      <h3 className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('pinned.title', 'Pinned')}</h3>
      <ul className="space-y-px">
        {families.flatMap((family) => family.rows.map((row) => {
          const isRoot = row.depth === 0;
          const isPinned = pins.pinnedIds.has(row.session.id);
          const isSelected = selectedSession?.id === row.session.id;
          const title = getSessionTitle(row.session);
          const age = formatCompactAge(String(row.session.lastActivity ?? ''), currentTime);
          return (
            <li key={`${family.pin.sessionId}:${row.session.id}`} className="group/pin relative" data-pinned-session-id={row.session.id} data-pin-depth={row.depth}>
              <button
                type="button"
                onClick={() => onSessionSelect(row.session, family.projectId)}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors',
                  isCompact && 'min-h-10',
                  isSelected ? 'bg-accent text-foreground' : 'text-foreground/85 hover:bg-accent/50',
                  isPinned && 'group-hover/pin:pr-9',
                )}
                style={{ paddingLeft: `${8 + row.depth * INDENT_PX}px` }}
                title={title}
              >
                {!isRoot && <span className="flex-shrink-0 text-muted-foreground/60" aria-hidden="true">{row.isLastSibling ? '└' : '├'}</span>}
                <span className="min-w-0 flex-1 truncate">{title}</span>
                {isRoot && <span className="max-w-[40%] flex-shrink truncate text-[11px] text-muted-foreground">{family.projectDisplayName}</span>}
                {age && <span className={cn('flex-shrink-0 text-[11px] tabular-nums text-muted-foreground', isPinned && 'group-hover/pin:hidden')}>{age}</span>}
              </button>
              {isPinned && (
                <button
                  type="button"
                  onClick={() => void pins.setPinned(row.session.id, false)}
                  disabled={!pins.ready || pins.pendingSessionId !== null}
                  aria-label={`${t('pinned.unpin', 'Unpin session')}: ${title}`}
                  title={t('pinned.unpin', 'Unpin session')}
                  className={cn(
                    'absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40',
                    !isCompact && 'opacity-0 focus-visible:opacity-100 group-hover/pin:opacity-100',
                  )}
                >
                  <PinOff className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        }))}
      </ul>
    </section>
  );
}
