import { defineConfig } from '@playwright/test';

const rawPort = process.env.REPLAY_CHECK_PORT ?? '4174';
if (!/^\d+$/.test(rawPort)) throw new Error('REPLAY_CHECK_PORT must be an integer');
const port = Number(rawPort);
if (port < 1024 || port > 65535 || [4186, 4188, 4189].includes(port))
  throw new Error('Invalid or reserved REPLAY_CHECK_PORT');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: 'event-replay-startup.browser.ts',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-replay-check-build.mjs',
    url: `${baseURL}/blog/events/forward-debate-2026`,
    env: { REPLAY_CHECK_PORT: String(port) },
    reuseExistingServer: false,
  },
});
