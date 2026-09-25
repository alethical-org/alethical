import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
// Run against a local app built with EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:8991
// and the fake public key qa-public-placeholder. All API traffic is intercepted.
const accountId = '00000000-0000-4000-8000-000000000076';
const email = 'email-interactions@example.invalid';
const initialPreferences = {
  account_id: accountId,
  email,
  research: false,
  features: false,
  version: 1,
};
type PendingWrite = { route: Route; body: Record<string, unknown> };
async function mockEmailAccount(page: Page, immediate = false) {
  let preferences = { ...initialPreferences };
  const writes: PendingWrite[] = [];
  await page.addInitScript(
    ({ accountId, email }) => {
      localStorage.setItem(
        'sb-127-auth-token',
        JSON.stringify({
          access_token: 'qa-only-fake-access-token',
          refresh_token: 'qa-only-fake-refresh-token',
          token_type: 'bearer',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: accountId,
            aud: 'authenticated',
            role: 'authenticated',
            email,
            app_metadata: { provider: 'email', providers: ['email'] },
            user_metadata: {},
            created_at: '2026-01-01T00:00:00Z',
          },
        }),
      );
    },
    { accountId, email },
  );
  const appUrl = new URL(test.info().project.use.baseURL!);
  if (appUrl.hostname !== '127.0.0.1') {
    throw new Error(
      'Email interaction tests require a local 127.0.0.1 app with fake sign-in configuration.',
    );
  }
  const appOrigin = appUrl.origin;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin && !url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname;
    if (path === '/api/v1/me')
      return route.fulfill({
        json: {
          data: {
            id: accountId,
            primary_email: email,
            display_name: 'Email interaction test',
            sign_in_methods: { google: false, password: true },
          },
        },
      });
    if (path === '/api/v1/me/email-preferences') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { data: preferences } });
      const body = route.request().postDataJSON();
      writes.push({ route, body });
      if (immediate) {
        preferences = {
          ...preferences,
          ...(typeof body.research === 'boolean' ? { research: body.research } : {}),
          ...(typeof body.features === 'boolean' ? { features: body.features } : {}),
          version: preferences.version + 1,
        };
        return route.fulfill({ json: { data: preferences } });
      }
      return;
    }
    if (path === '/api/v1/email-subscriptions/unsubscribe/inspect')
      return route.fulfill({ json: { data: { valid: true } } });
    if (path === '/api/v1/email-subscriptions/unsubscribe') {
      writes.push({ route, body: route.request().postDataJSON() });
      return;
    }
    // Never reach a real account, email service, analytics service or API.
    return route.fulfill({ status: 404, json: { detail: 'No real services in this test' } });
  });
  return {
    writes,
    async finish(index: number, success = true) {
      const { route, body } = writes[index];
      if (!success) return route.fulfill({ status: 503, json: { detail: 'Test save failure' } });
      if (body.action)
        return route.fulfill({ json: { data: { unsubscribed: true, action: body.action } } });
      preferences = {
        ...preferences,
        ...(typeof body.research === 'boolean' ? { research: body.research } : {}),
        ...(typeof body.features === 'boolean' ? { features: body.features } : {}),
        version: preferences.version + 1,
      };
      return route.fulfill({ json: { data: preferences } });
    },
  };
}
async function outline(control: Locator) {
  return control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: style.outlineWidth,
      color: style.outlineColor,
      visible: element.matches(':focus-visible'),
    };
  });
}
async function keyboardFocus(page: Page, control: Locator) {
  for (let count = 0; count < 40; count += 1) {
    await page.keyboard.press('Tab');
    if (await control.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('Control cannot be reached using Tab');
}
async function expectKeyboardRing(control: Locator) {
  await expect(control).toBeFocused();
  await expect
    .poll(() => outline(control))
    .toMatchObject({ style: 'solid', width: '2px', color: 'rgb(124, 92, 255)', visible: true });
}
async function expectNoPointerRing(control: Locator) {
  await expect.poll(async () => (await outline(control)).style).toBe('none');
}
const sizes = [
  { name: 'desktop', width: 1280, height: 1000 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'narrow phone', width: 320, height: 740 },
];
for (const size of sizes) {
  test(`${size.name}: preference controls distinguish pointer and keyboard focus`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(size);
    await mockEmailAccount(page);
    await page.goto('/email-preferences');
    const research = page.getByRole('checkbox', { name: /Unconcealed research/ });
    const features = page.getByRole('checkbox', { name: /New features and services/ });
    await expect(research).toBeVisible();
    for (const checkbox of [research, features]) {
      await checkbox.click();
      await expect(checkbox).toBeChecked();
      await page.screenshot({ path: testInfo.outputPath('pointer.png'), fullPage: true });
      await expectNoPointerRing(checkbox);
      await keyboardFocus(page, checkbox);
      await expectKeyboardRing(checkbox);
      await page.keyboard.press('Space');
      await expect(checkbox).not.toBeChecked();
      await expectKeyboardRing(checkbox);
    }
    const save = page.getByRole('button', { name: 'Save email preferences', exact: true });
    await keyboardFocus(page, save);
    await expectKeyboardRing(save);
    await page.getByRole('heading', { name: 'Email preferences', exact: true }).click();
    await save.click();
    await expectNoPointerRing(save);
  });
  test(`${size.name}: saving, failure, retry and success keep the save control steady`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(size);
    const mock = await mockEmailAccount(page);
    await page.goto('/email-preferences');
    const research = page.getByRole('checkbox', { name: /Unconcealed research/ });
    await research.click();
    const save = page.getByRole('button', { name: 'Save email preferences', exact: true });
    await save.scrollIntoViewIfNeeded();
    const ready = await save.boundingBox();
    await save.click();
    const saving = page.getByRole('button', { name: 'Saving…', exact: true });
    await expect(saving).toBeVisible();
    await expect(saving).toBeFocused();
    await expect(saving).toHaveAttribute('aria-busy', 'true');
    await expect(saving).toHaveAttribute('aria-disabled', 'true');
    await expect(saving).toHaveCSS('background-color', 'rgb(46, 212, 126)');
    await expect.poll(() => mock.writes.length).toBe(1);
    const pending = await saving.boundingBox();
    await page.screenshot({ path: testInfo.outputPath('saving.png'), fullPage: true });
    await expect(
      page
        .locator('[aria-live="polite"]')
        .filter({ hasText: '✓ Your email preferences are saved' }),
    ).toHaveCount(0);
    expect(pending).toEqual(ready);
    await expectNoPointerRing(saving);
    await saving.evaluate((element) => (element as HTMLElement).click());
    await page.keyboard.press('Enter');
    expect(mock.writes).toHaveLength(1);
    await expect(research).toHaveAttribute('aria-disabled', 'true');
    await mock.finish(0, false);
    const retry = page.getByRole('button', { name: 'Try again', exact: true });
    await expect(retry).toBeVisible();
    const retryBox = await retry.boundingBox();
    expect(retryBox?.width).toBe(ready?.width);
    expect(retryBox?.height).toBe(ready?.height);
    await retry.click();
    await expect.poll(() => mock.writes.length).toBe(2);
    expect(mock.writes[1].body).toEqual(mock.writes[0].body);
    await mock.finish(1);
    await expect(
      page
        .locator('[aria-live="polite"]')
        .filter({ hasText: '✓ Your email preferences are saved' }),
    ).toBeVisible();
    await expect(save).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('saved-position.png'), fullPage: true });
    expect(await save.boundingBox()).toEqual(ready);
    await page.screenshot({ path: testInfo.outputPath('saved.png'), fullPage: true });
  });
}

