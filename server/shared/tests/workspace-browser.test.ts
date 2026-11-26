import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureWorkspaceBrowserShim, workspaceBrowserEnv } from '@/shared/workspace-browser.js';

const tempDirectory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-browser-'));

test('the env points BROWSER at the shim and puts its directory first on PATH, once', () => {
  const directory = tempDirectory();
  const env = workspaceBrowserEnv({ PATH: `/usr/bin${path.delimiter}${directory}` }, { directory });
  assert.equal(env.BROWSER, path.join(directory, 'cloudui-open'));
  assert.equal(env.PATH, `${directory}${path.delimiter}/usr/bin`);
  assert.ok(fs.statSync(path.join(directory, 'xdg-open')).mode & 0o100);
});

test('a BROWSER the host sets is kept', () => {
  const directory = tempDirectory();
  const env = workspaceBrowserEnv({ PATH: '/usr/bin', BROWSER: 'w3m' }, { directory });
  assert.equal(env.BROWSER, undefined);
});

test('nothing is set on Windows or when the shim cannot be written', () => {
  assert.deepEqual(workspaceBrowserEnv({ PATH: 'C:\\bin' }, { platform: 'win32', directory: 'C:\\x' }), {});
  const failing = {
    mkdirSync: () => {
      throw new Error('read-only');
    },
  } as never;
  assert.equal(ensureWorkspaceBrowserShim({ directory: '/nope', fileSystem: failing }), null);
});

test('without a terminal the shim prints the URL and succeeds, so the caller does not fail', { skip: process.platform === 'win32' }, () => {
  const directory = tempDirectory();
  ensureWorkspaceBrowserShim({ directory });
  // No stdin (like a Bash tool with no TTY): the shim must print the URL, not hang.
  const run = spawnSync(path.join(directory, 'cloudui-open'), ['http://localhost:5174/x'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(run.status, 0);
  assert.match(run.stderr, /Open in the browser: http:\/\/localhost:5174\/x/);

  const fileRun = spawnSync(path.join(directory, 'xdg-open'), ['/srv/project/README.md'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(fileRun.status, 0);
  assert.doesNotMatch(fileRun.stderr, /OPEN_URL/);
});
