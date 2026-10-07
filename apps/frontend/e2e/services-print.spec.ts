import { expect, test, type Locator, type Page } from '@playwright/test';

import { injectPageSnapshot, renderPageSnapshot } from '../src/lib/pageSnapshot';
import { servicesPageSnapshot } from '../src/lib/servicesPageSnapshot';
import {
  SERVICES_AUDIENCES,
  SERVICES_CANDIDATE_NAMES,
  SERVICES_COALITION_URL,
  SERVICES_CONTACT_HREF,
  SERVICES_GROUPS,
  SERVICES_PARTNER_GROUPS,
  SERVICES_TOOLS,
} from '../src/lib/services';
import { suppressSiteMetrics } from './suppress-site-metrics';

test.beforeEach(async ({ context }) => {
  await suppressSiteMetrics(context);
});

async function waitForPrintAssets(page: Page, print: Locator) {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      print.locator('img').evaluateAll((images) =>
        images.every((image) => {
          const img = image as HTMLImageElement;
          return img.complete && img.naturalWidth > 0;
        }),
      ),
    )
    .toBe(true);
}

async function expectCompletePrint(print: Locator) {
  await expect(print).toBeVisible();
  for (const heading of await print.locator('h1, h2, h3').all()) {
    await expect(heading).toHaveCSS('color', 'rgb(17, 21, 15)');
  }
  await expect(print.locator('.services-print-sheet')).toHaveCount(4);
  for (const audience of SERVICES_AUDIENCES) {
    await expect(print).toContainText(audience.title);
    await expect(print).toContainText(audience.text);
    for (const example of audience.examples) await expect(print).toContainText(example);
  }
  for (const group of SERVICES_GROUPS) {
    await expect(print).toContainText(
      group.title === 'Websites and campaign tools' ? 'Websites and tools' : group.title,
    );
    await expect(print).toContainText(group.line);
    for (const example of group.examples) await expect(print).toContainText(example);
  }
  for (const tool of SERVICES_TOOLS) {
    await expect(print).toContainText(tool.title);
    await expect(print).toContainText(tool.text);
  }
  for (const group of SERVICES_PARTNER_GROUPS) {
    await expect(print).toContainText(group.name);
    for (const item of group.items) await expect(print).toContainText(item);
  }
  for (const name of SERVICES_CANDIDATE_NAMES) await expect(print).toContainText(name);
  await expect(
    print.getByRole('link', { name: 'angel@alethical.com', exact: true }),
  ).toHaveAttribute('href', SERVICES_CONTACT_HREF);
  const coalitionLinks = print.locator(`a[href="${SERVICES_COALITION_URL}"]`);
  await expect(coalitionLinks).toHaveCount(2);
  await expect(coalitionLinks.locator('img')).toHaveCount(1);
  await expect(print.locator('button, [role="tab"], [role="dialog"], nav')).toHaveCount(0);
  await expect(print).not.toContainText('PRIVATE DESIGN PREVIEW');
  await expect(print).not.toContainText('Open email draft');
}

async function expectUnclippedSheets(print: Locator) {
  const layout = await print.locator('.services-print-sheet').evaluateAll((sheets) =>
    sheets.map((sheet) => {
      const bounds = sheet.getBoundingClientRect();
      const content = sheet.querySelector('.services-print-content')!;
      const folio = sheet.querySelector('.services-print-folio')!;
      const contentBounds = content.getBoundingClientRect();
      const folioBounds = folio.getBoundingClientRect();
      const overflow = Array.from(content.querySelectorAll('h1, h2, h3, p, li, img, a')).filter(
        (element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.left < bounds.left - 1 ||
            rect.right > bounds.right + 1 ||
            rect.top < bounds.top - 1 ||
            rect.bottom > folioBounds.top + 1
          );
        },
      );
      return {
        width: bounds.width,
        background: getComputedStyle(sheet).backgroundColor,
        contentBottom: contentBounds.bottom,
        folioTop: folioBounds.top,
        folioBottom: folioBounds.bottom,
        sheetBottom: bounds.bottom,
        folioDigits: getComputedStyle(folio).fontVariantNumeric,
        overflow: overflow.map((element) => element.textContent || element.tagName),
      };
    }),
  );
  for (const sheet of layout) {
    // Safari auto-width printing enlarges text and spills footers. Keep the
    // approved physical Letter width even when the browser window is narrow.
    expect(sheet.width).toBeCloseTo(816, 0);
    expect(sheet.background).toBe('rgb(255, 255, 255)');
    expect(sheet.overflow).toEqual([]);
    expect(sheet.contentBottom).toBeLessThanOrEqual(sheet.folioTop - 8);
    expect(sheet.folioBottom).toBeLessThanOrEqual(sheet.sheetBottom);
    expect(sheet.folioDigits).toContain('tabular-nums');
  }
}

