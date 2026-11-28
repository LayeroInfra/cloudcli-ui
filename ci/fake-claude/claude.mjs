#!/usr/bin/env node
// A stand-in for the Claude Code CLI, for the stage and the e2e runs: the
// Workspace server drives it exactly like the real one (CLAUDE_CLI_PATH), but
// it answers instantly and deterministically and needs no account or network.
//
// It speaks the part of the SDK's stdin/stdout stream-json protocol the server
// uses: control requests (initialize, set_model, interrupt, …) get a success
// response, and each user message gets one `system/init` (first turn only),
// one assistant message and one `result`. The reply is
//
//   Fake reply: <the prompt text>
//
// and the turn is written to ~/.claude/projects/<cwd>/<session>.jsonl, so the
// server's history reader and session indexer see an ordinary transcript.
//
// Knobs (environment):
//   FAKE_CLAUDE_DELAY_MS  wait this long before replying (spinners, interrupt)
// Prompt markers:
//   [fake:error]          finish the turn as an error result
//   [fake:ask]            reply with a question (the session should need a reply)
//
// Contract test: ci/fake-claude/fake-claude.test.mjs (step fake-agent of the checks).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const VERSION = '9.9.9 (Fake Claude Code)';
const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

/** Value of `--name=value` or `--name value`. */
function arg(name) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
    if (args[i] === name && i + 1 < args.length) return args[i + 1];
  }
  return undefined;
}

const sessionId = arg('--resume') || arg('--session-id') || randomUUID();
const model = arg('--model') || 'fake-model';
const cwd = process.cwd();
const delayMs = Number.parseInt(process.env.FAKE_CLAUDE_DELAY_MS || '0', 10) || 0;
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const transcriptDir = path.join(configDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
const transcriptPath = path.join(transcriptDir, `${sessionId}.jsonl`);

let initSent = false;
let lastUuid = lastTranscriptUuid();
let turn = Promise.resolve();
let interrupted = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function lastTranscriptUuid() {
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]).uuid ?? null;
  } catch {
    return null;
  }
}

function record(entry) {
  fs.mkdirSync(transcriptDir, { recursive: true });
  const row = {
    parentUuid: lastUuid,
    isSidechain: false,
    userType: 'external',
    cwd,
    sessionId,
    version: 'fake',
    gitBranch: '',
    timestamp: new Date().toISOString(),
    ...entry,
  };
  fs.appendFileSync(transcriptPath, `${JSON.stringify(row)}\n`);
  lastUuid = row.uuid;
}

function promptText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n');
  }
  return '';
}

function controlResponse(request) {
  const subtype = request.request?.subtype;
  if (subtype === 'interrupt') interrupted = true;
  const response = subtype === 'initialize'
    ? {
        commands: [],
        agents: [],
        output_style: 'default',
        available_output_styles: ['default'],
        models: [{ value: 'default', displayName: 'Fake', description: 'Fake Claude for tests' }],
        account: { email: 'fake@workspace.test', subscriptionType: 'fake' },
      }
    : {};
  send({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response } });
}

async function answer(message) {
  const text = promptText(message.message?.content);
  const userUuid = message.uuid || randomUUID();
  record({ type: 'user', message: { role: 'user', content: message.message?.content ?? text }, uuid: userUuid });

  if (!initSent) {
    initSent = true;
    send({
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      uuid: randomUUID(),
      cwd,
      model,
      tools: [],
      mcp_servers: [],
      permissionMode: arg('--permission-mode') || 'default',
      slash_commands: [],
      apiKeySource: 'none',
      claude_code_version: VERSION,
      output_style: 'default',
      agents: [],
      skills: [],
      plugins: [],
    });
  }

  const started = Date.now();
  interrupted = false;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

  const isError = text.includes('[fake:error]');
  const reply = text.includes('[fake:ask]')
    ? `Fake question: which option do you want for "${text}"?`
    : `Fake reply: ${text}`;
  const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

  if (!interrupted && !isError) {
    const assistant = {
      id: `msg_fake_${randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: reply }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage,
    };
    const uuid = randomUUID();
    record({ type: 'assistant', message: assistant, uuid });
    send({ type: 'assistant', message: assistant, parent_tool_use_id: null, session_id: sessionId, uuid });
  }

  send({
    type: 'result',
    subtype: isError ? 'error_during_execution' : 'success',
    is_error: isError || interrupted,
    duration_ms: Date.now() - started,
    duration_api_ms: 0,
    num_turns: 1,
    result: isError ? 'Fake error' : reply,
    session_id: sessionId,
    total_cost_usd: 0,
    usage,
    modelUsage: {},
    permission_denials: [],
    uuid: randomUUID(),
  });
}

const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.type === 'control_request') {
    controlResponse(message);
  } else if (message.type === 'user') {
    turn = turn.then(() => answer(message));
  }
});
input.on('close', () => {
  void turn.then(() => process.exit(0));
});
