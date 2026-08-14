import { test, expect } from '@playwright/test';

// Story 1 (home half), .claude/skills/browser-user-test/stories.md:
// a first-time visitor lands on the home page and can tell what this is.
test('home page loads with the hero and current bills', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Alethical/);
  await expect(page.getByText('Grounded answers').first()).toBeVisible();
  // Bill cards carry a real bill code once data arrives. Filter to visible
  // matches: hidden nav/menu copies of the same text can come first in the DOM.
  await expect(
    page
      .getByText(/^(HF|SF) \d+$/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
});
