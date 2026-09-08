import { expect, test, type Page } from '@playwright/test';

import type { AccountSignupTotals } from '../src/lib/accountSignupMetrics';
import type {
  PerformanceTotals,
  SiteMetricActions,
  SiteMetricRecordTotals,
  TrafficBreakdown,
  TrafficTotals,
  UptimeTotals,
} from '../src/lib/traffic';
import { suppressSiteMetrics } from './suppress-site-metrics';

test.beforeEach(async ({ context, baseURL }) => {
  test.skip(!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname));
  // A missed fixture cannot reach a real API, including one baked into the build.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) && !url.pathname.startsWith('/api/')
      ? route.continue()
      : route.abort();
  });
  await suppressSiteMetrics(context);
});

function fixture() {
  const fetchedAt = new Date().toISOString();
  const end = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const period = (days: number) => ({
    startsAt: new Date(end - days * 86_400_000).toISOString(),
    endsAt: new Date(end).toISOString(),
    previousStartsAt: new Date(end - days * 2 * 86_400_000).toISOString(),
    previousEndsAt: new Date(end - days * 86_400_000).toISOString(),
  });
  const started = new Date(end - 90 * 86_400_000).toISOString();
  const destinationPageViews = {
    home: 300,
    billSearch: 40,
    billProfiles: 150,
    legislatorSearch: 20,
    legislatorProfiles: 30,
    findMyLegislator: 10,
    money: 80,
    moneySearch: 50,
    moneyByRace: 30,
    moneyCommitteeList: 20,
    moneyCommitteeProfiles: 90,
    moneyPayments: 40,
    moneyOutsideSpending: 20,
    moneyOther: 10,
    read: 40,
    legacyAsk: 50,
    other: 20,
  };
  const profile = (pageViews: number, count: number, capped = false) => ({
    pageViews,
    differentProfilesViewed: { count, capped, cap: 100 },
  });
  const breakdown: TrafficBreakdown = {
    destinationPageViews,
    billProfiles: profile(150, 61),
    legislatorProfiles: profile(30, 3),
    committeeProfiles: profile(90, 12),
  };
  const traffic: TrafficTotals = {
    pageViews24h: 100,
    pageViews7d: 1000,
    pageViews30d: 3000,
    estimatedVisitors24h: 60,
    estimatedVisitors7d: 600,
    estimatedVisitors30d: 1800,
    trafficBreakdown7d: breakdown,
    trafficBreakdown30d: {
      destinationPageViews: Object.fromEntries(
        Object.entries(destinationPageViews).map(([key, value]) => [key, value * 3]),
      ) as TrafficBreakdown['destinationPageViews'],
      billProfiles: profile(450, 95),
      legislatorProfiles: profile(90, 9),
      committeeProfiles: profile(270, 100, true),
    },
    fetchedAt,
    windowEndedAt: period(7).endsAt,
    countingStartedAt: started,
    teamExclusionConfigured: true,
  };
  const actions: Required<SiteMetricActions> = {
    billSearchesWithResults: 11,
    moneySearchesWithResults: 13,
    legislatorSearchesWithResults: 17,
    findMyLegislatorWithResults: 19,
    officialSourceLinksOpened: 23,
    newBillWatches: 5,
    newReaderAccounts: 7,
    newCommitteeWatches: 3,
  };
  const records: SiteMetricRecordTotals = {
    actions7d: { ...actions },
    actions30d: Object.fromEntries(
      Object.entries(actions).map(([key, value]) => [key, value * 3]),
    ) as Required<SiteMetricActions>,
    previousActions7d: { ...actions },
    previousActions30d: { ...actions },
    periods7d: period(7),
    periods30d: period(30),
    history: Object.fromEntries(
      Object.keys(actions).map((key) => [
        key,
        {
          recordingStartedAt: started,
          current7dComplete: true,
          current30dComplete: true,
          previous7dComplete: true,
          previous30dComplete: true,
        },
      ]),
    ) as SiteMetricRecordTotals['history'],
    totalsSinceStart: { newReaderAccounts: 37, newBillWatches: 45, newCommitteeWatches: 24 },
    readers: {
      registeredReaders: 37,
      currentReaderAccounts: 37,
      currentBillWatches: 41,
      differentBillsCurrentlyWatched: 29,
      currentBillFollowingReaders: 18,
      currentCommitteeWatches: 14,
      differentCommitteesCurrentlyWatched: 9,
      currentCommitteeFollowingReaders: 7,
    },
    fetchedAt,
    teamExclusionConfigured: true,
  };
  const accounts: AccountSignupTotals = {
    currentAccountsCreated: 80,
    currentConfirmedAccounts: 61,
    currentUnconfirmedAccounts: 19,
    created7d: 8,
    created30d: 27,
    previousCreated7d: 6,
    previousCreated30d: 22,
    periods7d: period(7),
    periods30d: period(30),
    asOf: fetchedAt,
    source: 'supabase',
    scope: 'current_surviving_reader_accounts',
    definition: 'Surviving reader accounts, including pending confirmation.',
    historyLimitation: 'Deleted accounts are not included, so past creation totals can decrease.',
  };
  const uptime: UptimeTotals = {
    websiteAvailability30d: 100,
    apiAvailability30d: 99.9,
    trafficPageAvailability30d: null,
    measuredAt: { website: fetchedAt, api: fetchedAt },
    monitoringStartedAt: { website: started, api: started },
    measurementSource: { website: 'status-page', api: 'status-page' },
    fetchedAt,
  };
  const performance: PerformanceTotals = {
    lcpP75Ms: 2000,
    lcpSamples: 50,
    inpP75Ms: 150,
    inpSamples: 65,
    clsP75: 0.05,
    clsSamples: 80,
    sampleInterval: 10,
    measurementScope: 'document-loads',
    navigationTypes: ['navigate', 'reload', 'back-forward', 'restore', 'prerender'],
    knownBotsExcluded: true,
    sampleCountSource: 'cloudflare-confidence',
    minimumSamples: 50,
    periodStartedOn: '2026-08-08',
    periodEndedOn: '2026-09-06',
    fetchedAt,
  };
  return { traffic, records, accounts, uptime, performance };
}

