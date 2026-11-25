import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/shared/utils';

type AnchoredPopoverProps = {
  /** Renders the trigger; receives whether the popover is open and the toggle. */
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  /** Renders the popover body; `close` dismisses it after an action. */
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  /** Which side of the trigger the popover opens on; 'top' for triggers near the bottom of the screen. */
  side?: 'top' | 'bottom';
  className?: string;
  /** Classes for the wrapper around trigger and popover, e.g. `flex-1` so a stretched trigger can actually stretch. */
  rootClassName?: string;
};

/**
 * Used by the project-workspace session lineage menu and the sidebar's account
 * block: a small anchored popover that closes on outside click or Escape.
 * Escape is stopped here so it does not also abort the running chat turn.
 */
export function AnchoredPopover({ trigger, children, align = 'left', side = 'bottom', className, rootClassName }: AnchoredPopoverProps) {
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
    <div ref={rootRef} className={cn('relative', rootClassName)}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open && (
        <div
          role="dialog"
          className={cn(
            'absolute z-50 min-w-[16rem] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
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
