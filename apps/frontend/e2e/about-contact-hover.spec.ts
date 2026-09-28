import { expect, test, type Page } from '@playwright/test';

import { suppressSiteMetrics } from './suppress-site-metrics';

test.beforeEach(async ({ context }) => {
  await suppressSiteMetrics(context);
});

function contactButton(page: Page) {
  return page.getByRole('link', { name: 'Contact us', exact: true });
}

for (const width of [900, 1280]) {
  test(`About email gains color and underline without moving at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about');
    const email = page.getByRole('link', { name: 'ask@alethical.com', exact: true });
    await email.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await expect(email).toHaveCSS('color', 'rgb(15, 122, 69)');
    await expect(email).toHaveCSS('text-decoration-line', 'none');
    const before = await email.boundingBox();
    await email.hover();
    await expect(email).toHaveCSS('color', 'rgb(17, 131, 43)');
    await expect(email).toHaveCSS('text-decoration-line', 'underline');
    expect(await email.boundingBox()).toEqual(before);
    await email.screenshot({ path: test.info().outputPath('email-hover.png') });
    await page.mouse.move(0, 0);
    await expect(email).toHaveCSS('color', 'rgb(15, 122, 69)');
    await expect(email).toHaveCSS('text-decoration-line', 'none');
    await expect(email).toHaveAttribute('href', 'mailto:ask@alethical.com');
  });

  test(`Contact us changes color without moving at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about');
    const button = contactButton(page);
    await button.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await expect(button).toHaveCSS('background-color', 'rgb(46, 212, 126)');
    const before = await button.boundingBox();
    await button.hover();
    await expect(button).toHaveCSS('background-color', 'rgb(40, 191, 113)');
    expect(await button.boundingBox()).toEqual(before);
    await expect(button).toHaveCSS('outline-style', 'none');
    await page.mouse.move(0, 0);
    await expect(button).toHaveCSS('background-color', 'rgb(46, 212, 126)');
    await button.screenshot({ path: test.info().outputPath('contact-rest.png') });
    await button.hover();
    await button.screenshot({ path: test.info().outputPath('contact-hover.png') });
  });
}

test('Contact us retains keyboard focus and opens the contact form', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/about');
  const button = contactButton(page);
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press('Tab');
    if (await button.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS('outline-color', 'rgb(124, 92, 255)');
  await expect(button).toHaveCSS('outline-width', '2px');
  await button.press('Enter');
  await expect(page).toHaveURL(/\/about\/contact$/);
  await expect(page.getByRole('heading', { name: 'Contact us', exact: true })).toBeVisible();
});

test('phone-width mouse hover does not apply the desktop treatment', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/about');
  const button = contactButton(page);
  await button.hover();
  await expect(button).toHaveCSS('background-color', 'rgb(46, 212, 126)');
  const email = page.getByRole('link', { name: 'ask@alethical.com', exact: true });
  await email.hover();
  await expect(email).toHaveCSS('color', 'rgb(15, 122, 69)');
  await expect(email).toHaveCSS('text-decoration-line', 'none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
});

test('touch does not leave a hover treatment after returning from the contact form', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    viewport: { width: 900, height: 900 },
  });
  try {
    await suppressSiteMetrics(context);
    const page = await context.newPage();
    await page.goto('/about');
    const email = page.getByRole('link', { name: 'ask@alethical.com', exact: true });
    await email.hover();
    await expect(email).toHaveCSS('color', 'rgb(15, 122, 69)');
    await expect(email).toHaveCSS('text-decoration-line', 'none');
    await contactButton(page).tap();
    await expect(page).toHaveURL(/\/about\/contact$/);
    await page.goBack();
    await expect(contactButton(page)).toHaveCSS('background-color', 'rgb(46, 212, 126)');
    await expect(contactButton(page)).toHaveCSS('outline-style', 'none');
  } finally {
    await context.close();
  }
});

test('contact page email preserves its existing underline on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/about/contact');
  const email = page.getByRole('link', { name: 'ask@alethical.com', exact: true });
  const words = email.getByText('ask@alethical.com', { exact: true });
  await email.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await expect(words).toHaveCSS('text-decoration-line', 'none');
  await email.hover();
  await expect(words).toHaveCSS('text-decoration-line', 'underline');
  await page.mouse.move(0, 0);
  await expect(words).toHaveCSS('text-decoration-line', 'none');
  await expect(email).toHaveAttribute('href', 'mailto:ask@alethical.com');
});

test('About email keeps its keyboard focus outline', async ({ page }) => {
  await page.goto('/about');
  const email = page.getByRole('link', { name: 'ask@alethical.com', exact: true });
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press('Tab');
    if (await email.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(email).toBeFocused();
  await expect(email).toHaveCSS('outline-color', 'rgb(124, 92, 255)');
  await expect(email).toHaveCSS('outline-width', '2px');
});