type Answers = ReturnType<typeof fixture>;
type Sources = { [K in keyof Answers]: Answers[K] | null };

async function installAnswers(page: Page, answers: Sources = fixture()) {
  const requests: string[] = [];
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname + url.search;
    requests.push(endpoint);
    const responses: Record<string, unknown> = {
      '/api/traffic': answers.traffic,
      '/api/v1/site-metrics?version=2': answers.records && { data: answers.records },
      '/api/v1/site-metrics/accounts': answers.accounts,
      '/api/traffic-uptime': answers.uptime,
      '/api/traffic-performance': answers.performance,
      '/api/traffic-google?window=30': {
        clicks30d: 31,
        impressions30d: 351,
        previousClicks30d: 20,
        previousImpressions30d: 300,
        periodStartedOn: '2026-08-06',
        periodEndedOn: '2026-09-04',
        previousPeriodStartedOn: '2026-07-07',
        previousPeriodEndedOn: '2026-08-05',
        fetchedAt: new Date().toISOString(),
      },
      '/api/traffic-bing': {
        clicks30d: 0,
        impressions30d: 0,
        previousClicks30d: 0,
        previousImpressions30d: 0,
        periodStartedOn: '2026-08-06',
        periodEndedOn: '2026-09-04',
        previousPeriodStartedOn: '2026-07-07',
        previousPeriodEndedOn: '2026-08-05',
        fetchedAt: new Date().toISOString(),
      },
    };
    if (url.pathname.endsWith('/site-metrics/events')) return route.fulfill({ status: 204 });
    const answer = responses[endpoint];
    return answer == null
      ? route.fulfill({ status: 503, json: { error: 'Fixture source unavailable.' } })
      : route.fulfill({ json: answer });
  });
  return requests;
}

async function openMetrics(page: Page) {
  await page.goto('/site-metrics');
  await expect(page.getByRole('heading', { name: 'Site Metrics', level: 1 })).toBeVisible();
  await expect(page.getByText('Loading site metrics.')).toHaveCount(0, { timeout: 30_000 });
}

function row(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..');
}

async function expectRow(page: Page, label: string, value: string) {
  await expect(row(page, label).getByText(value, { exact: true })).toBeVisible();
}

async function noHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

