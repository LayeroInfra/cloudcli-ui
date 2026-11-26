import type { Dirent } from 'node:fs';
import { lstat, open, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseFrontMatter } from '@/shared/frontmatter.js';
import { AppError } from '@/shared/utils.js';
import type {
  AgentInstructions,
  AgentProjectInstructionFile,
  AgentMemoryFact,
  AgentMemoryIndexEntry,
  AgentMemoryIssue,
  AgentMemoryMap,
  AgentMemoryStore,
} from '@/shared/types.js';

/** Claude Code loads only this many lines of MEMORY.md into a session; the rest is never seen. */
export const INDEX_LOADED_LINES = 200;
/** A fact larger than this is listed without its body. */
const MAX_FACT_BYTES = 256 * 1024;
/** Facts read per store; a runaway directory cannot stall the request. */
const MAX_FACTS_PER_STORE = 500;
/** How much of a session transcript is scanned for the `cwd` it ran in. */
const CWD_SCAN_BYTES = 64 * 1024;
const INDEX_FILE = 'MEMORY.md';
/** The global instructions file is edited from the panel; anything bigger is refused. */
const MAX_INSTRUCTIONS_BYTES = 256 * 1024;

/** `- [Title](file.md) — hook`; the separator may be an em dash, en dash, hyphen or colon. */
const INDEX_LINE = /^\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+)\)\s*(?:[—–:-]\s*)?(.*)$/;
const LINK = /\[\[([^\]\n]+)\]\]/g;

const defaultClaudeHome = () => path.join(os.homedir(), '.claude');

const readString = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Plain files only: a symlink inside a memory directory is never followed. */
async function isPlainFile(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isFile();
  } catch {
    return false;
  }
}

/**
 * The working directory a store belongs to. The directory name is the path with
 * every `/` and `.` turned into `-`, which cannot be reversed, so the real path is
 * read from the `cwd` the store's session transcripts record.
 */
async function readStoreCwd(storeDir: string): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await readdir(storeDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const transcripts = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl')).slice(0, 5);
  for (const transcript of transcripts) {
    let handle;
    try {
      handle = await open(path.join(storeDir, transcript.name), 'r');
      const buffer = Buffer.alloc(CWD_SCAN_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, CWD_SCAN_BYTES, 0);
      const match = /"cwd":"((?:[^"\\]|\\.)+)"/.exec(buffer.subarray(0, bytesRead).toString('utf8'));
      if (match) return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      // Unreadable transcript: try the next one.
    } finally {
      await handle?.close();
    }
  }
  return null;
}

function parseIndex(raw: string): AgentMemoryIndexEntry[] {
  const entries: AgentMemoryIndexEntry[] = [];
  raw.split('\n').forEach((line, lineIndex) => {
    const match = INDEX_LINE.exec(line);
    if (!match) return;
    entries.push({
      title: match[1].trim(),
      file: match[2].trim(),
      hook: match[3].trim(),
      line: lineIndex + 1,
      missing: false,
    });
  });
  return entries;
}

async function readFact(memoryDir: string, file: string): Promise<AgentMemoryFact> {
  const filePath = path.join(memoryDir, file);
  const stats = await lstat(filePath);
  const base: AgentMemoryFact = {
    file,
    name: null,
    description: null,
    type: null,
    body: '',
    links: [],
    hasFrontmatter: false,
    inIndex: false,
    size: stats.size,
    updatedAt: stats.mtime.toISOString(),
  };
  if (stats.size > MAX_FACT_BYTES) return base;

  const raw = await readFile(filePath, 'utf8');
  let data: Record<string, unknown> = {};
  let body = raw;
  try {
    const parsed = parseFrontMatter(raw);
    data = (parsed.data ?? {}) as Record<string, unknown>;
    body = parsed.content;
  } catch {
    // Malformed frontmatter: show the file as it is.
  }
  const metadata = (data.metadata && typeof data.metadata === 'object' ? data.metadata : {}) as Record<string, unknown>;
  const links = [...new Set([...body.matchAll(LINK)].map((match) => match[1].trim()))];

  return {
    ...base,
    name: readString(data.name),
    description: readString(data.description),
    type: readString(metadata.type) ?? readString(data.type),
    body: body.trim(),
    links,
    hasFrontmatter: Object.keys(data).length > 0,
  };
}

