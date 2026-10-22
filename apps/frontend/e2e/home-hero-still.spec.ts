import { expect, test } from '@playwright/test';

import { suppressSiteMetrics } from './suppress-site-metrics';

// The signed-out hero text is centred beside the money card, so anything that
// changes the card's height after first paint moves the whole hero. 3 things
// did: the text the server sends first was drawn in another layout until the
// app replaced it, the filer count arrived taller than its loading bar, and the
// card's JetBrains Mono eyebrow swapped in taller than its stand-in font. This
// check makes all 3 arrive late, records the top bar, the hero and the card on
// every frame from the first paint of the served text, and fails on any
// movement over 1px. Layout-shift scores cannot catch the first one: the browser
// scores a replaced element as 0.

type Frame = {
  t: number;
  served: boolean;
  logo: [number, number];
  hero: number;
  card: number | null;
  loading: boolean;
};

const SUMMARY = {
  data: {
    register: { state: 'reported', filer_count: 1613 },
    legislator_committee_confirmations: { state: 'unavailable' },
    contests: { state: 'unavailable' },
    independent_expenditure_rows: { state: 'unavailable' },
    freshness: { downloads_fetched_at: null, register_fetched_at: null },
  },
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.beforeEach(async ({ context }) => {
  await suppressSiteMetrics(context);
  await context.route('https://api.alethical.com/**', async (route) => {
    if (!route.request().url().includes('/campaign-finance/summary')) return route.abort();
    await delay(1500);
    await route
      .fulfill({
        json: SUMMARY,
        headers: { 'access-control-allow-origin': '*' },
      })
      .catch(() => {});
  });
  await context.route('**/fonts/jetbrains-mono-*.woff2', async (route) => {
    await delay(1000);
    await route.continue().catch(() => {});
  });
  // Hold the app back so the served text stays on screen for several frames.
  await context.route('**/_expo/static/js/**', async (route) => {
    await delay(400);
    await route.continue().catch(() => {});
  });
  await context.addInitScript(() => {
    const frames: Frame[] = [];
    (window as unknown as { __heroFrames: Frame[] }).__heroFrames = frames;
    // The first drawn element showing exactly this text: the served copy and the
    // app use different elements, and the page holds hidden copies too.
    const shown = (text: string) =>
      Array.from(document.querySelectorAll('body *')).find((node) => {
        if (node.childElementCount > 0 || node.textContent !== text) return false;
        const box = node.getBoundingClientRect();
        return box.height > 0 && box.top < window.innerHeight;
      });
    const tick = () => {
      const eyebrow = shown('TRUTH, UNCONCEALED');
      const logo = shown('ALETHICAL');
      if (eyebrow && logo) {
        const card = Array.from(document.querySelectorAll('a[href="/money"]')).find(
          (node) =>
            node.textContent?.includes('Follow the money') &&
            node.getBoundingClientRect().height > 0,
        );
        const logoBox = logo.getBoundingClientRect();
        frames.push({
          t: performance.now(),
          served: !!document.querySelector('#root .page-snapshot'),
          logo: [logoBox.left, logoBox.top],
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
  test(`homepage hero holds still from first paint at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByText('1,613', { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // A few more frames after the last arrival.
    await page.waitForTimeout(300);
    const frames = await page.evaluate(
      () => (window as unknown as { __heroFrames: Frame[] }).__heroFrames,
    );
    const monoLoaded = await page.evaluate(
      () =>
        (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).find((entry) =>
          entry.name.includes('/fonts/jetbrains-mono-latin'),
        )?.responseEnd ?? 0,
    );

    // The check only counts if every late arrival happened after first paint.
    expect(frames.length).toBeGreaterThan(10);
    expect(frames[0].served).toBe(true);
    expect(frames.some((frame) => !frame.served && frame.loading)).toBe(true);
    expect(frames.some((frame) => !frame.served && !frame.loading)).toBe(true);
    expect(monoLoaded).toBeGreaterThan(frames[0].t);

    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(spread(frames.map((frame) => frame.logo[0]))).toBeLessThanOrEqual(1);
    expect(spread(frames.map((frame) => frame.logo[1]))).toBeLessThanOrEqual(1);
    expect(spread(frames.map((frame) => frame.hero))).toBeLessThanOrEqual(1);
    const cards = frames.flatMap((frame) => (frame.card === null ? [] : [frame.card]));
    expect(cards.length).toBeGreaterThan(0);
    expect(spread(cards)).toBeLessThanOrEqual(1);
  });
}
