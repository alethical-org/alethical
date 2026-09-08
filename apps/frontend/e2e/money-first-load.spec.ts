import { createServer } from 'node:http';

import { expect, test, type Page } from '@playwright/test';

// Explicit opt-in: these checks read a deployed copy, not the tiny local seed.
// They record a baseline, not a passing speed budget or a real-reader percentile.
test.skip(process.env.MONEY_SPEED_RUN !== '1', 'Set MONEY_SPEED_RUN=1 to read a deployed copy');
test.skip(({ browserName }) => browserName !== 'chromium', 'Beacon suppression uses Chromium CDP');
test.use({
  storageState: { cookies: [], origins: [] },
  serviceWorkers: 'block',
  viewport:
    process.env.MONEY_SPEED_VIEWPORT === 'phone'
      ? { width: 390, height: 844 }
      : { width: 1280, height: 900 },
});

const committee = '/money/committees/100-percent-future-fund-41363';
const scenarios = [
  { id: 'committee-2025', path: `${committee}?year=2025`, kind: 'committee' },
  { id: 'payments-2025', path: `${committee}/payments?year=2025`, kind: 'payments' },
  {
    id: 'filtered-committees',
    path: '/money/committees?kind=candidate_committee',
    kind: 'list',
  },
] as const;

async function suppressMeasurementTraffic(page: Page) {
  // Do not count the lab as readers. These are the existing measurement sinks;
  // records and program files still come from the real, unchanged service.
  // page.route disables the HTTP cache even for unrelated requests. CDP URL
  // blocking preserves it, and collection endpoints do not include script.js.
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setBlockedURLs', {
    urls: [
      '*/cdn-cgi/rum*',
      '*/_vercel/insights/view*',
      '*/_vercel/insights/event*',
      '*/api/v1/site-metrics/events*',
    ],
  });
  await session.send('Network.setCacheDisabled', { cacheDisabled: false });
}

