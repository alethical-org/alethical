import { expect, test, type Locator } from '@playwright/test';

import { suppressSiteMetrics } from './suppress-site-metrics';

// Read-only checks against real public records, not the small local seed.
test.skip(
  process.env.LINK_UNDERLINE_RUN !== '1',
  'Set LINK_UNDERLINE_RUN=1 for public-record checks',
);

async function expectCompleteLabel(link: Locator) {
  const arrows = link.getByTestId('link-arrow');
  for (const arrow of await arrows.all()) {
    const result = await arrow.evaluate((svg) => {
      const group = svg.parentElement!;
      if (getComputedStyle(group).display !== 'inline-flex') return null;
      const label = group.parentElement!;
      const groupStyle = getComputedStyle(group);
      const labelStyle = getComputedStyle(label);
      const arrowStyle = getComputedStyle(svg);
      return {
        labelDecoration: labelStyle.textDecorationLine,
        finalWordDecoration: groupStyle.textDecorationLine,
        labelDecorationColor: labelStyle.textDecorationColor,
        finalWordDecorationColor: groupStyle.textDecorationColor,
        arrowDecoration: arrowStyle.textDecorationLine,
        gap: arrowStyle.marginLeft,
        size: svg.getBoundingClientRect().width,
        alignment: groupStyle.alignItems,
        wrap: groupStyle.whiteSpace,
      };
    });
    if (!result) continue;
    expect(result.finalWordDecoration).toBe(result.labelDecoration);
    expect(result.finalWordDecorationColor).toBe(result.labelDecorationColor);
    expect(result.arrowDecoration).toBe('none');
    expect(result.gap).toBe('6px');
    expect(result.size).toBe(19);
    expect(result.alignment).toBe('center');
    expect(result.wrap).toBe('nowrap');
  }
}

for (const width of [375, 900, 1440]) {
  test(`full link underlines at ${width}px`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await suppressSiteMetrics(context);
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      '/money/committees/abeyta-joseph-a-house-committee-18468?year=2026',
      '/legislators/aaron-repinski?tab=money',
      '/money/lobbying/lobbyists/anderson-chas-3337',
      '/',
    ]) {
      await page.goto(path);
      await expect(page.locator('a:visible [data-testid="link-arrow"]').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const links = page.locator('a:visible').filter({ has: page.getByTestId('link-arrow') });
      expect(await links.count()).toBeGreaterThan(0);
      for (const link of await links.all()) {
        await page.mouse.move(0, 0);
        await expectCompleteLabel(link);
        await link.hover();
        await expectCompleteLabel(link);
      }
      if (path.includes('abeyta-')) {
        const downloads = page.getByRole('link', {
          name: 'Minnesota’s campaign-finance downloads',
        });
        await expect(downloads.locator('span')).toHaveCSS('text-decoration-line', 'underline');
        await downloads.screenshot({ path: test.info().outputPath(`downloads-${width}.png`) });
      }
    }
  });
}
