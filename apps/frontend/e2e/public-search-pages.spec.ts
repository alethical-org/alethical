import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { suppressSiteMetrics } from './suppress-site-metrics';

// Read-only public stories. Local runs read the real public API through the
// test runner, which avoids widening production's allowed browser origins.
async function guardPublicReads(context: BrowserContext, baseURL?: string) {
  await context.route('**/*', (route) =>
    ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await suppressSiteMetrics(context);
  if (baseURL && ['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) {
    await context.route('https://api.alethical.com/**', async (route) => {
      if (route.request().method() !== 'GET') return route.abort();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'access-control-allow-origin': '*' },
      });
    });
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  await guardPublicReads(context, baseURL);
});

test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

async function expectNoHorizontalOverflow(page: Page) {
  const width = page.viewportSize()!.width;
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
          window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(width + 1);
}

for (const width of [390, 1400]) {
  test(`privacy source is a usable keyboard link at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeVisible();
    const policy = page.getByRole('link', { name: 'Google API Services User Data Policy' });
    await expect(policy).toHaveAttribute(
      'href',
      'https://developers.google.com/terms/api-services-user-data-policy',
    );
    await expectNoHorizontalOverflow(page);
    await policy.focus();
    // Safari's normal Tab skips links; Option-Tab includes them.
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(policy).toBeFocused();
    await expect(policy).toHaveCSS('outline-style', 'solid');
    const destinationPromise = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    const destination = await destinationPromise;
    await expect(destination).toHaveURL(
      'https://developers.google.com/terms/api-services-user-data-policy',
    );
    await destination.close();
    await page.goto('/terms');
    await expect(page.getByRole('heading', { name: 'Terms of Service', level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test(`candidate instructions and public facts load at ${width}px without an address`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/candidates');
    await expect(page.getByRole('heading', { name: 'Find my candidates', level: 1 })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Full street address' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByText('Candidate results are unavailable', { exact: true })).toHaveCount(
      0,
    );
    const id = '2aac573ec752af687b5d9d024cfc1530ae61127d9a5e90f7a6dc43721465cc1b';
    await page.goto(`/candidates/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Official candidate record', { exact: true })).toBeVisible();
    await expect(page.getByText(/Minnesota Secretary of State/).first()).toBeVisible();
    await expect(page.getByText(/Checked /).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Find my candidates', exact: true })).toBeVisible();
    await expect(page.getByText('Candidate record is unavailable', { exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
}

test('phone browser opens the official privacy source by tapping', async ({
  browser,
  browserName,
  baseURL,
}) => {
  test.skip(browserName === 'firefox', 'Phone emulation covers Android Chrome and iPhone Safari');
  const { defaultBrowserType, ...phone } =
    devices[browserName === 'webkit' ? 'iPhone 13' : 'Pixel 7'];
  expect(browserName).toBe(defaultBrowserType);
  expect(phone.isMobile).toBe(true);
  expect(phone.hasTouch).toBe(true);
  const context = await browser.newContext({ ...phone, baseURL });
  try {
    await guardPublicReads(context, baseURL);
    const page = await context.newPage();
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeVisible();
    expect(await page.evaluate(() => navigator.userAgent)).toMatch(
      browserName === 'webkit' ? /iPhone/ : /Android/,
    );
    const policy = page.getByRole('link', { name: 'Google API Services User Data Policy' });
    await expectNoHorizontalOverflow(page);
    await policy.evaluate((link) => {
      link.addEventListener('touchstart', () => link.setAttribute('data-review-tapped', 'true'), {
        once: true,
      });
    });
    const destinationPromise = page.waitForEvent('popup');
    await policy.tap();
    await expect(policy).toHaveAttribute('data-review-tapped', 'true');
    const destination = await destinationPromise;
    await expect(destination).toHaveURL(
      'https://developers.google.com/terms/api-services-user-data-policy',
    );
    await destination.close();
    await page.goto('/terms');
    await expect(page.getByRole('heading', { name: 'Terms of Service', level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});

test('phone browser reads public candidate facts and taps back without an address', async ({
  browser,
  browserName,
  baseURL,
}) => {
  test.skip(browserName === 'firefox', 'Phone emulation covers Android Chrome and iPhone Safari');
  const { defaultBrowserType, ...phone } =
    devices[browserName === 'webkit' ? 'iPhone 13' : 'Pixel 7'];
  expect(browserName).toBe(defaultBrowserType);
  expect(phone.isMobile).toBe(true);
  expect(phone.hasTouch).toBe(true);
  const context = await browser.newContext({ ...phone, baseURL });
  try {
    await guardPublicReads(context, baseURL);
    const page = await context.newPage();
    await page.goto('/candidates');
    await expect(page.getByRole('combobox', { name: 'Full street address' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const id = '2aac573ec752af687b5d9d024cfc1530ae61127d9a5e90f7a6dc43721465cc1b';
    await page.goto(`/candidates/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Official candidate record', { exact: true })).toBeVisible();
    await expect(page.getByText(/Minnesota Secretary of State/).first()).toBeVisible();
    await expect(page.getByText(/Checked /).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('link', { name: 'Find my candidates', exact: true }).tap();
    await expect(page).toHaveURL(/\/candidates$/);
    await expect(page.getByRole('combobox', { name: 'Full street address' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});
