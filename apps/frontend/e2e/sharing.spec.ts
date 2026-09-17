import { expect, test } from '@playwright/test';

const path = '/read/research/the-money-only-goes-one-way';
const publicUrl = `https://www.alethical.com${path}`;

test.beforeEach(async ({ page, baseURL }) => {
  // Production's public API does not allow arbitrary local preview ports.
  // Read the same GET responses through Playwright for local browser checks.
  if (baseURL && new URL(baseURL).hostname === 'localhost') {
    await page.route('https://api.alethical.com/**', async (route) => {
      if (route.request().method() !== 'GET') return route.abort();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'access-control-allow-origin': '*' },
      });
    });
  }
});

test.afterEach(async ({ page }) => {
  // The profile preloads other filing years after the Share assertions finish.
  // Let teardown cancel those reads without surfacing a closed-test route error.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

for (const [band, width, height] of [
  ['desktop', 1400, 1000],
  ['tablet', 900, 1000],
  ['phone', 390, 844],
  ['short desktop', 1200, 400],
] as const) {
  test(`${band}: named dialog, destinations, keyboard, and reachable close`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(path);
    const trigger = page.getByRole('button', { name: 'Share this research', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Share this research' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await expect(dialog.getByRole('textbox', { name: 'Research link' })).toHaveValue(publicUrl);
    await expect(dialog.getByRole('textbox')).toHaveAttribute('readonly', '');
    const labels = await dialog.getByRole('button').allTextContents();
    expect(
      labels.filter((label) => /^(Email|WhatsApp|Facebook|LinkedIn|X|Bluesky)$/.test(label)),
    ).toEqual(['Email', 'WhatsApp', 'Facebook', 'LinkedIn', 'X', 'Bluesky']);

    const before = await trigger.boundingBox();
    await page.mouse.move(5, 5);
    await page.mouse.wheel(0, 600);
    await expect.poll(async () => (await trigger.boundingBox())?.y).toBe(before?.y);
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    await dialog.getByRole('button', { name: 'Share on Bluesky' }).scrollIntoViewIfNeeded();
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    const closeBox = await close.boundingBox();
    expect(closeBox!.y).toBeGreaterThanOrEqual(0);
    expect(closeBox!.y + closeBox!.height).toBeLessThanOrEqual(height);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.mouse.click(5, 5);
    await expect(dialog).toHaveCount(0);
  });
}

test('new destinations retain the exact link without publishing anything', async ({ page }) => {
  await page.addInitScript(() => {
    window.open = ((url: string | URL | undefined) => {
      (window as unknown as { lastShareUrl: string }).lastShareUrl = String(url);
      return null;
    }) as typeof window.open;
  });
  await page.goto(path);
  await page.getByRole('button', { name: 'Share this research', exact: true }).click();
  for (const destination of ['WhatsApp', 'Bluesky']) {
    await page.getByRole('button', { name: `Share on ${destination}` }).click();
    const outgoing = await page.evaluate(
      () => (window as unknown as { lastShareUrl: string }).lastShareUrl,
    );
    const text = new URL(outgoing).searchParams.get('text');
    expect(text).toContain(publicUrl);
    expect(text).toContain('The Money Only Goes One Way');
  }
});

test('copy puts the exact public link on the clipboard', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Clipboard permission setup is Chromium-specific.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(path);
  await page.getByRole('button', { name: 'Share this research', exact: true }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(publicUrl);
});

test('supported device sharing receives the article and exact public link', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        (window as unknown as { sharedData: ShareData }).sharedData = data;
      },
    });
  });
  await page.goto(path);
  await page.getByRole('button', { name: 'Share this research', exact: true }).click();
  await page.getByRole('button', { name: 'Share using another app' }).click();
  const data = await page.evaluate(
    () => (window as unknown as { sharedData: ShareData }).sharedData,
  );
  expect(data.url).toBe(publicUrl);
  expect(data.title).toBeUndefined();
  expect(data.text?.split('The Money Only Goes One Way')).toHaveLength(2);
});

