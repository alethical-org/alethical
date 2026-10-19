import { expect, test } from '@playwright/test';
import { renderEventList } from '../src/lib/eventMarkup';

test.beforeEach(async ({ context, baseURL }) => {
  const base = new URL(baseURL!);
  if (!['localhost', '127.0.0.1'].includes(base.hostname))
    throw new Error('Event card regression checks require a loopback build');
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
    if (url.origin === base.origin) {
      if (/^\/(?:api|auth|_vercel)\//.test(url.pathname)) return route.abort();
      return route.continue();
    }
    if (
      url.origin === 'https://api.alethical.com' &&
      /^\/api\/v1\/comments\/articles\/[^/]+$/.test(url.pathname)
    )
      return route.fulfill({
        json: { data: { items: [], next_cursor: null } },
        headers: { 'access-control-allow-origin': '*' },
      });
    // Navigation is under review, not live media, accounts or reader comments.
    return route.abort();
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
});

for (const preview of [true, false]) {
  test(`event ${preview ? 'Blog preview' : 'collection'} card has one full-card link`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.setContent(
      `<main style="padding:30px;max-width:900px">${renderEventList(Date.now(), preview)}</main>`,
    );
    const card = page.locator('.event-list > li').first();
    const link = card.getByRole('link', { name: 'The Forward Debate', exact: true });
    await expect(card.getByRole('link')).toHaveCount(1);
    await card.hover({ position: { x: 12, y: 12 } });
    await expect(card).toHaveCSS('border-top-color', 'rgba(45, 212, 126, 0.85)');
    await expect(card).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -3)');
    await expect(card).toHaveCSS('box-shadow', 'rgba(17, 21, 15, 0.14) 0px 22px 46px 0px');
    await page.mouse.move(0, 0);
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await expect(card).toHaveCSS('outline', 'rgb(124, 92, 255) solid 2px');
    await expect(card).toHaveCSS('outline-offset', '2px');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await card.hover({ position: { x: 12, y: 12 } });
    await expect(card).toHaveCSS('transform', 'none');
    await expect(card).toHaveCSS('border-top-color', 'rgba(45, 212, 126, 0.85)');
    // Blank card space must reach the same real anchor, including native new-tab actions.
    const box = await card.boundingBox();
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href'),
        { x: box!.x + 12, y: box!.y + 12 },
      ),
    ).toBe('/blog/events/forward-debate-2026');
  });
}

test('separate event cards keep independent destinations and phone text fits', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.setContent(`<main style="padding:12px">${renderEventList()}</main>`);
  await page.locator('.event-list').evaluate((list) => {
    const second = list.children[0].cloneNode(true) as HTMLElement;
    second.querySelector('a')!.setAttribute('href', '/blog/events/fixture-second');
    list.append(second);
  });
  const cards = page.locator('.event-list > li');
  await expect(cards).toHaveCount(2);
  await cards.first().hover({ position: { x: 8, y: 8 } });
  await expect(cards.first()).toHaveCSS('transform', 'none');
  await expect(cards.first()).toHaveCSS('box-shadow', 'none');
  await page.keyboard.press('Tab');
  await expect(cards.first().getByRole('link')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cards.nth(1).getByRole('link')).toBeFocused();
  await page.locator('main').evaluate((main) => {
    main.style.fontSize = '200%';
    main.querySelectorAll('p,h2').forEach((node) => {
      (node as HTMLElement).style.fontSize = '200%';
    });
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await cards.nth(1).hover({ position: { x: 12, y: 12 } });
  await expect(cards.first()).toHaveCSS('box-shadow', 'none');
  await expect(cards.nth(1)).toHaveCSS('border-top-color', 'rgba(45, 212, 126, 0.85)');
});

for (const width of [320, 768, 1280]) {
  test(`Blog puts Events first and the card opens its article at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/blog');
    const headings = page.getByRole('heading', { level: 2 });
    await expect(headings.first()).toHaveText('EVENTS');
    expect((await headings.allTextContents()).slice(0, 4)).toEqual([
      'EVENTS',
      'RESEARCH REPORTS',
      'SHORT POSTS',
      'GUIDES',
    ]);
    const card = page.locator('.event-list > li').first();
    await expect(card.locator('.event-list-meta')).toHaveText('October 15, 2026');
    await card.hover({ position: { x: 12, y: 12 } });
    await expect(card).toHaveCSS('transform', width >= 768 ? 'matrix(1, 0, 0, 1, 0, -3)' : 'none');
    await card.click({ position: { x: 12, y: 12 } });
    await expect(page).toHaveURL(/\/blog\/events\/forward-debate-2026$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'The Forward Debate', exact: true }),
    ).toBeVisible();
    // The existing replay return is an absolute public URL. Keep premerge checks
    // on this build; the live review exercises the public round trip.
    await expect(page.getByRole('link', { name: 'Back to Events', exact: true })).toHaveAttribute(
      'href',
      'https://www.alethical.com/blog/events',
    );
    await page.goto('/blog/events');
    await expect(card.locator('.event-list-meta')).toHaveText('October 15, 2026');
    await page.keyboard.press('Tab');
    await card.getByRole('link').focus();
    await expect(card).toHaveCSS('outline', 'rgb(124, 92, 255) solid 2px');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/blog\/events\/forward-debate-2026$/);
  });
}

test('touch does not leave the desktop card lift active', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1024, height: 900 },
  });
  const page = await context.newPage();
  await page.setContent(renderEventList());
  const card = page.locator('.event-list > li').first();
  await card.hover({ position: { x: 12, y: 12 } });
  await expect(card).toHaveCSS('transform', 'none');
  await expect(card).toHaveCSS('box-shadow', 'none');
  await context.close();
});
