import { useTranslation } from 'react-i18next';

import type { LLMProvider, ProviderAuthStatusMap } from '@/shared/types';
import AgentConnectionCard from '@/modules/onboarding/AgentConnectionCard';

type AgentConnectionsStepProps = {
  providerStatuses: ProviderAuthStatusMap;
  onOpenProviderLogin: (provider: LLMProvider) => void;
};

// One neutral Layero card style for every provider: the provider's own logo
// carries its identity, so the cards no longer need a colour each.
const providerCards = [
  { provider: 'claude' as const, title: 'Claude Code' },
  { provider: 'cursor' as const, title: 'Cursor' },
  { provider: 'codex' as const, title: 'OpenAI Codex' },
  { provider: 'opencode' as const, title: 'OpenCode' },
];

/** Rendered by Onboarding as its second step, listing every CLI provider the user can log into. */
export default function AgentConnectionsStep({
  providerStatuses,
  onOpenProviderLogin,
}: AgentConnectionsStepProps) {
  const { t } = useTranslation('auth');
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold tracking-tightish text-foreground">{t('onboarding.agentsStepTitle')}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {t('onboarding.agentsStepDescription')}
        </p>
      </div>

      <div className="-mr-1 max-h-[38vh] space-y-2 overflow-y-auto pr-1">
        {providerCards.map((providerCard) => (
          <AgentConnectionCard
            key={providerCard.provider}
            provider={providerCard.provider}
            title={providerCard.title}
            status={providerStatuses[providerCard.provider]}
            onLogin={() => onOpenProviderLogin(providerCard.provider)}
          />
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground">{t('onboarding.agentsLaterHint')}</p>
    </div>
  );
}
