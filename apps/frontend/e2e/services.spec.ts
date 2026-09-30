import { expect, test } from '@playwright/test';

import { suppressSiteMetrics } from './suppress-site-metrics';

test.beforeEach(async ({ context }) => {
  await suppressSiteMetrics(context);
});

for (const width of [320, 375, 768, 924, 1100, 1280]) {
  test(`public services remains readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/services');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Political intelligence. Practical campaign support.',
    );
    await expect(page).toHaveTitle('Political intelligence and campaign services | Alethical');
    await expect(page.getByText('PRIVATE DESIGN PREVIEW')).toHaveCount(0);
    await expect(page.getByText('IN DEVELOPMENT', { exact: true })).toBeVisible();
    const delivery = page.getByRole('heading', { name: 'Delivery and pricing', exact: true });
    await delivery.scrollIntoViewIfNeeded();
    const layout = await delivery.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        height: rect.height,
        line: Number.parseFloat(style.lineHeight),
        right: rect.right,
        scrollWidth: element.scrollWidth,
        width: rect.width,
        pageWidth: document.documentElement.scrollWidth,
      };
    });
    expect(layout.height).toBeLessThanOrEqual(layout.line + 1);
    expect(layout.right).toBeLessThanOrEqual(width);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
    expect(layout.pageWidth).toBe(width);
    await expect(
      page.getByText('Pricing is tailored to your needs', { exact: true }),
    ).toBeVisible();
    // Every software heading stays in its intended row, rather than wrapping the last tile.
    const tools = page.getByRole('heading', {
      name: /^(Candidate profiles|Campaign checklists|Candidate tools|Partner marketplace)$/,
    });
    const positions = await tools.evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().top)),
    );
    if (width >= 1100) expect(new Set(positions).size).toBe(1);
    else if (width >= 768) expect(new Set(positions).size).toBe(2);
    else expect(new Set(positions).size).toBe(4);
    await page.screenshot({ path: test.info().outputPath(`services-${width}.png`) });
  });
}

test('audience choices work with a keyboard and announce the selected content', async ({
  page,
}) => {
  await page.goto('/services');
  const organizations = page.getByRole('tab', { name: /^For organizations/ });
  const campaigns = page.getByRole('tab', { name: /^For individual campaigns/ });
  const panel = page.getByRole('tabpanel');
  await expect(organizations).toHaveAttribute('aria-selected', 'true');
  await organizations.press('ArrowRight');
  await expect(campaigns).toBeFocused();
  await expect(campaigns).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toContainText('A campaign website');
  await expect(panel).not.toContainText('Shared research');
  await campaigns.press('Home');
  await expect(organizations).toBeFocused();
  await expect(panel).toContainText('Support across campaigns');
  await organizations.hover();
  await expect(organizations).toHaveCSS('background-color', 'rgba(53, 196, 107, 0.13)');
});

for (const width of [375, 1280]) {
  test(`contact panel closes, contains focus, and opens the correct draft at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 667 });
    await page.goto('/services');
    const contact = page.getByRole('button', { name: 'Contact Us', exact: true });
    await contact.hover();
    await expect(contact).toHaveCSS('background-color', 'rgb(47, 176, 95)');
    await contact.click();
    const dialog = page.locator('#services-contact-panel');
    const heading = dialog.getByRole('heading', { name: 'Contact Us', exact: true });
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    const draft = dialog.getByRole('link', { name: 'Open email draft', exact: true });
    await expect(heading).toBeFocused();
    await expect(draft).toHaveAttribute('href', 'mailto:angel@alethical.com?cc=ask@alethical.com');
    await heading.press('Shift+Tab');
    await expect(draft).toBeFocused();
    await draft.press('Tab');
    await expect(close).toBeFocused();
    await close.press('Shift+Tab');
    await expect(draft).toBeFocused();
    const panelBox = (await dialog.boundingBox())!;
    const closeBox = (await close.boundingBox())!;
    expect(closeBox.y - panelBox.y).toBeCloseTo(width < 768 ? 23 : 21, 0);
    expect(panelBox.x).toBeGreaterThanOrEqual(16);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width - 16);
    await close.hover();
    await expect(close).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.08)');
    await draft.hover();
    await expect(draft).toHaveCSS('background-color', 'rgb(47, 176, 95)');
    await draft.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(contact).toBeFocused();
    await contact.click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await contact.click();
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(0);
  });
}

test('section links reveal their heading and coalition links share one destination', async ({
  page,
}) => {
  await page.goto('/services');
  await page.getByRole('link', { name: 'Partners', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Specialist support, connected to your campaign.' }),
  ).toBeInViewport();
  await page.getByRole('link', { name: 'Early work', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Already helping campaigns get started.' }),
  ).toBeInViewport();
  for (const label of ['Minnesota Forward Coalition', 'Minnesota Forward Coalition candidates']) {
    await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'href',
      'https://forwardcoalition.com/candidates',
    );
  }
});

for (const width of [375, 1280]) {
  test(`homepage campaign services card opens the public presentation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const card = page.getByRole('link', { name: /^Campaign services Get political/ });
    await expect(card).toHaveAttribute('href', '/services');
    await card.click();
    await expect(page).toHaveURL(/\/services$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Political intelligence. Practical campaign support.',
    );
    await page.goBack();
    await expect(card).toBeVisible();
  });
}

for (const width of [375, 1280]) {
  test(`About Services works above the presentation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/services');
    if (width < 1100) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    else await page.getByRole('button', { name: 'About', exact: true }).click();
    const services =
      width < 1100
        ? page.getByRole('dialog').getByRole('link', { name: 'Services', exact: true })
        : page
            .getByRole('link', { name: 'Services', exact: true })
            .and(page.locator('a[href="/services"]'));
    await expect(services).toHaveAttribute('href', '/services');
    await expect(services).toHaveAttribute('aria-current', 'page');
    await services.scrollIntoViewIfNeeded();
    const hit = await services.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
      );
    });
    expect(hit).toBe(true);
    await services.hover();
    await services.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Political intelligence. Practical campaign support.',
    );
    await expect(services).toHaveCount(0);
    if (width < 1100) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    else await page.getByRole('button', { name: 'About', exact: true }).click();
    await page.getByRole('link', { name: 'About us', exact: true }).click();
    await expect(page).toHaveURL(/\/about$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/services$/);
  });
}
