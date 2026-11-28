// Screenshots of the stage for the agent: it cannot see Companion, so after
// the smoke the Mac photographs the pages named in STAGE_SHOTS and
// workspace-run-stage copies them to the VM, where the agent opens the PNGs:
//   ~/.local/state/workspace-stage/shots/<sha>/<name>.png
//
//   STAGE_SHOTS   comma-separated paths, default "/" (e.g. "/,/session/<id>")
//   SHOTS_DIR     where to write them (workspace-run-stage sets it)
// Each page is shot signed in as stage-admin, at a desktop and a phone size.
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const PASSWORD = process.env.STAGE_PASSWORD || '';
const SHOTS_DIR = process.env.SHOTS_DIR || 'test-results/shots';
const PATHS = (process.env.STAGE_SHOTS || '/').split(',').map((entry) => entry.trim()).filter(Boolean);
const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

const slug = (value) => value.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-') || 'home';

test('screenshots of the stage pages for the agent', async ({ page }) => {
  expect(PASSWORD, 'STAGE_PASSWORD').not.toBe('');
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  // What Companion sees after /__stage/on: the stage cookie, so the client
  // shows its stage banner and keeps the stage sign-in apart, as for a person.
  await page.context().addCookies([{ name: 'workspace_stage', value: '1', url: test.info().project.use.baseURL || 'http://127.0.0.1:13102' }]);
  await page.goto('/');
  await page.locator('#username').fill('stage-admin');
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('#username')).toHaveCount(0, { timeout: 20_000 });

  const written = [];
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const target of PATHS) {
      await page.goto(target);
      // Lets data load and transitions settle; a page that keeps polling still gets shot.
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      const file = path.join(SHOTS_DIR, `${slug(target)}--${size.name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      written.push(file);
    }
  }
  console.log(`shots: ${written.join(', ')}`);
});
