import { Check, GitBranch, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type OnboardingStepProgressProps = {
  currentStep: number;
};

const onboardingSteps = [
  { titleKey: 'onboarding.gitStepTitle', icon: GitBranch, required: true },
  { titleKey: 'onboarding.stepConnectAgents', icon: LogIn, required: false },
];

/** Rendered by Onboarding above the active step to show progress through the setup wizard. */
export default function OnboardingStepProgress({ currentStep }: OnboardingStepProgressProps) {
  const { t } = useTranslation('auth');
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between">
        {onboardingSteps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isActive = index === currentStep;
          const Icon = step.icon;

          return (
            <div key={step.titleKey} className="contents">
              <div className="flex flex-1 flex-col items-center">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors duration-200 ${
                    isCompleted
                      ? 'border-leaf bg-leaf text-white'
                      : isActive
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-muted-foreground'
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>

                <div className="mt-1.5 text-center">
                  <p className={`text-sm font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {t(step.titleKey)}
                  </p>
                  {step.required && <span className="text-xs text-muted-foreground">{t('onboarding.required')}</span>}
                </div>
              </div>

              {index < onboardingSteps.length - 1 && (
                <div className={`mx-2 h-px flex-1 transition-colors duration-200 ${isCompleted ? 'bg-leaf' : 'bg-border'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
