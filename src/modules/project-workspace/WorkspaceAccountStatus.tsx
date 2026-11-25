import { useEffect } from 'react';
import { ExternalLink, Settings, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useProviderAuthStatus } from '@/modules/provider-auth';
import type { LLMProvider, ProviderAuthStatus, SettingsMainTab } from '@/shared/types';
import { LLMProviderLogo } from '@/shared/ui';
import { cn } from '@/shared/utils';
import WorkspacePopover from '@/modules/project-workspace/WorkspacePopover';

const SOURCE_URL = 'https://github.com/LayeroInfra/cloudcli-ui';

type WorkspaceAccountStatusProps = {
  provider: LLMProvider;
  onShowSettings: (tab?: SettingsMainTab) => void;
};

/** "Pro", "Max" — the plan as Claude Code stores it, capitalised for display. */
function formatPlan(plan: string | undefined): string | null {
  if (!plan) return null;
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** The account line itself: the email when the CLI knows one, else how the CLI is signed in. */
function describeAccount(status: ProviderAuthStatus, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!status.authenticated) return t('workspace.account.signedOut', { defaultValue: 'Not signed in' });
  if (status.email && status.email.includes('@')) return status.email;
  if (status.method === 'api_key') return t('workspace.account.apiKey', { defaultValue: 'API key' });
  return status.email || t('workspace.account.signedIn', { defaultValue: 'Signed in' });
}

/**
 * Rendered by WorkspaceHeader: who the agent is running as — the account
 * email and plan of the session's provider — always visible, with a menu for
 * the details, the account settings and the edition's source link.
 */
export default function WorkspaceAccountStatus({ provider, onShowSettings }: WorkspaceAccountStatusProps) {
  const { t } = useTranslation();
  const { providerAuthStatus, checkProviderAuthStatus } = useProviderAuthStatus();
  const status = providerAuthStatus[provider];

  useEffect(() => {
    void checkProviderAuthStatus(provider);
  }, [checkProviderAuthStatus, provider]);

  const plan = formatPlan(status.plan);
  const account = describeAccount(status, t);

  return (
    <WorkspacePopover
      align="right"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={t('workspace.account.label', { defaultValue: 'Account' })}
          className={cn(
            'flex h-8 max-w-[16rem] items-center gap-1.5 rounded-md border border-border/70 px-2 text-xs transition-colors hover:bg-accent',
            open && 'bg-accent',
            !status.loading && !status.authenticated && 'border-destructive/50 text-destructive',
          )}
        >
          <LLMProviderLogo provider={provider} className="h-3.5 w-3.5 flex-shrink-0" />
          {status.loading ? (
            <span className="h-3 w-28 animate-pulse rounded bg-muted" aria-hidden="true" />
          ) : (
            <>
              <span className="min-w-0 truncate font-medium text-foreground">{account}</span>
              {plan && (
                <span className="flex-shrink-0 rounded bg-primary/10 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-primary">
                  {plan}
                </span>
              )}
            </>
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="text-xs">
          <div className="flex items-start gap-2 px-2.5 py-2">
            <UserRound className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="min-w-0 space-y-0.5">
              <div className="truncate font-semibold text-foreground">{account}</div>
              {status.organization && <div className="truncate text-muted-foreground">{status.organization}</div>}
              <div className="text-muted-foreground">
                {[plan, status.method === 'api_key' ? t('workspace.account.apiKey', { defaultValue: 'API key' }) : null, status.installedVersion ? `CLI ${status.installedVersion}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {status.subscriptionOverride && (
                <div className="text-amber-600 dark:text-amber-400">
                  {t('workspace.account.keyOverridesLogin', { defaultValue: 'An API key is used instead of the subscription login' })}
                </div>
              )}
              {!status.authenticated && status.error && <div className="text-destructive">{status.error}</div>}
            </div>
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => {
              close();
              onShowSettings('agents');
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent"
          >
            <Settings className="h-3.5 w-3.5 text-muted-foreground" />
            {t('workspace.account.manage', { defaultValue: 'Accounts and agents' })}
          </button>
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-accent"
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            {t('workspace.account.source', { defaultValue: 'Source code · Layero edition' })}
          </a>
        </div>
      )}
    </WorkspacePopover>
  );
}
