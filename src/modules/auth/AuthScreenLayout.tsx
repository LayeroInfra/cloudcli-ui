import type { ReactNode } from 'react';

import { LayeroMark, LayeroWorkspaceLockup } from '@/shared/ui';

type AuthScreenLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
  footerText: string;
};

/**
 * Wraps the auth module's LoginForm and SetupForm so both full-screen auth
 * pages share one layout. It follows the Layero panel's sign-in page: a flat
 * page, a narrow centred column, the brand mark above a plain heading, and no
 * decorative backdrop competing with the form.
 */
export default function AuthScreenLayout({
  title,
  description,
  children,
  footerText,
}: AuthScreenLayoutProps) {
  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-background">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm motion-safe:animate-auth-rise">
          <div className="mb-8 flex flex-col items-center text-center">
            <LayeroMark className="h-11 w-11 shadow-sm" />
            <h1 className="mt-6 text-2xl font-semibold tracking-tightish text-foreground">{title}</h1>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] sm:p-7">
            {children}
          </div>

          <p className="mx-auto mt-5 max-w-xs text-center text-xs leading-relaxed text-muted-foreground">
            {footerText}
          </p>
        </div>
      </main>

      <footer className="flex justify-center pb-6 pt-2">
        <LayeroWorkspaceLockup className="opacity-60" />
      </footer>
    </div>
  );
}