test('printing includes both audiences, hides an open contact panel, and restores screen choices', async ({
  page,
}) => {
  await page.goto('/services');
  const print = page.locator('.services-print');
  await expect(print).toHaveCount(1);
  await expect(print).toBeHidden();
  const campaigns = page.getByRole('tab', { name: /^For individual campaigns/ });
  await campaigns.click();
  await expect(page.getByRole('tabpanel')).not.toContainText('Shared research');
  await page.getByRole('button', { name: 'Contact Us', exact: true }).click();
  const dialog = page.locator('#services-contact-panel');
  await expect(dialog).toBeVisible();

  await page.emulateMedia({ media: 'print' });
  await waitForPrintAssets(page, print);
  await expectCompletePrint(print);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('banner')).toBeHidden();

  await page.emulateMedia({ media: 'screen' });
  await expect(print).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(campaigns).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('A campaign website');
  await expect(page.getByRole('banner')).toBeVisible();
});

test('print content belongs to the current services visit and disappears when leaving services', async ({
  page,
}) => {
  await page.goto('/services');
  await expect(page.locator('.services-print')).toHaveCount(1);
  await page.getByRole('link', { name: 'Alethical home', exact: true }).click();
  await expect(page.locator('.services-print')).toHaveCount(0);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('link', { name: /^Campaign services Get political/ })).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('link', { name: /^Campaign services Get political/ }).click();
  await expect(page.locator('.services-print')).toHaveCount(1);
  await page.emulateMedia({ media: 'print' });
  await expectCompletePrint(page.locator('.services-print'));
});

for (const paper of [
  { name: 'Letter', width: 816, height: 1056 },
  { name: 'A4', width: 794, height: 1123 },
] as const) {
  test(`browser printing produces 4 complete portrait ${paper.name} sheets`, async ({
    page,
    browserName,
  }, testInfo) => {
    // Playwright exposes actual browser PDF generation in Chromium only.
    test.skip(browserName !== 'chromium');
    await page.setViewportSize({ width: paper.width, height: paper.height });
    await page.goto('/services');
    await page.emulateMedia({ media: 'print' });
    const print = page.locator('.services-print');
    await waitForPrintAssets(page, print);
    await expectCompletePrint(print);
    await expectUnclippedSheets(print);
    // Export from a normal screen size: paper layout must not depend on the viewport.
    await page.setViewportSize({ width: 375, height: 667 });
    const pdfPath = testInfo.outputPath(`services-${paper.name}.pdf`);
    const pdf = await page.pdf({
      path: pdfPath,
      format: paper.name,
      landscape: false,
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: true,
    });
    // Chromium writes each page dictionary as an uncompressed PDF object.
    // The word boundary excludes the parent /Pages tree from this count.
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(4);
    await testInfo.attach(`services-${paper.name}`, {
      path: pdfPath,
      contentType: 'application/pdf',
    });
  });
}

test('the first response also prints all services when JavaScript is unavailable', async ({
  browser,
  browserName,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    await suppressSiteMetrics(context);
    // Static CI serves the real generated first response without running the API.
    // Local/live acceptance omits this fixture and tests the server's own response.
    if (process.env.E2E_STATIC_BUILD === '1') {
      await context.route('**/services', async (route) => {
        const response = await route.fetch();
        const body = injectPageSnapshot(
          await response.text(),
          renderPageSnapshot(servicesPageSnapshot()),
        );
        await route.fulfill({ response, body });
      });
    }
    const page = await context.newPage();
    await page.goto('/services');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Political intelligence. Practical campaign support.',
    );
    await page.emulateMedia({ media: 'print' });
    const print = page.locator('.services-print');
    await waitForPrintAssets(page, print);
    await expectCompletePrint(print);
    if (browserName === 'chromium') {
      const pdfPath = testInfo.outputPath('services-no-javascript.pdf');
      const pdf = await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true });
      expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(4);
      await testInfo.attach('services-no-javascript', {
        path: pdfPath,
        contentType: 'application/pdf',
      });
    }
  } finally {
    await context.close();
  }
});
