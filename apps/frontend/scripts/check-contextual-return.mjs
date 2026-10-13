/** Rendered regression: named returns preserve context and agree with copied links. */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { readerFixtures } from './reader-completion-fixtures.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local build');
const fixture = await readerFixtures();
async function readingPosition(link) {
  await link.scrollIntoViewIfNeeded();
  return link.evaluate((node) => {
    let parent = node.parentElement;
    while (parent && !['auto', 'scroll'].includes(getComputedStyle(parent).overflowY))
      parent = parent.parentElement;
    if (parent)
      parent.scrollTop = Math.min(parent.scrollTop + 80, parent.scrollHeight - parent.clientHeight);
    return node.getBoundingClientRect().y;
  });
}
async function settledPosition(page, link) {
  await expect
    .poll(() =>
      link.evaluate((node) => {
        let parent = node.parentElement;
        while (parent && !['auto', 'scroll'].includes(getComputedStyle(parent).overflowY))
          parent = parent.parentElement;
        const entry = history.state.__alethical;
        const stored = sessionStorage.getItem(
          `alethical:scroll:${entry.sessionId}:${entry.entryId}`,
        );
        return Math.abs(Number(stored) - (parent?.scrollTop ?? 0)) < 2 && stored !== null;
      }),
    )
    .toBe(true);
  return (await link.boundingBox()).y;
}
const browser = await chromium.launch();
try {
  for (const width of [1280, 900, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: width === 390,
      hasTouch: width === 390,
      serviceWorkers: 'block',
    });
    await context.route('**/*', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin === new URL(base).origin && ['GET', 'HEAD'].includes(request.method()))
        return route.continue();
      if (url.origin === 'https://api.alethical.com' && request.method() === 'GET') {
        const response = fixture(url.pathname, url.searchParams);
        if (response !== undefined) {
          if (url.pathname === '/api/v1/bills' && response.page)
            response.page = { ...response.page, total: 72, has_more: true };
          return route.fulfill({ json: response, headers: { 'access-control-allow-origin': '*' } });
        }
      }
      return route.fulfill({ status: 503, body: '' });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const source = '/bills?q=school&topic=education&scope=all&omnibus=1';
    await page.goto(base + source);
    await expect(page.getByRole('heading', { name: 'Search bills', exact: true })).toBeVisible();
    const record = page.locator('a[href^="/bills/"]:visible').first();
    await expect(record).toBeVisible();
    const sourcePath = await page.evaluate(() => location.pathname + location.search);
    await record.click();
    const returned = page.getByRole('link', { name: 'Back to Search bills', exact: true });
    await expect(returned).toBeVisible();
    await expect(returned).toHaveAttribute('href', sourcePath);
    const copied = await returned.getAttribute('href');
    const fresh = await context.newPage();
    await fresh.goto(base + copied);
    await expect(fresh.getByRole('heading', { name: 'Search bills', exact: true })).toBeVisible();
    await fresh.close();
    const billPath = await page.evaluate(() => location.pathname + location.search);
    const contact = page.locator('a[href="/about/contact"]:visible').first();
    await contact.click();
    const billReturn = page.getByRole('link', { name: 'Back to HF 719', exact: true });
    await expect(billReturn).toHaveAttribute('href', billPath);
    await billReturn.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('link', { name: 'Back to Search bills', exact: true }),
    ).toBeVisible();
    if (width === 390)
      await page.getByRole('link', { name: 'Back to Search bills', exact: true }).tap();
    else await page.getByRole('link', { name: 'Back to Search bills', exact: true }).click();
    await expect(page).toHaveURL(base + sourcePath);
    await expect(page.getByRole('heading', { name: 'Search bills', exact: true })).toBeVisible();
    const direct = await context.newPage();
    await direct.goto(base + '/about/contact');
    await expect(direct.getByRole('link', { name: 'Back to Home', exact: true })).toHaveAttribute(
      'href',
      '/',
    );
    await direct.getByRole('link', { name: 'Back to Home', exact: true }).click();
    await expect(direct).toHaveURL(base + '/');
    await direct.close();
    // A differently ordered source query must restore its original entry and scroll.
    await page.goto(base + '/bills?q=housing&page=2&chamber=House');
    const filteredBill = page.locator('a[href^="/bills/"]:visible').first();
    await expect(filteredBill).toBeVisible();
    await readingPosition(filteredBill);
    const before = await settledPosition(page, filteredBill);
    const originalEntry = await page.evaluate(() => history.state.__alethical.entryId);
    await filteredBill.click();
    await page.getByRole('link', { name: 'Back to Search bills', exact: true }).click();
    await expect(filteredBill).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => history.state.__alethical.entryId))
      .toBe(originalEntry);
    await expect
      .poll(async () => Math.abs((await filteredBill.boundingBox()).y - before))
      .toBeLessThan(3);

    await page.goto(base + '/legislators/jim-abeler');
    const profileBill = page.locator('a[href="/bills/94-2025-HF719"]:visible').first();
    await expect(profileBill).toBeVisible();
    await readingPosition(profileBill);
    const profileBefore = await settledPosition(page, profileBill);
    await profileBill.click();
    await page.getByRole('link', { name: 'Back to Sen. Jim Abeler', exact: true }).click();
    await expect(profileBill).toBeVisible();
    await expect
      .poll(async () => Math.abs((await profileBill.boundingBox()).y - profileBefore))
      .toBeLessThan(3);

    await page.goto(base + '/blog/topics/lobbying');
    const article = page.getByRole('link', { name: 'The Money Only Goes One Way', exact: true });
    await article.click();
    const articleReturn = page.getByRole('link', { name: 'Back to Lobbying', exact: true });
    const articleReturnHref = await articleReturn.getAttribute('href');
    assert(articleReturnHref.includes('post=the-money-only-goes-one-way'));
    await articleReturn.click();
    await expect(page).toHaveURL(base + articleReturnHref);
    assert.equal(errors.length, 0, 'Named-return navigation must not crash');
    console.log(
      `${width}px contextual return agrees with copied address, retains filters and supports keyboard/touch`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
