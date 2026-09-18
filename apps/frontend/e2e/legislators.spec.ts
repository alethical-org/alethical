import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page, baseURL }) => {
  if (baseURL && new URL(baseURL).hostname === 'localhost') {
    await page.route('https://api.alethical.com/**', async (route) => {
      if (route.request().method() !== 'GET') return route.abort();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'access-control-allow-origin': '*' },
      });
    });
  }
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

// Story 3 (list-and-fields half), .claude/skills/browser-user-test/stories.md:
// the legislator list shows who they are — name, party, chamber, district.
test('legislator search lists members with party and district', async ({ page }) => {
  await page.goto('/legislators');
  await expect(page.getByRole('heading', { name: 'Search legislators', level: 1 })).toBeVisible();
  await expect(page.getByText(/legislators as of /).first()).toBeVisible();
  await expect(page.getByText(/District \d+/).first()).toBeVisible();
});

for (const [layout, width] of [
  ['desktop', 1400],
  ['phone', 390],
] as const) {
  test(`${layout}: the Money route opens a selected legislator on Campaign money`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/money');
    await page.locator('[data-testid="money-lanes"] a').filter({ hasText: 'Legislators' }).click();
    await expect(page).toHaveURL(/\/legislators\?tab=money$/);

    const profile = page.locator('a[href^="/legislators/"][href$="?tab=money"]').first();
    await expect(profile).toBeVisible();
    await profile.click();

    await expect(page).toHaveURL(/\/legislators\/[^?]+\?tab=money$/);
    await expect(page.getByRole('link', { name: 'Campaign money', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test(`${layout}: ordinary and direct profile routes keep Overview without a repeated money card`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/legislators');

    const profile = page.locator('a[href^="/legislators/"]:not([href*="?"])').first();
    await expect(profile).toBeVisible();
    await profile.click();

    await expect(page).toHaveURL(/\/legislators\/[^?]+$/);
    await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByText('Open the Campaign money tab', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Campaign money', exact: true })).toHaveCount(1);
  });
}

test('the top menu returns to the ordinary Overview path after visiting Campaign money', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/legislators/aaron-repinski?tab=money');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: /^Legislators/ }).click();

  await expect(page).toHaveURL(/\/legislators$/);
  const profile = page.locator('a[href^="/legislators/"]:not([href*="?"]):visible').first();
  await expect(profile).toBeVisible();
  await profile.click();
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
