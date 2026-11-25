import assert from 'node:assert/strict';
import test from 'node:test';

import { claudeRateLimitsService } from '@/modules/providers/services/claude-rate-limits.service.js';

test('rate-limit readings are kept per window and normalised', () => {
  claudeRateLimitsService.reset();
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  claudeRateLimitsService.record({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.42, resetsAt });
  claudeRateLimitsService.record({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 81, resetsAt: resetsAt + 86400 });

  const [fiveHour, sevenDay] = claudeRateLimitsService.list();
  assert.equal(fiveHour.type, 'five_hour');
  assert.equal(fiveHour.utilization, 42);
  assert.equal(fiveHour.resetsAt, new Date(resetsAt * 1000).toISOString());
  assert.equal(sevenDay.status, 'allowed_warning');
  assert.equal(sevenDay.utilization, 81);
});

test('a reading without figures keeps the last known utilization and reset', () => {
  claudeRateLimitsService.reset();
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  claudeRateLimitsService.record({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.3, resetsAt });
  claudeRateLimitsService.record({ status: 'allowed', rateLimitType: 'five_hour' });

  const [window] = claudeRateLimitsService.list();
  assert.equal(window.utilization, 30);
  assert.equal(window.resetsAt, new Date(resetsAt * 1000).toISOString());
});

test('a window whose reset has passed is dropped', () => {
  claudeRateLimitsService.reset();
  claudeRateLimitsService.record({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.9, resetsAt: Math.floor(Date.now() / 1000) - 5 });
  assert.deepEqual(claudeRateLimitsService.list(), []);
});

const usageResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('account usage supplies the 5-hour and weekly windows before any turn', async () => {
  claudeRateLimitsService.reset();
  let calls = 0;
  let sentAuth = '';
  claudeRateLimitsService.setAccountUsageSource({
    readToken: async () => 'token',
    fetch: async (_url, init) => {
      calls += 1;
      sentAuth = String((init.headers as Record<string, string>).Authorization);
      return usageResponse({
        five_hour: { utilization: 35.0, resets_at: '2099-01-01T16:00:00.333462+00:00' },
        seven_day: { utilization: 8.0, resets_at: '2099-01-07T01:00:00+00:00' },
        seven_day_opus: null,
      });
    },
  });
  try {
    const windows = await claudeRateLimitsService.listWithAccountUsage();
    assert.deepEqual(windows.map((w) => [w.type, w.utilization]), [['five_hour', 35], ['seven_day', 8]]);
    assert.equal(sentAuth, 'Bearer token');
    // Cached for a minute.
    await claudeRateLimitsService.listWithAccountUsage();
    assert.equal(calls, 1);
  } finally {
    claudeRateLimitsService.setAccountUsageSource();
  }
});

test('without a live token or on an error the event readings stand alone', async () => {
  claudeRateLimitsService.reset();
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  claudeRateLimitsService.record({ status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt });
  claudeRateLimitsService.setAccountUsageSource({ readToken: async () => null, fetch: async () => { throw new Error('no call expected'); } });
  try {
    const windows = await claudeRateLimitsService.listWithAccountUsage();
    assert.deepEqual(windows.map((w) => [w.type, w.status]), [['five_hour', 'rejected']]);

    claudeRateLimitsService.reset();
    claudeRateLimitsService.setAccountUsageSource({ readToken: async () => 'token', fetch: async () => usageResponse({}, 401) });
    assert.deepEqual(await claudeRateLimitsService.listWithAccountUsage(), []);
  } finally {
    claudeRateLimitsService.setAccountUsageSource();
  }
});