// Fetch only public font files in Node; the browser remains isolated from external sites.
let productionFontCss: Promise<string> | undefined;
async function loadProductionFonts(page: Page) {
  productionFontCss ??= (async () => {
    const response = await fetch(
      'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@500&display=swap',
    );
    expect(response.ok).toBe(true);
    let css = await response.text();
    const urls = [
      ...new Set(
        [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(
          (match) => match[1],
        ),
      ),
    ];
    expect(urls.length).toBeGreaterThan(0);
    const assets = await Promise.all(
      urls.map(async (url) => {
        const asset = await fetch(url);
        expect(asset.ok).toBe(true);
        return [
          url,
          `data:font/ttf;base64,${Buffer.from(await asset.arrayBuffer()).toString('base64')}`,
        ] as const;
      }),
    );
    for (const [url, data] of assets) css = css.split(url).join(data);
    return css;
  })();
  await page.addStyleTag({ content: await productionFontCss });
  expect(
    await page.evaluate(async () => {
      const faces = await Promise.all(
        [
          '400 14.5px "Libre Franklin"',
          '500 13.5px "Libre Franklin"',
          '700 14px "JetBrains Mono"',
          '800 19px "Libre Franklin"',
          '500 20px "Space Grotesk"',
        ].map((font) => document.fonts.load(font)),
      );
      await document.fonts.ready;
      return faces.every(
        (loaded) => loaded.length > 0 && loaded.every((face) => face.status === 'loaded'),
      );
    }),
  ).toBe(true);
}

async function destinationGeometry(page: Page) {
  return page.getByTestId('site-metrics-destinations').evaluate((panel) =>
    [...panel.querySelectorAll<HTMLElement>('[data-testid$="-bar"]')].map((bar) => {
      const key = bar.dataset.testid!.replace('site-metrics-destination-', '').replace('-bar', '');
      const row =
        panel.querySelector(`[data-testid="site-metrics-destination-${key}-row"]`) ??
        bar.parentElement!;
      const label =
        panel.querySelector(`[data-testid="site-metrics-destination-${key}-label"]`) ??
        row.firstElementChild!;
      const percent = bar.nextElementSibling!;
      const group = row.parentElement!;
      const range = document.createRange();
      range.selectNodeContents(label);
      const labelStyle = getComputedStyle(label);
      return {
        key,
        row: row.getBoundingClientRect().toJSON(),
        label: label.getBoundingClientRect().toJSON(),
        bar: bar.getBoundingClientRect().toJSON(),
        percent: percent.getBoundingClientRect().toJSON(),
        glyphs: range.getBoundingClientRect().toJSON(),
        lineHeight: parseFloat(labelStyle.lineHeight),
        font: labelStyle.fontFamily,
        radius: getComputedStyle(bar).borderRadius,
        border: getComputedStyle(group).borderLeftWidth,
        padding: getComputedStyle(group).paddingLeft,
      };
    }),
  );
}

for (const width of [375, 390, 767, 768, 820, 1099, 1100, 1440]) {
  test(`destination layout keeps shared columns and group spacing at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    await installAnswers(page);
    await openMetrics(page);
    await loadProductionFonts(page);
    const phone = width < 768;
    const stacked = width === 375;
    const rows = await destinationGeometry(page);
    expect(rows).toHaveLength(17);
    const groupStarts = new Set([
      'billSearch',
      'legislatorSearch',
      'money',
      'read',
      'legacyAsk',
      'other',
    ]);
    const standalone = new Set(['home', 'read', 'legacyAsk', 'other']);
    for (const [index, item] of rows.entries()) {
      expect(item.font).toContain('Libre Franklin');
      expect(item.label.width, item.key).toBe(stacked ? item.row.width : phone ? 159 : 170);
      expect(item.label.x, item.key).toBe(rows[0].label.x);
      expect(item.glyphs.width, item.key).toBeLessThanOrEqual(item.label.width);
      expect(item.glyphs.height, item.key).toBeLessThanOrEqual(item.lineHeight + 1);
      expect(item.bar.x, item.key).toBe(rows[0].bar.x);
      expect(item.bar.right, item.key).toBe(rows[0].bar.right);
      expect(item.bar.height, item.key).toBe(phone ? 9 : 12);
      expect(item.radius, item.key).toBe(phone ? '5px' : '6px');
      expect(item.percent.width, item.key).toBe(phone ? 34 : 38);
      expect(item.percent.x - item.bar.right, item.key).toBe(phone ? 10 : 12);
      expect(item.border, item.key).toBe(standalone.has(item.key) ? '0px' : '2px');
      expect(item.padding, item.key).toBe(standalone.has(item.key) ? '14px' : '12px');
      if (stacked) {
        expect(item.bar.y, item.key).toBeGreaterThanOrEqual(item.label.bottom);
        expect(item.bar.x, item.key).toBe(item.label.x);
      } else {
        expect(item.bar.x - item.label.right, item.key).toBe(phone ? 10 : 12);
        expect(
          Math.abs(item.bar.y + item.bar.height / 2 - item.label.y - item.label.height / 2),
          item.key,
        ).toBeLessThanOrEqual(1);
      }
      if (index > 0) {
        expect(item.row.y - rows[index - 1].row.bottom, item.key).toBe(
          groupStarts.has(item.key) ? (phone ? 11 : 15) : 12,
        );
      }
    }
    if (width === 390) expect(rows[0].bar.width).toBe(81);
    await noHorizontalOverflow(page);
  });

  test(`activity cards preserve top alignment and bottom slack at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    const answers = fixture();
    answers.traffic.trafficBreakdown30d!.destinationPageViews = Object.fromEntries(
      Object.keys(answers.traffic.trafficBreakdown30d!.destinationPageViews).map((key) => [key, 0]),
    ) as TrafficBreakdown['destinationPageViews'];
    answers.traffic.pageViews30d = 0;
    answers.traffic.estimatedVisitors30d = 0;
    for (const profile of [
      answers.traffic.trafficBreakdown30d.billProfiles,
      answers.traffic.trafficBreakdown30d.legislatorProfiles,
      answers.traffic.trafficBreakdown30d.committeeProfiles!,
    ]) {
      profile.pageViews = 0;
      profile.differentProfilesViewed = { count: 0, capped: false, cap: 100 };
    }
    await installAnswers(page, answers);
    await openMetrics(page);
    await loadProductionFonts(page);
    const destinations = page.getByTestId('site-metrics-destinations');
    const actions = page
      .getByRole('heading', { name: 'What people do', exact: true })
      .locator('..');
    const explore = page.getByTestId('site-metrics-explore');
    const readers = page.getByRole('heading', { name: 'Readers', exact: true }).locator('..');
    const cardBoxes = async () =>
      Promise.all(
        [destinations, actions, explore, readers].map(async (card) => (await card.boundingBox())!),
      );
    const rowOffsets = () =>
      actions.getByTestId(/^site-metrics-action-row-\d+$/).evaluateAll((rows) => {
        const top = rows[0].parentElement!.parentElement!.getBoundingClientRect().top;
        return rows.map((row) => row.getBoundingClientRect().top - top);
      });
    const before = await cardBoxes();
    const offsets = await rowOffsets();
    await page.getByRole('button', { name: 'Last 30 days', exact: true }).click();
    await expect(
      destinations.getByText('No page views in this range yet', { exact: true }),
    ).toBeVisible();
    const after = await cardBoxes();
    expect(await rowOffsets()).toEqual(offsets);
    if (width >= 768) {
      for (const boxes of [before, after]) {
        for (const [left, right] of [
          [boxes[0], boxes[1]],
          [boxes[2], boxes[3]],
        ]) {
          expect(left.y).toBe(right.y);
          expect(left.y + left.height).toBe(right.y + right.height);
        }
      }
      const zero = (await destinations
        .getByText('No page views in this range yet', { exact: true })
        .boundingBox())!;
      expect(after[0].y + after[0].height - zero.y - zero.height).toBeGreaterThan(80);
    } else {
      expect(after[0].height).toBeLessThan(before[0].height);
      for (const boxes of [before, after]) {
        expect(boxes[2].y - boxes[0].y - boxes[0].height).toBe(12);
        expect(boxes[1].y - boxes[2].y - boxes[2].height).toBe(12);
        expect(boxes[3].y - boxes[1].y - boxes[1].height).toBe(12);
      }
    }
    await noHorizontalOverflow(page);
  });
}

