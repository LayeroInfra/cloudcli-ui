import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/shared/utils';

type WorkspacePopoverProps = {
  /** Renders the trigger; receives whether the popover is open and the toggle. */
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  /** Renders the popover body; `close` dismisses it after an action. */
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
};

/**
 * Rendered by the workspace header's account menu and session lineage: a
 * small anchored popover that closes on outside click or Escape. Escape is
 * stopped here so it does not also abort the running chat turn.
 */
export default function WorkspacePopover({ trigger, children, align = 'left', className }: WorkspacePopoverProps) {
  // Whether the popover is showing.
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open && (
        <div
          role="dialog"
          className={cn(
            'absolute top-full z-50 mt-1.5 min-w-[16rem] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
