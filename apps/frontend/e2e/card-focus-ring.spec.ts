import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Run against a local web preview built with EXPO_PUBLIC_API_URL=http://records.test.
// Leave Supabase settings unset (the localhost fallback), or set
// EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321 and
// EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa-public-placeholder. Both use the
// sb-localhost-auth-token key. The lobbying response is a saved public-record
// fixture; the account session is invented. No real account is contacted.
test.skip(process.env.FOCUS_RING_RUN !== '1', 'Set FOCUS_RING_RUN=1 for the local focus check.');

test.beforeEach(async ({ baseURL, context }) => {
  const preview = baseURL ? new URL(baseURL) : null;
  test.skip(
    !preview || !['localhost', '127.0.0.1'].includes(preview.hostname),
    'Fixture checks require a local preview.',
  );
  await context.route('**/*', (route) => {
    const address = new URL(route.request().url());
    return address.origin === preview!.origin || address.origin === 'http://records.test'
      ? route.continue()
      : route.abort();
  });
});

const directoryFixture = JSON.parse(
  readFileSync(
    join(__dirname, '../src/screens/redesign/__tests__/fixtures/lobbying-directories-live.json'),
    'utf8',
  ),
) as { lobbyists_page_2: unknown };

async function tabTo(page: Page, selector: string) {
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((target) => document.activeElement?.matches(target), selector)) return;
  }
  throw new Error(`Keyboard could not reach ${selector}`);
}

async function ringOf(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        visible: element.matches(':focus-visible'),
        color: style.outlineColor,
        width: style.outlineWidth,
        kind: style.outlineStyle,
        offset: style.outlineOffset,
        radius: style.borderRadius,
        shadow: style.boxShadow,
      };
    });
}

async function expectSharedRing(page: Page, selector: string, radius: string) {
  const ring = await ringOf(page, selector);
  expect(ring).toMatchObject({
    visible: true,
    color: 'rgb(124, 92, 255)',
    width: '2px',
    kind: 'solid',
    offset: '2px',
    radius,
  });
}

for (const width of [1280, 900, 375]) {
  test(`whole money and About cards have one keyboard ring at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/money');
    const moneyCard = 'a[href="/money/committees"]';
    await expect(page.locator(moneyCard)).toBeVisible();
    await tabTo(page, moneyCard);
    await expectSharedRing(page, moneyCard, width < 768 ? '16px' : '18px');
    expect(await page.locator(moneyCard).locator('a').count()).toBe(0);
    await page.locator(moneyCard).click();
    await page.goBack();
    await expect(page.locator(moneyCard)).toBeVisible();
    expect((await ringOf(page, moneyCard)).kind).toBe('none');

    await page.goto('/about');
    const aboutCard = 'a[href="/bills"]:has([role="heading"])';
    await expect(page.locator(aboutCard)).toBeVisible();
    await tabTo(page, aboutCard);
    await expectSharedRing(page, aboutCard, '14px');
    // A second purple glow used to be added to this same card on focus.
    expect((await ringOf(page, aboutCard)).shadow).not.toContain('124, 92, 255');
    await page.locator(aboutCard).click();
    await page.goBack();
    await expect(page.locator(aboutCard)).toBeVisible();
    expect((await ringOf(page, aboutCard)).kind).toBe('none');
  });
}

test('lobbyist rows use one full-width ring and preserve the last row corners', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.route('http://records.test/**', (route) =>
    route.fulfill({ json: { data: directoryFixture.lobbyists_page_2 } }),
  );
  await page.goto('/money/lobbying/lobbyists?page=2');
  const first = '[role="listitem"] a';
  await expect(page.locator(first)).toHaveCount(50);
  await tabTo(page, first);
  await expectSharedRing(page, first, '0px');
  expect(await page.locator(first).first().locator('a').count()).toBe(0);
  const last = page.locator(first).last();
  await last.focus();
  await expectSharedRing(page, '[role="listitem"]:last-child a', '0px 0px 15px 15px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await page.locator(first).first().click();
  await page.goBack();
  await expect(page.locator(first).first()).toBeVisible();
  expect((await ringOf(page, first)).kind).toBe('none');
});

test('the last account menu row keeps its full ring inside the scrolling menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 310 });
  const accountId = '00000000-0000-4000-8000-000000000076';
  const expiration = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: accountId, session_id: 'fixture', exp: expiration })}.not-a-real-signature`,
    refresh_token: 'fixture-refresh',
    token_type: 'bearer',
    expires_at: expiration,
    expires_in: 3600,
    user: {
      id: accountId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'test@example.invalid',
      email_confirmed_at: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
    },
  };
  await page.addInitScript(
    (saved) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(saved)),
    session,
  );
  await page.route('http://records.test/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === '/api/v1/me'
        ? {
            id: accountId,
            primary_email: 'test@example.invalid',
            display_name: 'Test Reader',
            sign_in_methods: { google: false, password: true },
          }
        : path === '/api/v1/admin/access'
          ? { is_admin: true }
          : [];
    return route.fulfill({ json: { data } });
  });
  await page.goto('/about');
  await page.getByRole('button', { name: /Test/ }).click();
  const rows = page.locator('[data-account-menu-row]');
  await expect(rows).toHaveCount(4);
  await tabTo(page, '[data-account-menu-row]:last-of-type');
  const last = rows.last();
  await last.scrollIntoViewIfNeeded();
  await expectSharedRing(page, '[data-account-menu-row]:last-of-type', '0px');
  const clearance = await last.evaluate((element) => {
    const row = element.getBoundingClientRect();
    const frame = element.closest('[data-account-menu-rows]')?.getBoundingClientRect();
    const scrollTop = element.closest('[data-account-menu-rows]')?.scrollTop ?? 0;
    if (!frame) return null;
    return {
      left: row.left - frame.left,
      right: frame.right - row.right,
      bottom: frame.bottom - row.bottom,
      scrollTop,
    };
  });
  expect(clearance).not.toBeNull();
  expect(clearance!.left).toBeGreaterThanOrEqual(4);
  expect(clearance!.right).toBeGreaterThanOrEqual(4);
  expect(clearance!.bottom).toBeGreaterThanOrEqual(4);
  expect(clearance!.scrollTop).toBeGreaterThan(0);
});
