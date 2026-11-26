import { AlertTriangle, Brain, ChevronRight, FileText, FolderOpen, Loader2, RefreshCw, Save, X } from 'lucide-react';
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

const TYPE_DOT: Record<string, string> = {
  user: 'bg-sky-500',
  feedback: 'bg-amber-500',
  project: 'bg-emerald-500',
  reference: 'bg-violet-500',
};

const dotFor = (type: string | null) => (type && TYPE_DOT[type]) || 'bg-muted-foreground/40';

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
    <ul className="space-y-0.5 rounded-md bg-amber-500/10 px-2 py-1.5">
      {issues.map((issue, index) => (
        <li key={`${issue.kind}-${issue.file ?? ''}-${index}`} className="flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" />
          <span>{issue.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/** The last folder of a path, with the rest beside it in muted type. */
function splitPath(fullPath: string): { name: string; parent: string } {
  const trimmed = fullPath.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  return cut <= 0 ? { name: trimmed || '/', parent: '' } : { name: trimmed.slice(cut + 1), parent: trimmed.slice(0, cut) };
}

function FactRow({ fact, issues, knownSlugs }: { fact: AgentMemoryFact; issues: AgentMemoryIssue[]; knownSlugs: Set<string> }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <li data-fact={fact.file}>
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        aria-expanded={isOpen}
        className={cn('group flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/40', isOpen && 'bg-accent/30')}
      >
        <span className={cn('mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full', dotFor(fact.type))} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">{fact.name ?? fact.file}</span>
            {issues.length > 0 && <AlertTriangle className="h-3 w-3 flex-shrink-0 text-amber-500" aria-label={`${issues.length} issues`} />}
          </span>
          {fact.description && <span className={cn('mt-0.5 block text-xs leading-snug text-muted-foreground', !isOpen && 'line-clamp-2')}>{fact.description}</span>}
        </span>
        <span className="mt-0.5 flex flex-shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">{fact.type ?? 'untyped'}</span>
          <span className="tabular-nums">{formatWhen(fact.updatedAt)}</span>
        </span>
      </button>
      {isOpen && (
        <div className="space-y-2 bg-accent/30 px-3 pb-3 pl-7">
          <IssueList issues={issues} />
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">
            {fact.body || '(empty)'}
          </pre>
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <TypeBadge type={fact.type} />
            <span className="font-mono">{fact.file}</span>
            <span>· {fact.size} B</span>
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
        </div>
      )}
    </li>
  );
}

/** One project's memory, folded to its header until opened. */
function StoreSection({ store, typeFilter, isOpen, onToggle }: { store: AgentMemoryStore; typeFilter: string | null; isOpen: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const [showIndex, setShowIndex] = useState(false);
  const knownSlugs = useMemo(() => new Set(store.facts.flatMap((fact) => [fact.file.replace(/\.md$/, ''), ...(fact.name ? [fact.name] : [])])), [store.facts]);
  const facts = typeFilter ? store.facts.filter((fact) => fact.type === typeFilter) : store.facts;
  const storeIssues = store.issues.filter((issue) => !issue.file || !store.facts.some((fact) => fact.file === issue.file));
  const typeCounts = MEMORY_TYPES.map((type) => [type, store.facts.filter((fact) => fact.type === type).length] as const).filter(([, count]) => count > 0);
  const { name, parent } = splitPath(store.projectPath ?? store.id);

  if (typeFilter && facts.length === 0) return null;

  return (
    <section className={cn('overflow-hidden rounded-lg border transition-colors', isOpen ? 'border-border bg-background' : 'border-border/60 bg-background/40 hover:border-border')} data-store={store.id}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform duration-150', isOpen && 'rotate-90')} aria-hidden="true" />
        <FolderOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground" title={store.projectPath ?? store.id}>{name}</span>
          {parent && <span className="block truncate font-mono text-[10px] text-muted-foreground">{parent}</span>}
        </span>
        <span className="flex flex-shrink-0 items-center gap-2">
          {typeCounts.map(([type, count]) => (
            <span key={type} className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground" title={type}>
              <span className={cn('h-1.5 w-1.5 rounded-full', dotFor(type))} aria-hidden="true" />
              {count}
            </span>
          ))}
          {store.issues.length > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-medium leading-4 text-amber-700 dark:text-amber-300" title={t('workspace.memory.issueCount', { count: store.issues.length, defaultValue: '{{count}} issues' })}>
              <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
              {store.issues.length}
            </span>
          )}
          <span className="w-12 text-right text-[11px] tabular-nums text-muted-foreground">{formatWhen(store.updatedAt)}</span>
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-border/60">
          {(storeIssues.length > 0 || store.index.exists) && (
            <div className="flex items-start gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">{storeIssues.length > 0 && <IssueList issues={storeIssues} />}</div>
              {store.index.exists && (
                <button
                  type="button"
                  onClick={() => setShowIndex((previous) => !previous)}
                  aria-pressed={showIndex}
                  className={cn('flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors', showIndex ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/70')}
                >
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  MEMORY.md · {store.index.lines}
                </button>
              )}
            </div>
          )}
          {showIndex && (
            <pre className="mx-3 mb-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">{store.index.raw}</pre>
          )}
          <ul className="divide-y divide-border/50 border-t border-border/40">
            {facts.map((fact) => (
              <FactRow key={fact.file} fact={fact} knownSlugs={knownSlugs} issues={store.issues.filter((issue) => issue.file === fact.file)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function MemoryTab({ map, typeFilter, onTypeFilter }: { map: AgentMemoryMap; typeFilter: string | null; onTypeFilter: (type: string | null) => void }) {
  const { t } = useTranslation();
  const [showEmpty, setShowEmpty] = useState(false);
  // Groups start folded; a type filter unfolds the ones it matches. A click
  // flips a group from that default, until the filter changes again.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  useEffect(() => setFlipped(new Set()), [typeFilter]);

  const filled = map.stores.filter((store) => store.facts.length > 0 || store.issues.length > 0);
  const empty = map.stores.filter((store) => !filled.includes(store));
  const allFacts = filled.flatMap((store) => store.facts);
  const issueCount = map.stores.reduce((sum, store) => sum + store.issues.length, 0);
  const presentTypes = MEMORY_TYPES.filter((type) => allFacts.some((fact) => fact.type === type));
  const allOpen = filled.length > 0 && filled.every((store) => (typeFilter !== null) !== flipped.has(store.id));

  const toggle = (id: string) => setFlipped((previous) => {
    const next = new Set(previous);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const setAll = (open: boolean) => setFlipped(new Set(open === (typeFilter !== null) ? [] : filled.map((store) => store.id)));

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold tabular-nums text-foreground">{allFacts.length}</span>
            <span className="text-xs text-muted-foreground">
              {t('workspace.memory.factsIn', { count: filled.length, defaultValue: 'facts in {{count}} projects' })}
            </span>
            {issueCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {t('workspace.memory.issueCount', { count: issueCount, defaultValue: '{{count}} issues' })}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">{t('workspace.memory.shared', { defaultValue: 'Shared by everyone on this workspace' })}</p>
        </div>
        {filled.length > 1 && (
          <button type="button" onClick={() => setAll(!allOpen)} className="flex-shrink-0 text-[11px] text-muted-foreground hover:text-foreground">
            {allOpen ? t('workspace.memory.collapseAll', { defaultValue: 'Collapse all' }) : t('workspace.memory.expandAll', { defaultValue: 'Expand all' })}
          </button>
        )}
      </div>

      {presentTypes.length > 1 && (
        <div className="flex flex-wrap gap-1 px-1" role="group" aria-label="Type">
          {[null, ...presentTypes].map((type) => {
            const count = type ? allFacts.filter((fact) => fact.type === type).length : allFacts.length;
            const active = typeFilter === type;
            return (
              <button
                key={type ?? 'all'}
                type="button"
                onClick={() => onTypeFilter(type)}
                aria-pressed={active}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                  active ? 'border-foreground/25 bg-accent text-foreground' : 'border-border/70 text-muted-foreground hover:bg-accent/60',
                )}
              >
                {type && <span className={cn('h-1.5 w-1.5 rounded-full', dotFor(type))} aria-hidden="true" />}
                {type ?? t('workspace.memory.all', { defaultValue: 'All' })}
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {filled.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-6 py-8 text-center">
          <Brain className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">{t('workspace.memory.emptyTitle', { defaultValue: 'Nothing remembered yet' })}</p>
          <p className="text-xs text-muted-foreground">
            {t('workspace.memory.emptyHint', { defaultValue: 'Facts the agent saves to its memory show up here, by project.' })}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filled.map((store) => (
            <StoreSection
              key={store.id}
              store={store}
              typeFilter={typeFilter}
              isOpen={(typeFilter !== null) !== flipped.has(store.id)}
              onToggle={() => toggle(store.id)}
            />
          ))}
        </div>
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
