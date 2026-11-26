import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAgentMemoryService } from '@/modules/agent-memory/services/agent-memory.service.js';

async function withClaudeHome(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'agent-memory-'));
  try {
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

const fact = (name: string, type: string, body: string) =>
  `---\nname: ${name}\ndescription: about ${name}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`;

test('memory map lists stores, parses facts and flags what sessions never see', async () => {
  await withClaudeHome(async (home) => {
    const store = path.join(home, 'projects', '-srv-app');
    await mkdir(path.join(store, 'memory'), { recursive: true });
    await writeFile(path.join(store, 'session.jsonl'), `${JSON.stringify({ type: 'user', cwd: '/srv/app' })}\n`);
    await writeFile(path.join(store, 'memory', 'MEMORY.md'), [
      '- [VM limits](vm-limits.md) — 3.8GB RAM',
      '- [Gone](gone.md) — deleted fact',
    ].join('\n'));
    await writeFile(path.join(store, 'memory', 'vm-limits.md'), fact('vm-limits', 'project', 'See [[builds-flow]] and [[stray]].'));
    await writeFile(path.join(store, 'memory', 'builds-flow.md'), fact('builds-flow', 'feedback', 'Woodpecker only.'));
    await writeFile(path.join(store, 'memory', 'loose.md'), 'no frontmatter');
    // Symlinks are never followed out of the memory directory.
    await writeFile(path.join(home, '.credentials.json'), '{"secret":1}');
    await symlink(path.join(home, '.credentials.json'), path.join(store, 'memory', 'creds.md'));

    const empty = path.join(home, 'projects', '-srv-empty', 'memory');
    await mkdir(empty, { recursive: true });
    await mkdir(path.join(home, 'projects', '-srv-no-memory'), { recursive: true });

    const map = await createAgentMemoryService(() => home).readMap();

    assert.deepEqual(map.stores.map((s) => s.id), ['-srv-app', '-srv-empty']);
    const [app] = map.stores;
    assert.equal(app.projectPath, '/srv/app');
    assert.deepEqual(app.facts.map((f) => f.file), ['builds-flow.md', 'loose.md', 'vm-limits.md']);
    const vm = app.facts.find((f) => f.file === 'vm-limits.md')!;
    assert.equal(vm.type, 'project');
    assert.equal(vm.description, 'about vm-limits');
    assert.equal(vm.inIndex, true);
    assert.deepEqual(vm.links, ['builds-flow', 'stray']);
    assert.ok(!JSON.stringify(map).includes('secret'));

    const issues = app.issues.map((issue) => `${issue.kind}:${issue.file ?? ''}`).sort();
    assert.deepEqual(issues, [
      'broken-link:vm-limits.md',
      'missing-file:gone.md',
      'no-frontmatter:loose.md',
      'not-indexed:builds-flow.md',
      'not-indexed:loose.md',
    ]);
    assert.equal(app.index.entries.find((e) => e.file === 'gone.md')?.missing, true);
  });
});

test('the same fact in two stores is flagged in both; a long index is flagged as truncated', async () => {
  await withClaudeHome(async (home) => {
    for (const id of ['-a', '-b']) {
      const dir = path.join(home, 'projects', id, 'memory');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'shared.md'), fact('shared', 'user', 'same'));
      const padding = id === '-a' ? Array.from({ length: 205 }, (_, i) => `line ${i}`) : [];
      await writeFile(path.join(dir, 'MEMORY.md'), [...padding, '- [Shared](shared.md) — x'].join('\n'));
    }
    const map = await createAgentMemoryService(() => home).readMap();
    for (const store of map.stores) {
      assert.ok(store.issues.some((issue) => issue.kind === 'duplicate' && issue.file === 'shared.md'), store.id);
    }
    const a = map.stores.find((s) => s.id === '-a')!;
    assert.ok(a.issues.some((issue) => issue.kind === 'index-truncated' && !issue.file));
    assert.ok(a.issues.some((issue) => issue.kind === 'index-truncated' && issue.file === 'shared.md'));
  });
});

test('global CLAUDE.md is created, saved, and a stale save is refused', async () => {
  await withClaudeHome(async (home) => {
    const service = createAgentMemoryService(() => home);
    const missing = await service.readInstructions();
    assert.equal(missing.exists, false);
    assert.equal(missing.updatedAt, null);

    const created = await service.writeInstructions('# Rules\n', null);
    assert.equal(created.exists, true);
    assert.equal(await readFile(path.join(home, 'CLAUDE.md'), 'utf8'), '# Rules\n');

    // Someone else (an agent) edits the file after the editor opened it.
    const later = new Date(Date.now() + 5000);
    await utimes(path.join(home, 'CLAUDE.md'), later, later);
    await assert.rejects(service.writeInstructions('# Mine\n', created.updatedAt), (error: { statusCode?: number }) => error.statusCode === 409);
    assert.equal(await readFile(path.join(home, 'CLAUDE.md'), 'utf8'), '# Rules\n');

    const fresh = await service.readInstructions();
    const saved = await service.writeInstructions('# Mine\n', fresh.updatedAt);
    assert.equal(saved.content, '# Mine\n');
    assert.ok((await stat(path.join(home, 'CLAUDE.md'))).isFile());
  });
});

test('an empty or missing projects directory gives an empty map', async () => {
  await withClaudeHome(async (home) => {
    const map = await createAgentMemoryService(() => home).readMap();
    assert.deepEqual(map.stores, []);
  });
});