test('whole Money fallback remains one standalone destination at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1100 });
  const answers = fixture();
  const breakdown = answers.traffic.trafficBreakdown7d;
  const detailKeys = [
    'moneySearch',
    'moneyByRace',
    'moneyCommitteeList',
    'moneyCommitteeProfiles',
    'moneyPayments',
    'moneyOutsideSpending',
    'moneyOther',
  ] as const;
  for (const key of detailKeys) {
    breakdown.destinationPageViews.money! += breakdown.destinationPageViews[key]!;
    delete breakdown.destinationPageViews[key];
  }
  delete breakdown.committeeProfiles;
  await installAnswers(page, answers);
  await openMetrics(page);
  await loadProductionFonts(page);
  const panel = page.getByTestId('site-metrics-destinations');
  const money = page.getByTestId('site-metrics-destination-money-row');
  await expect(money.getByText('Money in politics', { exact: true })).toBeVisible();
  await expect(money.getByText('34%', { exact: true })).toBeVisible();
  await expect(
    panel.getByText(
      'Detailed money-page counts are unavailable. Money in politics includes the whole money section.',
      { exact: true },
    ),
  ).toBeVisible();
  const rows = await destinationGeometry(page);
  expect(rows).toHaveLength(10);
  for (const item of rows) {
    expect(item.label.x).toBe(rows[0].label.x);
    expect(item.bar.x).toBe(rows[0].bar.x);
    expect(item.bar.right).toBe(rows[0].bar.right);
  }
  expect(rows.find((item) => item.key === 'money')).toMatchObject({
    border: '0px',
    padding: '14px',
  });
  expect(
    await page
      .getByTestId('site-metrics-destination-rows')
      .evaluate((list) =>
        [...list.children].map((group) => group.querySelectorAll('[data-testid$="-row"]').length),
      ),
  ).toEqual([1, 2, 3, 1, 1, 1, 1]);
  await noHorizontalOverflow(page);
});

