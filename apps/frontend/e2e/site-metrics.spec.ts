import { expect, test, type Locator, type Page } from '@playwright/test';

async function styleOf(locator: Locator, property: string) {
  return locator.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);
}

async function installMetricAnswers(page: Page) {
  const fetchedAt = new Date().toISOString();
  const breakdown = {
    destinationPageViews: {
      home: 70,
      billSearch: 3,
      billProfiles: 62,
      legislatorSearch: 2,
      legislatorProfiles: 3,
      findMyLegislator: 2,
      other: 87,
    },
    billProfiles: {
      pageViews: 62,
      differentProfilesViewed: { count: 61, capped: false, cap: 100 },
    },
    legislatorProfiles: {
      pageViews: 3,
      differentProfilesViewed: { count: 3, capped: false, cap: 100 },
    },
  };
  await page.route('**/api/traffic', (route) =>
    route.fulfill({
      json: {
        pageViews24h: 229,
        pageViews7d: 229,
        pageViews30d: 229,
        estimatedVisitors24h: 16,
        estimatedVisitors7d: 16,
        estimatedVisitors30d: 16,
        trafficBreakdown7d: breakdown,
        trafficBreakdown30d: breakdown,
        fetchedAt,
        windowEndedAt: fetchedAt,
        countingStartedAt: fetchedAt,
        teamExclusionConfigured: false,
      },
    }),
  );
  const search = {
    clicks30d: 3,
    impressions30d: 351,
    previousClicks30d: 0,
    previousImpressions30d: 0,
    periodStartedOn: '2026-07-14',
    periodEndedOn: '2026-08-12',
    previousPeriodStartedOn: '2026-06-14',
    previousPeriodEndedOn: '2026-07-13',
    fetchedAt,
  };
  await page.route('**/api/traffic-google?window=30', (route) => route.fulfill({ json: search }));
  await page.route('**/api/traffic-bing', (route) =>
    route.fulfill({
      json: {
        ...search,
        clicks30d: 0,
        impressions30d: 0,
      },
    }),
  );
  await page.route('**/api/traffic-uptime', (route) =>
    route.fulfill({
      json: {
        websiteAvailability30d: 100,
        trafficPageAvailability30d: 98.18,
        apiAvailability30d: 100,
        fetchedAt,
      },
    }),
  );
  await page.route('**/api/traffic-performance', (route) =>
    route.fulfill({
      json: {
        lcpP75Ms: null,
        lcpSamples: 40,
        inpP75Ms: null,
        inpSamples: 10,
        clsP75: null,
        clsSamples: 40,
        sampleInterval: 10,
        periodStartedOn: '2026-07-19',
        periodEndedOn: '2026-08-15',
        fetchedAt,
      },
    }),
  );
  await page.route('**/api/v1/site-metrics', (route) =>
    route.fulfill({
      json: {
        data: {
          actions7d: {
            billSearchesWithResults: 0,
            legislatorSearchesWithResults: 0,
            findMyLegislatorWithResults: 0,
            officialSourceLinksOpened: 0,
            newBillWatches: 1,
          },
          actions30d: {
            billSearchesWithResults: 0,
            legislatorSearchesWithResults: 0,
            findMyLegislatorWithResults: 0,
            officialSourceLinksOpened: 0,
            newBillWatches: 1,
          },
          readers: {
            registeredReaders: 12,
            currentBillWatches: 5,
            differentBillsCurrentlyWatched: 4,
          },
          fetchedAt,
          teamExclusionConfigured: false,
        },
      },
    }),
  );
}

async function waitForMetrics(page: Page) {
  await installMetricAnswers(page);
  await page.goto('/site-metrics');
  await expect(page.getByRole('heading', { name: 'Site Metrics', level: 1 })).toBeVisible();
  await expect(page.getByText('Loading site metrics.')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('site-metrics-explore')).toBeVisible();
}

