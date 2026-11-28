import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { isWorkspaceStage } from '@/shared/utils';

/** What the stage server reports about itself in `/health`. */
type StageInfo = { ref?: string; sha?: string };

/**
 * Used by App on every page, the sign-in screen included: on the Workspace
 * stage it pins a strip saying which branch build this is, with the way back
 * to production. The stage shares the production address (:9443), so without
 * it the two are easy to mistake for each other. Renders nothing elsewhere.
 */
export function WorkspaceStageBanner() {
  const { t } = useTranslation();
  const onStage = isWorkspaceStage();
  // Branch and commit the stage server was started from; filled from /health once.
  const [stage, setStage] = useState<StageInfo | null>(null);

  useEffect(() => {
    if (!onStage) return;
    let cancelled = false;
    void api.health()
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { stage?: StageInfo } | null) => {
        if (!cancelled && body?.stage) setStage(body.stage);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [onStage]);

  if (!onStage) return null;

  const label = stage?.ref
    ? `${stage.ref}${stage.sha ? ` @ ${stage.sha.slice(0, 8)}` : ''}`
    : t('workspaceStage.unknownBuild', { defaultValue: 'branch build' });

  // One line at any width: a long branch name is cut short, the way back stays whole.
  return (
    <div
      role="status"
      data-testid="workspace-stage-banner"
      className="pointer-events-auto fixed bottom-2 left-1/2 z-[1000] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full bg-amber-500 px-3 py-1 text-xs font-medium text-black shadow-lg"
    >
      <span className="min-w-0 truncate" title={label}>{t('workspaceStage.label', { defaultValue: 'Stage' })}: {label}</span>
      <a href="/__stage/off" className="shrink-0 underline underline-offset-2">
        {t('workspaceStage.exit', { defaultValue: 'Back to Workspace' })}
      </a>
    </div>
  );
}
