import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, LLMProviderLogo } from '@/shared/ui';
import type { LLMProvider, ProviderAuthStatus } from '@/shared/types';

type AgentConnectionCardProps = {
  provider: LLMProvider;
  title: string;
  status: ProviderAuthStatus;
  onLogin: () => void;
};

/** Rendered by onboarding's AgentConnectionsStep to show one CLI provider's connection state. */
export default function AgentConnectionCard({
  provider,
  title,
  status,
  onLogin,
}: AgentConnectionCardProps) {
  const { t } = useTranslation('auth');

  const statusText = status.loading
    ? t('onboarding.checking')
    : status.authenticated
      ? status.email || t('onboarding.connected')
      : status.error || t('onboarding.notConnected');

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border-soft bg-muted">
            <LLMProviderLogo provider={provider} className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {title}
              {status.authenticated && <Check className="h-3.5 w-3.5 flex-shrink-0 text-leaf" />}
            </div>
            <div className="truncate text-xs text-muted-foreground" title={statusText}>{statusText}</div>
          </div>
        </div>

        {!status.authenticated && !status.loading && (
          <Button size="sm" variant="outline" onClick={onLogin} className="flex-shrink-0">
            {t('onboarding.login')}
          </Button>
        )}
      </div>
    </div>
  );
}
