// Contract test of the stand-in Claude CLI (ci/fake-claude/claude.mjs): the
// real Agent SDK the server uses must be able to run a turn on it, resume the
// session, and find the transcript where the server's history reader looks.
// Runs in the checks (step fake-agent): node --test ci/fake-claude/fake-claude.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { query } from '@anthropic-ai/claude-agent-sdk';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'claude.mjs');

async function runTurn(prompt, extra = {}) {
  const messages = [];
  for await (const message of query({
    prompt,
    options: {
      pathToClaudeCodeExecutable: FAKE,
      cwd: extra.cwd,
      env: { ...process.env, HOME: extra.home, CLAUDE_CONFIG_DIR: path.join(extra.home, '.claude') },
      ...(extra.resume ? { resume: extra.resume } : {}),
    },
  })) {
    messages.push(message);
  }
  return messages;
}

test('a turn on the fake CLI: init, reply, result and a transcript', { timeout: 30_000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-cwd-'));
  try {
    const first = await runTurn('hello workspace', { home, cwd });
    const init = first.find((m) => m.type === 'system' && m.subtype === 'init');
    const assistant = first.find((m) => m.type === 'assistant');
    const result = first.find((m) => m.type === 'result');
    assert.ok(init, 'system/init');
    assert.equal(assistant?.message?.content?.[0]?.text, 'Fake reply: hello workspace');
    assert.equal(result?.subtype, 'success');

    const sessionId = init.session_id;
    const transcript = path.join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
    const rows = fs.readFileSync(transcript, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(rows.map((r) => r.type), ['user', 'assistant']);

    const second = await runTurn('again', { home, cwd, resume: sessionId });
    assert.equal(second.find((m) => m.type === 'result')?.session_id, sessionId);
    const resumed = fs.readFileSync(transcript, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(resumed.length, 4);
    assert.equal(resumed[2].parentUuid, rows[1].uuid, 'resume continues the same chain');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
