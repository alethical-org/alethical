import { expect, test } from '@playwright/test';
import { suppressSiteMetrics } from './suppress-site-metrics';

test.beforeEach(async ({ context }) => {
  await suppressSiteMetrics(context);
  // Footer geometry is independent of optional news/count responses. Settle
  // those requests immediately so arriving content cannot move the footer
  // between the vertical scroll and its measurement.
  await context.route('https://api.alethical.com/**', (route) => route.abort());
});

for (const width of [320, 390, 900, 1600]) {
  test(`footer social links and focus fit without sideways scrolling at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const links = page.getByRole('link', { name: /^Alethical on / });
    await expect(links).toHaveCount(6);
    await page.evaluate(() => document.fonts.ready);
    // Scroll vertically, as a reader would. scrollIntoView can silently shift an
    // overflowing ancestor sideways and hide the defect this test must catch.
    await page.mouse.move(width / 2, 450);
    await expect
      .poll(async () => {
        await page.mouse.wheel(0, 10_000);
        const box = await links.last().boundingBox();
        return box !== null && box.y >= 0 && box.y + box.height <= 900;
      })
      .toBe(true);
    await expect(links.last()).toBeInViewport();
    const measure = () =>
      links.evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          const ancestors = [];
          for (let parent = node.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) {
              const rect = parent.getBoundingClientRect();
              ancestors.push({ left: rect.left, right: rect.right, scrollLeft: parent.scrollLeft });
            }
          }
          return {
            left: box.left,
            right: box.right,
            width: box.width,
            height: box.height,
            ancestors,
          };
        }),
      );
    const assertFits = async () => {
      for (const box of await measure()) {
        expect(box.width).toBe(width < 768 ? 44 : 42);
        expect(box.height).toBe(box.width);
        // Keep the 2px outline plus its 2px offset inside every clipping edge.
        expect(box.left).toBeGreaterThanOrEqual(4);
        expect(box.right).toBeLessThanOrEqual(width - 4);
        for (const ancestor of box.ancestors) {
          expect(ancestor.scrollLeft).toBe(0);
          expect(box.left - 4).toBeGreaterThanOrEqual(ancestor.left);
          expect(box.right + 4).toBeLessThanOrEqual(ancestor.right);
        }
      }
    };
    await assertFits();
    await links.first().focus();
    await page.keyboard.press('Shift+Tab');
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press('Tab');
      await expect(links.nth(index)).toBeFocused();
      await expect(links.nth(index)).toHaveCSS('outline-style', 'solid');
      await assertFits();
    }
  });
}
