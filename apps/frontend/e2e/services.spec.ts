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
    await expect(page.getByRole('banner')).toHaveCount(1);
    expect((await page.getByRole('banner').boundingBox())!.height).toBeLessThanOrEqual(
      width < 768 ? 110 : 77,
    );
    await expect(page.getByRole('link', { name: 'Alethical home', exact: true })).toBeVisible();
    const header = page.getByRole('banner');
    const logo = header.getByRole('link', { name: 'Alethical home', exact: true });
    expect((await logo.boundingBox())!.width).toBe(width < 360 ? 124 : width < 768 ? 140 : 183);
    if (width < 768) {
      const sections = page.getByRole('navigation', { name: 'Services sections' });
      await expect(sections).toHaveCSS('gap', '24px');
      await expect(sections).toHaveCSS('border-top-width', '1px');
      await expect(header.getByRole('button', { name: 'Contact Us', exact: true })).toHaveCSS(
        'padding-left',
        width < 360 ? '14px' : '18px',
      );
    }
    await page.screenshot({ path: test.info().outputPath(`services-header-${width}.png`) });
    for (const [section, name] of [
      ['audiences', 'Support for an organization. A starting point for a campaign.'],
      ['services', 'From research to practical support.'],
      ['tools', 'Tools built around the way your team works.'],
      ['partners', 'Specialist support, connected to your campaign.'],
      ['early-work', 'Already helping campaigns get started.'],
    ]) {
      await page.getByRole('heading', { name, exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`services-${section}-${width}.png`) });
    }

    const partners = page.locator('#partners');
    const partnerHeadings = partners.getByRole('heading', { level: 3 });
    const partnerPositions = await partnerHeadings.evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().top)),
    );
    expect(new Set(partnerPositions).size).toBe(width < 768 ? 4 : 2);
    await expect(partnerHeadings.first()).toHaveCSS('font-size', '19px');
    await expect(partnerHeadings.first().locator('..')).toHaveCSS(
      'border-top-color',
      'rgb(53, 196, 107)',
    );
    await expect(partners.getByRole('listitem').first()).toHaveCSS('border-top-width', '1px');
    if ([375, 768, 1280].includes(width)) {
      const scroll = page.locator('#services-page');
      const dimensions = await scroll.evaluate((element) => ({
        total: element.scrollHeight,
        visible: element.clientHeight,
      }));
      for (let offset = 0; offset < dimensions.total; offset += dimensions.visible - 150) {
        await scroll.evaluate((element, top) => {
          element.scrollTop = top;
        }, offset);
        await page.screenshot({
          path: test.info().outputPath(`services-whole-${width}-${offset}.png`),
        });
      }
    }

    const event = page.locator('#services-events');
    await expect(
      event.getByRole('heading', { name: 'Debate hosting and event production' }),
    ).toBeVisible();
    await expect(event).toContainText('Bring candidates and communities together');
    await expect(event.getByRole('link', { name: 'Host a debate', exact: true })).toHaveCount(0);
    const replay = event.getByRole('link', { name: 'Watch The Forward Debate', exact: true });
    await expect(replay).toHaveAttribute(
      'href',
      'https://www.alethical.com/blog/events/forward-debate-2026',
    );
    await expect(replay).not.toHaveAttribute('target', '_blank');
    await replay.scrollIntoViewIfNeeded();
    expect((await replay.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: test.info().outputPath(`services-event-${width}.png`) });

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
      page
        .locator('#services-page')
        .getByText('Pricing is tailored to your needs', { exact: true }),
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
    await page.screenshot({ path: test.info().outputPath(`services-contact-${width}.png`) });
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