for (const size of sizes) {
  test(`${size.name}: confirmation preserves focus and waits for a confirmed save`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(size);
    const mock = await mockEmailAccount(page);
    await page.goto('/money');
    await expect(
      page.getByRole('button', { name: /Account panel for Email interaction test|Account menu/ }),
    ).toBeVisible();

    const invite = page.getByRole('button', { name: 'Get Unconcealed by email', exact: true });
    await invite.click();
    const dialog = page.getByRole('dialog');
    const choice = dialog.getByRole('checkbox');
    await expect(choice).toBeVisible();
    await choice.click();
    await expectNoPointerRing(choice);
    await keyboardFocus(page, choice);
    await expectKeyboardRing(choice);
    await page.keyboard.press('Space');
    await expect(choice).not.toBeChecked();
    const subscribe = dialog.getByRole('button', { name: 'Subscribe to Unconcealed', exact: true });
    await subscribe.evaluate((element) => {
      const samples: string[] = [];
      const sample = () => {
        if (!element.isConnected) return;
        const style = getComputedStyle(element);
        samples.push(`${style.outlineStyle}:${style.outlineColor}`);
        requestAnimationFrame(sample);
      };
      (element as HTMLElement & { outlineSamples: string[] }).outlineSamples = samples;
      requestAnimationFrame(sample);
    });
    const subscribeElement = await subscribe.elementHandle();
    await subscribe.click();
    const saving = dialog.getByRole('button', { name: 'Saving…', exact: true });
    await expect.poll(() => mock.writes.length).toBe(1);
    await expectNoPointerRing(saving);
    await expect(
      dialog.getByRole('heading', { name: 'You’re subscribed to Unconcealed' }),
    ).toHaveCount(0);
    await saving.evaluate((element) => (element as HTMLElement).click());
    expect(mock.writes).toHaveLength(1);
    await mock.finish(0);
    const success = dialog.getByRole('heading', { name: 'You’re subscribed to Unconcealed' });
    await expect(success).toBeFocused();
    await expectNoPointerRing(success);
    const samples = await subscribeElement!.evaluate(
      (element) => (element as HTMLElement & { outlineSamples: string[] }).outlineSamples,
    );
    expect(samples.some((sample) => sample === 'solid:rgb(124, 92, 255)')).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath('confirmation-success.png'),
      fullPage: true,
    });
    await dialog.getByRole('button', { name: 'Back to Money in politics' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Email preferences', exact: true }),
    ).toBeVisible();
  });

  test(`${size.name}: confirmation close returns to the invitation`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockEmailAccount(page);
    await page.goto('/money');
    await expect(
      page.getByRole('button', { name: /Account panel for Email interaction test|Account menu/ }),
    ).toBeVisible();
    const invite = page.getByRole('button', { name: 'Get Unconcealed by email', exact: true });
    await invite.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(invite).toBeFocused();
  });

  test(`${size.name}: unsubscribe buttons keep keyboard focus and do not show a click outline`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const mock = await mockEmailAccount(page);
    await page.goto('/unsubscribe#unsubscribe=qa-only-invalid-token');
    const research = page.getByRole('button', {
      name: 'Unsubscribe from Unconcealed',
      exact: true,
    });
    const all = page.getByRole('button', {
      name: 'Stop all research and feature emails',
      exact: true,
    });
    await keyboardFocus(page, research);
    await expectKeyboardRing(research);
    await keyboardFocus(page, all);
    await expectKeyboardRing(all);
    await page.getByRole('heading', { name: 'Unsubscribe from Unconcealed' }).click();
    await all.click();
    const saving = page.getByRole('button', { name: 'Unsubscribing…', exact: true });
    await expect.poll(() => mock.writes.length).toBe(1);
    await expectNoPointerRing(saving);
    await mock.finish(0, false);
    const retry = page.getByRole('button', { name: 'Try again', exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
    await expectNoPointerRing(page.getByRole('button', { name: 'Unsubscribing…', exact: true }));
    await expect.poll(() => mock.writes.length).toBe(2);
    await mock.finish(1);
    await expect(page.getByRole('heading', { name: 'You’re unsubscribed' })).toBeVisible();
    expect(mock.writes[1].body).toEqual({ token: 'qa-only-invalid-token', action: 'all' });
  });
}

