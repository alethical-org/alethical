import { expect, test, type Page } from '@playwright/test';

import { suppressSiteMetrics } from './suppress-site-metrics';

test.beforeEach(async ({ context }) => {
  await suppressSiteMetrics(context);
});

// Tops and bottoms of the first field box and the 2 side cards, in page pixels.
async function measure(page: Page) {
  return page.evaluate(() => {
    const rect = (node: Element | null | undefined) => {
      if (!node) throw new Error('Contact us layout element is missing');
      const box = node.getBoundingClientRect();
      return { top: box.top + window.scrollY, bottom: box.bottom + window.scrollY };
    };
    const card = (eyebrow: string) =>
      Array.from(document.querySelectorAll('div')).find(
        (node) => node.firstElementChild?.textContent === eyebrow,
      );
    const follow = card('FOLLOW ALETHICAL');
    const circles = Array.from(follow?.querySelectorAll('a[aria-label^="Alethical on"]') ?? []).map(
      (link) => rect(link),
    );
    return {
      fieldBox: rect(document.getElementById('contact-name')?.parentElement),
      emailCard: rect(card('EMAIL US')),
      followCard: rect(follow),
      circles,
    };
  });
}

// Tablet (768 to 1099px) and computer keep the form and side column side by side.
for (const width of [800, 1280]) {
  test(`Contact us side cards line up with the first field box at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/about/contact');
    await expect(page.getByRole('link', { name: /^Alethical on / }).nth(13)).toBeAttached();
    await page.evaluate(() => document.fonts.ready);
    const layout = await measure(page);

    expect(layout.emailCard.top).toBe(layout.fieldBox.top);
    expect(layout.followCard.top - layout.emailCard.bottom).toBe(24);

    // 4 circles on the first line and 3 on the second, 20px apart.
    expect(layout.circles).toHaveLength(7);
    expect(new Set(layout.circles.slice(0, 4).map((box) => box.top)).size).toBe(1);
    expect(new Set(layout.circles.slice(4).map((box) => box.top)).size).toBe(1);
    expect(layout.circles[4].top - layout.circles[0].bottom).toBe(20);
  });
}
