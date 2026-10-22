import { expect, test } from '@playwright/test';

import { suppressSiteMetrics } from './suppress-site-metrics';

// The signed-out hero text is centred beside the money card, so anything that
// changes the card's height after first paint moves the whole hero. 2 things
// did: the filer count arriving taller than its loading bar, and the card's
// JetBrains Mono eyebrow swapping in taller than its stand-in font. This check
// makes both arrive late, records the hero and the card on every frame from
// the first one that draws the hero, and fails on any movement over 1px.

const SUMMARY = {
  data: {
    register: { state: 'reported', filer_count: 1613 },
    legislator_committee_confirmations: { state: 'unavailable' },
    contests: { state: 'unavailable' },
    independent_expenditure_rows: { state: 'unavailable' },
    freshness: { downloads_fetched_at: null, register_fetched_at: null },
  },
};

test.beforeEach(async ({ context }) => {
  await suppressSiteMetrics(context);
  await context.route('https://api.alethical.com/**', async (route) => {
    if (!route.request().url().includes('/campaign-finance/summary')) return route.abort();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route
      .fulfill({
        json: SUMMARY,
        headers: { 'access-control-allow-origin': '*' },
      })
      .catch(() => {});
  });
  await context.route('**/fonts/jetbrains-mono-*.woff2', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue().catch(() => {});
  });
  await context.addInitScript(() => {
    const frames: { t: number; hero: number; card: number | null; loading: boolean }[] = [];
    (window as unknown as { __heroFrames: typeof frames }).__heroFrames = frames;
    const leaf = (text: string) =>
      Array.from(document.querySelectorAll('div')).find(
        (node) => node.children.length === 0 && node.textContent === text,
      );
    const tick = () => {
      const eyebrow = leaf('TRUTH, UNCONCEALED');
      if (eyebrow) {
        const card = Array.from(document.querySelectorAll('a[href="/money"]')).find((node) =>
          node.textContent?.includes('Follow the money'),
        );
        frames.push({
          t: performance.now(),
          hero: eyebrow.getBoundingClientRect().top,
          card: card ? card.getBoundingClientRect().height : null,
          loading: !!document.querySelector(
            '[aria-label="Loading how many filers the register holds"]',
          ),
        });
      }
      if (performance.now() < 6000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
});

test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

for (const width of [1280, 900, 390]) {
  test(`homepage hero holds still while the count and fonts arrive at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByText('1,613', { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // A few more frames after the last arrival.
    await page.waitForTimeout(300);
    const frames = await page.evaluate(
      () =>
        (
          window as unknown as {
            __heroFrames: { t: number; hero: number; card: number | null; loading: boolean }[];
          }
        ).__heroFrames,
    );
    const monoLoaded = await page.evaluate(
      () =>
        performance
          .getEntriesByType('resource')
          .find((entry) => entry.name.includes('/fonts/jetbrains-mono-latin'))?.responseEnd ?? 0,
    );

    // The check only counts if both late arrivals happened after first paint.
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.some((frame) => frame.loading)).toBe(true);
    expect(monoLoaded).toBeGreaterThan(frames[0].t);

    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(spread(frames.map((frame) => frame.hero))).toBeLessThanOrEqual(1);
    const cards = frames.flatMap((frame) => (frame.card === null ? [] : [frame.card]));
    expect(cards.length).toBeGreaterThan(0);
    expect(spread(cards)).toBeLessThanOrEqual(1);
  });
}
