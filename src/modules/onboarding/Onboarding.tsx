import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { LLMProvider } from '@/shared/types';
import { api, readApiErrorMessage } from '@/shared/api';
import { Button, LayeroWorkspaceLockup } from '@/shared/ui';
import { ProviderLoginModal, useProviderAuthStatus } from '@/modules/provider-auth';
import AgentConnectionsStep from '@/modules/onboarding/AgentConnectionsStep';
import GitConfigurationStep from '@/modules/onboarding/GitConfigurationStep';
import OnboardingStepProgress from '@/modules/onboarding/OnboardingStepProgress';

const gitEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const readErrorMessageFromResponse = async (response: Response, fallback: string) => {
  try {
    return readApiErrorMessage(await response.json()) ?? fallback;
  } catch {
    return fallback;
  }
};

type OnboardingProps = {
  onComplete?: () => void | Promise<void>;
};

/** Used by the auth module's ProtectedRoute to run first-time git and agent setup before the app loads. */
export default function Onboarding({ onComplete }: OnboardingProps) {
  const { t } = useTranslation('auth');
  const [currentStep, setCurrentStep] = useState(0);
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [activeLoginProvider, setActiveLoginProvider] = useState<LLMProvider | null>(null);
  const {
    providerAuthStatus,
    checkProviderAuthStatus,
    refreshProviderAuthStatuses,
  } = useProviderAuthStatus();

  const previousActiveLoginProviderRef = useRef<LLMProvider | null | undefined>(undefined);

  const loadGitConfig = useCallback(async () => {
    try {
      const response = await api.user.gitConfig();
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { gitName?: string; gitEmail?: string };
      if (payload.gitName) {
        setGitName(payload.gitName);
      }
      if (payload.gitEmail) {
        setGitEmail(payload.gitEmail);
      }
    } catch (caughtError) {
      console.error('Error loading git config:', caughtError);
    }
  }, []);

  useEffect(() => {
    void loadGitConfig();
    void refreshProviderAuthStatuses();
  }, [loadGitConfig, refreshProviderAuthStatuses]);

  useEffect(() => {
    const previousProvider = previousActiveLoginProviderRef.current;
    previousActiveLoginProviderRef.current = activeLoginProvider;

    const didCloseModal = previousProvider !== undefined
      && previousProvider !== null
      && activeLoginProvider === null;

    // Refresh statuses after the login modal is closed.
    if (didCloseModal) {
      void refreshProviderAuthStatuses();
    }
  }, [activeLoginProvider, refreshProviderAuthStatuses]);

  const handleProviderLoginOpen = (provider: LLMProvider) => {
    setActiveLoginProvider(provider);
  };

  const handleLoginComplete = (exitCode: number) => {
    if (exitCode === 0 && activeLoginProvider) {
      void checkProviderAuthStatus(activeLoginProvider);
    }
  };

  const handleNextStep = async () => {
    setErrorMessage('');

    if (currentStep !== 0) {
      setCurrentStep((previous) => previous + 1);
      return;
    }

    if (!gitName.trim() || !gitEmail.trim()) {
      setErrorMessage(t('onboarding.errorNameEmailRequired'));
      return;
    }

    if (!gitEmailPattern.test(gitEmail)) {
      setErrorMessage(t('onboarding.errorInvalidEmail'));
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.user.updateGitConfig(gitName, gitEmail);

      if (!response.ok) {
        const message = await readErrorMessageFromResponse(response, t('onboarding.errorSaveGitConfig'));
        throw new Error(message);
      }

      setCurrentStep((previous) => previous + 1);
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : t('onboarding.errorSaveGitConfig'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePreviousStep = () => {
    setErrorMessage('');
    setCurrentStep((previous) => previous - 1);
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const response = await api.user.completeOnboarding();
      if (!response.ok) {
        const message = await readErrorMessageFromResponse(response, t('onboarding.errorCompleteOnboarding'));
        throw new Error(message);
      }

      await onComplete?.();
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : t('onboarding.errorCompleteOnboarding'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isCurrentStepValid = currentStep === 0
    ? Boolean(gitName.trim() && gitEmail.trim() && gitEmailPattern.test(gitEmail))
    : true;

  return (
    <>
      <div className="relative h-screen overflow-y-auto bg-background">
        <div className="relative mx-auto flex min-h-full w-full max-w-xl items-center justify-center p-4">
          <div className="w-full py-6 motion-safe:animate-auth-rise">
          <div className="mb-6 flex justify-center">
            <LayeroWorkspaceLockup size="lg" />
          </div>

          <OnboardingStepProgress currentStep={currentStep} />

          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]">
            {currentStep === 0 ? (
              <GitConfigurationStep
                gitName={gitName}
                gitEmail={gitEmail}
                isSubmitting={isSubmitting}
                onGitNameChange={setGitName}
                onGitEmailChange={setGitEmail}
              />
            ) : (
              <AgentConnectionsStep
                providerStatuses={providerAuthStatus}
                onOpenProviderLogin={handleProviderLoginOpen}
              />
            )}

              {errorMessage && (
                <div
                  role="alert"
                  className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800/50 dark:bg-red-950/30"
                >
                  <p className="text-[13px] text-red-700 dark:text-red-300">{errorMessage}</p>
                </div>
              )}

            <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
              <Button
                variant="ghost"
                onClick={handlePreviousStep}
                disabled={currentStep === 0 || isSubmitting}
                className="text-muted-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
                {t('onboarding.previous')}
              </Button>

              <div className="flex items-center gap-3">
                {currentStep < 1 ? (
                  <Button
                    onClick={handleNextStep}
                    disabled={!isCurrentStepValid || isSubmitting}
                    className="px-5"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('onboarding.saving')}
                      </>
                    ) : (
                      <>
                        {t('onboarding.next')}
                        <ChevronRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={handleFinish}
                    disabled={isSubmitting}
                    className="px-5"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('onboarding.completing')}
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4" />
                        {t('onboarding.completeSetup')}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

      {activeLoginProvider && (
        <ProviderLoginModal
          isOpen={Boolean(activeLoginProvider)}
          onClose={() => setActiveLoginProvider(null)}
          provider={activeLoginProvider}
          onComplete={handleLoginComplete}
        />
      )}
    </>
  );
}
