import { expect, test } from '@playwright/test';

// Deterministic controller tests. Real YouTube availability is checked separately.
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<button>Play example</button>' }),
  );
});

test('local final-video layout preserves the transcript and stays excluded from search', async ({
  page,
  request,
}) => {
  await page.route('https://www.youtube.com/iframe_api', (route) => route.abort());
  const response = await page.goto('/blog/events/forward-debate-2026');
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
  expect(response?.headers()['cache-control']).toBe('no-store');
  await expect(page.getByText('PRIVATE DRAFT', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'The Forward Debate', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#watch')).toHaveCount(1);
  await expect(page.locator('#topics,#transcript')).toHaveCount(2);
  await expect(page.locator('.replay-turn')).toHaveCount(100);
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveAttribute('src', /\/embed\/y66-Wf9bNio\?/);
  await expect(
    page.getByText('Uncertain words and speakers are marked.', { exact: true }),
  ).toBeVisible();
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

for (const width of [320, 390, 768, 1100, 1280]) {
  test(`community invitation stays usable at ${width}px and enlarged text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('https://www.youtube.com/iframe_api', (route) => route.abort());
    await page.goto('/blog/events/forward-debate-2026');
    const invitation = page.locator('.replay-invitation');
    const link = invitation.getByRole('link', { name: 'Contact Alethical', exact: true });
    await invitation.scrollIntoViewIfNeeded();
    await expect(invitation).toHaveCSS('background-color', 'rgb(17, 21, 15)');
    await expect(invitation.locator('h2')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(invitation.locator('h2')).toHaveCSS('hyphens', 'auto');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(invitation.locator('img')).toHaveJSProperty('complete', true);
    expect(
      await invitation.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(0);
    await expect(link).toHaveAttribute('href', 'https://www.alethical.com/about/contact');
    await expect(link).not.toHaveAttribute('target');
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await page.keyboard.press('Tab');
    await link.focus();
    await expect(link).toHaveCSS('outline-width', '2px');
    await expect(link).toHaveCSS('outline-color', 'rgb(124, 92, 255)');
    await link.hover();
    await expect(link).toHaveCSS(
      'background-color',
      width >= 768 ? 'rgb(40, 191, 113)' : 'rgb(46, 212, 126)',
    );
    await expect(link).toHaveCSS('color', 'rgb(6, 35, 26)');
    await page.mouse.down();
    await expect(link).toHaveCSS('background-color', 'rgb(35, 173, 102)');
    await page.mouse.move(0, 0);
    await page.mouse.up();
    await invitation.evaluate((el) => {
      for (const node of el.querySelectorAll<HTMLElement>('h2,a'))
        node.style.fontSize = `${parseFloat(getComputedStyle(node).fontSize) * 2}px`;
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const boxes = await invitation.evaluate((el) => ({
      outer: el.getBoundingClientRect().toJSON(),
      heading: el.querySelector('h2')!.getBoundingClientRect().toJSON(),
      link: el.querySelector('a')!.getBoundingClientRect().toJSON(),
    }));
    expect(boxes.link.right).toBeLessThanOrEqual(boxes.outer.right);
    expect(boxes.heading.right).toBeLessThanOrEqual(boxes.outer.right);
    expect(boxes.link.top).toBeGreaterThanOrEqual(boxes.heading.bottom);
  });
}