async function installContentClock(page: Page, kind: string) {
  await page.addInitScript(
    ({ kind, committee }) => {
      const clock = window as Window & { moneyContentObservedMs?: number };
      const shown = (node: Element) =>
        !node.closest('[aria-hidden="true"]') &&
        node.getBoundingClientRect().width > 0 &&
        node.getBoundingClientRect().height > 0 &&
        getComputedStyle(node).visibility !== 'hidden';
      const visible = (selector: string) => [...document.querySelectorAll(selector)].filter(shown);
      const textMatches = (pattern: RegExp) =>
        [...document.querySelectorAll('div[dir="auto"]')].some(
          (node) => pattern.test(node.textContent || '') && shown(node),
        );
      const observe = () => {
        let ready = false;
        if (
          !document.querySelector('.page-snapshot') &&
          !visible('[role="status"][aria-busy="true"]').length &&
          !visible('[role="alert"]').length
        ) {
          if (kind === 'list') {
            const rows = visible('a[href^="/money/committees/"]');
            ready =
              visible('[aria-label="Filter by kind"] [aria-pressed="true"]').some((node) =>
                node.textContent?.startsWith('Candidate committees'),
              ) &&
              rows.length > 0 &&
              rows.every((node) => node.textContent?.includes('Candidate committee')) &&
              textMatches(/^NAME A–Z$/) &&
              visible('[role="heading"][aria-level="1"]').some(
                (node) => node.textContent === 'Committees',
              );
          } else if (kind === 'committee') {
            ready =
              visible('[role="button"][aria-pressed="true"]').some(
                (node) => node.textContent === '2025',
              ) &&
              visible(`a[href^="${committee}/payments?"]`).some(
                (node) =>
                  /^See all [\d,]+ payments$/.test(node.textContent || '') &&
                  new URL(node.getAttribute('href')!, location.origin).searchParams.get('year') ===
                    '2025',
              );
          } else {
            ready =
              visible('[role="heading"][aria-level="1"]').some(
                (node) => node.textContent === 'Who gave to this committee',
              ) &&
              textMatches(/^\$[\d,.]+$/) &&
              textMatches(/^LARGEST FIRST$/) &&
              textMatches(
                /^(?:[1-9][\d,]* payments? named in this period|Showing [1-9][\d,]* of [1-9][\d,]* payments named)$/,
              ) &&
              visible('[role="button"][aria-pressed="true"]').some(
                (node) => node.textContent === '2025',
              );
          }
        }
        if (ready) clock.moneyContentObservedMs = performance.now();
        else if (performance.now() < 60_000) requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    },
    { kind, committee },
  );
}

async function waitForRequestedContent(page: Page, kind: string) {
  await expect(page.locator('.page-snapshot')).toHaveCount(0);
  if (kind === 'list') {
    await expect(page.getByRole('heading', { name: 'Committees', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Filter by kind' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Candidate committees/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const rows = page.locator('a[href^="/money/committees/"]').filter({ visible: true });
    await expect(rows.first()).toContainText('Candidate committee');
    expect(
      (await rows.allTextContents()).every((text) => text.includes('Candidate committee')),
    ).toBe(true);
    // This label is rendered only alongside actual returned committee rows.
    await expect(page.getByText('NAME A–Z', { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: '2025', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    if (kind === 'payments') {
      await expect(
        page.getByRole('heading', { name: 'Who gave to this committee', exact: true }),
      ).toBeVisible();
      // This label is rendered by PaymentRows, not by its loading placeholders.
      await expect(
        page.getByText('LARGEST FIRST', { exact: true }).filter({ visible: true }),
      ).toBeVisible();
      await expect(
        page
          .getByText(/^\$[\d,.]+$/)
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      await expect(
        page
          .getByText(
            /^(?:[1-9][\d,]* payments? named in this period|Showing [1-9][\d,]* of [1-9][\d,]* payments named)$/,
          )
          .filter({ visible: true }),
      ).toBeVisible();
    } else {
      // The full-list link exists only after this year's short payment list lands.
      await expect(page.getByRole('link', { name: /^See all [\d,]+ payments$/ })).toBeVisible();
    }
  }
  await expect(page.getByRole('status').and(page.locator('[aria-busy="true"]'))).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function observedAfterFrames(page: Page) {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return (window as Window & { moneyContentObservedMs?: number }).moneyContentObservedMs;
  });
}

test('measurement guard rejects wrong filters, mixed rows and unfinished loads', async ({
  page,
}) => {
  await installContentClock(page, 'list');
  await page.goto('about:blank');
  await page.setContent(`<div role="heading" aria-level="1">Committees</div>
    <div role="group" aria-label="Filter by kind">
      <button aria-pressed="true" id="choice">All kinds</button>
    </div>
    <div dir="auto">NAME A–Z</div>
    <a href="/money/committees/example-1">Example Candidate committee</a>`);
  expect(await observedAfterFrames(page)).toBeUndefined();
  await page.evaluate(() => {
    document.getElementById('choice')!.textContent = 'Candidate committees';
    document.body.insertAdjacentHTML(
      'beforeend',
      '<a id="wrong" href="/money/committees/example-2">Example Party unit</a>',
    );
  });
  expect(await observedAfterFrames(page)).toBeUndefined();
  await page.evaluate(() => {
    document.getElementById('wrong')!.remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="busy" role="status" aria-busy="true">Loading committees</div>',
    );
  });
  expect(await observedAfterFrames(page)).toBeUndefined();
  const validAt = await page.evaluate(() => {
    document.getElementById('busy')!.remove();
    return performance.now();
  });
  expect(await observedAfterFrames(page)).toBeGreaterThanOrEqual(validAt);
});

test('measurement guard rejects payment labels without a positive count', async ({ page }) => {
  await installContentClock(page, 'payments');
  await page.goto('about:blank');
  await page.setContent(`<div role="heading" aria-level="1">Who gave to this committee</div>
    <button role="button" aria-pressed="true">2025</button>
    <div dir="auto">LARGEST FIRST</div><div dir="auto">$25</div>
    <div dir="auto" id="count">0 payments named in this period</div>`);
  expect(await observedAfterFrames(page)).toBeUndefined();
  const validAt = await page.evaluate(() => {
    document.getElementById('count')!.textContent = '1 payment named in this period';
    return performance.now();
  });
  expect(await observedAfterFrames(page)).toBeGreaterThanOrEqual(validAt);
});

test('beacon suppression preserves program downloads and the browser HTTP cache', async ({
  page,
}) => {
  let programReads = 0;
  let beaconReads = 0;
  const server = createServer((request, response) => {
    if (request.url === '/_vercel/insights/script.js') {
      programReads++;
      response.writeHead(200, {
        'Content-Type': 'text/javascript',
        'Cache-Control': 'public, max-age=3600',
      });
      response.end('/* synthetic cache probe */');
    } else if (request.url === '/_vercel/insights/view') {
      beaconReads++;
      response.end('unexpected beacon');
    } else response.end('<!doctype html><title>Local measurement guard</title>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await suppressMeasurementTraffic(page);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Local guard did not start');
    await page.goto(`http://127.0.0.1:${address.port}`);
    const result = await page.evaluate(async () => {
      await (await fetch('/_vercel/insights/script.js')).text();
      await (await fetch('/_vercel/insights/script.js')).text();
      return fetch('/_vercel/insights/view').then(
        () => 'sent',
        () => 'blocked',
      );
    });
    expect(result).toBe('blocked');
    expect(beaconReads).toBe(0);
    expect(programReads).toBe(1);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});

for (const scenario of scenarios) {
  test(`fresh direct entry: ${scenario.id}`, async ({ page, browserName }, testInfo) => {
    await suppressMeasurementTraffic(page);
    await installContentClock(page, scenario.kind);
    const requests: {
      path: string;
      startedMs: number;
      finishedMs: number | null;
      status: number | null;
    }[] = [];
    const requestRows = new Map<object, (typeof requests)[number]>();
    const started = performance.now();
    let errorCount = 0;
    page.on('pageerror', () => errorCount++);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() !== 'GET' || !url.pathname.startsWith('/api/v1/')) return;
      // This suite never searches a name; nevertheless, discard all query values
      // except the fixed selection/pagination fields before writing an artifact.
      const kept = new URLSearchParams();
      for (const key of [
        'year',
        'direction',
        'kind',
        'limit',
        'offset',
        'sort',
        'spender',
        'about',
      ]) {
        const value = url.searchParams.get(key);
        if (value !== null) kept.set(key, value);
      }
      const row = {
        path: `${url.pathname}${kept.size ? `?${kept}` : ''}`,
        startedMs: performance.now() - started,
        finishedMs: null,
        status: null,
      };
      requests.push(row);
      requestRows.set(request, row);
    });
    page.on('response', (response) => {
      const row = requestRows.get(response.request());
      if (row) row.status = response.status();
    });
    page.on('requestfinished', (request) => {
      const row = requestRows.get(request);
      if (row) row.finishedMs = performance.now() - started;
    });

    let observation: Record<string, unknown> = { outcome: 'incomplete' };
    try {
      const response = await page.goto(scenario.path, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);
      const html = await response!.text();
      observation = { outcome: 'content_not_ready' };
      await waitForRequestedContent(page, scenario.kind);
      const contentObservedMs = await page.evaluate(
        () => (window as Window & { moneyContentObservedMs?: number }).moneyContentObservedMs,
      );
      expect(contentObservedMs).toBeGreaterThan(0);
      // Parsing the saved response happens after the observed interval.
      const firstResponse = await page.evaluate((source) => {
        const parsed = new DOMParser().parseFromString(source, 'text/html');
        const seed = parsed.getElementById('alethical-page-data');
        let entries = 0;
        let malformed = false;
        if (seed) {
          try {
            const value: unknown = JSON.parse(seed.textContent || '');
            if (Array.isArray(value)) entries = value.length;
            else malformed = true;
          } catch {
            malformed = true;
          }
        }
        return {
          decodedHtmlBytes: new TextEncoder().encode(source).length,
          hasReadableSnapshot: Boolean(parsed.querySelector('.page-snapshot')),
          seedEntries: entries,
          malformedSeed: malformed,
          programFiles: [...parsed.querySelectorAll('script[src]')].map(
            (node) => new URL(node.getAttribute('src')!, 'https://www.alethical.com').pathname,
          ),
        };
      }, html);
      const navigation = await page.evaluate(() => {
        const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return {
          responseStartMs: entry.responseStart,
          responseEndMs: entry.responseEnd,
          domContentLoadedMs: entry.domContentLoadedEventEnd,
          encodedHtmlBytes: entry.encodedBodySize,
        };
      });
      observation = {
        ...firstResponse,
        ...navigation,
        contentObservedMs,
        contentClock:
          'first animation frame observing the scenario DOM condition; not a paint metric',
        outcome: 'measured',
        speedBudgetVerdict: 'not_evaluated',
      };
      expect(errorCount).toBe(0);
    } catch (error) {
      observation = { ...observation, outcome: 'failed', failureStage: observation.outcome };
      throw error;
    } finally {
      // A timeout still writes its unfinished request list. Failed samples never
      // disappear from the denominator or turn into a successful speed reading.
      await testInfo.attach('money-direct-load.json', {
        body: JSON.stringify(
          {
            scenario: scenario.id,
            path: scenario.path,
            browserName,
            viewport: page.viewportSize(),
            capturedAt: new Date().toISOString(),
            cacheCondition: 'fresh isolated browser; edge and server caches uncontrolled',
            networkCondition: 'unthrottled; no physical-phone claim',
            revisionLabel: process.env.MONEY_SPEED_REVISION ?? 'not supplied',
            ...observation,
            errorCount,
            requests,
            requestClock:
              'test-runner monotonic milliseconds from collection setup, not navigation start',
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    }
  });
}

test('committee to payments and Back preserves the requested year', async ({ page }, testInfo) => {
  let stage = 'initial_load';
  let outcome = 'failed';
  let clickToAssertionCompleteMs: number | null = null;
  let backPreservedYear = false;
  try {
    await suppressMeasurementTraffic(page);
    await page.goto(`${committee}?year=2025`);
    await waitForRequestedContent(page, 'committee');
    stage = 'click_to_payments';
    const clickStarted = performance.now();
    await page.getByRole('link', { name: /^See all [\d,]+ payments$/ }).click();
    await expect(page).toHaveURL(/\/payments\?(?:[^#]*&)?(?:tab=gave&)?year=2025/);
    await waitForRequestedContent(page, 'payments');
    clickToAssertionCompleteMs = performance.now() - clickStarted;
    stage = 'back_to_committee';
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${committee}\\?year=2025$`));
    await waitForRequestedContent(page, 'committee');
    backPreservedYear = true;
    outcome = 'measured';
    stage = 'complete';
  } finally {
    await testInfo.attach('money-click-load.json', {
      body: JSON.stringify(
        {
          scenario: 'committee-to-payments-and-back',
          outcome,
          stage,
          clickToAssertionCompleteMs,
          clock: 'upper bound including action dispatch and assertion polling',
          selectedYear: 2025,
          backPreservedYear,
          browserName: 'chromium',
          viewport: page.viewportSize(),
          capturedAt: new Date().toISOString(),
          revisionLabel: process.env.MONEY_SPEED_REVISION ?? 'not supplied',
          cacheCondition: 'browser HTTP cache enabled; edge and server caches uncontrolled',
          speedBudgetVerdict: 'not_evaluated',
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
});
