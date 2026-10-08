import { expect, test, type Locator } from '@playwright/test';
import { suppressSiteMetrics } from './suppress-site-metrics';

test.beforeEach(async ({ context }) => {
  await suppressSiteMetrics(context);
  // Keep the address form and map present regardless of API availability or
  // the current election calendar. These checks never submit an address.
  await context.route('**/candidates/elections', (route) =>
    route.fulfill({
      json: [{ id: 'menu-test', label: 'Test election', date: '2099-11-03', type: 'general' }],
    }),
  );
});

// Visibility alone misses a menu painted underneath a later page element.
// Sample the full row, including its icon and padding, where the map overlapped.
async function expectRowReceivesPointer(row: Locator) {
  await expect(row).toBeVisible();
  expect(
    await row.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return [0.1, 0.5, 0.9].every((x) =>
        [0.25, 0.5, 0.75].every((y) =>
          element.contains(
            document.elementFromPoint(box.x + box.width * x, box.y + box.height * y),
          ),
        ),
      );
    }),
  ).toBe(true);
}

for (const width of [1100, 1440, 1680]) {
  for (const menu of ['Search', 'About']) {
    test(`${menu} stays above candidate content and accepts pointer selection at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/candidates');
      await expect(
        page.getByRole('heading', { name: 'Find my candidates', exact: true }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole('button', { name: 'Find', exact: true })).toBeEnabled();
      await expect(page.locator('img[src*="mn-outline-candidates"]')).toBeVisible();
      const trigger = page.getByRole('button', { name: menu, exact: true });
      await trigger.hover();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const names =
        menu === 'Search'
          ? [
              /Bills and votes Read/,
              /Legislators Look up/,
              /Find my candidates NEW/,
              /Find my legislators Enter/,
            ]
          : [/^About us$/, /^Campaign services$/, /^Contact us$/];
      const rows = names.map((name) => trigger.locator('..').getByRole('link', { name }));
      for (const row of rows) await expectRowReceivesPointer(row);

      // Cross into the part of the panel covered by the map before this fix,
      // then remain there longer than the existing departure grace period.
      const target = rows[menu === 'Search' ? 1 : 2];
      const box = (await target.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
      await page.waitForTimeout(250);
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      for (const row of rows) await row.hover();
      await target.click();
      await expect(page).toHaveURL(menu === 'Search' ? /\/legislators$/ : /\/about\/contact$/);
    });
  }
}

test('candidate menus support slow diagonal movement across the trigger-to-panel path', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/candidates');
  for (const menu of ['Search', 'About']) {
    const trigger = page.getByRole('button', { name: menu, exact: true });
    await trigger.hover();
    const from = (await trigger.boundingBox())!;
    const row = trigger.locator('..').getByRole('link').first();
    const to = (await row.boundingBox())!;
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const end = { x: to.x + to.width / 2 - 20, y: to.y + to.height / 2 };
    for (let step = 1; step <= 30; step++) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * step) / 30,
        start.y + ((end.y - start.y) * step) / 30,
      );
      await page.waitForTimeout(25);
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    }
    await trigger.hover();
    await page.keyboard.press('Escape');
  }
});

test('candidate menus retain keyboard access, Escape and outside dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/candidates');
  const trigger = page.getByRole('button', { name: 'Search', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /Bills and votes Read/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await page.getByRole('heading', { name: 'Find my candidates', exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('short desktop windows keep menu rows reachable by scrolling and keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 400 });
  await page.goto('/candidates');
  const trigger = page.getByRole('button', { name: 'Search', exact: true });
  await trigger.hover();
  const before = (await trigger.boundingBox())!;
  const firstRow = page.getByRole('link', { name: /Bills and votes Read/ });
  const lastRow = page.getByRole('link', { name: /Find my legislators Enter/ });
  await firstRow.hover();
  await page.mouse.wheel(0, 1000);
  await page.waitForTimeout(250);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect((await trigger.boundingBox())!.y).toBe(before.y);
  const lastBox = (await lastRow.boundingBox())!;
  expect(lastBox.y).toBeGreaterThan(0);
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(400);
  await expectRowReceivesPointer(lastRow);
  await page.keyboard.press('Escape');
  await trigger.focus();
  await page.keyboard.press('Enter');
  // Firefox also makes the overflowing scroll container a keyboard stop.
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    if (await lastRow.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(lastRow).toBeFocused();
  await expect
    .poll(async () => {
      const keyboardBox = (await lastRow.boundingBox())!;
      return keyboardBox.y + keyboardBox.height;
    })
    .toBeLessThanOrEqual(400);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/find-my-legislator$/);
});

test.describe('touch navigation', () => {
  test.use({ hasTouch: true });
  for (const width of [390, 900]) {
    test(`candidate drawer stays above content and accepts selection at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/candidates');
      await page.getByRole('button', { name: 'Open menu', exact: true }).tap();
      const row = page
        .getByRole('link', { name: 'Legislators', exact: true })
        .filter({ visible: true });
      await expectRowReceivesPointer(row);
      await row.tap();
      await expect(page).toHaveURL(/\/legislators$/);
    });
  }
});
