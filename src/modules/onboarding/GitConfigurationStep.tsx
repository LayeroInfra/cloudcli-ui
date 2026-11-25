import { GitBranch, Mail, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type GitConfigurationStepProps = {
  gitName: string;
  gitEmail: string;
  isSubmitting: boolean;
  onGitNameChange: (value: string) => void;
  onGitEmailChange: (value: string) => void;
};

/** Rendered by Onboarding as its first step, collecting the git identity used for commits. */
export default function GitConfigurationStep({
  gitName,
  gitEmail,
  isSubmitting,
  onGitNameChange,
  onGitEmailChange,
}: GitConfigurationStepProps) {
  const { t } = useTranslation('auth');
  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border-soft bg-muted">
          <GitBranch className="h-5 w-5 text-foreground" />
        </div>
        <h2 className="text-xl font-semibold tracking-tightish text-foreground">{t('onboarding.gitStepTitle')}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {t('onboarding.gitStepDescription')}
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="gitName" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-foreground">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            {t('onboarding.gitNameLabel')} <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            id="gitName"
            value={gitName}
            onChange={(event) => onGitNameChange(event.target.value)}
            className="h-11 w-full rounded-lg border border-input bg-card px-3.5 text-base text-foreground shadow-sm transition-colors placeholder:text-muted-foreground/70 hover:border-border-strong focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/10 sm:text-sm"
            placeholder={t('onboarding.gitNamePlaceholder')}
            required
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t('onboarding.gitNameHint')}</p>
        </div>

        <div>
          <label htmlFor="gitEmail" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-foreground">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            {t('onboarding.gitEmailLabel')} <span className="text-destructive">*</span>
          </label>
          <input
            type="email"
            id="gitEmail"
            value={gitEmail}
            onChange={(event) => onGitEmailChange(event.target.value)}
            className="h-11 w-full rounded-lg border border-input bg-card px-3.5 text-base text-foreground shadow-sm transition-colors placeholder:text-muted-foreground/70 hover:border-border-strong focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/10 sm:text-sm"
            placeholder={t('onboarding.gitEmailPlaceholder')}
            required
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t('onboarding.gitEmailHint')}</p>
        </div>
      </div>
    </div>
  );
}
