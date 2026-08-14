import { defineConfig } from '@playwright/test';

// On-demand end-to-end checks (see .claude/skills/browser-user-test/SKILL.md).
// Not wired into CI — that is a pending decision, not an oversight.
// The app is client-rendered, so data-backed text can take a few seconds to
// appear; the expect timeout is sized for that, not for slow assertions.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:19006',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
