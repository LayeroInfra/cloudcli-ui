// The stage works end to end: it is the branch build it claims to be, a fixture
// user signs in, the fixture projects are listed, a chat turn goes through the
// stand-in Claude (ci/fake-claude) and survives a reload.
import { expect, test } from '@playwright/test';

const PASSWORD = process.env.STAGE_PASSWORD || '';

test('health names the staged branch', async ({ request }) => {
  const health = await (await request.get('/health')).json();
  expect(health.status).toBe('ok');
  expect(health.stage?.sha).toMatch(/^[0-9a-f]{40}$/);
});

test('sign in, open a project, chat with the fake agent', async ({ page }) => {
  expect(PASSWORD, 'STAGE_PASSWORD').not.toBe('');
  await page.goto('/');
  await page.locator('#username').fill('stage-admin');
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();

  await expect(page.getByText('Demo app').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Demo docs').first()).toBeVisible();
  await page.getByText('Demo app').first().click();

  const composer = page.locator('textarea').first();
  if (!(await composer.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /new (chat|session)/i }).first().click();
  }
  await expect(composer).toBeVisible({ timeout: 15_000 });
  const prompt = `hello e2e ${Date.now()}`;
  await composer.fill(prompt);
  await composer.press('Enter');

  await expect(page.getByText(`Fake reply: ${prompt}`)).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByText(`Fake reply: ${prompt}`)).toBeVisible({ timeout: 30_000 });
});