for (const size of sizes) {
  test(`${size.name}: an immediate save keeps keyboard focus and the footer steady`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const mock = await mockEmailAccount(page, true);
    await page.goto('/email-preferences');
    await page.getByRole('checkbox', { name: /Unconcealed research/ }).click();
    const save = page.getByRole('button', { name: 'Save email preferences', exact: true });
    await keyboardFocus(page, save);
    await expectKeyboardRing(save);
    const box = await save.boundingBox();
    const footer = page.getByRole('link', { name: 'Privacy Policy', exact: true });
    const footerBox = await footer.boundingBox();
    await page.keyboard.press('Enter');
    await expect(
      page
        .locator('[aria-live="polite"]')
        .filter({ hasText: '✓ Your email preferences are saved' }),
    ).toBeVisible();
    await expectKeyboardRing(save);
    expect(mock.writes).toHaveLength(1);
    expect(await save.boundingBox()).toEqual(box);
    expect(await footer.boundingBox()).toEqual(footerBox);
  });
}

test.describe('phone touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('tapping preference rows and saving leaves no sticky hover or focus outline', async ({
    page,
  }) => {
    const mock = await mockEmailAccount(page);
    await page.goto('/email-preferences');
    for (const name of [/Unconcealed research/, /New features and services/]) {
      const choice = page.getByRole('checkbox', { name });
      await choice.tap();
      await expect(choice).toBeChecked();
      await expectNoPointerRing(choice);
    }
    await page.getByRole('button', { name: 'Save email preferences', exact: true }).tap();
    const saving = page.getByRole('button', { name: 'Saving…', exact: true });
    await expect(saving).toHaveAttribute('aria-disabled', 'true');
    await expectNoPointerRing(saving);
    await expect.poll(() => mock.writes.length).toBe(1);
    await mock.finish(0);
    const save = page.getByRole('button', { name: 'Save email preferences', exact: true });
    await expectNoPointerRing(save);
    await expect(save).toHaveCSS('background-color', 'rgb(46, 212, 126)');
  });
});

test('keyboard save keeps its focus ring and blocks repeat actions during a slow response', async ({
  page,
}) => {
  const mock = await mockEmailAccount(page);
  await page.goto('/email-preferences');
  const research = page.getByRole('checkbox', { name: /Unconcealed research/ });
  await research.click();
  const save = page.getByRole('button', { name: 'Save email preferences', exact: true });
  await save.hover();
  await expect(save).toHaveCSS('background-color', 'rgb(40, 191, 113)');
  await keyboardFocus(page, save);
  await page.keyboard.press('Enter');
  const saving = page.getByRole('button', { name: 'Saving…', exact: true });
  await expectKeyboardRing(saving);
  await expect(saving).toHaveAttribute('aria-disabled', 'true');
  await expect(saving).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => mock.writes.length).toBe(1);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  expect(mock.writes).toHaveLength(1);
  await mock.finish(0);
  await expect(save).toBeVisible();
  await expectKeyboardRing(save);
});
