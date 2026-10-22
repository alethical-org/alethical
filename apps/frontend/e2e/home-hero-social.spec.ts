import { expect, test } from '@playwright/test';

import { suppressSiteMetrics } from './suppress-site-metrics';

test.beforeEach(async ({ context }) => {
  await suppressSiteMetrics(context);
});

const ORDER = ['YouTube', 'LinkedIn', 'Facebook', 'X', 'Bluesky', 'Instagram', 'TikTok'];

// [viewport width, link size, gap between links, space under the hero text]
for (const [width, size, gap, space] of [
  [1280, 40, 2, 28],
  [900, 40, 2, 24],
  [390, 44, 0, 18],
  [320, 44, 0, 18],
]) {
  test(`homepage hero lists the 7 accounts under the text at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const row = page.getByRole('group', { name: 'Social media' });
    const links = row.getByRole('link');
    await expect(links).toHaveCount(7);
    for (const [index, platform] of ORDER.entries()) {
      await expect(links.nth(index)).toHaveAccessibleName(
        `Alethical on ${platform} (opens in a new tab)`,
      );
    }
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const group = document.querySelector('[role="group"][aria-label="Social media"]');
      const intro = Array.from(document.querySelectorAll('div')).find(
        (node) => node.children.length === 0 && node.textContent?.startsWith('We turn scattered'),
      );
      if (!group || !intro) throw new Error('Hero text or social row is missing');
      const anchors = Array.from(group.querySelectorAll('a'));
      return {
        introLeft: intro.getBoundingClientRect().left,
        introBottom: intro.getBoundingClientRect().bottom,
        firstInkLeft: anchors[0].querySelector('path')!.getBoundingClientRect().left,
        boxes: anchors.map((anchor) => {
          const box = anchor.getBoundingClientRect();
          return { left: box.left, top: box.top, width: box.width };
        }),
      };
    });

    // The first mark's ink starts exactly on the text's left edge: no indent.
    expect(Math.abs(layout.firstInkLeft - layout.introLeft)).toBeLessThan(0.5);
    expect(layout.boxes[0].top - layout.introBottom).toBeCloseTo(space, 0);
    for (const box of layout.boxes) expect(box.width).toBe(size);
    if (width < 336) {
      // Below 336px: 4 marks, then 3, Bluesky under YouTube.
      expect(new Set(layout.boxes.slice(0, 4).map((box) => box.top)).size).toBe(1);
      expect(layout.boxes[4].top - layout.boxes[0].top).toBe(size);
      expect(layout.boxes[4].left).toBe(layout.boxes[0].left);
    } else {
      expect(new Set(layout.boxes.map((box) => box.top)).size).toBe(1);
      expect(layout.boxes[1].left - layout.boxes[0].left).toBe(size + gap);
    }

    // Grey marks with no circle at rest; keyboard focus draws the site ring.
    const bluesky = links.nth(4);
    await page.mouse.move(0, 0);
    await expect(bluesky).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(bluesky.locator('svg')).toHaveAttribute('fill', '#6b716b');
    await bluesky.focus();
    await expect(bluesky).toHaveCSS('outline-style', 'solid');
    if (width >= 768) {
      await bluesky.hover();
      await expect(bluesky).toHaveCSS('background-color', 'rgba(17, 21, 15, 0.06)');
      await expect(bluesky.locator('svg')).toHaveAttribute('fill', '#11150f');
    }
  });
}