/** One `~/.claude/projects/<dir>/memory` directory, with the problems found in it. */
async function readStore(projectsRoot: string, id: string): Promise<AgentMemoryStore | null> {
  const storeDir = path.join(projectsRoot, id);
  const memoryDir = path.join(storeDir, 'memory');
  let entries: Dirent[];
  try {
    if (!(await lstat(memoryDir)).isDirectory()) return null;
    entries = await readdir(memoryDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const factFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== INDEX_FILE)
    .map((entry) => entry.name)
    .sort()
    .slice(0, MAX_FACTS_PER_STORE);

  const indexPath = path.join(memoryDir, INDEX_FILE);
  const indexExists = await isPlainFile(indexPath);
  const indexRaw = indexExists ? await readFile(indexPath, 'utf8') : '';
  const indexLines = indexRaw ? indexRaw.replace(/\n$/, '').split('\n').length : 0;
  const indexEntries = parseIndex(indexRaw);

  const facts = (await Promise.all(factFiles.map((file) => readFact(memoryDir, file).catch(() => null))))
    .filter((fact): fact is AgentMemoryFact => fact !== null);

  const factFileSet = new Set(facts.map((fact) => fact.file));
  const indexed = new Set<string>();
  for (const entry of indexEntries) {
    const file = path.posix.normalize(entry.file).replace(/^\.\//, '');
    if (factFileSet.has(file)) indexed.add(file);
    else entry.missing = true;
  }

  const slugs = new Set<string>();
  for (const fact of facts) {
    fact.inIndex = indexed.has(fact.file);
    slugs.add(fact.file.replace(/\.md$/, ''));
    if (fact.name) slugs.add(fact.name);
  }

  const issues: AgentMemoryIssue[] = [];
  if (facts.length > 0 && !indexExists) {
    issues.push({ kind: 'no-index', detail: 'MEMORY.md is missing, so no fact here reaches a session.' });
  }
  if (indexLines > INDEX_LOADED_LINES) {
    issues.push({ kind: 'index-truncated', detail: `MEMORY.md has ${indexLines} lines; sessions load only the first ${INDEX_LOADED_LINES}.` });
  }
  indexEntries.forEach((entry) => {
    if (entry.missing) issues.push({ kind: 'missing-file', file: entry.file, detail: `MEMORY.md line ${entry.line} points to ${entry.file}, which does not exist.` });
    else if (entry.line > INDEX_LOADED_LINES) issues.push({ kind: 'index-truncated', file: entry.file, detail: `Indexed on line ${entry.line}, past what sessions load.` });
  });
  const names = new Map<string, string>();
  for (const fact of facts) {
    if (!fact.inIndex) issues.push({ kind: 'not-indexed', file: fact.file, detail: 'Not listed in MEMORY.md, so sessions never see it.' });
    if (!fact.hasFrontmatter && fact.size <= MAX_FACT_BYTES) issues.push({ kind: 'no-frontmatter', file: fact.file, detail: 'No frontmatter (name, description, type).' });
    for (const link of fact.links) {
      if (!slugs.has(link)) issues.push({ kind: 'broken-link', file: fact.file, detail: `[[${link}]] matches no memory yet.` });
    }
    if (fact.name) {
      const previous = names.get(fact.name);
      if (previous) issues.push({ kind: 'duplicate', file: fact.file, detail: `Same name as ${previous}.` });
      else names.set(fact.name, fact.file);
    }
  }

  const times = [indexExists ? (await lstat(indexPath)).mtime.toISOString() : null, ...facts.map((fact) => fact.updatedAt)]
    .filter((time): time is string => time !== null)
    .sort();

  return {
    id,
    projectPath: await readStoreCwd(storeDir),
    index: { exists: indexExists, lines: indexLines, entries: indexEntries, raw: indexRaw },
    facts,
    issues,
    updatedAt: times[times.length - 1] ?? null,
  };
}

/** Facts whose name recurs in another store: the same thing remembered twice. */
function crossStoreDuplicates(stores: AgentMemoryStore[]): void {
  const byName = new Map<string, AgentMemoryStore[]>();
  for (const store of stores) {
    for (const name of new Set(store.facts.map((fact) => fact.name).filter((name): name is string => name !== null))) {
      byName.set(name, [...(byName.get(name) ?? []), store]);
    }
  }
  for (const [name, holders] of byName) {
    if (holders.length < 2) continue;
    for (const store of holders) {
      const others = holders.filter((other) => other !== store).map((other) => other.projectPath ?? other.id);
      const fact = store.facts.find((candidate) => candidate.name === name);
      store.issues.push({ kind: 'duplicate', file: fact?.file, detail: `"${name}" is also remembered in ${others.join(', ')}.` });
    }
  }
}

/**
 * Reads Claude Code's auto-memory: every `<claude home>/projects/<dir>/memory`
 * directory, its MEMORY.md index and the fact files beside it, read-only. Also
 * reads and writes `<claude home>/CLAUDE.md`, the instructions every session
 * loads whatever its project. Nothing else under `~/.claude` (credentials,
 * transcripts) is returned, only the `cwd` a transcript names.
 */
export function createAgentMemoryService(claudeHome: () => string = defaultClaudeHome) {
  const instructionsPath = () => path.join(claudeHome(), 'CLAUDE.md');

  const readInstructions = async (): Promise<AgentInstructions> => {
    const filePath = instructionsPath();
    try {
      const stats = await lstat(filePath);
      if (!stats.isFile()) throw new AppError(`${filePath} is not a plain file.`, { code: 'INSTRUCTIONS_NOT_FILE', statusCode: 409 });
      return { path: filePath, exists: true, content: await readFile(filePath, 'utf8'), updatedAt: stats.mtime.toISOString() };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: filePath, exists: false, content: '', updatedAt: null };
      throw error;
    }
  };

  return {
    /**
     * Which per-project instruction files exist in `projectPath`, the ones a
     * session there loads on top of the global file. Only their existence is
     * read; the editor opens them like any project file.
     */
    async projectInstructionFiles(projectPath: string): Promise<AgentProjectInstructionFile[]> {
      const files = ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md')];
      return Promise.all(files.map(async (file) => {
        const filePath = path.join(projectPath, file);
        return { path: filePath, name: file, exists: await isPlainFile(filePath) };
      }));
    },

    async readMap(): Promise<AgentMemoryMap> {
      const root = path.join(claudeHome(), 'projects');
      let dirs: Dirent[];
      try {
        dirs = await readdir(root, { withFileTypes: true });
      } catch {
        return { root, stores: [] };
      }
      const stores = (await Promise.all(dirs.filter((dir) => dir.isDirectory()).map((dir) => readStore(root, dir.name))))
        .filter((store): store is AgentMemoryStore => store !== null);
      crossStoreDuplicates(stores);
      // Stores with something in them first, the most recently changed on top.
      stores.sort((a, b) => (b.facts.length > 0 ? 1 : 0) - (a.facts.length > 0 ? 1 : 0)
        || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
        || a.id.localeCompare(b.id));
      return { root, stores };
    },

    readInstructions,

    /**
     * Replaces the global CLAUDE.md. `baseUpdatedAt` is the version the editor
     * started from (null for a file that did not exist): if the file changed
     * since, e.g. an agent edited it, the save is refused rather than lost.
     */
    async writeInstructions(content: string, baseUpdatedAt: string | null): Promise<AgentInstructions> {
      if (Buffer.byteLength(content, 'utf8') > MAX_INSTRUCTIONS_BYTES) {
        throw new AppError('CLAUDE.md is too large.', { code: 'INSTRUCTIONS_TOO_LARGE', statusCode: 413 });
      }
      const current = await readInstructions();
      if (current.updatedAt !== baseUpdatedAt) {
        throw new AppError('CLAUDE.md changed since it was opened. Reload it and apply your edit again.', { code: 'INSTRUCTIONS_CONFLICT', statusCode: 409 });
      }
      const filePath = instructionsPath();
      const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, content, { encoding: 'utf8', mode: 0o644 });
      await rename(temporary, filePath);
      return readInstructions();
    },
  };
}

export const agentMemoryService = createAgentMemoryService();
