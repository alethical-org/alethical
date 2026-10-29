import { expect, test } from '@playwright/test';

for (const width of [320, 390, 1280]) {
  for (const [path, destination, name] of [
    ['/blog/events/forward-debate-2026', '/blog/events', 'Back to Debates and recordings'],
    ['/blog/events', '/blog', 'Back to Media'],
  ]) {
    test(`event return remains usable at ${width}px on ${path}`, async ({ page, baseURL }) => {
      const base = new URL(baseURL!);
      if (!['localhost', '127.0.0.1'].includes(base.hostname))
        throw new Error('Event return checks require a loopback build');
      // The replay preserves its public return URL. Keep this premerge journey
      // on the app under test instead of visiting the deployed site.
      await page.route('https://www.alethical.com/blog/events', (route) =>
        route.fulfill({ status: 302, headers: { location: `${baseURL}/blog/events` } }),
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const link = page.getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', new RegExp(`${destination}$`));
      await expect(link).toHaveCSS('color', 'rgb(75, 82, 75)');
      await expect(link).toHaveCSS('min-height', '44px');
      await expect(link).toHaveCSS('column-gap', '9px');
      await expect(link.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      await link.hover();
      await expect(link).toHaveCSS('color', width >= 768 ? 'rgb(17, 21, 15)' : 'rgb(75, 82, 75)');
      await expect(link.locator('span')).toHaveCSS(
        'text-decoration-line',
        width >= 768 ? 'underline' : 'none',
      );
      await expect(link.locator('svg')).toHaveCSS('text-decoration-line', 'none');
      await page.keyboard.press('Tab');
      await link.focus();
      await expect(link).toHaveCSS('outline-color', 'rgb(124, 92, 255)');
      await expect(link).toHaveCSS('outline-width', '2px');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (path.includes('forward-debate')) {
        const groups = page.locator('.event-published > .event-keep, .event-facts .event-keep');
        for (const group of await groups.all()) {
          expect(
            await group.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              return new Set(
                [...range.getClientRects()]
                  .filter((rect) => rect.width > 0)
                  .map((rect) => Math.round(rect.top)),
              ).size;
            }),
          ).toBe(1);
        }
      }
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${destination}$`));
    });
  }
}
