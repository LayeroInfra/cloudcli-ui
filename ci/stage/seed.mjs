// Fills a fresh Workspace stage with its fixtures, or turns a copy of the
// production database into safe stage data. Run by infra/vm/bin/workspace-stage
// from the staged release (so better-sqlite3 and bcryptjs resolve from its
// node_modules), with the stage server already up on STAGE_URL.
//
//   node ci/stage/seed.mjs fixtures   <home> <password>
//   node ci/stage/seed.mjs prod-copy  <home> <password> <production auth.db>
//
// fixtures: users stage-admin, stage-alice, stage-bob (one password, printed by
// `workspace-stage status`), and two git projects under <home>/projects.
// prod-copy: the production database with every secret dropped (API keys,
// tokens, push endpoints, the JWT secret), every password set to the stage one,
// transcript paths cleared and project paths moved under /nonexistent — so the
// stage can neither read nor delete production transcripts or project files.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';

const [mode, home, password, prodDb] = process.argv.slice(2);
const STAGE_URL = process.env.STAGE_URL || 'http://127.0.0.1:3102';
const dbPath = path.join(home, '.cloudcli', 'auth.db');
const USERS = ['stage-admin', 'stage-alice', 'stage-bob'];
const PROJECTS = [
  { dir: 'demo-app', name: 'Demo app' },
  { dir: 'demo-docs', name: 'Demo docs' },
];

if (!home || !password || !['fixtures', 'prod-copy'].includes(mode) || (mode === 'prod-copy' && !prodDb)) {
  console.error('usage: seed.mjs fixtures <home> <password> | seed.mjs prod-copy <home> <password> <prod auth.db>');
  process.exit(2);
}

async function api(route, body, token) {
  const response = await fetch(`${STAGE_URL}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${route}: ${response.status} ${JSON.stringify(json)}`);
  return json;
}

function gitRepo(dir, title) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${title}\n\nFixture project of the Workspace stage.\n`);
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('add', 'README.md');
  git('-c', 'user.name=Stage', '-c', 'user.email=stage@workspace.test', 'commit', '-q', '-m', 'Initial commit');
}

async function seedFixtures() {
  // The first user goes through the API, like a real first sign-up; it also creates the schema's rows.
  const { token } = await api('/api/auth/register', { username: USERS[0], password });
  for (const project of PROJECTS) {
    const dir = path.join(home, 'projects', project.dir);
    if (!fs.existsSync(dir)) gitRepo(dir, project.name);
    await api('/api/projects/create-project', { path: dir, customName: project.name }, token);
  }
  // The API is single-user; the other logins go in the way workspace-add-user does it.
  const db = new Database(dbPath);
  const hash = await bcrypt.hash(password, 10);
  const insert = db.prepare('INSERT OR IGNORE INTO users (username, password_hash) VALUES (?, ?)');
  for (const user of USERS.slice(1)) insert.run(user, hash);
  db.prepare('UPDATE users SET has_completed_onboarding = 1, git_name = username, git_email = username || \'@workspace.test\'').run();
  db.close();
  console.log(`fixtures: users ${USERS.join(', ')}; projects ${PROJECTS.map((p) => p.dir).join(', ')}`);
}

async function seedProdCopy() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const source = new Database(prodDb, { readonly: true, fileMustExist: true });
  await source.backup(dbPath);
  source.close();

  const db = new Database(dbPath);
  // The project-path move below relies on sessions' ON UPDATE CASCADE.
  db.pragma('foreign_keys = ON');
  const hash = await bcrypt.hash(password, 10);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  const run = (table, sql) => { if (tables.has(table)) db.prepare(sql).run(); };
  db.transaction(() => {
    for (const table of ['api_keys', 'user_credentials', 'push_subscriptions', 'notification_channel_endpoints', 'vapid_keys']) {
      run(table, `DELETE FROM ${table}`);
    }
    run('app_config', "DELETE FROM app_config WHERE key = 'jwt_secret' OR key LIKE '%token%' OR key LIKE '%secret%'");
    db.prepare('UPDATE users SET password_hash = ?').run(hash);
    run('sessions', 'UPDATE sessions SET jsonl_path = NULL');
    run('superseded_provider_sessions', 'UPDATE superseded_provider_sessions SET jsonl_path = NULL');
    // sessions.project_path follows through ON UPDATE CASCADE.
    run('projects', "UPDATE projects SET project_path = '/nonexistent/prod-copy' || project_path WHERE project_path NOT LIKE '/nonexistent/%'");
  })();
  const users = db.prepare('SELECT username FROM users').all().map((r) => r.username);
  db.close();
  console.log(`prod-copy: ${users.length} users (${users.join(', ')}), all with the stage password; secrets dropped`);
}

await (mode === 'fixtures' ? seedFixtures() : seedProdCopy());
