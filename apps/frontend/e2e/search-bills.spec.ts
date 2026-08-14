import { test, expect } from '@playwright/test';

// Story 2 (search-to-results half), .claude/skills/browser-user-test/stories.md:
// a topic word typed by a parent returns dated, plain-language results.
test('searching bills by topic returns dated results', async ({ page }) => {
  await page.goto('/bills?q=school');
  await expect(page.getByRole('heading', { name: 'Search bills', level: 1 })).toBeVisible();
  // The result count states its as-of date (grounded-answers rule 12's dating habit).
  await expect(page.getByText(/bills as of /).first()).toBeVisible();
  // Filter to visible matches: hidden copies of a bill code can come first in the DOM.
  await expect(
    page
      .getByText(/^(HF|SF) \d+$/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
});
