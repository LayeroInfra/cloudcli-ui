import { AlertTriangle } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { LLMProvider, SettingsMainTab } from '@/shared/types';
import SidebarAccount from '@/modules/sidebar/SidebarAccount';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';

type SidebarFooterProps = {
  restartRequired: boolean;
  currentVersion: string;
  onShowSettings: (tab?: SettingsMainTab) => void;
  /** Whose account the corner shows: the selected session's provider, else Claude. */
  provider: LLMProvider;
  t: TFunction;
};

/** Rendered by SidebarContent at the bottom of the panel: the restart notice, then the account corner. Upstream release notices are not shown in this fork. */
export default function SidebarFooter({
  restartRequired,
  currentVersion,
  onShowSettings,
  provider,
  t,
}: SidebarFooterProps) {
  const isCompact = useCompactSidebar();
  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Restart-required banner: the running server version differs from the
          installed/frontend version (updated but not restarted). */}
      {restartRequired && (
        <>
          <div className="nav-divider" />
          <div className="px-2 py-1.5 md:px-2 md:py-1.5">
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-300/60 bg-amber-50/80 px-2.5 py-2 dark:border-amber-700/40 dark:bg-amber-900/15">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400" />
              <span className="min-w-0 flex-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('version.restartRequired')}
              </span>
            </div>
          </div>
        </>
      )}

      <div className="nav-divider" />
      <SidebarAccount
        provider={provider}
        currentVersion={currentVersion}
        isCompact={isCompact}
        onShowSettings={onShowSettings}
        t={t}
      />
    </div>
  );
}