test('Site Metrics matches the accepted desktop measurements', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await waitForMetrics(page);

  const sectionHeadings = page.getByRole('heading', { level: 2 });
  await expect(sectionHeadings).toHaveCount(4);
  for (const name of [
    'Recent traffic',
    'How people use Alethical',
    'Found in search',
    'How well the site works',
  ]) {
    const heading = page.getByRole('heading', { name, level: 2, exact: true });
    await expect(heading).toHaveCSS('font-size', '20px');
    await expect(heading).toHaveCSS('font-weight', '800');
    await expect(heading).toHaveCSS('color', 'rgb(43, 99, 119)');
  }
  const panelHeading = page.getByRole('heading', { name: 'Where people go', level: 3 });
  await expect(panelHeading).toHaveCSS('font-size', '15.5px');
  await expect(panelHeading).toHaveCSS('font-weight', '700');
  for (const name of ['Found in search', 'How well the site works']) {
    await expect(
      page
        .getByRole('heading', { name, level: 2, exact: true })
        .locator('..')
        .getByText('LAST 30 DAYS', { exact: true }),
    ).toBeVisible();
  }

  const exploreHeader = page.getByTestId('site-metrics-explore-views-header');
  const exploreValue = page.getByTestId('site-metrics-explore-bills-views');
  await expect(exploreHeader).toHaveCSS('font-size', '13px');
  await expect(exploreHeader).toHaveCSS('font-weight', '600');
  await expect(exploreHeader).toHaveCSS('text-align', 'right');
  await expect(exploreValue).toHaveCSS('font-size', '24px');
  await expect(exploreValue).toHaveCSS('font-weight', '800');
  await expect(exploreValue).toHaveCSS('text-align', 'right');
  const exploreViewsHeaderRight = await exploreHeader.evaluate(
    (element) => element.getBoundingClientRect().right,
  );
  const exploreBillsViewsRight = await exploreValue.evaluate(
    (element) => element.getBoundingClientRect().right,
  );
  const exploreLegislatorsViewsRight = await page
    .getByTestId('site-metrics-explore-legislators-views')
    .evaluate((element) => element.getBoundingClientRect().right);
  expect(exploreBillsViewsRight).toBeCloseTo(exploreViewsHeaderRight, 1);
  expect(exploreLegislatorsViewsRight).toBeCloseTo(exploreViewsHeaderRight, 1);

  const rail = page.getByTestId('site-metrics-destination-home-bar');
  await expect(rail).toHaveCSS('height', '12px');
  await expect(rail).toHaveCSS('border-radius', '6px');
  await expect(rail).toHaveCSS('background-color', 'rgb(232, 235, 233)');

  const searchCard = page.getByTestId('site-metrics-search-google');
  await expect(searchCard).toHaveCSS('padding', '16px 20px 18px');
  await expect(searchCard).toHaveCSS('border-top-width', '1px');

  const actionRow = page.getByTestId('site-metrics-action-row-0');
  await expect(actionRow).toHaveCSS('padding-top', '11px');
  await expect(actionRow).toHaveCSS('border-bottom-width', '1px');
  const availabilityRow = page.getByTestId('site-metrics-availability-row-0');
  await expect(availabilityRow).toHaveCSS('padding-top', '10px');
  await expect(page.getByText('Site Metrics page')).toHaveCount(0);
  await expect(page.getByText('Checked by Checkly', { exact: true })).toBeVisible();
  await expect(page.getByText('Measured by Cloudflare', { exact: true })).toBeVisible();

  const speedRow = page.getByTestId('site-metrics-speed-row-0');
  await expect(speedRow).toHaveCSS('padding-top', '15px');
  const speedResult = page.getByTestId('site-metrics-speed-result-0');
  await expect(speedResult).toHaveCSS('flex-direction', 'row');
  expect(await styleOf(page.getByTestId('site-metrics-speed-verdict-0'), 'min-width')).toBe(
    '126px',
  );
  const buildingSample = page.getByTestId('site-metrics-speed-value-0');
  await expect(buildingSample).toHaveText('Building sample');
  await expect(buildingSample).toHaveCSS('min-width', '58px');
  await expect(buildingSample).toHaveCSS('font-size', '18px');
  await expect(buildingSample).toHaveCSS('font-weight', '800');
  await expect(buildingSample).toHaveCSS('line-height', '23px');
  await expect(buildingSample).toHaveCSS('text-align', 'right');
});

