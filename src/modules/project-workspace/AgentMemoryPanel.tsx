import { AlertTriangle, Brain, ChevronRight, FileText, Loader2, RefreshCw, Save, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import type {
  AgentInstructions,
  AgentMemoryFact,
  AgentMemoryIssue,
  AgentMemoryMap,
  AgentMemoryStore,
  AgentProjectInstructionFile,
} from '@/shared/types';
import { cn } from '@/shared/utils';

type AgentMemoryPanelProps = {
  open: boolean;
  onClose: () => void;
  /** The open project's folder, for its own CLAUDE.md files. */
  projectPath: string | null;
  /** Opens a file in the editor beside the chat. */
  onOpenFile: (filePath: string) => void;
};

type Tab = 'memory' | 'instructions';
type InstructionsPayload = AgentInstructions & { projectFiles: AgentProjectInstructionFile[] };
type Envelope<T> = { data?: T; error?: { message?: string } | string };

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;

const TYPE_CLASS: Record<string, string> = {
  user: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  feedback: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  project: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  reference: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
};

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (response.ok && payload?.data) return payload.data;
  const error = payload?.error;
  throw new Error((typeof error === 'string' ? error : error?.message) || `${fallback} (HTTP ${response.status}).`);
}

/** "14:32" today, else "25 Nov". */
function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function TypeBadge({ type }: { type: string | null }) {
  return (
    <span className={cn('rounded px-1.5 py-px text-[10px] font-medium leading-4', type ? TYPE_CLASS[type] ?? 'bg-muted text-muted-foreground' : 'bg-muted text-muted-foreground')}>
      {type ?? 'untyped'}
    </span>
  );
}

