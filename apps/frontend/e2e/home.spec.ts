import { test, expect } from '@playwright/test';
import { suppressSiteMetrics } from './suppress-site-metrics';

test.beforeEach(async ({ context }) => {
  await suppressSiteMetrics(context);
});

// Story 1 (home half), .claude/skills/browser-user-test/stories.md:
// a first-time visitor lands on the home page and can tell what this is.
test('home introduces the public records and links to money and bills', async ({ page }) => {
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
  await expect(page.getByRole('link', { name: /Bills and votes/ })).toHaveAttribute(
    'href',
    '/bills',
  );
  await expect(page.getByRole('link', { name: /Follow the money/ })).toHaveAttribute(
    'href',
    '/money',
  );
});

for (const width of [320, 375, 400, 900, 1100, 1600]) {
  test(`homepage cards contain their text and actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    for (const name of [/Bills and votes/, /Follow the money/]) {
      const card = page.getByRole('link', { name });
      await expect(card).toBeVisible();
      await expect(card.locator('a, button, [role="button"], [tabindex="0"]')).toHaveCount(0);
      const outside = await card.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return [...node.querySelectorAll('div, svg')].some((child) => {
          const rect = child.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            (rect.left < box.left - 1 ||
              rect.right > box.right + 1 ||
              rect.top < box.top - 1 ||
              rect.bottom > box.bottom + 1)
          );
        });
      });
      expect(outside).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
}