for (const width of [390, 1280]) {
  test(`section links target the current visit after returning home at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/services');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Political intelligence. Practical campaign support.',
    );
    await page.getByRole('link', { name: 'Alethical home', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByTestId('home-services').click();
    await page.setViewportSize({ width, height: 844 });
    for (const [link, heading] of [
      ['Partners', 'Specialist support, connected to your campaign.'],
      ['Early work', 'Already helping campaigns get started.'],
      ['Services', 'From research to practical support.'],
    ]) {
      await page.getByRole('link', { name: link, exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeInViewport();
    }
    const organizations = page.getByRole('tab', { name: /^For organizations/ });
    const campaigns = page.getByRole('tab', { name: /^For individual campaigns/ });
    await organizations.press('ArrowRight');
    await expect(campaigns).toBeFocused();
    await campaigns.press('Home');
    await expect(organizations).toBeFocused();
  });
}

for (const width of [375, 1280]) {
  test(`homepage campaign services card opens the public presentation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const card = page.getByTestId('home-services');
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
  test(`shared navigation enters Services and its logo returns home at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    if (width < 1100) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    else await page.getByRole('button', { name: 'About', exact: true }).click();
    const services = page
      .locator('a[href="/services"]')
      .filter({ hasText: /^(Campaign services|Services)$/ });
    await services.click();
    await expect(page).toHaveURL(/\/services$/);
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toHaveCount(0);
    const home = page.getByRole('link', { name: 'Alethical home', exact: true });
    await expect(home).toHaveAttribute('href', '/');
    await home.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole('button', { name: width < 1100 ? 'Open menu' : 'Sign in', exact: true }),
    ).toBeVisible();
  });
}

for (const width of [320, 768, 1100]) {
  test(`standard footer fits and its links work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/services');
    const footer = page.getByRole('contentinfo');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toContainText('We hold these truths to be self-evident.');
    for (const [label, href] of [
      ['Contact Us', '/about/contact'],
      ['Privacy Policy', '/privacy'],
      ['Terms of Use', '/terms'],
    ]) {
      await expect(footer.getByRole('link', { name: label, exact: true })).toHaveAttribute(
        'href',
        href,
      );
    }
    await expect(
      footer.locator('a[href="https://www.instagram.com/alethicaltruth"]'),
    ).toBeVisible();
    await expect(footer.locator('a[href="https://www.tiktok.com/@alethicaltruth"]')).toBeVisible();
    await expect(footer.locator('a[href="https://bsky.app/profile/alethical.com"]')).toBeVisible();
    await expect(footer.locator('a[target="_blank"]')).toHaveCount(7);
    const privacy = footer.getByRole('link', { name: 'Privacy Policy', exact: true });
    await privacy.hover();
    await expect(privacy).toHaveCSS('text-decoration-line', 'underline');
    const positions = await footer.evaluate((element) => {
      const brand = [...element.querySelectorAll('div')].find((node) =>
        [...node.childNodes].some(
          (child) =>
            child.nodeType === Node.TEXT_NODE &&
            child.textContent?.startsWith('We hold these truths'),
        ),
      )!;
      const social = element.querySelector('a[target="_blank"]')!;
      return {
        brand: brand.getBoundingClientRect().toJSON(),
        social: social.getBoundingClientRect().toJSON(),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(positions.overflow).toBe(false);
    if (width < 1100) expect(positions.social.y).toBeGreaterThan(positions.brand.y);
    else expect(positions.social.x).toBeGreaterThan(positions.brand.x + positions.brand.width);
    await page.screenshot({ path: test.info().outputPath(`services-footer-${width}.png`) });
    await footer.getByRole('link', { name: 'Contact Us', exact: true }).click();
    await expect(page).toHaveURL(/\/about\/contact$/);
    await expect(page.getByRole('heading', { name: 'Contact us', exact: true })).toBeVisible();
  });
}

for (const width of [375, 900, 1280]) {
  test(`replay link keeps its visible focus and pointer feedback at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/services');
    const replay = page
      .locator('#services-events')
      .getByRole('link', { name: 'Watch The Forward Debate' });
    const label = replay.locator('div');
    await replay.scrollIntoViewIfNeeded();
    await expect(label).toHaveCSS('color', 'rgb(236, 236, 236)');
    await replay.hover();
    await expect(label).toHaveCSS(
      'color',
      width < 768 ? 'rgb(236, 236, 236)' : 'rgb(53, 196, 107)',
    );
    await page.mouse.down();
    await expect(label).toHaveCSS('color', 'rgb(90, 214, 138)');
    await page.mouse.move(1, 500);
    await page.mouse.up();
    await replay.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(replay).toBeFocused();
    await expect(replay).toHaveCSS('outline-color', 'rgb(124, 92, 255)');
    await expect(replay).toHaveCSS('outline-width', '2px');
    await page.screenshot({ path: test.info().outputPath(`services-event-focus-${width}.png`) });
  });
}
