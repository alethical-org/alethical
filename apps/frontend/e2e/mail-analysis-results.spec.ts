import { createHash } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { MailAnalysis } from '../src/data/mailAnalysis';

// Synthetic image and isolated responses. Never upload to a real service.
const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
const result: MailAnalysis = {
  status: 'ready',
  can_retry: false,
  matching_mailers: { count: 1 },
  sides: [
    { side: 'front', status: 'read', text: 'Printed front text', complete: false, disclosures: [] },
    { side: 'back', status: 'read', text: 'Printed back text', complete: false, disclosures: [] },
  ],
  payers: [
    {
      side: 'front',
      quote: 'Paid for by Example committee',
      payer_text: 'Example committee',
      official_organization: null,
      related_records: [],
      candidates: [
        {
          name: 'Example committee',
          registration_number: '12345',
          scope: 'candidate_record',
          basis: 'same_committee_name',
          source_url: 'https://cfb.mn.gov/example',
          records: {
            state: 'available',
            registration_number: '12345',
            year: 2026,
            received: {
              state: 'reported',
              has_more: true,
              total_payments: 8,
              source_url: 'https://cfb.mn.gov/example-receipts',
              fetched_at: '2026-11-08T15:00:00Z',
              payments: [
                {
                  amount: '1234567.89',
                  record_number: 7,
                  received_on: '2026-10-15',
                  contributor:
                    'A long synthetic contributor name that wraps without losing any words',
                },
              ],
            },
            paid: {
              state: 'not_reported',
              payments: [],
              has_more: false,
              total_payments: null,
              source_url: null,
              fetched_at: null,
            },
            independent_spending: {
              state: 'not_reported',
              payments: [],
              has_more: false,
              total_payments: null,
              source_url: null,
              fetched_at: null,
            },
          },
        },
      ],
    },
  ],
};

async function savedMail(page: Page, initial = result) {
  const base = new URL(test.info().project.use.baseURL!);
  if (!['localhost', '127.0.0.1'].includes(base.hostname))
    throw new Error('Local preview required');
  let submission: Record<string, unknown> = {};
  let analysis = initial;
  const receipt = {
    sha256: createHash('sha256').update(photo).digest('hex'),
    bytes: photo.length,
    content_type: 'image/png',
  };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base.origin && !url.pathname.startsWith('/api/')) return route.continue();
    if (!url.pathname.startsWith('/api/v1/mail-upload/'))
      return route.fulfill({ status: 404, json: { detail: 'No real services in this test' } });
    const path = url.pathname;
    let data: unknown;
    if (path.endsWith('/sessions'))
      data = {
        token: 'synthetic-session',
        expires_at: '2099-01-01T00:00:00Z',
        supported_content_types: ['image/png'],
      };
    else if (path.endsWith('/analysis/retry'))
      data = analysis = { ...analysis, status: 'pending', can_retry: false };
    else if (path.endsWith('/analysis')) data = analysis;
    else if (path.endsWith('/submit')) data = { ...submission, status: 'saved' };
    else if (path.includes('/images/'))
      data = submission = { ...submission, [path.split('/').pop()!]: receipt };
    else
      data = submission = {
        id: path.split('/').pop(),
        status: 'draft',
        front: null,
        back: null,
        likes_ad: null,
        comment: null,
      };
    return route.fulfill({ json: { data } });
  });
  await page.goto('/mail-upload');
  await page
    .locator('input[type=file]')
    .nth(0)
    .setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByText('Front photo uploaded', { exact: true })).toBeAttached();
  await page
    .locator('input[type=file]')
    .nth(2)
    .setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByText('Back photo uploaded', { exact: true })).toBeAttached();
  await page.locator('#mail-yes').check();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Printed payer', exact: true })).toBeVisible();
  return {
    finish: () => {
      analysis = result;
    },
  };
}

test('photo keyboard focus cycles at both ends and survives zoom limits and reset', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await savedMail(page);
  const opener = page.getByRole('button', { name: 'View front photo', exact: true }).first();
  await opener.click();
  const close = page.getByRole('button', { name: 'Close', exact: true });
  const fit = page.getByRole('button', { name: 'Fit photo', exact: true });
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true });
  await expect(close).toBeFocused();
  await expect(zoom).toBeEnabled();
  await zoom.click();
  await fit.focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(fit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(fit).toHaveAttribute('aria-disabled', 'true');
  await expect(fit).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.mail-photo-image-area')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.getByRole('button', { name: 'Upload another', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Printed payer', exact: true })).toHaveCount(0);
  await expect(page.locator('.mail-results')).toHaveCount(0);
});