test('Site Metrics matches the accepted phone measurements', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForMetrics(page);

  for (const name of [
    'Recent traffic',
    'How people use Alethical',
    'Found in search',
    'How well the site works',
  ]) {
    const heading = page.getByRole('heading', { name, level: 2, exact: true });
    await expect(heading).toHaveCSS('font-size', '18px');
    await expect(heading).toHaveCSS('font-weight', '800');
  }
  const panelHeading = page.getByRole('heading', { name: 'Where people go', level: 3 });
  await expect(panelHeading).toHaveCSS('font-size', '15px');
  await expect(panelHeading).toHaveCSS('font-weight', '700');

  await expect(page.getByText('Activity range', { exact: true })).toHaveCount(0);
  const rangeGroup = page.getByRole('group', { name: 'Activity range' });
  await expect(rangeGroup).toBeVisible();
  const rangeButtons = rangeGroup.getByRole('button');
  await expect(rangeButtons).toHaveCount(2);
  const firstRangeBox = await rangeButtons.nth(0).boundingBox();
  const secondRangeBox = await rangeButtons.nth(1).boundingBox();
  expect(firstRangeBox?.height).toBe(44);
  expect(secondRangeBox?.height).toBe(44);
  expect(firstRangeBox?.width).toBeCloseTo(secondRangeBox?.width ?? 0, 1);

  const recentSource = page.getByTestId('site-metrics-recent-source');
  const recentCollecting = page.getByTestId('site-metrics-recent-collecting');
  const recentVisitorNote = page.getByTestId('site-metrics-recent-visitor-note');
  const sourceBox = await recentSource.boundingBox();
  const collectingBox = await recentCollecting.boundingBox();
  const visitorNoteBox = await recentVisitorNote.boundingBox();
  expect(collectingBox?.x).toBeCloseTo(sourceBox?.x ?? 0, 1);
  expect(visitorNoteBox?.x).toBeCloseTo(sourceBox?.x ?? 0, 1);
  expect((collectingBox?.y ?? 0) - ((sourceBox?.y ?? 0) + (sourceBox?.height ?? 0))).toBe(9);
  expect((visitorNoteBox?.y ?? 0) - ((collectingBox?.y ?? 0) + (collectingBox?.height ?? 0))).toBe(
    9,
  );
  await expect(recentSource).toHaveCSS('font-size', '11.5px');
  await expect(recentCollecting).toHaveCSS('color', 'rgb(143, 90, 18)');

  await expect(page.getByTestId('site-metrics-explore-views-header')).toHaveCSS(
    'font-size',
    '12px',
  );
  await expect(page.getByTestId('site-metrics-explore-bills-views')).toHaveCSS('font-size', '22px');
  const exploreViewsHeaderRight = await page
    .getByTestId('site-metrics-explore-views-header')
    .evaluate((element) => element.getBoundingClientRect().right);
  const exploreBillsViewsRight = await page
    .getByTestId('site-metrics-explore-bills-views')
    .evaluate((element) => element.getBoundingClientRect().right);
  const exploreLegislatorsViewsRight = await page
    .getByTestId('site-metrics-explore-legislators-views')
    .evaluate((element) => element.getBoundingClientRect().right);
  expect(exploreBillsViewsRight).toBeCloseTo(exploreViewsHeaderRight, 1);
  expect(exploreLegislatorsViewsRight).toBeCloseTo(exploreViewsHeaderRight, 1);
  const exploreRow = page.getByTestId('site-metrics-explore-bills-views').locator('..');
  await expect(exploreRow).toHaveCSS('padding-top', '11px');

  const rail = page.getByTestId('site-metrics-destination-home-bar');
  await expect(rail).toHaveCSS('height', '9px');
  await expect(rail).toHaveCSS('border-radius', '5px');

  const actionRow = page.getByTestId('site-metrics-action-row-0');
  await expect(actionRow).toHaveCSS('padding-top', '0px');
  await expect(actionRow).toHaveCSS('border-bottom-width', '0px');
  await expect(page.getByTestId('site-metrics-reader-row-0')).toHaveCSS('padding-top', '0px');

  const searchSection = page.getByTestId('site-metrics-search-google');
  await expect(searchSection).toHaveCSS('padding', '15px 16px 17px');
  await expect(searchSection).toHaveCSS('border-top-width', '1px');
  await expect(searchSection).toHaveCSS('border-radius', '13px');
  const appearancesMetric = page.getByTestId('site-metrics-search-google-appearances');
  const clicksMetric = page.getByTestId('site-metrics-search-google-clicks');
  const appearancesBox = await appearancesMetric.boundingBox();
  const clicksBox = await clicksMetric.boundingBox();
  expect(appearancesBox?.width).toBeCloseTo(clicksBox?.width ?? 0, 1);
  expect((clicksBox?.x ?? 0) - ((appearancesBox?.x ?? 0) + (appearancesBox?.width ?? 0))).toBe(14);
  await expect(clicksMetric).toHaveCSS('align-items', 'flex-end');

  const availability = page.getByTestId('site-metrics-availability');
  await expect(availability).toHaveCSS('padding', '15px 16px 17px');
  await expect(availability).toHaveCSS('border-top-width', '1px');
  await expect(availability).toHaveCSS('border-radius', '13px');
  await expect(page.getByTestId('site-metrics-availability-row-0')).toHaveCSS('padding-top', '9px');
  const availabilityHeadingBox = await page
    .getByRole('heading', { name: 'Can people reach Alethical?', level: 3 })
    .boundingBox();
  const availabilityRowBox = await page
    .getByTestId('site-metrics-availability-row-0')
    .boundingBox();
  expect((availabilityRowBox?.x ?? 0) - (availabilityHeadingBox?.x ?? 0)).toBe(12);

  const speedRow = page.getByTestId('site-metrics-speed-row-0');
  await expect(speedRow).toHaveCSS('padding-top', '9px');
  const speedHeadingBox = await page
    .getByRole('heading', { name: 'Speed and stability during real visits', level: 3 })
    .boundingBox();
  const speedRowBox = await speedRow.boundingBox();
  expect((speedRowBox?.x ?? 0) - (speedHeadingBox?.x ?? 0)).toBe(12);
  const speedResult = page.getByTestId('site-metrics-speed-result-0');
  await expect(speedResult).toHaveCSS('flex-direction', 'column');
  const buildingSample = page.getByTestId('site-metrics-speed-value-0');
  await expect(buildingSample).toHaveText('Building sample');
  await expect(buildingSample).toHaveCSS('font-size', '17px');
  await expect(buildingSample).toHaveCSS('font-weight', '800');
  await expect(buildingSample).toHaveCSS('line-height', '22px');
  await expect(buildingSample).toHaveCSS('text-align', 'right');
});
