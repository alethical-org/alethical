import { defineConfig } from '@playwright/test';

// On-demand end-to-end checks (see .claude/skills/browser-user-test/SKILL.md).
// These full 3-engine stories are on demand. The required frontend CI job
// runs the focused public reader subset in scripts/reader-completion-checks.mjs.
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
