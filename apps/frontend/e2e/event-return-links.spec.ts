import { expect, test } from '@playwright/test';

for (const width of [320, 390, 1280]) {
  for (const [path, destination, name] of [
    ['/blog/events/forward-debate-2026', '/blog/events', 'Back to Events'],
    ['/blog/events', '/blog', 'Back to Blog'],
  ]) {
    test(`event return remains usable at ${width}px on ${path}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const link = page.getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', destination);
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
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${destination}$`));
    });
  }
}
