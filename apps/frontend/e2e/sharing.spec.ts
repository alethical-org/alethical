import { expect, test } from '@playwright/test';

const path = '/read/research/the-money-only-goes-one-way';
const publicUrl = `https://www.alethical.com${path}`;

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
  expect(data.title).toBe('The Money Only Goes One Way');
  expect(data.text).toContain('The Money Only Goes One Way');
});
