import { useTranslation } from 'react-i18next';

import { LayeroMark, LayeroWorkspaceLockup } from '@/shared/ui';

/** Rendered by the auth module's ProtectedRoute while the initial auth status check is in flight. */
export default function AuthLoadingScreen() {
  const { t } = useTranslation('auth');
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex flex-col items-center gap-5 text-center" role="status" aria-live="polite">
        <LayeroMark className="h-11 w-11 shadow-sm motion-safe:animate-pulse" />
        <LayeroWorkspaceLockup size="lg" />
        <p className="sr-only">{t('misc.loadingState')}</p>
      </div>
    </div>
  );
}
