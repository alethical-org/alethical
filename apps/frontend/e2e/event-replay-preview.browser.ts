import { expect, test } from '@playwright/test';

// Deterministic controller tests. Real YouTube availability is checked separately.
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<button>Play example</button>' }),
  );
});

test('local public layout omits unfinished sections and stays excluded from search', async ({
  page,
  request,
}) => {
  const response = await page.goto('/blog/events/forward-debate-2026');
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
  expect(response?.headers()['cache-control']).toBe('no-store');
  await expect(page.getByText('PRIVATE DRAFT', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'The Forward Debate', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#watch')).toHaveCount(0);
  await expect(page.locator('#topics,#transcript')).toHaveCount(2);
  await expect(page.locator('.replay-turn')).toHaveCount(100);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  expect(
    (
      await request.get('/blog/events/forward-debate-2026', {
        headers: { Origin: 'https://unrelated.example' },
      })
    ).status(),
  ).toBe(403);
});

test('topic links seek, preserve the frame, copy their timestamp and support Back', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.YT={Player:class{constructor(frame,opts){this.frame=frame;queueMicrotask(()=>opts.events.onReady());}seekTo(s){this.frame.dataset.lastSeek=String(s);}destroy(){}}};window.onYouTubeIframeAPIReady();`,
    }),
  );
  await page.goto('/__replay-example');
  await expect(
    page.getByRole('button', { name: 'Copy link to Example speaker at 0:20' }),
  ).toBeVisible();
  const frame = page.locator('#replay-player');
  const originalSrc = await frame.getAttribute('src');
  await page.getByRole('link', { name: '0:20 Longer answer example', exact: true }).click();
  await expect(frame).toHaveAttribute('data-last-seek', '20');
  await expect(frame).toHaveAttribute('src', originalSrc!);
  await expect(page).toHaveURL(/\?t=20#watch$/);
  await expect(page.getByRole('heading', { name: 'Watch the full example' })).toBeFocused();
  await expect(page.locator('[data-replay-youtube]')).toHaveAttribute('href', /t=20s$/);
  await page.getByRole('button', { name: 'Copy link to Example speaker at 0:20' }).click();
  await expect(page.locator('[data-replay-copy-status]')).toHaveText('Link copied for 0:20');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'http://127.0.0.1:4187/__replay-example?t=20#watch',
  );
  await page.goBack();
  // Returning to the article without a timestamp does not rewind playback.
  await expect(frame).toHaveAttribute('data-last-seek', '20');
  const timeLink = page.getByRole('link', { name: '0:40 Closing example', exact: true });
  await timeLink.focus();
  await page.keyboard.press('Enter');
  await expect(frame).toHaveAttribute('data-last-seek', '40');
});

test('blocked player controls leave ordinary links and transcript usable', async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', (route) => route.abort());
  await page.goto('/__replay-example');
  await expect(page.locator('[data-replay-status]')).toContainText('watch it on YouTube');
  await page.getByRole('link', { name: '0:20 Longer answer example', exact: true }).click();
  await expect(page).toHaveURL(/\?t=20#watch$/);
  await expect(page.locator('iframe')).toHaveAttribute('src', /start=20/);
  await expect(page.locator('.replay-turn')).toHaveCount(3);
});

for (const width of [320, 390, 1280]) {
  test(`readable controls and transcript at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('https://www.youtube.com/iframe_api', (route) => route.abort());
    await page.goto('/__replay-example');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await page.locator('iframe').boundingBox())!.height).toBeGreaterThanOrEqual(200);
    const copy = page.getByRole('button', { name: 'Copy link to Example speaker at 0:20' });
    await copy.focus();
    expect(await copy.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.locator('summary').click();
    await expect(page.getByText('Also invited: Jared Gapinski', { exact: false })).toBeVisible();
    await page.locator('.event-flyer').scrollIntoViewIfNeeded();
    await expect(page.locator('.event-flyer')).toHaveJSProperty('complete', true);
    expect(
      await page.locator('.event-flyer').evaluate((el: HTMLImageElement) => el.naturalWidth),
    ).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`replay-${width}.png`), fullPage: true });
  });
}
