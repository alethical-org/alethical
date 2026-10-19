import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'event-replay-preview.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4187', browserName: 'chromium' },
  webServer: {
    command: 'node scripts/preview-event-replay.mjs',
    url: 'http://127.0.0.1:4187/blog/events/forward-debate-2026',
    env: { REPLAY_PREVIEW_PORT: '4187' },
    reuseExistingServer: false,
  },
});