const committeeName = 'Beer PAC-Minn Beer Wholesalers Assoc';
const committeePath = '/money/committees/beer-pac-minn-beer-wholesalers-assoc-30274';
for (const width of [1400, 900, 390]) {
  test(`legislator money at ${width}: describes the selected year`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/legislators/aaron-repinski?tab=money&year=2024');
    await page.getByRole('button', { name: 'Share this legislator', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share this legislator', exact: true });
    await expect(
      dialog.getByText('Campaign money for filing year 2024, from Minnesota’s official filings', {
        exact: true,
      }),
    ).toBeVisible();
    expect((await dialog.innerText()).split('Aaron Repinski')).toHaveLength(2);
    const shared = new URL(await dialog.getByRole('textbox').inputValue());
    expect(shared.searchParams.get('tab')).toBe('money');
    expect(shared.searchParams.get('year')).toBe('2024');
  });
}
for (const width of [1400, 900, 390]) {
  test(`committee at ${width}: context heading stays out of non-repeating messages`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      window.open = ((url: string | URL | undefined) => {
        (window as unknown as { lastShareUrl: string }).lastShareUrl = String(url);
        return null;
      }) as typeof window.open;
    });
    await page.goto(`${committeePath}?tab=filings&year=2026`);
    await page.getByRole('button', { name: 'Share this committee', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share this committee', exact: true });
    await expect(
      dialog.getByRole('heading', { name: 'Share this committee', exact: true }),
    ).toBeVisible();
    expect((await dialog.innerText()).split(committeeName)).toHaveLength(2);
    await expect(
      dialog.getByText('Campaign money from Minnesota’s official filings', { exact: true }),
    ).toBeVisible();
    const sharedUrl = await dialog.getByRole('textbox').inputValue();
    expect(new URL(sharedUrl).searchParams.get('tab')).toBe('filings');
    expect(new URL(sharedUrl).searchParams.get('year')).toBe('2026');
    for (const destination of ['WhatsApp', 'X', 'Bluesky']) {
      await dialog.getByRole('button', { name: `Share on ${destination}`, exact: true }).click();
      const outgoing = await page.evaluate(
        () => (window as unknown as { lastShareUrl: string }).lastShareUrl,
      );
      const url = new URL(outgoing);
      const message = url.searchParams.get('text')!;
      expect(message.split(committeeName)).toHaveLength(2);
      expect(message).not.toContain('Share this committee');
      expect(message).not.toContain('Alethical');
      expect(destination === 'X' ? url.searchParams.get('url') : message).toContain(sharedUrl);
    }
  });
}

for (const [resultPath, label, expected] of [
  ['/money/search?q=Beer', 'Share these search results', { q: 'Beer' }],
  [
    '/money/payments?name=John%20Smith&role=contributor',
    'Share these payment records',
    { name: 'John Smith', role: 'contributor' },
  ],
  [
    `${committeePath}/payments?tab=gave&year=2026`,
    'Share these payment records',
    { tab: 'gave', year: '2026' },
  ],
  [
    '/money/races?year=2026&office=House',
    'Share this race comparison',
    { year: '2026', office: 'House' },
  ],
  [
    '/money/outside-spending?browse=groups&year=2026',
    'Share these outside-spending results',
    { browse: 'groups', year: '2026' },
  ],
] as const) {
  test(`${resultPath}: restores the shared results view`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${resultPath}&unrelated=excluded`);
    await page.getByRole('button', { name: label, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: label, exact: true });
    await expect(dialog.getByRole('heading', { name: label, exact: true })).toBeVisible();
    const shared = new URL(await dialog.getByRole('textbox').inputValue());
    expect(shared.origin).toBe('https://www.alethical.com');
    expect(shared.searchParams.has('unrelated')).toBe(false);
    for (const [key, value] of Object.entries(expected))
      expect(shared.searchParams.get(key)).toBe(value);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.goto(`${shared.pathname}${shared.search}${shared.hash}`);
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: label, exact: true }).getByRole('textbox'),
    ).toHaveValue(shared.href);
  });
}
