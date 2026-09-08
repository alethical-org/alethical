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
      await expectRow(page, 'Accounts created', '8');
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

    test('account growth changes with 7/30 days while current accounts and follows stay fixed', async ({
      page,
    }) => {
      const requests = await installAnswers(page);
      await openMetrics(page);
      await expectRow(page, 'Accounts created', '8');
      await expectRow(page, 'Current accounts', '80');
      await expectRow(page, 'New committee follows', '3');
      await expectRow(page, 'Money searches with results', '13');
      await expectRow(page, 'Current committee follows', '14');
      await expectRow(page, 'Different committees currently followed', '9');
      await expectRow(page, 'Readers following committees', '7');
      await expect(page.getByText(/Accounts include unconfirmed sign-ups/)).toBeVisible();
      const ranges = page.getByRole('group', { name: 'Activity range' });
      if (viewport.name === 'phone') {
        for (const button of await ranges.getByRole('button').all()) {
          expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        }
      }
      await ranges.getByRole('button', { name: 'Last 30 days', exact: true }).click();
      await expectRow(page, 'Accounts created', '27');
      await expectRow(page, 'Money searches with results', '39');
      await expectRow(page, 'New committee follows', '9');
      await expectRow(page, 'Current accounts', '80');
      await expectRow(page, 'Current committee follows', '14');
      await expectRow(page, 'Different committees currently followed', '9');
      await expect(ranges.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await ranges.getByRole('button', { name: 'Last 7 days', exact: true }).click();
      await expectRow(page, 'Accounts created', '8');
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

    test('an unavailable account source does not turn sign-ups into zero or hide activity', async ({
      page,
    }) => {
      await installAnswers(page, { ...fixture(), accounts: null });
      await openMetrics(page);
      await expectRow(page, 'Accounts created', 'Not available');
      await expectRow(page, 'Current accounts', 'Not available');
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
      await expectRow(page, 'Accounts created', '8');
      await expectRow(page, 'Current accounts', '80');
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
      await expectRow(page, 'Accounts created', '8');
      await expect(page.getByTestId('site-metrics-search-google')).toBeVisible();
      await expect(page.getByTestId('site-metrics-speed-value-0')).toHaveText('2 s');
      await noHorizontalOverflow(page);
    });

    test('a failed availability source leaves traffic, growth, search and speed visible', async ({
      page,
    }) => {
      await installAnswers(page, { ...fixture(), uptime: null });
      await openMetrics(page);
      await expect(page.getByText('Availability data is temporarily unavailable.')).toBeVisible();
      await expect(page.getByTestId('site-metrics-explore')).toBeVisible();
      await expectRow(page, 'Accounts created', '8');
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
      await expectRow(page, 'Accounts created', '8');
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
      await expect(row(page, 'New committee follows')).toContainText('Partial range');
      await expect(row(page, 'Official source links clicked')).toContainText('Partial range');
      await page.getByRole('button', { name: 'Last 30 days', exact: true }).click();
      await expectRow(page, 'Bill searches with results', '0');
      await expectRow(page, 'Money searches with results', 'Not recorded yet');
      await expect(row(page, 'New committee follows')).toContainText('Partial range');
      await expect(row(page, 'Official source links clicked')).toContainText('Partial range');
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
