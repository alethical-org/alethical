import { expect, test, type Page } from '@playwright/test';

import { suppressSiteMetrics } from './suppress-site-metrics';

// These fixtures never leave this browser. In particular, no test action reaches
// either real collection endpoint, even when the app enables analytics.
test.beforeEach(async ({ context, baseURL }) => {
  test.skip(!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname));
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    return ['localhost', '127.0.0.1'].includes(host) ? route.continue() : route.abort();
  });
  await suppressSiteMetrics(context);
});

async function fixtureApi(page: Page, answer: (url: URL) => unknown | Promise<unknown>) {
  const events: { event: string; eventId: string }[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/site-metrics/events')) {
      events.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    }
    const value = await answer(url);
    return route.fulfill({ json: value ?? { data: [] } });
  });
  return events;
}

test('bill searches count settled visible results, not a previous query waiting on an answer', async ({
  page,
}) => {
  let pending = false;
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events = await fixtureApi(page, async (url) => {
    if (!url.pathname.endsWith('/bills')) return undefined;
    const empty = url.searchParams.get('q') === 'unmatched';
    if (empty) {
      pending = true;
      await held;
    }
    const data = empty
      ? []
      : [
          {
            id: '94-2026-HF1',
            file_type: 'HF',
            file_number: 1,
            title: 'Test school funding',
            chief_sponsors: [],
          },
        ];
    return { data, page: { limit: 20, offset: 0, has_more: false, total: data.length } };
  });
  await page.goto('/bills?q=school');
  await expect(page.getByText('Test school funding').first()).toBeVisible();
  await expect.poll(() => events.length).toBe(1);
  await page.getByRole('textbox', { name: 'Search by keyword or bill number' }).fill('unmatched');
  await expect.poll(() => pending).toBe(true);
  expect(events).toHaveLength(1);
  release?.();
  await expect(page.getByText('Test school funding')).toHaveCount(0);
  expect(events).toHaveLength(1);
  await page.getByRole('textbox', { name: 'Search by keyword or bill number' }).fill('education');
  await expect.poll(() => events.length).toBe(2);
  expect(events.map(({ event }) => event)).toEqual([
    'bill_search_with_results',
    'bill_search_with_results',
  ]);
  expect(Object.keys(events[0]).sort()).toEqual(['event', 'eventId']);
});

test('legislator searches count the chamber filter actually displayed', async ({ page }) => {
  const events = await fixtureApi(page, (url) =>
    url.pathname.endsWith('/legislators')
      ? {
          data: [
            {
              id: 'test-alice',
              slug: 'test-alice',
              full_name: 'Alice Example',
              current_service: {
                chamber: 'house',
                party: 'DFL',
                district: { id: '1', code: '1A' },
              },
              committees: [],
              stats: { chief_bill_count: 0, total_bill_count: 0 },
            },
          ],
          page: { limit: 250, offset: 0, has_more: false, total: 1 },
        }
      : undefined,
  );
  await page.goto('/legislators?q=Alice&chamber=Senate');
  await expect(page.getByRole('heading', { name: 'Search legislators', level: 1 })).toBeVisible();
  await expect(page.getByText('Loading legislators')).toHaveCount(0);
  expect(events).toHaveLength(0);
  await page.getByRole('button', { name: /^House/ }).click();
  await expect(page.getByText('Alice Example').first()).toBeVisible();
  await expect.poll(() => events.length).toBe(1);
  expect(events[0].event).toBe('legislator_search_with_results');
});

test('money searches count displayed records, not unavailable or unknown result groups', async ({
  page,
}) => {
  const events = await fixtureApi(page, (url) => {
    if (!url.pathname.endsWith('/campaign-finance/search')) return undefined;
    const q = url.searchParams.get('q');
    const state = q === 'unavailable' ? 'unavailable' : 'reported';
    return {
      data: {
        state,
        q,
        groups: [
          {
            kind: q === 'unknown' ? 'unknown' : 'committees',
            state,
            total: 1,
            results: [
              { kind: 'committee', registration_number: 'test-1', name: 'Example Committee' },
            ],
          },
        ],
      },
    };
  });
  await page.goto('/money/search?q=unavailable');
  const input = page.getByRole('textbox');
  await expect(page.getByText('We could not search all of these records just now')).toBeVisible();
  await expect(input).toBeVisible();
  expect(events).toHaveLength(0);
  await input.fill('unknown');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('unknown');
  expect(events).toHaveLength(0);
  await input.fill('example');
  await expect(page.getByText('Example Committee').first()).toBeVisible();
  await expect.poll(() => events.length).toBe(1);
  expect(events[0].event).toBe('money_search_with_results');
  await input.press('Enter');
  expect(events).toHaveLength(1);
  expect(Object.keys(events[0]).sort()).toEqual(['event', 'eventId']);
});
