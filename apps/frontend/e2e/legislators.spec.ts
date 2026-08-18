import { test, expect } from '@playwright/test';

// Story 3 (list-and-fields half), .claude/skills/browser-user-test/stories.md:
// the legislator list shows who they are — name, party, chamber, district.
test('legislator search lists members with party and district', async ({ page }) => {
  await page.goto('/legislators');
  await expect(page.getByRole('heading', { name: 'Search legislators', level: 1 })).toBeVisible();
  await expect(page.getByText(/legislators as of /).first()).toBeVisible();
  await expect(page.getByText(/District \d+/).first()).toBeVisible();
});
