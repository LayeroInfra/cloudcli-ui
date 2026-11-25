import { AlertCircle } from 'lucide-react';

type AuthErrorAlertProps = {
  errorMessage: string;
};

/** Rendered by the auth module's LoginForm and SetupForm to surface submit and session errors. */
export default function AuthErrorAlert({ errorMessage }: AuthErrorAlertProps) {
  if (!errorMessage) {
    return null;
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p className="text-[13px] leading-relaxed">{errorMessage}</p>
    </div>
  );
}
