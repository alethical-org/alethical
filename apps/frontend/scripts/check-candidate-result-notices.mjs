/** Browser regression: run against a local server with candidate preview enabled. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:19057';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use the local preview');
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 900, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
    });
    await page.goto(`${base}/candidates`);
    await page.getByLabel('Review state', { exact: true }).waitFor();
    await page.getByLabel('Full street address', { exact: true }).fill('100 Example Street');
    await page.getByRole('button', { name: 'Find my candidates', exact: true }).click();
    const notice = page.getByRole('region', { name: 'About these results', exact: true });
    await notice.waitFor();
    assert.equal(await notice.count(), 1);
    assert.equal(
      await notice.evaluate((node) => {
        const prior = node.previousElementSibling.getBoundingClientRect();
        return node.getBoundingClientRect().top - prior.bottom;
      }),
      40,
    );
    assert.equal(await page.getByText('No candidates listed', { exact: true }).count(), 1);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );

    // A popup trapped under the later results column fails this real pointer action.
    const menu = page.getByRole('combobox', { name: /^Election/ });
    await menu.click();
    const primary = page.getByRole('option', { name: /State primary/ });
    if (width === 390) await primary.tap({ timeout: 5000 });
    else await primary.click({ timeout: 5000 });
    await page.getByText('Not every office has a primary', { exact: true }).waitFor();
    assert.equal(
      await page.locator('.candidate-group-toggle').last().innerText(),
      'School board\n1 race',
    );
    assert.equal(
      await notice.evaluate(
        (node) =>
          node.getBoundingClientRect().top -
          node.previousElementSibling.getBoundingClientRect().bottom,
      ),
      40,
    );
    await menu.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    assert.equal(await menu.evaluate((node) => node === document.activeElement), true);
    await page.close();
    console.log(`Candidate notices and election selection pass at ${width}px`);
  }
} finally {
  await browser.close();
}
