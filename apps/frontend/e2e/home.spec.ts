import { test, expect } from '@playwright/test';
import { suppressSiteMetrics } from './suppress-site-metrics';

test.beforeEach(async ({ context, baseURL }) => {
  await suppressSiteMetrics(context);
  if (baseURL && ['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) {
    // Export previews are not production CORS origins. Preserve exact public
    // GET responses locally; this does not change API records or its settings.
    await context.route('https://api.alethical.com/**', async (route) => {
      if (route.request().method() !== 'GET') return route.abort();
      const response = await route.fetch({ timeout: 15_000 });
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'access-control-allow-origin': '*' },
      });
    });
  }
});

test.afterEach(async ({ context }) => {
  // Rendering-only checks can finish before unused GETs. Teardown cancellation
  // is not a product failure; errors during the actual check still fail it.
  await context.unrouteAll({ behavior: 'ignoreErrors' });
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

for (const width of [390, 1600]) {
  test(`Back returns to the homepage bill invitation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByText(/registered campaigns, parties, and funds/)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const billLink =
      width < 768
        ? page.getByRole('link').filter({ hasText: 'HF 4138' }).first()
        : page.getByRole('link', { name: 'View bill profile', exact: true });
    await billLink.focus();
    await billLink.scrollIntoViewIfNeeded();
    const position = () =>
      billLink.evaluate((node) => {
        let parent = node.parentElement;
        while (parent && getComputedStyle(parent).overflowY !== 'auto') {
          parent = parent.parentElement;
        }
        return parent?.scrollTop ?? 0;
      });
    const before = await position();
    expect(before).toBeGreaterThan(100);
    // React Native Web saves its inner scroller after its trailing scroll event.
    await page.waitForTimeout(150);
    await billLink.click();
    await page.waitForURL('**/bills/94-2026-HF4138');
    await page.goBack();
    await page.waitForURL(/\/$/);
    await expect.poll(position).toBe(before);
    await expect(billLink).toBeInViewport();
  });
}

for (const width of [900, 1100, 1600]) {
  test(`editorial example matches the approved facts and layout at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const badge = page.getByRole('link', { name: 'HF 4138', exact: true });
    await expect(badge).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const card = badge.locator('../..');
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByText('Effective Jul 1, 2027', { exact: true })).toBeVisible();
    const note = card.getByText(
      'Such as infinite scrolling, autoplay video, and push notifications',
      { exact: true },
    );
    await expect(note).toHaveCSS('font-style', 'normal');
    const badgeText = badge.getByText('HF 4138', { exact: true });
    await expect(badgeText).toHaveCSS('font-family', /Libre Franklin/);
    await expect(badgeText).toHaveCSS('font-weight', '800');
    await expect(badgeText).toHaveCSS('font-size', '16px');
    await expect(badgeText).toHaveCSS('font-variant-numeric', 'tabular-nums');
    const facts = badge.locator('..');
    const layout = await facts.evaluate((row) => {
      const boxes = Array.from(row.children).map((child) => child.getBoundingClientRect());
      return {
        count: boxes.length,
        centers: boxes.map((r) => r.y + r.height / 2),
        overflow: row.scrollWidth > row.clientWidth,
      };
    });
    expect(layout.count).toBe(5);
    expect(layout.overflow).toBe(false);
    if (width === 1600)
      expect(Math.max(...layout.centers) - Math.min(...layout.centers)).toBeLessThan(1);
    const quotes = await Promise.all(
      ['Parental consent', 'Addictive features', 'Privacy by default'].map(async (name) => {
        return card.getByText(name, { exact: true }).locator('../..').boundingBox();
      }),
    );
    const heights = quotes.map((box) => box!.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    const footer = card.getByRole('link', { name: 'View bill profile', exact: true });
    const footerBox = (await footer.boundingBox())!;
    expect(Math.abs(footerBox.x - quotes[0]!.x)).toBeLessThan(1);
    expect(Math.abs(footerBox.y - (quotes[0]!.y + quotes[0]!.height) - 18)).toBeLessThan(1);
    await expect(footer).toHaveAttribute('href', '/bills/94-2026-HF4138');
    await badge.hover();
    await expect(badge).toHaveCSS('background-color', 'rgb(246, 230, 203)');
    await expect(badgeText).toHaveCSS('text-decoration-line', 'underline');
  });
}