function IssueList({ issues }: { issues: AgentMemoryIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {issues.map((issue, index) => (
        <li key={`${issue.kind}-${issue.file ?? ''}-${index}`} className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" />
          <span>{issue.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function FactRow({ fact, issues, knownSlugs }: { fact: AgentMemoryFact; issues: AgentMemoryIssue[]; knownSlugs: Set<string> }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <li className="rounded-md border border-border/60" data-fact={fact.file}>
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        aria-expanded={isOpen}
        className="flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent/50"
      >
        <ChevronRight className={cn('mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type={fact.type} />
            <span className="truncate text-sm font-medium text-foreground">{fact.name ?? fact.file}</span>
            {issues.length > 0 && <AlertTriangle className="h-3 w-3 text-amber-500" aria-label={`${issues.length} issues`} />}
          </span>
          {fact.description && <span className="mt-0.5 block text-xs text-muted-foreground">{fact.description}</span>}
        </span>
        <span className="flex-shrink-0 text-[11px] text-muted-foreground">{formatWhen(fact.updatedAt)}</span>
      </button>
      {isOpen && (
        <div className="space-y-2 border-t border-border/60 px-3 py-2">
          <IssueList issues={issues} />
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
            {fact.body || '(empty)'}
          </pre>
          {fact.links.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="text-muted-foreground">Links:</span>
              {fact.links.map((link) => (
                <span
                  key={link}
                  className={cn('rounded px-1.5 font-mono', knownSlugs.has(link) ? 'bg-muted text-foreground' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400')}
                  title={knownSlugs.has(link) ? undefined : 'Not written yet'}
                >
                  [[{link}]]
                </span>
              ))}
            </div>
          )}
          <div className="font-mono text-[10px] text-muted-foreground">{fact.file} · {fact.size} B</div>
        </div>
      )}
    </li>
  );
}

function StoreSection({ store, typeFilter }: { store: AgentMemoryStore; typeFilter: string | null }) {
  const { t } = useTranslation();
  const [showIndex, setShowIndex] = useState(false);
  const knownSlugs = useMemo(() => new Set(store.facts.flatMap((fact) => [fact.file.replace(/\.md$/, ''), ...(fact.name ? [fact.name] : [])])), [store.facts]);
  const facts = typeFilter ? store.facts.filter((fact) => fact.type === typeFilter) : store.facts;
  const storeIssues = store.issues.filter((issue) => !issue.file || !store.facts.some((fact) => fact.file === issue.file));

  if (typeFilter && facts.length === 0) return null;

  return (
    <section className="rounded-lg border border-border/70" data-store={store.id}>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs font-medium text-foreground" title={store.id}>{store.projectPath ?? store.id}</div>
          <div className="text-[11px] text-muted-foreground">
            {[
              t('workspace.memory.factCount', { count: store.facts.length, defaultValue: '{{count}} facts' }),
              store.issues.length > 0 && t('workspace.memory.issueCount', { count: store.issues.length, defaultValue: '{{count}} issues' }),
              store.updatedAt && formatWhen(store.updatedAt),
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        {store.index.exists && (
          <button
            type="button"
            onClick={() => setShowIndex((previous) => !previous)}
            aria-pressed={showIndex}
            className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors', showIndex ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/70')}
          >
            MEMORY.md
          </button>
        )}
      </div>
      <div className="space-y-2 px-2 pb-2">
        {storeIssues.length > 0 && <div className="px-1"><IssueList issues={storeIssues} /></div>}
        {showIndex && (
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">{store.index.raw}</pre>
        )}
        <ul className="space-y-1">
          {facts.map((fact) => (
            <FactRow key={fact.file} fact={fact} knownSlugs={knownSlugs} issues={store.issues.filter((issue) => issue.file === fact.file)} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function MemoryTab({ map, typeFilter, onTypeFilter }: { map: AgentMemoryMap; typeFilter: string | null; onTypeFilter: (type: string | null) => void }) {
  const { t } = useTranslation();
  const [showEmpty, setShowEmpty] = useState(false);
  const filled = map.stores.filter((store) => store.facts.length > 0 || store.issues.length > 0);
  const empty = map.stores.filter((store) => !filled.includes(store));
  const allFacts = filled.flatMap((store) => store.facts);
  const issueCount = map.stores.reduce((sum, store) => sum + store.issues.length, 0);

  return (
    <div className="space-y-2">
      <p className="px-1 text-[11px] text-muted-foreground">
        {t('workspace.memory.summary', {
          facts: allFacts.length,
          stores: filled.length,
          defaultValue: '{{facts}} facts in {{stores}} projects',
        })}
        {issueCount > 0 && <span className="text-amber-700 dark:text-amber-400"> · {t('workspace.memory.issueCount', { count: issueCount, defaultValue: '{{count}} issues' })}</span>}
        {' · '}
        {t('workspace.memory.shared', { defaultValue: 'shared by everyone on this workspace' })}
      </p>

      {allFacts.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1" role="group" aria-label="Type">
          {[null, ...MEMORY_TYPES].map((type) => {
            const count = type ? allFacts.filter((fact) => fact.type === type).length : allFacts.length;
            return (
              <button
                key={type ?? 'all'}
                type="button"
                onClick={() => onTypeFilter(type)}
                aria-pressed={typeFilter === type}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  typeFilter === type ? 'border-foreground/30 bg-accent text-foreground' : 'border-border text-muted-foreground hover:bg-accent/60',
                )}
              >
                {type ?? t('workspace.memory.all', { defaultValue: 'All' })} {count}
              </button>
            );
          })}
        </div>
      )}

      {filled.length === 0 ? (
        <div className="px-6 py-5 text-center">
          <p className="text-sm font-medium text-foreground">{t('workspace.memory.emptyTitle', { defaultValue: 'Nothing remembered yet' })}</p>
          <p className="text-xs text-muted-foreground">
            {t('workspace.memory.emptyHint', { defaultValue: 'Facts the agent saves to its memory show up here, by project.' })}
          </p>
        </div>
      ) : (
        filled.map((store) => <StoreSection key={store.id} store={store} typeFilter={typeFilter} />)
      )}

      {empty.length > 0 && (
        <div className="px-1">
          <button type="button" onClick={() => setShowEmpty((previous) => !previous)} aria-expanded={showEmpty} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn('h-3 w-3 transition-transform', showEmpty && 'rotate-90')} aria-hidden="true" />
            {t('workspace.memory.emptyStores', { count: empty.length, defaultValue: '{{count}} projects with empty memory' })}
          </button>
          {showEmpty && (
            <ul className="mt-1 space-y-0.5 pl-4">
              {empty.map((store) => <li key={store.id} className="truncate font-mono text-[11px] text-muted-foreground">{store.projectPath ?? store.id}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function InstructionsTab({ projectPath, onOpenFile }: { projectPath: string | null; onOpenFile: (filePath: string) => void }) {
  const { t } = useTranslation();
  // The file as last read or saved; the base a save must start from.
  const [loaded, setLoaded] = useState<InstructionsPayload | null>(null);
  // The text in the editor.
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Set when a save was refused because the file changed underneath.
  const [conflict, setConflict] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await readJson<InstructionsPayload>(await api.agentMemory.instructions(projectPath ?? undefined), 'Instructions are unavailable');
      setLoaded(data);
      setDraft(data.content);
      setError(null);
      setConflict(false);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, [projectPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!loaded) return;
    setIsSaving(true);
    try {
      const response = await api.agentMemory.saveInstructions(draft, loaded.updatedAt);
      if (response.status === 409) setConflict(true);
      const data = await readJson<AgentInstructions>(response, 'CLAUDE.md could not be saved');
      setLoaded({ ...loaded, ...data });
      setDraft(data.content);
      setError(null);
      setConflict(false);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!loaded) {
    return error
      ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      : <div className="h-40 animate-pulse rounded-lg bg-muted" aria-hidden="true" />;
  }

  const dirty = draft !== loaded.content;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="px-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-medium text-foreground">{loaded.path}</span>
          {!loaded.exists && <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{t('workspace.memory.notCreated', { defaultValue: 'not created' })}</span>}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t('workspace.memory.instructionsHint', { defaultValue: 'Loaded into every Claude session on this workspace, whatever the project. Edits apply to sessions started after saving.' })}
        </p>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span className="flex-1">{error}</span>
          {conflict && (
            <button type="button" onClick={() => void load()} className="rounded border border-destructive/40 px-2 py-0.5 hover:bg-destructive/10">
              {t('workspace.memory.reload', { defaultValue: 'Reload' })}
            </button>
          )}
        </div>
      )}

      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
        aria-label="CLAUDE.md"
        placeholder={t('workspace.memory.instructionsPlaceholder', { defaultValue: '# Rules for every session\n\n- Builds and tests run only through Woodpecker…' })}
        className="min-h-[16rem] flex-1 resize-none rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed text-foreground outline-none focus:border-ring"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 's') {
            event.preventDefault();
            if (dirty && !isSaving) void save();
          }
        }}
      />

      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11px] text-muted-foreground">{loaded.updatedAt && t('workspace.memory.savedAt', { when: formatWhen(loaded.updatedAt), defaultValue: 'Changed {{when}}' })}</span>
        <button
          type="button"
          onClick={() => setDraft(loaded.content)}
          disabled={!dirty || isSaving}
          className="h-7 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          {t('workspace.memory.revert', { defaultValue: 'Revert' })}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || isSaving}
          className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {loaded.exists ? t('workspace.memory.save', { defaultValue: 'Save' }) : t('workspace.memory.create', { defaultValue: 'Create' })}
        </button>
      </div>

      {loaded.projectFiles.length > 0 && (
        <div className="border-t border-border/60 px-1 pt-2">
          <p className="mb-1 text-[11px] text-muted-foreground">
            {t('workspace.memory.projectFilesHint', { defaultValue: 'Added on top in this project only:' })}
          </p>
          <ul className="space-y-0.5">
            {loaded.projectFiles.map((file) => (
              <li key={file.path}>
                {file.exists ? (
                  <button type="button" onClick={() => onOpenFile(file.path)} className="flex items-center gap-1.5 font-mono text-xs text-foreground hover:underline">
                    <FileText className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                    {file.name}
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground/60">
                    <FileText className="h-3 w-3" aria-hidden="true" />
                    {file.name} · {t('workspace.memory.absent', { defaultValue: 'none' })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Rendered by WorkspaceMain as a card over the right of the chat: the agent's
 * own memory and instructions, the same for everyone on the workspace. The
 * Memory tab lists Claude's auto-memory by project with what sessions never
 * see (facts missing from MEMORY.md, broken links, duplicates); the
 * Instructions tab edits the global `~/.claude/CLAUDE.md` and links the open
 * project's own instruction files.
 */
export default function AgentMemoryPanel({ open, onClose, projectPath, onOpenFile }: AgentMemoryPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('memory');
  const [map, setMap] = useState<AgentMemoryMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      setMap(await readJson<AgentMemoryMap>(await api.agentMemory.map(), 'Memory is unavailable'));
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const tabButton = (id: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={cn('h-7 rounded-md px-2 text-xs transition-colors', tab === id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60')}
    >
      {label}
    </button>
  );

  return (
    <aside
      aria-label={t('workspace.memory.title', { defaultValue: 'Agent memory' })}
      className="pointer-events-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
    >
      <div className="flex h-10 flex-shrink-0 items-center gap-1 border-b border-border px-3">
        <Brain className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="ml-1 mr-2 text-sm font-semibold">{t('workspace.memory.title', { defaultValue: 'Agent memory' })}</h2>
        <div role="tablist" className="flex flex-1 items-center gap-0.5">
          {tabButton('memory', t('workspace.memory.tabMemory', { defaultValue: 'Memory' }))}
          {tabButton('instructions', t('workspace.memory.tabInstructions', { defaultValue: 'Instructions' }))}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label={t('workspace.builds.refresh', { defaultValue: 'Refresh' })}
          title={t('workspace.builds.refresh', { defaultValue: 'Refresh' })}
          className={cn('flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', tab !== 'memory' && 'invisible')}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('workspace.close', { defaultValue: 'Close' })}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
        <div className={cn(tab !== 'memory' && 'hidden')}>
            {error && <p role="alert" className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
            {map ? (
              <MemoryTab map={map} typeFilter={typeFilter} onTypeFilter={setTypeFilter} />
            ) : (
              !error && [0, 1, 2].map((row) => <div key={row} className="mb-1 h-12 animate-pulse rounded-lg bg-muted" aria-hidden="true" />)
            )}
        </div>
        {/* Kept mounted so switching tabs never drops an unsaved edit. */}
        <div className={cn('flex min-h-0 flex-1 flex-col', tab !== 'instructions' && 'hidden')}>
          <InstructionsTab projectPath={projectPath} onOpenFile={onOpenFile} />
        </div>
      </div>
    </aside>
  );
}
