import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { WorkspaceBuild, WorkspaceBuildDetail, WorkspaceBuildJob, WorkspaceBuildStep } from '@/shared/types.js';
import { AppError, normalizeWorkspaceOwner } from '@/shared/utils.js';

/** Woodpecker's pipeline as its REST API returns it; only the fields read here. */
type WoodpeckerPipeline = {
  number: number;
  status: string;
  event?: string;
  branch?: string;
  message?: string;
  created?: number;
  started?: number;
  finished?: number;
  variables?: Record<string, string> | null;
  workflows?: Array<{ name?: string; children?: Array<{ id: number; name?: string; state?: string; exit_code?: number; started?: number; finished?: number }> }>;
};

type WoodpeckerLogLine = { line?: number; data?: string | null };

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Where the service talks to Woodpecker; replaceable in tests. */
type WorkspaceBuildsSource = {
  serverUrl: string;
  repo: string;
  /** Branch of the pipeline repo a manual build runs on. */
  branch: string;
  readToken: () => Promise<string | null>;
  fetch: FetchLike;
};

/** Pipelines per page when scanning for one owner's builds. */
const SCAN_PAGE_SIZE = 50;
/** Pages scanned at most; with several users one owner's builds can sit behind others'. */
const SCAN_MAX_PAGES = 3;
/** Builds the drawer shows. */
const LIST_LIMIT = 20;
/** Lines of a step's log the drawer shows. */
const LOG_TAIL_LINES = 80;
/** Collapses a burst of polls from several tabs into one Woodpecker request. */
const LIST_CACHE_MS = 1500;
const REQUEST_TIMEOUT_MS = 8000;
/** The same cap `workspace-trigger-build` applies to a title. */
const TITLE_MAX_LENGTH = 80;

const TOKEN_FILE = path.join(os.homedir(), '.local', 'state', 'woodpecker', 'user.token');

/** Default titles, the same `workspace-trigger-build` uses, so both paths name runs alike. */
const DEFAULT_TITLES: Record<WorkspaceBuildJob, string> = {
  checks: 'Manual checks',
  deploy: 'Deploy workspace-ui',
};

const defaultSource = (): WorkspaceBuildsSource => ({
  // Loopback only: Woodpecker is never reached from, or exposed to, the browser.
  serverUrl: process.env.WOODPECKER_SERVER || 'http://127.0.0.1:8000',
  repo: process.env.WORKSPACE_BUILDS_REPO || 'buildadmin/cloudcli-checks',
  branch: process.env.WOODPECKER_BRANCH || 'main',
  readToken: async () => {
    if (process.env.WOODPECKER_TOKEN?.trim()) return process.env.WOODPECKER_TOKEN.trim();
    try {
      return (await readFile(TOKEN_FILE, 'utf8')).trim() || null;
    } catch {
      return null;
    }
  },
  fetch: (url, init) => fetch(url, init),
});

let source: WorkspaceBuildsSource = defaultSource();
let repoIdCache: { repo: string; id: number } | null = null;
let listCache: { at: number; pipelines: WoodpeckerPipeline[] } | null = null;

/** One line, collapsed spaces, at most 80 characters: what Woodpecker stores as the run's title. */
export function normalizeBuildTitle(title: string | undefined, job: WorkspaceBuildJob): string {
  const clean = (title ?? '').replace(/[\n\r\t]/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, TITLE_MAX_LENGTH).trim();
  return clean || DEFAULT_TITLES[job];
}

/** Woodpecker could not be asked, or did not answer usefully. `status` is its HTTP status when it answered. */
class WoodpeckerError extends AppError {
  readonly upstreamStatus: number | null;

  constructor(message: string, upstreamStatus: number | null = null) {
    super(message, { code: 'BUILDS_UNAVAILABLE', statusCode: 503 });
    this.upstreamStatus = upstreamStatus;
  }
}

