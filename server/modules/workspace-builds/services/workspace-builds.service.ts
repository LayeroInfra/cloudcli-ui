import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { WorkspaceBuild, WorkspaceBuildDetail, WorkspaceBuildStep } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

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

type WoodpeckerLogLine = { line?: number; data?: string };

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

type TriggerRunner = (owner: string) => Promise<string>;

/** Where the service talks to Woodpecker and how it starts a build; replaceable in tests. */
type WorkspaceBuildsSource = {
  serverUrl: string;
  repo: string;
  readToken: () => Promise<string | null>;
  fetch: FetchLike;
  trigger: TriggerRunner;
};

/** Pipelines scanned per list request; only the session owner's are kept. */
const SCAN_PAGE_SIZE = 50;
/** Builds the drawer shows. */
const LIST_LIMIT = 20;
/** Lines of a step's log the drawer shows. */
const LOG_TAIL_LINES = 80;
/** Collapses a burst of polls from several tabs into one Woodpecker request. */
const LIST_CACHE_MS = 1500;
const REQUEST_TIMEOUT_MS = 8000;
const TRIGGER_TIMEOUT_MS = 30_000;

const TOKEN_FILE = path.join(os.homedir(), '.local', 'state', 'woodpecker', 'user.token');
const TRIGGER_BIN = path.join(os.homedir(), '.local', 'bin', 'workspace-trigger-build');

const defaultSource = (): WorkspaceBuildsSource => ({
  // Loopback only: Woodpecker is never reached from, or exposed to, the browser.
  serverUrl: process.env.WOODPECKER_SERVER || 'http://127.0.0.1:8000',
  repo: process.env.WORKSPACE_BUILDS_REPO || 'buildadmin/cloudcli-checks',
  readToken: async () => {
    if (process.env.WOODPECKER_TOKEN?.trim()) return process.env.WOODPECKER_TOKEN.trim();
    try {
      return (await readFile(TOKEN_FILE, 'utf8')).trim() || null;
    } catch {
      return null;
    }
  },
  fetch: (url, init) => fetch(url, init),
  // The VM helper owns how a build is started; the owner is the only input,
  // and it always comes from the authenticated session.
  trigger: (owner) => new Promise((resolve, reject) => {
    execFile(
      process.env.WORKSPACE_TRIGGER_BUILD_BIN || TRIGGER_BIN,
      [],
      { env: { ...process.env, WORKSPACE_OWNER: owner }, timeout: TRIGGER_TIMEOUT_MS },
      (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim())) : resolve(String(stdout))),
    );
  }),
});

let source: WorkspaceBuildsSource = defaultSource();
let repoIdCache: { repo: string; id: number } | null = null;
let listCache: { at: number; pipelines: WoodpeckerPipeline[] } | null = null;

/**
 * The Woodpecker label value for a CloudUI username, normalised exactly as
 * `workspace-trigger-build` does: lower case, runs of anything but
 * `a-z0-9_-` become `-`, leading and trailing dashes dropped.
 */
export function normalizeWorkspaceOwner(username: string): string {
  return username.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function unavailable(message: string): AppError {
  return new AppError(message, { code: 'BUILDS_UNAVAILABLE', statusCode: 503 });
}

async function woodpecker<T>(pathname: string): Promise<T> {
  const token = await source.readToken();
  if (!token) throw unavailable('Woodpecker is not configured on this server (no token).');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await source.fetch(`${source.serverUrl}${pathname}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw unavailable(`Woodpecker answered ${response.status}.`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable('Woodpecker is unreachable.');
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

const seconds = (value: number | undefined): string | null => (value && value > 0 ? new Date(value * 1000).toISOString() : null);

/** Pipelines without the owner variable predate owner routing and belong to nobody. */
const ownerOf = (pipeline: WoodpeckerPipeline): string => pipeline.variables?.WORKSPACE_OWNER ?? '';

function toBuild(pipeline: WoodpeckerPipeline): WorkspaceBuild {
  return {
    number: pipeline.number,
    status: pipeline.status,
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

/**
 * Builds of the CloudUI checks pipeline, scoped to one user: every read and
 * trigger takes the owner from the authenticated session, so one user never
 * sees, or starts, another user's builds.
 */
export const workspaceBuildsService = {
  /** The newest builds whose `WORKSPACE_OWNER` is this user, newest first. */
  async listBuilds(username: string): Promise<WorkspaceBuild[]> {
    const owner = normalizeWorkspaceOwner(username);
    if (!owner) return [];
    const now = Date.now();
    if (!listCache || now - listCache.at > LIST_CACHE_MS) {
      const id = await repoId();
      const pipelines = await woodpecker<WoodpeckerPipeline[]>(`/api/repos/${id}/pipelines?page=1&perPage=${SCAN_PAGE_SIZE}`);
      listCache = { at: now, pipelines: Array.isArray(pipelines) ? pipelines : [] };
    }
    return listCache.pipelines
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
    const owner = normalizeWorkspaceOwner(username);
    const id = await repoId();
    let pipeline: WoodpeckerPipeline;
    try {
      pipeline = await woodpecker<WoodpeckerPipeline>(`/api/repos/${id}/pipelines/${number}`);
    } catch (error) {
      if (error instanceof AppError && /answered 404/.test(error.message)) pipeline = { number, status: '' };
      else throw error;
    }
    if (!owner || ownerOf(pipeline) !== owner) {
      throw new AppError('Build not found.', { code: 'BUILD_NOT_FOUND', statusCode: 404 });
    }
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
      const lines = await woodpecker<WoodpeckerLogLine[]>(`/api/repos/${id}/logs/${number}/${logStep.id}`).catch(() => []);
      logTail = (Array.isArray(lines) ? lines : []).slice(-LOG_TAIL_LINES).map(decodeLogLine);
    }
    return { ...toBuild(pipeline), steps, logStepId: logStep?.id ?? null, logTail };
  },

  /** Starts the checks pipeline on this user's Mac; returns the new build number when the helper printed one. */
  async triggerBuild(username: string): Promise<{ number: number | null }> {
    const owner = normalizeWorkspaceOwner(username);
    if (!owner) {
      throw new AppError('A signed-in user is required to start a build.', { code: 'USER_REQUIRED', statusCode: 401 });
    }
    let output: string;
    try {
      output = await source.trigger(owner);
    } catch (error) {
      throw unavailable(error instanceof Error && error.message ? error.message : 'The build could not be started.');
    }
    listCache = null;
    // The helper prints woodpecker-cli's table: a header, then "NUMBER STATUS ...".
    const match = /^\s*(\d+)\s+\w+/m.exec(output.split('\n').slice(1).join('\n'));
    return { number: match ? Number(match[1]) : null };
  },

  /** Test hook: replace the Woodpecker endpoint, token, fetch and trigger; no argument restores the defaults. */
  setSource(next?: Partial<WorkspaceBuildsSource>): void {
    source = { ...defaultSource(), ...next };
    repoIdCache = null;
    listCache = null;
  },
};