for (const width of [390, 768, 1440]) {
  test(`partial range keeps number aligned and note below at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    const answers = fixture();
    answers.records.actions7d.moneySearchesWithResults = 2;
    answers.records.actions30d.moneySearchesWithResults = 6;
    answers.records.history!.moneySearchesWithResults!.current7dComplete = false;
    answers.records.history!.moneySearchesWithResults!.current30dComplete = false;
    await installAnswers(page, answers);
    await openMetrics(page);
    await loadProductionFonts(page);
    for (const [days, value] of [
      [7, '2'],
      [30, '6'],
    ] as const) {
      await page.getByRole('button', { name: `Last ${days} days`, exact: true }).click();
      const action = page.getByTestId('site-metrics-action-row-1');
      const label = action.getByText('Money searches with results', { exact: true });
      const note = action.getByText('Partial range', { exact: true });
      const previous = page
        .getByTestId('site-metrics-action-row-0')
        .getByText(days === 7 ? '11' : '33', { exact: true });
      await expect(note).toBeVisible();
      const numberBox = await action.evaluate((row, value) => {
        const element = row.querySelector('[data-testid$="-value"]');
        if (element) {
          if (element.textContent !== value) throw new Error('Unexpected action count');
          return element.getBoundingClientRect().toJSON();
        }
        // The old bug nested the note inside the count. Measure its bare digit too,
        // so this regression fails on alignment rather than a missing test marker.
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent?.trim() !== value) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect().toJSON();
        }
        throw new Error('Missing action count');
      }, value);
      const [labelBox, noteBox, previousBox, actionBox] = await Promise.all(
        [label, note, previous, action].map(async (element) => (await element.boundingBox())!),
      );
      expect(numberBox.x + numberBox.width).toBeCloseTo(previousBox.x + previousBox.width, 2);
      expect(
        Math.abs(labelBox.y + labelBox.height / 2 - numberBox.y - numberBox.height / 2),
      ).toBeLessThanOrEqual(2);
      expect(noteBox.y).toBeGreaterThanOrEqual(
        Math.max(labelBox.y + labelBox.height, numberBox.y + numberBox.height),
      );
      expect(noteBox.x + noteBox.width).toBeCloseTo(numberBox.x + numberBox.width, 2);
      const divider = await action.evaluate((element) =>
        parseFloat(getComputedStyle(element).borderBottomWidth),
      );
      expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(
        actionBox.y + actionBox.height - divider,
      );
      const nextRow = (await page.getByTestId('site-metrics-action-row-2').boundingBox())!;
      expect(noteBox.y + noteBox.height).toBeLessThan(nextRow.y);
    }
    await noHorizontalOverflow(page);
  });
}

for (const width of [390, 768, 820, 1099, 1100, 1440]) {
  for (const state of ['building sample', 'needs improvement'] as const) {
    test(`speed values stay inside the card at ${width}px with ${state}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const answers = fixture();
      answers.performance.inpP75Ms = state === 'building sample' ? null : 350;
      answers.performance.inpSamples = state === 'building sample' ? 12 : 65;
      await installAnswers(page, answers);
      await openMetrics(page);
      const panel = page.getByTestId('site-metrics-performance');
      await panel.scrollIntoViewIfNeeded();
      const value = page.getByTestId('site-metrics-speed-value-1');
      await expect(value).toHaveText(state === 'building sample' ? 'Building sample' : '350 ms');
      await expect(value).toHaveCSS('font-size', width < 768 ? '17px' : '18px');
      await expect(value).toHaveCSS('font-weight', '800');
      const outside = await panel.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [...element.querySelectorAll('[data-testid^="site-metrics-speed-"]')]
          .filter((child) => {
            const rect = child.getBoundingClientRect();
            return rect.width > 0 && (rect.left < box.left || rect.right > box.right);
          })
          .map((child) => child.getAttribute('data-testid'));
      });
      expect(outside).toEqual([]);
      if (state === 'needs improvement') {
        await expect(page.getByTestId('site-metrics-speed-verdict-1')).toHaveText(
          'Needs improvement',
        );
      }
      await noHorizontalOverflow(page);
    });
  }
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 1200 },
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport });

    test('collection dates stay at the bottom and name the measurements they cover', async ({
      page,
    }) => {
      const answers = fixture();
      answers.traffic.countingStartedAt = '2026-08-15T02:01:44Z';
      answers.uptime.monitoringStartedAt = {
        website: '2026-08-15T14:20:38Z',
        api: '2026-08-16T14:22:28Z',
      };
      await installAnswers(page, answers);
      await openMetrics(page);
      const dates = page.getByTestId('site-metrics-collection-dates');
      await expect(dates).toContainText('Dates use UTC.');
      await expect(dates).toContainText(
        'Site visits and page views: Collected since August 15, 2026.',
      );
      await expect(dates).toContainText(
        'Money searches, new bill watches, and new committee follows: Collected since September 8, 2026.',
      );
      await expect(dates).toContainText(
        'Homepage: Monitoring since August 15, 2026; data service: Monitoring since August 16, 2026.',
      );
      await expect(dates).toContainText(
        'Includes Money page views recorded before the Money rows were added.',
      );
      await expect(dates).toContainText(
        'Total user accounts: Uses current account records, so no collection start date applies.',
      );
      const health = (await page.getByTestId('site-metrics-closing-grid').boundingBox())!;
      const box = (await dates.boundingBox())!;
      expect(box.y).toBeGreaterThan(health.y + health.height);
      await expect(page.getByRole('heading', { level: 2 }).last()).toHaveText(
        'Data collection dates',
      );
      await expect(page.getByTestId('site-metrics-recent-collecting')).toHaveCount(0);
      const before = (await dates.textContent())!;
      await page.getByRole('button', { name: 'Last 30 days', exact: true }).click();
      await expect(dates).toHaveText(before);
      await noHorizontalOverflow(page);
    });

    test('missing start dates do not become reporting-window or first-event dates', async ({
      page,
    }) => {
      const answers = fixture();
      const missing: Sources = { ...answers, traffic: null };
      answers.uptime.monitoringStartedAt = { website: null, api: null };
      await installAnswers(page, missing);
      await openMetrics(page);
      await expect(page.getByTestId('site-metrics-collection-page-views')).toContainText(
        'Start date unavailable.',
      );
      await expect(page.getByTestId('site-metrics-collection-availability')).toContainText(
        'Homepage: Start date unavailable; data service: Start date unavailable.',
      );
      await expectRow(page, 'Total user accounts', '80');
      await noHorizontalOverflow(page);
    });

    test('Cloudflare source is last after the measurement-change note', async ({ page }) => {
      const answers = fixture();
      answers.performance.periodStartedOn = '2026-08-09';
      answers.performance.periodEndedOn = '2026-09-07';
      await installAnswers(page, answers);
      await openMetrics(page);
      const panel = page.getByTestId('site-metrics-performance');
      const source = page.getByTestId('site-metrics-performance-source');
      const warning = panel.getByText(/Cloudflare changed page-load measurement/);
      await expect(source).toHaveText(
        'Measured by Cloudflare · August 9, 2026 to September 7, 2026 (UTC)',
      );
      const note = (await warning.boundingBox())!;
      expect((await source.boundingBox())!.y).toBeGreaterThanOrEqual(note.y + note.height);
      expect(await source.evaluate((node) => node === node.parentElement?.lastElementChild)).toBe(
        true,
      );
      await noHorizontalOverflow(page);
    });

    test('private dashboard links stay absent for a signed-in team account', async ({ page }) => {
      const id = '00000000-0000-4000-8000-000000000009';
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const user = {
        id,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'team-fixture@example.invalid',
        email_confirmed_at: '2026-01-01T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
      };
      const session = {
        access_token:
          encode({ alg: 'HS256', typ: 'JWT' }) +
          '.' +
          encode({ sub: id, session_id: 'fixture-team', exp }) +
          '.not-a-real-signature',
        refresh_token: 'fixture-refresh',
        token_type: 'bearer',
        expires_at: exp,
        expires_in: 3600,
        user,
      };
      await page.addInitScript(
        ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
        { key: process.env.E2E_AUTH_STORAGE_KEY ?? 'sb-localhost-auth-token', session },
      );
      await installAnswers(page);
      await page.route('**/api/v1/me', (route) =>
        route.fulfill({
          json: {
            data: {
              id,
              primary_email: user.email,
              display_name: 'Synthetic team account',
              sign_in_methods: { google: false, password: true },
            },
          },
        }),
      );
      await page.route('**/api/v1/site-metrics/collection', (route) =>
        route.fulfill({
          json: { collect: false, teamAccount: true, teamExclusionConfigured: true },
        }),
      );
      await page.route('**/api/v1/admin/access', (route) =>
        route.fulfill({ json: { data: { is_admin: false } } }),
      );
      await openMetrics(page);
      await expect(
        page.getByRole('button', { name: /Account menu|Account panel for/ }),
      ).toBeVisible();
      await expect(page.getByText(/^OPEN (VERCEL|GOOGLE|BING|CHECKLY|CLOUDFLARE)/)).toHaveCount(0);
      const hrefs = await page
        .locator('a[href]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
      for (const href of hrefs) {
        expect(href).not.toMatch(
          /vercel\.com\/dashboard|search\.google\.com\/search-console|bing\.com\/webmasters|app\.checklyhq\.com|dash\.cloudflare\.com/,
        );
      }
      await expect(page.getByRole('link', { name: 'See detailed availability' })).toBeVisible();
    });

    test('health cards contain every note without empty stretched phone cards', async ({
      page,
    }) => {
      await installAnswers(page);
      await openMetrics(page);
      const availability = page.getByTestId('site-metrics-availability');
      const performance = page.getByTestId('site-metrics-performance');
      for (const panel of [availability, performance]) {
        const overflow = await panel.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return [...element.querySelectorAll('*')].some((child) => {
            const rect = child.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.bottom > box.bottom + 1;
          });
        });
        expect(overflow).toBe(false);
      }
      const availabilityBox = (await availability.boundingBox())!;
      const performanceBox = (await performance.boundingBox())!;
      if (viewport.name === 'phone') {
        expect(performanceBox.y - availabilityBox.y - availabilityBox.height).toBe(12);
        expect(performanceBox.height).toBeGreaterThan(availabilityBox.height);
      } else {
        expect(performanceBox.y).toBe(availabilityBox.y);
        expect(performanceBox.height).toBe(availabilityBox.height);
      }
    });

    test('activity changes with 7/30 days while total accounts and current follows stay fixed', async ({
      page,
    }) => {
      const requests = await installAnswers(page);
      await openMetrics(page);
      await expectRow(page, 'Total user accounts', '80');
      await expectRow(page, 'New committee follows', '3');
      await expectRow(page, 'Money searches with results', '13');
      await expectRow(page, 'Current committee follows', '14');
      await expectRow(page, 'Different committees currently followed', '9');
      await expectRow(page, 'Readers following committees', '7');
      await expect(page.getByText(/includes unconfirmed sign-ups/)).toBeVisible();
      const ranges = page.getByRole('group', { name: 'Activity range' });
      if (viewport.name === 'phone') {
        for (const button of await ranges.getByRole('button').all()) {
          expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        }
      }
      await ranges.getByRole('button', { name: 'Last 30 days', exact: true }).click();
      await expectRow(page, 'Total user accounts', '80');
      await expectRow(page, 'Money searches with results', '39');
      await expectRow(page, 'New committee follows', '9');
      await expectRow(page, 'Current committee follows', '14');
      await expectRow(page, 'Different committees currently followed', '9');
      await expect(ranges.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await ranges.getByRole('button', { name: 'Last 7 days', exact: true }).click();
      await expectRow(page, 'Total user accounts', '80');
      expect(requests).toContain('/api/v1/site-metrics?version=2');
      expect(requests.filter((url) => url === '/api/v1/site-metrics/accounts')).toHaveLength(1);
      expect(requests).not.toContain('/api/v1/site-metrics');
      await noHorizontalOverflow(page);
    });

    test('Money destinations and committee breadth use separate counters', async ({ page }) => {
      await installAnswers(page);
      await openMetrics(page);
      const expected = [
        ['Money home', '8%'],
        ['Money search', '5%'],
        ['Money by race', '3%'],
        ['Committee list', '2%'],
        ['Committee money pages', '9%'],
        ['Payments by name', '4%'],
        ['Outside spending', '2%'],
        ['Other money pages', '1%'],
        ['Ask', '5%'],
      ];
      const destinations = page.getByTestId('site-metrics-destinations');
      for (const [label, value] of expected) {
        await expect(
          destinations
            .getByText(label, { exact: true })
            .locator('..')
            .getByText(value, { exact: true }),
        ).toBeVisible();
      }
      const committees = page.getByRole('row').filter({
        has: page.getByRole('rowheader', { name: 'Money committees', exact: true }),
      });
      await expect(committees.getByRole('cell')).toHaveText(['90', '12']);
      await expectRow(page, 'Money searches with results', '13');
      await expectRow(page, 'Current committee follows', '14');
      await page.getByRole('button', { name: 'Last 30 days', exact: true }).click();
      await expect(committees.getByRole('cell')).toHaveText(['270', '100+']);
      await expect(
        page.getByText('A + means the source cannot list every different profile'),
      ).toBeVisible();
      await noHorizontalOverflow(page);
    });

    test('an unavailable account source does not turn the total into zero or hide activity', async ({
      page,
    }) => {
      await installAnswers(page, { ...fixture(), accounts: null });
      await openMetrics(page);
      await expectRow(page, 'Total user accounts', 'Not available');
      await expectRow(page, 'Money searches with results', '13');
      await expectRow(page, 'Current committee follows', '14');
      await expect(page.getByTestId('site-metrics-explore')).toBeVisible();
      await noHorizontalOverflow(page);
    });

    test('an unavailable activity source leaves independent account totals visible', async ({
      page,
    }) => {
      await installAnswers(page, { ...fixture(), records: null });
      await openMetrics(page);
      await expectRow(page, 'Total user accounts', '80');
      await expect(page.getByText('Reader totals are temporarily unavailable.')).toBeVisible();
      await expect(page.getByText('Recorded actions are temporarily unavailable.')).toBeVisible();
      await expect(page.getByTestId('site-metrics-search-google')).toBeVisible();
      await noHorizontalOverflow(page);
    });

    test('one missing Checkly percentage leaves its sibling and other sources visible', async ({
      page,
    }) => {
      const answers = fixture();
      answers.uptime.websiteAvailability30d = null;
      answers.uptime.measuredAt!.website = null;
      answers.uptime.monitoringStartedAt!.website = null;
      answers.uptime.measurementSource!.website = null;
      await installAnswers(page, answers);
      await openMetrics(page);
      await expectRow(page, 'Homepage', 'Not available');
      await expectRow(page, 'Data service', '99.9%');
      await expectRow(page, 'Total user accounts', '80');
      await expect(page.getByTestId('site-metrics-search-google')).toBeVisible();
      await expect(page.getByTestId('site-metrics-speed-value-0')).toHaveText('2 s');
      await noHorizontalOverflow(page);
    });

    test('a failed availability source leaves traffic, accounts, search and speed visible', async ({
      page,
    }) => {
      await installAnswers(page, { ...fixture(), uptime: null });
      await openMetrics(page);
      await expect(page.getByText('Availability data is temporarily unavailable.')).toBeVisible();
      await expect(page.getByTestId('site-metrics-explore')).toBeVisible();
      await expectRow(page, 'Total user accounts', '80');
      await expect(page.getByTestId('site-metrics-search-google')).toBeVisible();
      await expect(page.getByTestId('site-metrics-speed-value-0')).toHaveText('2 s');
      await noHorizontalOverflow(page);
    });

    test('speed needs 50 actual measurements for each score, not a weighted visit total', async ({
      page,
    }) => {
      const answers = fixture();
      answers.performance.lcpP75Ms = null;
      answers.performance.lcpSamples = 49;
      answers.performance.inpP75Ms = null;
      answers.performance.inpSamples = 4;
      answers.performance.clsSamples = 50;
      answers.performance.sampleInterval = 15;
      await installAnswers(page, answers);
      await openMetrics(page);
      await expect(page.getByTestId('site-metrics-speed-value-0')).toHaveText('Building sample');
      await expect(page.getByTestId('site-metrics-speed-value-1')).toHaveText('Building sample');
      await expect(page.getByTestId('site-metrics-speed-value-2')).toHaveText('0.05');
      await expect(page.getByText(/Each score needs at least 50 measurements/)).toBeVisible();
      await expect(
        page.getByText(/Known bots are excluded; team visits may be included/),
      ).toBeVisible();
      await noHorizontalOverflow(page);
    });

    test('an invalid speed answer cannot publish a score backed by fewer than 50 samples', async ({
      page,
    }) => {
      const answers = fixture();
      answers.performance.lcpSamples = 49;
      await installAnswers(page, answers);
      await openMetrics(page);
      await expect(
        page.getByText('Speed and stability data is temporarily unavailable.'),
      ).toBeVisible();
      await expect(page.getByTestId('site-metrics-speed-value-0')).toHaveCount(0);
      await expectRow(page, 'Total user accounts', '80');
      await expectRow(page, 'Data service', '99.9%');
      await noHorizontalOverflow(page);
    });

    test('zero, unrecorded history and a partial range stay distinct', async ({ page }) => {
      const answers = fixture();
      for (const actions of [answers.records.actions7d, answers.records.actions30d]) {
        actions.billSearchesWithResults = 0;
        actions.moneySearchesWithResults = 0;
      }
      answers.records.history!.moneySearchesWithResults = {
        recordingStartedAt: null,
        current7dComplete: false,
        current30dComplete: false,
        previous7dComplete: false,
        previous30dComplete: false,
      };
      answers.records.previousActions7d!.moneySearchesWithResults = null;
      answers.records.previousActions30d!.moneySearchesWithResults = null;
      answers.records.history!.newCommitteeWatches = {
        recordingStartedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        current7dComplete: false,
        current30dComplete: false,
        previous7dComplete: false,
        previous30dComplete: false,
      };
      answers.records.previousActions7d!.newCommitteeWatches = null;
      answers.records.previousActions30d!.newCommitteeWatches = null;
      answers.records.history!.officialSourceLinksOpened = {
        ...answers.records.history!.newCommitteeWatches,
      };
      answers.records.previousActions7d!.officialSourceLinksOpened = null;
      answers.records.previousActions30d!.officialSourceLinksOpened = null;
      await installAnswers(page, answers);
      await openMetrics(page);
      await expectRow(page, 'Bill searches with results', '0');
      await expectRow(page, 'Money searches with results', 'Not recorded yet');
      await expect(row(page, 'New committee follows')).toContainText('3');
      await expect(page.getByTestId('site-metrics-action-row-6-note')).toHaveText('Partial range');
      await expect(page.getByTestId('site-metrics-action-row-4-note')).toHaveText('Partial range');
      await page.getByRole('button', { name: 'Last 30 days', exact: true }).click();
      await expectRow(page, 'Bill searches with results', '0');
      await expectRow(page, 'Money searches with results', 'Not recorded yet');
      await expect(page.getByTestId('site-metrics-action-row-6-note')).toHaveText('Partial range');
      await expect(page.getByTestId('site-metrics-action-row-4-note')).toHaveText('Partial range');
      await noHorizontalOverflow(page);
    });

    test('a displayed money search sends only a per-action name and retry key', async ({
      page,
    }) => {
      const events: Record<string, unknown>[] = [];
      await page.route('**/api/v1/**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/site-metrics/events')) {
          events.push(route.request().postDataJSON());
          return route.fulfill({ status: 204 });
        }
        if (!url.pathname.endsWith('/campaign-finance/search')) {
          return route.fulfill({ json: { data: [] } });
        }
        const q = url.searchParams.get('q');
        return route.fulfill({
          json: {
            data: {
              state: 'reported',
              q,
              groups: [
                {
                  kind: 'committees',
                  state: 'reported',
                  total: q === 'nomatch' ? 0 : 1,
                  results:
                    q === 'nomatch'
                      ? []
                      : [
                          {
                            kind: 'committee',
                            registration_number: 'test-1',
                            name: 'Example Committee',
                          },
                        ],
                },
              ],
            },
          },
        });
      });
      await page.goto('/money/search?q=nomatch');
      const input = page.getByRole('textbox');
      await expect(input).toBeVisible();
      await expect(page.getByText('Example Committee')).toHaveCount(0);
      expect(events).toHaveLength(0);
      await input.fill('example');
      await expect(page.getByText('Example Committee').first()).toBeVisible();
      await expect.poll(() => events.length).toBe(1);
      expect(events[0].event).toBe('money_search_with_results');
      expect(Object.keys(events[0]).sort()).toEqual(['event', 'eventId']);
      expect(events[0].eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      await input.press('Enter');
      await input.fill('nomatch');
      await expect(page.getByText('Example Committee')).toHaveCount(0);
      await input.fill('example');
      await expect(page.getByText('Example Committee').first()).toBeVisible();
      expect(events).toHaveLength(1);
      await noHorizontalOverflow(page);
    });
  });
}