test('a completed retry keeps evidence and returns focus to its related result', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await savedMail(page, {
    ...result,
    status: 'partial',
    can_retry: true,
    sides: result.sides.map((side) =>
      side.side === 'back' ? { ...side, status: 'unreadable', text: '' } : side,
    ),
  });
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Trying again…', exact: true })).toBeVisible();
  await expect(page.locator('blockquote')).toHaveText('“Paid for by Example committee”');
  response.finish();
  await expect(page.getByRole('button', { name: 'Trying again…', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Machine-read text', exact: true })).toBeFocused();
});

test('a browser photo decode failure leaves Close and the unavailable controls reachable', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await savedMail(page);
  await page.getByRole('button', { name: 'View front photo', exact: true }).first().click();
  await page.locator('.mail-photo-image-area img').evaluate((image) => {
    (image as HTMLImageElement).src = 'data:image/png;base64,broken';
  });
  await expect(page.getByRole('alert')).toHaveText('We couldn’t open this photo');
  for (const label of ['Zoom out', 'Zoom in', 'Fit photo'])
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  await page.screenshot({ path: info.outputPath('photo-failed.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload another', exact: true })).toBeVisible();
});

test('GET recovery keeps focused busy and failed buttons, then focuses the retained result', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await savedMail(page, { ...result, status: 'pending' });
  let hold = false;
  let waiting: Route | null = null;
  let retries = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/analysis/retry')) retries++;
  });
  await page.route('**/api/v1/mail-upload/submissions/*/analysis', (route) => {
    if (hold) {
      waiting = route;
      return;
    }
    return route.fulfill({ status: 503, json: { detail: 'Synthetic transport failure' } });
  });
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await expect(retry).toBeVisible();
  hold = true;
  await retry.focus();
  await page.keyboard.press('Enter');
  const busy = page.getByRole('button', { name: 'Trying again…', exact: true });
  await expect(busy).toBeFocused();
  await expect.poll(() => waiting !== null).toBe(true);
  await waiting!.fulfill({ status: 503, json: { detail: 'Synthetic transport failure' } });
  waiting = null;
  await expect(retry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(busy).toBeFocused();
  await expect.poll(() => waiting !== null).toBe(true);
  await waiting!.fulfill({ json: { data: result } });
  await expect(page.getByRole('heading', { name: 'Machine-read text', exact: true })).toBeFocused();
  expect(retries).toBe(0);
});

// Enlarge every HTML node's actual computed text size and line height. This
// tests text-only enlargement, including nested labels, dates and modal tools;
// it is separate from the narrow CSS viewport/browser-zoom reflow checks.
async function doubleAllText(page: Page) {
  return page.evaluate(() => {
    const sizes = [...document.querySelectorAll<HTMLElement>('body, body *')]
      .filter((node) => node instanceof HTMLElement && !node.closest('.__expo_fast_refresh'))
      .map((node) => {
        const style = getComputedStyle(node);
        return { node, font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
      });
    sizes.forEach(({ node, font, line }) => {
      node.style.setProperty('font-size', `${font * 2}px`, 'important');
      if (Number.isFinite(line))
        node.style.setProperty('line-height', `${line * 2}px`, 'important');
    });
    return sizes
      .filter(({ node, font }) => parseFloat(getComputedStyle(node).fontSize) < font * 1.99)
      .map(({ node, font }) => ({
        tag: node.tagName,
        class: node.className,
        before: font,
        after: getComputedStyle(node).fontSize,
      }));
  });
}

for (const width of [320, 390]) {
  test(`all text at 200% keeps money and photo tools readable at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await savedMail(page);
    await expect(page.locator('.payment-amount')).toHaveText('$1,234,567');
    await expect(page.getByText('Latest 1 of 8 records · 2026', { exact: true })).toBeVisible();
    expect(await doubleAllText(page)).toEqual([]);
    await page.locator('.payment-amount').scrollIntoViewIfNeeded();
    expect(
      await page.locator('.payment-amount').evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getClientRects().length;
      }),
    ).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('money-text-200.png') });
    // Open a fresh page so every size doubles once, including the newly mounted dialog.
    await savedMail(page);
    await page.getByRole('button', { name: 'View front photo', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
    expect(await doubleAllText(page)).toEqual([]);
    for (const label of ['Close', 'Zoom out', 'Zoom in', 'Fit photo']) {
      const control = page.getByRole('button', { name: label, exact: true });
      const bounds = await control.boundingBox();
      expect(
        bounds &&
          bounds.x >= 10 &&
          bounds.y >= 10 &&
          bounds.x + bounds.width <= width - 10 &&
          bounds.y + bounds.height <= 834,
      ).toBe(true);
      expect(
        await control.evaluate(
          (node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight,
        ),
      ).toBe(true);
    }
    await page.screenshot({ path: info.outputPath('photo-text-200.png') });
  });
}

test('touch pinch, drag and double tap change only the photo view', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CDP touch injection is Chromium-only');
  await page.setViewportSize({ width: 390, height: 844 });
  await savedMail(page);
  await page.getByRole('button', { name: 'View front photo', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  const viewport = page.locator('.mail-photo-image-area');
  const bounds = (await viewport.boundingBox())!;
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { id: number; x: number; y: number }[],
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', [
    { id: 0, x: x - 40, y },
    { id: 1, x: x + 40, y },
  ]);
  await touch('touchMove', [
    { id: 0, x: x - 80, y },
    { id: 1, x: x + 80, y },
  ]);
  await touch('touchEnd', []);
  await expect(viewport.locator('img')).toHaveAttribute('style', /scale\(2\)/);
  await touch('touchStart', [{ id: 0, x, y }]);
  await touch('touchMove', [{ id: 0, x: x + 30, y }]);
  await touch('touchEnd', []);
  await expect(viewport.locator('img')).toHaveAttribute('style', /translate\(30px, 0px\)/);
  await page.getByRole('button', { name: 'Fit photo', exact: true }).click();
  for (let tap = 0; tap < 2; tap++) {
    await touch('touchStart', [{ id: 0, x, y }]);
    await touch('touchEnd', []);
  }
  await expect(viewport.locator('img')).toHaveAttribute('style', /scale\(2\)/);
  await expect(viewport.locator('img')).toHaveAttribute('src', /^blob:/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