async function woodpecker<T>(pathname: string, init: { method?: 'GET' | 'POST'; body?: unknown; allowEmpty?: boolean } = {}): Promise<T> {
  const token = await source.readToken();
  if (!token) throw new WoodpeckerError('Woodpecker is not configured on this server (no token).');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await source.fetch(`${source.serverUrl}${pathname}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    if (!response.ok) throw new WoodpeckerError(`Woodpecker answered ${response.status}.`, response.status);
    if (init.allowEmpty) return (await response.json().catch(() => null)) as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new WoodpeckerError('Woodpecker is unreachable.');
  } finally {
    clearTimeout(timer);
  }
}

async function repoId(): Promise<number> {
  if (repoIdCache?.repo === source.repo) return repoIdCache.id;
  const repo = await woodpecker<{ id: number }>(`/api/repos/lookup/${source.repo}`);
  repoIdCache = { repo: source.repo, id: repo.id };
  return repo.id;
}

/** The newest pipelines of the repo, a few pages deep; cached briefly so polling tabs share one scan. */
async function recentPipelines(): Promise<WoodpeckerPipeline[]> {
  const now = Date.now();
  if (listCache && now - listCache.at <= LIST_CACHE_MS) return listCache.pipelines;
  const id = await repoId();
  const pipelines: WoodpeckerPipeline[] = [];
  for (let page = 1; page <= SCAN_MAX_PAGES; page += 1) {
    const batch = await woodpecker<WoodpeckerPipeline[] | null>(`/api/repos/${id}/pipelines?page=${page}&perPage=${SCAN_PAGE_SIZE}`);
    const rows = Array.isArray(batch) ? batch : [];
    pipelines.push(...rows);
    if (rows.length < SCAN_PAGE_SIZE) break;
  }
  listCache = { at: now, pipelines };
  return pipelines;
}

const seconds = (value: number | undefined): string | null => (value && value > 0 ? new Date(value * 1000).toISOString() : null);

/** Pipelines without the owner variable predate owner routing and belong to nobody. */
const ownerOf = (pipeline: WoodpeckerPipeline): string => pipeline.variables?.WORKSPACE_OWNER ?? '';

/** Runs from before `WORKSPACE_JOB` existed were all checks. */
const jobOf = (pipeline: WoodpeckerPipeline): WorkspaceBuildJob => (pipeline.variables?.WORKSPACE_JOB === 'deploy' ? 'deploy' : 'checks');

function toBuild(pipeline: WoodpeckerPipeline): WorkspaceBuild {
  return {
    number: pipeline.number,
    status: pipeline.status,
    job: jobOf(pipeline),
    title: pipeline.variables?.WORKSPACE_BUILD_TITLE?.trim() || '',
    branch: pipeline.branch ?? '',
    event: pipeline.event ?? '',
    message: pipeline.message ?? '',
    createdAt: seconds(pipeline.created),
    startedAt: seconds(pipeline.started),
    finishedAt: seconds(pipeline.finished),
  };
}

/** Terminal colour and cursor codes the test runners print; the drawer shows plain text. */
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[A-Za-z]/g;

function decodeLogLine(line: WoodpeckerLogLine): string {
  return line.data ? Buffer.from(line.data, 'base64').toString('utf8').replace(/\n$/, '').replace(ANSI_ESCAPE, '') : '';
}

const notFound = () => new AppError('Build not found.', { code: 'BUILD_NOT_FOUND', statusCode: 404 });

/** The pipeline, when it exists and belongs to this user; anything else reads as not found. */
async function ownPipeline(username: string, number: number): Promise<{ id: number; pipeline: WoodpeckerPipeline }> {
  const owner = normalizeWorkspaceOwner(username);
  if (!owner) throw notFound();
  const id = await repoId();
  let pipeline: WoodpeckerPipeline;
  try {
    pipeline = await woodpecker<WoodpeckerPipeline>(`/api/repos/${id}/pipelines/${number}`);
  } catch (error) {
    if (error instanceof WoodpeckerError && error.upstreamStatus === 404) throw notFound();
    throw error;
  }
  if (ownerOf(pipeline) !== owner) throw notFound();
  return { id, pipeline };
}

/** Woodpecker states in which a build can still be cancelled. */
const CANCELLABLE_STATUSES = new Set(['pending', 'running', 'blocked']);

/**
 * Builds of the CloudUI checks pipeline, scoped to one user: every read and
 * trigger takes the owner from the authenticated session. This is a view
 * filter for a trusted team, not a security boundary: anyone with a shell on
 * the VM holds the same Woodpecker token.
 */
export const workspaceBuildsService = {
  /** The newest builds whose `WORKSPACE_OWNER` is this user, newest first. */
  async listBuilds(username: string): Promise<WorkspaceBuild[]> {
    const owner = normalizeWorkspaceOwner(username);
    if (!owner) return [];
    return (await recentPipelines())
      .filter((pipeline) => ownerOf(pipeline) === owner)
      .slice(0, LIST_LIMIT)
      .map(toBuild);
  },

  /**
   * One build with its steps and the tail of one step's log: the step asked
   * for, else the first failed one, else the last one. Another user's build
   * reads as not found, so its existence is not revealed either.
   */
  async getBuild(username: string, number: number, stepId?: number): Promise<WorkspaceBuildDetail> {
    const { id, pipeline } = await ownPipeline(username, number);
    const steps: WorkspaceBuildStep[] = (pipeline.workflows ?? []).flatMap((workflow) => (workflow.children ?? []).map((step) => ({
      id: step.id,
      name: step.name ?? '',
      state: step.state ?? '',
      exitCode: typeof step.exit_code === 'number' ? step.exit_code : null,
      startedAt: seconds(step.started),
      finishedAt: seconds(step.finished),
    })));
    const logStep = steps.find((step) => step.id === stepId)
      ?? steps.find((step) => step.state === 'failure' || step.state === 'error')
      ?? steps.at(-1);
    let logTail: string[] = [];
    if (logStep && logStep.state !== 'pending') {
      const lines = await woodpecker<WoodpeckerLogLine[] | null>(`/api/repos/${id}/logs/${number}/${logStep.id}`).catch(() => []);
      logTail = (Array.isArray(lines) ? lines : []).slice(-LOG_TAIL_LINES).map(decodeLogLine);
    }
    return { ...toBuild(pipeline), steps, logStepId: logStep?.id ?? null, logTail };
  },

  /**
   * Starts a checks run on this user's Mac: a manual pipeline whose
   * `WORKSPACE_OWNER` variable becomes the `owner` label only that Mac's
   * agent picks up. Same variables `workspace-trigger-build` sets.
   */
  async triggerBuild(username: string, options: { title?: string } = {}): Promise<{ number: number | null }> {
    const owner = normalizeWorkspaceOwner(username);
    if (!owner) {
      throw new AppError('A signed-in user is required to start a build.', { code: 'USER_REQUIRED', statusCode: 401 });
    }
    const job: WorkspaceBuildJob = 'checks';
    const id = await repoId();
    const pipeline = await woodpecker<Partial<WoodpeckerPipeline> | null>(`/api/repos/${id}/pipelines`, {
      method: 'POST',
      body: {
        branch: source.branch,
        variables: {
          WORKSPACE_OWNER: owner,
          WORKSPACE_JOB: job,
          WORKSPACE_BUILD_TITLE: normalizeBuildTitle(options.title, job),
        },
      },
    });
    listCache = null;
    return { number: typeof pipeline?.number === 'number' ? pipeline.number : null };
  },

  /**
   * Cancels one of this user's queued or running builds: the way out of a
   * build no Mac will ever pick up. A finished build is left as it is.
   */
  async cancelBuild(username: string, number: number): Promise<{ cancelled: boolean }> {
    const { id, pipeline } = await ownPipeline(username, number);
    if (!CANCELLABLE_STATUSES.has(pipeline.status)) return { cancelled: false };
    // Woodpecker answers with no body.
    await woodpecker<unknown>(`/api/repos/${id}/pipelines/${number}/cancel`, { method: 'POST', allowEmpty: true });
    listCache = null;
    return { cancelled: true };
  },

  /** Test hook: replace the Woodpecker endpoint, token and fetch; no argument restores the defaults. */
  setSource(next?: Partial<WorkspaceBuildsSource>): void {
    source = { ...defaultSource(), ...next };
    repoIdCache = null;
    listCache = null;
  },
};
