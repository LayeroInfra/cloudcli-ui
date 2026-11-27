// Smoke tests of the Workspace stage, run on a Mac by workspace-run-stage
// after the stage is up. WebKit, because Companion is a WKWebView.
//   STAGE_URL       the stage server (an SSH forward to the VM's 127.0.0.1:3102)
//   STAGE_PASSWORD  password of the stage fixtures' users
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: process.env.E2E_OUTPUT_DIR || 'test-results',
  use: {
    baseURL: process.env.STAGE_URL || 'http://127.0.0.1:13102',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }],
});
