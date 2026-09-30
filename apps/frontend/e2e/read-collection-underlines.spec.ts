import { expect, test, type Locator } from '@playwright/test';

async function expectWordsOnlyUnderline(link: Locator, visibleLabel: string) {
  await expect(link).toHaveAttribute('href', /\/blog\//);
  const parts = link.locator(':scope > *');
  await expect(parts).toHaveCount(2);
  const words = parts.first();
  const arrow = parts.last();
  expect(
    await words.evaluate((element) => {
      const copy = element.cloneNode(true) as Element;
      copy.querySelectorAll('.read-sr').forEach((hidden) => hidden.remove());
      return copy.textContent;
    }),
  ).toBe(visibleLabel);
  await expect(arrow).toHaveAttribute('aria-hidden', 'true');
  await link.hover();
  await expect(words).toHaveCSS('text-decoration-line', 'underline');
  await expect(arrow).toHaveCSS('text-decoration-line', 'none');
  await expect(link).toHaveCSS('column-gap', '6px');
  expect(await arrow.evaluate((element) => element.getBoundingClientRect().width)).toBe(19);
}

async function expectReturnUnderline(link: Locator, label: string) {
  const parts = link.locator(':scope > *');
  await expect(parts).toHaveCount(2);
  const arrow = parts.first();
  const words = parts.last();
  await expect(words).toHaveText(label);
  await expect(arrow).toHaveAttribute('aria-hidden', 'true');
  await link.hover();
  await expect(words).toHaveCSS('text-decoration-line', 'underline');
  await expect(arrow).toHaveCSS('text-decoration-line', 'none');
  await expect(link).toHaveCSS('column-gap', '9px');
  expect(await arrow.evaluate((element) => element.getBoundingClientRect().width)).toBe(18);
}

test('Read collection links underline one whole label and leave the arrow bare', async ({
  page,
}) => {
  await page.goto('/blog');
  const collections = page.locator('a.read-collection-link');
  await expect(collections).toHaveCount(3);
  for (const [name, visible] of [
    ['All research reports', 'All reports'],
    ['All short posts', 'All posts'],
    ['All guides', 'All guides'],
  ]) {
    await expectWordsOnlyUnderline(page.getByRole('link', { name, exact: true }), visible);
  }

  await page.goto('/blog/guides');
  await expectWordsOnlyUnderline(
    page.getByRole('link', { name: 'Open the How the Money Works group page' }),
    'Open group page',
  );
});

test('reading return links underline the complete label but not the chevron', async ({ page }) => {
  for (const path of ['/blog/research', '/blog/short-posts', '/blog/guides']) {
    await page.goto(path);
    await expectReturnUnderline(
      page.getByRole('link', { name: 'Back to Blog', exact: true }),
      'Back to Blog',
    );
  }

  await page.goto('/blog/sets/how-the-money-works');
  await expectReturnUnderline(
    page.getByRole('link', { name: 'All guides', exact: true }),
    'All guides',
  );

  for (const path of [
    '/blog/research/the-money-only-goes-one-way',
    '/blog/guides/who-has-to-report-their-money',
    '/blog/research/lobbyist-giving',
  ]) {
    await page.goto(path);
    await expectReturnUnderline(
      page.getByRole('link', { name: 'Back to Blog', exact: true }),
      'Back to Blog',
    );
  }
});
