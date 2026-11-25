import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useVersionCheck } from '@/shared/hooks/useVersionCheck';
import { LayeroMark, LayeroWorkspaceLockup } from '@/shared/ui';

/** Layero's public site. */
const LAYERO_URL = 'https://layero.ru';
/** This fork's source; AGPL-3.0 requires offering it to every network user. */
const SOURCE_URL = 'https://github.com/LayeroInfra/cloudcli-ui';
/** The upstream project this fork is built on, credited as its licence requires. */
const UPSTREAM_URL = 'https://github.com/siteboon/claudecodeui';

const LINK_ROW =
  'flex items-center justify-between gap-3 px-4 py-3 text-sm text-foreground transition-colors hover:bg-accent/60';

/** Rendered by Settings for the "about" tab: the product, its version, and where its source lives. */
export default function AboutTab() {
  const { t } = useTranslation('settings');
  // Only the running version is shown: update checks still target the upstream
  // project's releases, which are not Layero Workspace releases.
  const { currentVersion } = useVersionCheck('siteboon', 'claudecodeui');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <LayeroMark className="h-12 w-12 shadow-sm" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <LayeroWorkspaceLockup />
            <span className="rounded-md border border-border-soft bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              v{currentVersion}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t('about.tagline', { defaultValue: 'A remote workspace for AI coding agents on Layero' })}
          </p>
        </div>
      </div>

      <div className="divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-card">
        <a href={LAYERO_URL} target="_blank" rel="noopener noreferrer" className={LINK_ROW}>
          <span>layero.ru</span>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        </a>
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={LINK_ROW}>
          <span>{t('about.source', { defaultValue: 'Source code' })}</span>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        </a>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('about.basedOn', { defaultValue: 'Built on the open-source' })}{' '}
        <a
          href={UPSTREAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-border-strong underline-offset-2 transition-colors hover:text-foreground"
        >
          CloudCLI UI
        </a>{' '}
        © Siteboon AI B.V. {t('about.licensed')}
      </p>
    </div>
  );
}
