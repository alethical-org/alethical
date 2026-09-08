import { expect, test, type Page, type Route } from '@playwright/test';
import { leadershipFixture } from '../src/lib/__tests__/leadershipMetricsFixture';
import { suppressSiteMetrics } from './suppress-site-metrics';

// This suite restores invented saved sessions, never signs into a real account.
// The local export uses the unconfigured auth client's localhost fallback.
const storageKey = process.env.E2E_AUTH_STORAGE_KEY ?? 'sb-localhost-auth-token';
function syntheticSession(account = 1, revision = 1) {
  const id = `00000000-0000-4000-8000-${String(account).padStart(12, '0')}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, session_id: `fixture-${account}`, exp: expiresAt, revision })}.not-a-real-signature`,
    refresh_token: `not-a-real-refresh-token-${account}-${revision}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email: `admin-fixture-${account}@example.invalid`,
      email_confirmed_at: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
    },
  };
}
type Session = ReturnType<typeof syntheticSession>;
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const metric = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('..');

async function answers(
  page: Page,
  options: {
    session?: Session | null;
    allowed?: boolean;
    data?: ReturnType<typeof leadershipFixture>;
  } = {},
) {
  const session = options.session === undefined ? syntheticSession() : options.session;
  const state = {
    session,
    allowed: options.allowed ?? true,
    data: options.data ?? leadershipFixture(),
    holdValidation: false,
    pendingValidation: null as Route | null,
    reportTokens: [] as string[],
    accessTokens: [] as string[],
  };
  await page.addInitScript(
    ({ key, saved }) => {
      localStorage.clear();
      if (saved) localStorage.setItem(key, JSON.stringify(saved));
    },
    { key: storageKey, saved: session },
  );
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/api/v1/me') {
      if (state.holdValidation) {
        state.pendingValidation = route;
        return;
      }
      return json(route, {
        data: {
          id: state.session?.user.id,
          primary_email: state.session?.user.email,
          display_name: 'Synthetic administrator',
          sign_in_methods: { google: false, password: true },
        },
      });
    }
    if (path === '/api/v1/admin/access') {
      state.accessTokens.push(route.request().headers().authorization ?? '');
      return json(route, { data: { is_admin: state.allowed } });
    }
    if (path === '/api/v1/admin/site-metrics') {
      state.reportTokens.push(route.request().headers().authorization ?? '');
      return json(route, state.data);
    }
    if (path === '/api/v1/site-metrics/events') return route.fulfill({ status: 204 });
    if (path === '/api/v1/site-metrics/collection')
      return json(route, { collect: false, teamAccount: true, teamExclusionConfigured: true });
    return json(route, { detail: 'Not available in this isolated fixture' }, 503);
  });
  return state;
}

async function changeSession(page: Page, session: Session | null, event: string) {
  // Exercise the real provider's cross-tab subscription, not React internals.
  await page.evaluate(
    ({ key, saved, eventName }) => {
      if (saved) localStorage.setItem(key, JSON.stringify(saved));
      else localStorage.removeItem(key);
      const channel = new BroadcastChannel(key);
      channel.postMessage({ event: eventName, session: saved });
      channel.close();
    },
    { key: storageKey, saved: session, eventName: event },
  );
}

test.beforeEach(async ({ context, baseURL }) => {
  test.skip(
    !baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname),
    'Synthetic private-report checks run only against a local export.',
  );
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    // Only local static files reach a server. Every API answer is mocked above.
    return url.origin === new URL(baseURL!).origin &&
      !url.pathname.startsWith('/api/') &&
      route.request().method() === 'GET'
      ? route.continue()
      : route.abort();
  });
  await suppressSiteMetrics(context);
});

test('network boundary blocks vendor calls and discards event uploads locally', async ({
  page,
}) => {
  await page.goto('/admin/site-metrics');
  const outcomes = await page.evaluate(async () => {
    const urls = [
      'https://example.invalid/auth/v1/user',
      'https://static.cloudflareinsights.com/beacon.min.js',
      'https://cloudflareinsights.com/cdn-cgi/rum',
      '/_vercel/insights/view',
      '/api/unmocked-private-route',
    ];
    const blocked = await Promise.all(
      urls.map(async (url) => {
        try {
          await fetch(url);
          return false;
        } catch {
          return true;
        }
      }),
    );
    const event = await fetch('/api/v1/site-metrics/events', {
      method: 'POST',
      body: JSON.stringify({ event: 'money_search_with_results' }),
    });
    return { blocked, eventStatus: event.status };
  });
  expect(outcomes).toEqual({ blocked: [true, true, true, true, true], eventStatus: 204 });
});

for (const width of [390, 1280]) {
  test.describe(`${width}px leadership metrics`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('allowed administrator sees private totals and range changes', async ({ page }) => {
      const state = await answers(page);
      await page.goto('/admin/site-metrics');
      await expect(metric(page, 'Current surviving accounts created')).toHaveText(/23$/);
      await expect(metric(page, 'Surviving accounts created in last 7 days')).toHaveText(/4$/);
      await page.getByRole('button', { name: 'Last 30 days', exact: true }).click();
      await expect(metric(page, 'Surviving accounts created in last 30 days')).toHaveText(/8$/);
      await expect(metric(page, 'Surviving accounts created in previous 30 days')).toHaveText(/6$/);
      await expect(metric(page, 'Current surviving accounts created')).toHaveText(/23$/);
      await expect(metric(page, 'Stored bills')).toHaveText(/2,001$/);
      await expect(metric(page, 'Total operating cost')).toHaveText(/Unavailable$/);
      await expect(
        page.getByText(/not invoices, reserved budgets, or total operating cost/),
      ).toBeVisible();
      expect(state.reportTokens).toEqual([`Bearer ${state.session!.access_token}`]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      for (const name of ['Last 7 days', 'Last 30 days', 'Refresh']) {
        const box = await page.getByRole('button', { name, exact: true }).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('signed-out visitor cannot request private totals', async ({ page }) => {
      const state = await answers(page, { session: null });
      await page.goto('/admin/site-metrics');
      await expect(
        page.getByText('Sign in with an administrator account to view leadership metrics.'),
      ).toBeVisible();
      await expect(page.getByText('Current surviving accounts created')).toHaveCount(0);
      expect(state.accessTokens).toEqual([]);
      expect(state.reportTokens).toEqual([]);
    });

    test('signed-in nonadministrator cannot request private totals', async ({ page }) => {
      const state = await answers(page, { allowed: false });
      await page.goto('/admin/site-metrics');
      await expect(
        page.getByText('Restricted access. This account cannot view leadership metrics.'),
      ).toBeVisible();
      await expect(page.getByText('Current surviving accounts created')).toHaveCount(0);
      expect(state.accessTokens).toEqual([`Bearer ${state.session!.access_token}`]);
      expect(state.reportTokens).toEqual([]);
    });

    for (const source of ['accounts', 'activity', 'operations'] as const) {
      test(`${source} failure leaves the other private sources readable`, async ({ page }) => {
        const data = leadershipFixture();
        data[source] = null;
        data.errors[source] = `Synthetic ${source} source is unavailable.`;
        await answers(page, { data });
        await page.goto('/admin/site-metrics');
        await expect(page.getByText(data.errors[source]!, { exact: true }).first()).toBeVisible();
        if (source !== 'accounts')
          await expect(metric(page, 'Current surviving accounts created')).toHaveText(/23$/);
        if (source !== 'activity')
          await expect(metric(page, 'Current bill follows')).toHaveText(/6$/);
        if (source !== 'operations')
          await expect(metric(page, 'Stored bills')).toHaveText(/2,001$/);
        await expect(page.getByText('Leadership metrics are unavailable. Try again.')).toHaveCount(
          0,
        );
      });
    }

    for (const change of ['token', 'account', 'sign-out'] as const) {
      test(`${change} change clears prior private totals before new access resolves`, async ({
        page,
      }) => {
        const state = await answers(page);
        await page.goto('/admin/site-metrics');
        await expect(metric(page, 'Current surviving accounts created')).toHaveText(/23$/);
        state.holdValidation = true;
        const next =
          change === 'sign-out' ? null : syntheticSession(change === 'account' ? 2 : 1, 2);
        state.session = next;
        state.data.accounts!.currentAccountsCreated = 49;
        state.data.accounts!.currentConfirmedAccounts = 46;
        await changeSession(page, next, change === 'sign-out' ? 'SIGNED_OUT' : 'TOKEN_REFRESHED');
        await expect(page.getByText('Current surviving accounts created')).toHaveCount(0);
        await expect(page.getByText('Stored bills', { exact: true })).toHaveCount(0);
        expect(state.reportTokens).toHaveLength(1);
        if (!next) {
          await expect(
            page.getByText('Sign in with an administrator account to view leadership metrics.'),
          ).toBeVisible();
          return;
        }
        await expect.poll(() => Boolean(state.pendingValidation)).toBe(true);
        await expect(page.getByText('Checking access…')).toBeVisible();
        state.holdValidation = false;
        await json(state.pendingValidation!, {
          data: {
            id: next.user.id,
            primary_email: next.user.email,
            display_name: 'Next synthetic administrator',
          },
        });
        await expect(metric(page, 'Current surviving accounts created')).toHaveText(/49$/);
        expect(state.reportTokens.at(-1)).toBe(`Bearer ${next.access_token}`);
        expect(
          await page.evaluate(() =>
            Object.values(localStorage).some((value) => value.includes('currentAccountsCreated')),
          ),
        ).toBe(false);
      });
    }
  });
}
