import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: {
    authenticated: true, email: 'dev@example.com', plan: 'pro', method: 'oauth', loading: false,
  } as Record<string, unknown>,
  rateLimits: vi.fn(),
  setThemeMode: vi.fn(),
  setPreference: vi.fn(),
  preferences: { showThinking: true, showRawParameters: false, sendByCtrlEnter: false, voiceEnabled: false } as Record<string, boolean>,
}));

vi.mock('@/shared/context/ThemeContext', () => ({ useTheme: () => ({ themeMode: 'system', setThemeMode: mocks.setThemeMode }) }));
vi.mock('@/shared/context/UiPreferencesContext', () => ({
  useUiPreferences: () => mocks.preferences,
  useSetUiPreference: () => mocks.setPreference,
}));
vi.mock('@/modules/i18n', () => ({ LanguageSelector: () => <div>language-selector</div> }));

vi.mock('@/modules/provider-auth', () => ({
  useProviderAuthStatus: () => ({
    providerAuthStatus: { claude: mocks.status, codex: { ...mocks.status, email: 'codex@example.com' } },
    checkProviderAuthStatus: async () => undefined,
  }),
}));

vi.mock('@/shared/api', () => ({ api: { providers: { claudeRateLimits: mocks.rateLimits } } }));

const { default: SidebarAccount } = await import('@/modules/sidebar/SidebarAccount');

// Interpolates the defaultValue so assertions read like the English UI.
const t = ((key: string, options?: Record<string, unknown>) => {
  const template = typeof options?.defaultValue === 'string' ? options.defaultValue : key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
}) as unknown as TFunction;

const respond = (windows: unknown[]) => Promise.resolve({ ok: true, json: async () => ({ data: { windows } }) });

afterEach(() => {
  mocks.rateLimits.mockReset();
  mocks.setThemeMode.mockReset();
  mocks.setPreference.mockReset();
  mocks.status.method = 'oauth';
});

const windowsFixture = () => [
  { type: 'seven_day', status: 'allowed', utilization: 18, resetsAt: null, observedAt: '' },
  { type: 'five_hour', status: 'allowed_warning', utilization: 76.4, resetsAt: new Date(Date.now() + 61 * 60_000).toISOString(), observedAt: '' },
];

test('the corner shows the account and one ring for the weekly limit, with the figure on hover', async () => {
  mocks.rateLimits.mockReturnValue(respond(windowsFixture()));
  render(<SidebarAccount provider="claude" currentVersion="1.2.3" isCompact={false} onShowSettings={vi.fn()} t={t} />);

  assert.ok(screen.getByText('dev@example.com'));
  assert.ok(screen.getByText('Pro'));
  const ring = await waitFor(() => screen.getByLabelText('Week: 18%'));
  assert.equal(ring.getAttribute('title'), 'Week: 18%');
  // Only one ring: the 5-hour figure is in the menu, not the corner.
  assert.equal(screen.getAllByTestId('account-limit-ring').length, 1);
  assert.equal(screen.queryByText(/76%/), null);
});

test('the usage card beside the profile lists the 5h and weekly limits; the profile menu holds theme, preferences and settings', async () => {
  mocks.rateLimits.mockReturnValue(respond(windowsFixture()));
  const onShowSettings = vi.fn();
  render(<SidebarAccount provider="claude" currentVersion="1.2.3" isCompact={false} onShowSettings={onShowSettings} t={t} />);
  await waitFor(() => screen.getByLabelText('Week: 18%'));

  // The ring is not part of the profile button: clicking the profile opens the menu, hovering the ring shows usage.
  assert.equal(screen.getByRole('button', { name: 'Account' }).contains(screen.getByTestId('account-limit-ring')), false);
  assert.equal(screen.getByRole('button', { name: 'Account' }).contains(screen.getByTestId('account-plan-limits')), false);

  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  const limits = within(screen.getByTestId('account-plan-limits'));
  assert.ok(limits.getByText('5h'));
  assert.ok(limits.getByText('Week'));
  assert.ok(limits.getByText(/^76% · Resets in 1h/));
  assert.ok(limits.getByText('18%'));
  const limitsText = screen.getByTestId('account-plan-limits').textContent!;
  assert.ok(limitsText.indexOf('5h') < limitsText.indexOf('Week'));

  fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
  assert.deepEqual(mocks.setThemeMode.mock.calls, [['dark']]);

  const thinking = screen.getByRole('switch', { name: 'quickSettings.showThinking' });
  assert.equal(thinking.getAttribute('aria-checked'), 'true');
  fireEvent.click(thinking);
  assert.deepEqual(mocks.setPreference.mock.calls, [['showThinking', false]]);
  // Voice stays hidden until it is enabled in settings.
  assert.equal(screen.queryByRole('switch', { name: 'quickSettings.voiceEnabled' }), null);
  assert.ok(screen.getByText('language-selector'));
  assert.ok(screen.getByText('CloudCLI v1.2.3'));

  fireEvent.click(screen.getByRole('button', { name: 'Accounts and agents' }));
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  fireEvent.click(screen.getByRole('button', { name: 'actions.settings' }));
  assert.deepEqual(onShowSettings.mock.calls, [['agents'], []]);
});

test('the ring shows a skeleton while the first answer is in flight', () => {
  mocks.rateLimits.mockReturnValue(new Promise(() => {}));
  render(<SidebarAccount provider="claude" currentVersion="1" isCompact={false} onShowSettings={vi.fn()} t={t} />);
  assert.equal(screen.queryByTestId('account-limit-ring'), null);
  // The skeleton stands where the ring will be: beside the profile button, not inside it.
  const account = screen.getByRole('button', { name: 'Account' });
  assert.equal(account.querySelector('.animate-pulse'), null);
  assert.ok(account.parentElement?.parentElement?.querySelector('.animate-pulse'));
});

test('without figures the ring stays, marked as having no data', async () => {
  mocks.rateLimits.mockReturnValue(respond([]));
  render(<SidebarAccount provider="claude" currentVersion="1" isCompact={false} onShowSettings={vi.fn()} t={t} />);
  assert.ok(await waitFor(() => screen.getByLabelText('Week: no data')));
});

test('an API-key login has no plan limits and does not ask for them', () => {
  mocks.status.method = 'api_key';
  render(<SidebarAccount provider="claude" currentVersion="1" isCompact={false} onShowSettings={vi.fn()} t={t} />);
  assert.equal(screen.queryByTestId('account-limit-ring'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  assert.equal(screen.queryByTestId('account-plan-limits'), null);
  assert.equal(mocks.rateLimits.mock.calls.length, 0);
});

test('another provider shows its own account without Claude plan limits', () => {
  render(<SidebarAccount provider="codex" currentVersion="1" isCompact={false} onShowSettings={vi.fn()} t={t} />);
  assert.ok(screen.getByText('codex@example.com'));
  assert.equal(mocks.rateLimits.mock.calls.length, 0);
});
