import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// The local fixture has invented accounts and retained synthetic files only.
// This regression does not start/restart it and intercepts its sole write.
const origin = process.env.TV_LOCAL_UI_ORIGIN;
const output = resolve('../../.task-notes/tv-admin-buttons');
async function expectLabelsInsideButtons(page: Page) {
  const failures = await page
    .locator('[data-tv-review-action] [role="button"]')
    .evaluateAll((buttons) =>
      buttons.flatMap((button) => {
        const box = button.getBoundingClientRect();
        if (!box.width || !box.height) return [];
        const ranges: DOMRect[] = [];
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode;
          if (!text.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          ranges.push(...range.getClientRects());
        }
        const overflow = ranges.some(
          (line) =>
            line.left < box.left - 1 ||
            line.right > box.right + 1 ||
            line.top < box.top - 1 ||
            line.bottom > box.bottom + 1,
        );
        return overflow
          ? [{ label: button.getAttribute('aria-label'), width: box.width, height: box.height }]
          : [];
      }),
    );
  expect(failures).toEqual([]);
}

test('long admin actions wrap naturally and keep their box while saving', async ({ page }) => {
  test.skip(!origin, 'Set TV_LOCAL_UI_ORIGIN to the running isolated synthetic fixture');
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 1504, height: 1000 });
  await page.goto(`${origin}/fixture/select/admin`);
  await page
    .getByRole('button', { name: 'Review SYNTHETIC source private contact', exact: true })
    .first()
    .click();
  const openDraft = page.getByRole('button', { name: /^Open draft copy/ }).first();
  await expect(openDraft).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Return to the review queue', exact: true }),
  ).toBeVisible();
  await expectLabelsInsideButtons(page);
  await openDraft.click();
  await expect(
    page.getByRole('button', { name: 'Withdraw this copy from every reader path', exact: true }),
  ).toBeVisible();
  await expectLabelsInsideButtons(page);
  await page
    .getByRole('button', { name: 'Return to the review queue', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'desktop-long-labels.png') });
  await page
    .getByRole('button', { name: 'Withdraw this copy from every reader path', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'desktop-withdraw-label.png') });

  await page.setViewportSize({ width: 375, height: 900 });
  await expectLabelsInsideButtons(page);
  await openDraft.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'phone-wrapped-labels.png') });
  await page
    .getByRole('checkbox', {
      name: 'I inspected every prepared page and the private details have been removed',
      exact: true,
    })
    .check();
  await page
    .getByRole('checkbox', {
      name: 'I checked the title, folder label and category for private details',
      exact: true,
    })
    .check();
  await page
    .getByRole('checkbox', {
      name: 'I inspected the text for every page and removed private details from searchable text',
      exact: true,
    })
    .check();
  await page
    .getByLabel('Copy approval evidence', { exact: true })
    .fill('Synthetic button-state test; this request is intercepted and never saved');
  const approval = page.getByRole('button', {
    name: 'Approve this exact copy',
    exact: true,
  });
  await expect(approval).toBeEnabled();
  await approval.scrollIntoViewIfNeeded();
  const wrapper = approval.locator('..');
  const ready = await wrapper.boundingBox();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  await page.route('**/api/v1/admin/political-ads/copies/*/approve', async (route) => {
    writes += 1;
    await hold;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"detail":"Synthetic failure; nothing saved"}',
    });
  });
  await approval.click();
  const saving = page.getByRole('button', { name: 'Saving…', exact: true });
  await expect(saving).toHaveAttribute('aria-busy', 'true');
  await expect(saving).toHaveAttribute('aria-disabled', 'true');
  const busy = await saving.locator('..').boundingBox();
  expect(busy).toEqual(ready);
  await expectLabelsInsideButtons(page);
  await page.screenshot({ path: resolve(output, 'phone-saving-stable.png') });
  await expect(
    page.locator('[data-tv-review-action] > span:not([aria-hidden="true"])'),
  ).toHaveCount(0);
  expect(writes).toBe(1);
  release();
  await expect(approval).toBeEnabled();
  expect(await wrapper.boundingBox()).toEqual(ready);
});