test('the browser-check guard blocks Vercel and Cloudflare scripts and beacon deliveries', async ({
  browser,
}) => {
  const isolated = await browser.newContext();
  const escaped: string[] = [];
  // A local fallback catches anything suppression misses. This isolated context
  // does not inherit the spec's general external-request guard, so it cannot
  // hide a broken suppression rule. No fallback request reaches the network.
  await isolated.route('**/*', (route) => {
    if (route.request().resourceType() !== 'document') escaped.push(route.request().url());
    return route.fulfill({
      contentType: 'text/html',
      body: '<html><body>Guard test</body></html>',
    });
  });
  await suppressSiteMetrics(isolated);
  const page = await isolated.newPage();
  try {
    await page.goto('http://127.0.0.1/metrics-guard-test');
    const results = await page.evaluate(async () => {
      const targets = [
        '/_vercel/insights/view',
        '/cdn-cgi/rum',
        'https://static.cloudflareinsights.com/beacon.min.js',
        'https://cloudflareinsights.com/cdn-cgi/rum',
        'https://va.vercel-scripts.com/v1/script.js',
        'https://vitals.vercel-insights.com/v1/vitals',
      ];
      return Promise.all(
        targets.map(async (url) => {
          try {
            await fetch(url);
            return 'delivered';
          } catch {
            return 'blocked';
          }
        }),
      );
    });
    expect(results).toEqual(Array(6).fill('blocked'));
    expect(escaped).toEqual([]);
  } finally {
    await isolated.close();
  }
});
