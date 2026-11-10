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

async function savedMail(page: Page, initial: MailAnalysis | null = result) {
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
      data = analysis = { ...(analysis ?? result), status: 'pending', can_retry: false };
    else if (path.endsWith('/analysis')) {
      if (!analysis)
        return route.fulfill({ status: 503, json: { detail: 'Synthetic transport failure' } });
      data = analysis;
    } else if (path.endsWith('/submit')) data = { ...submission, status: 'saved' };
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
  if (initial)
    await expect(page.getByRole('heading', { name: 'Printed payer', exact: true })).toBeVisible();
  else await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
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
  await expect(
    page.getByRole('heading', { name: 'Text from your mail', exact: true }),
  ).toBeFocused();
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
  await expect(page.getByRole('heading', { name: 'Printed payer', exact: true })).toBeFocused();
  const target = (await page
    .getByRole('heading', { name: 'Printed payer', exact: true })
    .boundingBox())!;
  expect(target.y >= 0 && target.y + target.height <= 844).toBe(true);
  expect(retries).toBe(0);
});

test('an empty GET recovery that finds an expired session focuses visible Start again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await savedMail(page, null);
  await page.route('**/api/v1/mail-upload/submissions/*/analysis', (route) =>
    route.fulfill({ status: 401, json: { detail: 'Expired' } }),
  );
  await page.getByRole('button', { name: 'Try again', exact: true }).focus();
  await page.keyboard.press('Enter');
  const start = page.getByRole('button', { name: 'Start again', exact: true });
  await expect(start).toBeFocused();
  const bounds = (await start.boundingBox())!;
  expect(bounds.y >= 0 && bounds.y + bounds.height <= 844).toBe(true);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
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
    await expect(page.getByText('Latest 1 of 8 records', { exact: true })).toBeVisible();
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

for (const { width, scale } of [
  { width: 320, scale: 1 },
  { width: 320, scale: 2 },
  { width: 800, scale: 1 },
  { width: 1280, scale: 1 },
]) {
  test(`contribution explanation uses keyboard and fits ${width}px at ${scale * 100}% text`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await savedMail(page);
    await expect(
      page.getByText('Money or donated goods and services given to this committee', {
        exact: true,
      }),
    ).toBeVisible();
    const toggle = page.getByRole('button', {
      name: 'What counts as a contribution?',
      exact: true,
    });
    const answer = page.locator('.contribution-answer');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(answer).toBeHidden();
    if (scale === 2) expect(await doubleAllText(page)).toEqual([]);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(answer).toBeVisible();
    await expect(answer).toHaveText(
      'An organization can also assign its own money to its political fund. Minnesota records this as a contribution.',
    );
    const measurement = await toggle.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const textRects = [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .flatMap((child) => {
          const range = document.createRange();
          range.selectNode(child);
          return [...range.getClientRects()].map((rect) => ({
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          }));
        });
      const style = getComputedStyle(node);
      return {
        height: box.height,
        left: box.left,
        right: box.right,
        bottom: box.bottom,
        top: box.top,
        textRects,
        outline: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineOffset: style.outlineOffset,
      };
    });
    expect(measurement.height).toBeGreaterThanOrEqual(44);
    expect(measurement.outline).toBe('solid');
    expect(measurement.outlineWidth).toBe('2px');
    expect(measurement.outlineOffset).toBe('4px');
    for (const rect of measurement.textRects) {
      expect(rect.left).toBeGreaterThanOrEqual(measurement.left);
      expect(rect.right).toBeLessThanOrEqual(measurement.right + 0.5);
      expect(rect.top).toBeGreaterThanOrEqual(measurement.top);
      expect(rect.bottom).toBeLessThanOrEqual(measurement.bottom + 0.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const answerBox = (await answer.boundingBox())!;
    expect(answerBox.x).toBeLessThanOrEqual(measurement.left + 4);
    expect(answerBox.y - measurement.bottom).toBeGreaterThanOrEqual(8);
    await page.screenshot({
      path: info.outputPath('contribution-explanation-open.png'),
      fullPage: true,
    });
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(answer).toBeHidden();
    await toggle.hover();
    await expect(toggle).toHaveCSS('background-color', 'rgb(241, 243, 242)');
  });
}

test('source downloads describe file type and scope without becoming section headings', async ({
  page,
}) => {
  const sourceResult = structuredClone(result);
  sourceResult.payers[0].candidates[0].records!.received!.source_url =
    'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/?download=-2113865252';
  await savedMail(page, sourceResult);
  await expect(
    page.getByRole('heading', { name: 'Contributions received', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.record-group h4 a')).toHaveCount(0);
  const download = page.getByRole('link', {
    name: 'Download contributions (CSV), Minnesota Campaign Finance Board, opens in a new tab',
    exact: true,
  });
  await expect(download).toHaveAttribute(
    'href',
    sourceResult.payers[0].candidates[0].records!.received!.source_url!,
  );
  await expect(download).toHaveAttribute('target', '_blank');
  await expect(download).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(download).toHaveAccessibleDescription(
    'State files cover all filers from 2015 to present. Downloads may take a moment.',
  );
  await expect(page.getByRole('heading', { name: 'Matching mailers', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Text from your mail', exact: true }),
  ).toBeVisible();
});

// Public CFB records checked November 10, 2026. The photo and printed text remain
// synthetic; no private mail evidence or authenticated upload is used in this test.
function publicFundResults(): MailAnalysis {
  const fixture = structuredClone(result);
  const entries = [
    { amount: '5945.8500', date: '2026-10-19', receipt: 487344, spending: 23758, text: false },
    { amount: '6143.2400', date: '2026-10-18', receipt: 349548, spending: 34449, text: false },
    { amount: '21719.8800', date: '2026-10-17', receipt: 489262, spending: 34448, text: true },
    { amount: '5542.1700', date: '2026-10-17', receipt: 486137, spending: 23757, text: false },
    { amount: '11977.5700', date: '2026-10-16', receipt: 489261, spending: 24578, text: false },
  ];
  const block = {
    state: 'reported' as const,
    has_more: true,
    total_payments: 26,
    fetched_at: '2026-11-10T00:17:45Z',
  };
  fixture.payers[0].quote = 'Synthetic test: Paid for by Our America';
  fixture.payers[0].candidates = [];
  fixture.payers[0].related_records = [
    {
      name: 'Our America Minnesota Political Fund',
      registration_number: '30807',
      scope: 'related_record',
      basis: 'same_website',
      domain: 'joinouramerica.org',
      checked_on: '2026-11-09',
      source_url:
        'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/political-committee-fund/30807/2026/',
      roles: [{ role: 'Treasurer', name: 'Ed Molchany' }],
      records: {
        state: 'available',
        registration_number: '30807',
        year: 2026,
        received: {
          ...block,
          source_url:
            'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/?download=-2113865252',
          payments: entries.map((row) => ({
            amount: row.amount,
            record_number: row.receipt,
            received_on: row.date,
            contributor: 'Our America',
            receipt_type: 'Contribution',
          })),
        },
        paid: {
          state: 'not_reported',
          payments: [],
          total_payments: null,
          has_more: false,
          source_url: null,
          fetched_at: null,
        },
        independent_spending: {
          ...block,
          source_url:
            'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/?download=-617535497',
          payments: entries.map((row) => ({
            amount: row.amount,
            unpaid_amount: '0.0000',
            record_number: row.spending,
            paid_on: row.date,
            vendor_name: 'Bilander Media',
            affected_committee_name: 'Demuth, Lisa Gov Committee',
            stance: 'For',
            expenditure_type: 'Independent Expenditure',
            purpose: row.text
              ? 'Telephone: Texting - Lisa Demuth for Governor'
              : 'Advertising - general: Digital Advertising Service',
          })),
        },
      },
    },
  ];
  fixture.sides[1] = {
    ...fixture.sides[1],
    status: 'partial',
    display_text:
      'Synthetic reading example\n[Unreadable]\nThe rest of the printed words stay in order',
    reading_notice: 'Some text could not be read',
  };
  fixture.status = 'partial';
  fixture.can_retry = true;
  return fixture;
}

for (const { width, scale } of [
  { width: 390, scale: 1 },
  { width: 834, scale: 1 },
  { width: 1440, scale: 1 },
  { width: 320, scale: 1 },
  { width: 320, scale: 2 },
]) {
  test(`public fund results visual coverage ${width}px ${scale * 100}%`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await savedMail(page, publicFundResults());
    await expect(page.locator('.record-summary')).toContainText(
      'They don’t identify who produced this mailer.',
    );
    await expect(page.locator('.payment-row')).toHaveCount(10);
    await page.getByRole('button', { name: 'What counts as a contribution?', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    if (scale === 2) expect(await doubleAllText(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const scroll = await page.locator('.mail-results').evaluate((node) => {
      let owner = node.parentElement;
      while (
        owner &&
        !(
          owner.scrollHeight > owner.clientHeight &&
          /auto|scroll/.test(getComputedStyle(owner).overflowY)
        )
      )
        owner = owner.parentElement;
      owner ??= document.scrollingElement as HTMLElement;
      owner.setAttribute('data-mail-review-scroll', 'true');
      const box = owner.getBoundingClientRect();
      const results = node.getBoundingClientRect();
      return {
        start: Math.max(0, owner.scrollTop + results.top - box.top - 16),
        end: Math.min(
          owner.scrollHeight - owner.clientHeight,
          owner.scrollTop + results.bottom - box.top - owner.clientHeight + 16,
        ),
        step: owner.clientHeight * 0.8,
      };
    });
    const positions: number[] = [];
    for (let position = scroll.start; position < scroll.end; position += scroll.step)
      positions.push(position);
    positions.push(scroll.end);
    for (let index = 0; index < positions.length; index++) {
      const viewport = page.locator('[data-mail-review-scroll]');
      // React Native Web attaches its own scrollTo({y, animated}) to this DOM
      // node. Set scrollTop directly, then prove the viewport reached the target.
      await viewport.evaluate((node, top) => {
        node.scrollTop = top;
      }, positions[index]);
      await expect
        .poll(async () =>
          Math.abs((await viewport.evaluate((node) => node.scrollTop)) - positions[index]),
        )
        .toBeLessThan(1);
      await page.screenshot({
        path: info.outputPath(`results-page-${String(index + 1).padStart(2, '0')}.png`),
      });
    }
  });
}

test.describe('touch contribution explanation', () => {
  test.use({ hasTouch: true });
  test('opens by tap without keeping a hover highlight', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await savedMail(page);
    const toggle = page.getByRole('button', {
      name: 'What counts as a contribution?',
      exact: true,
    });
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.contribution-answer')).toBeVisible();
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
    await expect(toggle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
