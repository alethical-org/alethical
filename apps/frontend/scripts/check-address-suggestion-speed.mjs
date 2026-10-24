// Read-only browser checks with local suggestion fixtures and public civic inputs.
// BASE_URL=http://localhost:19049 node scripts/check-address-suggestion-speed.mjs
import assert from 'node:assert/strict';
import { chromium, webkit, expect } from '@playwright/test';
const base = process.env.BASE_URL;
if (!base) throw new Error('Set BASE_URL');
const browser = await (process.argv.includes('--webkit') ? webkit : chromium).launch();
const reports = [];
try {
  for (const width of [1280, 900, 390]) {
    for (const path of ['/candidates', '/find-my-legislator']) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      const requests = [];
      await context.route('**/*', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const json = (body) =>
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname.endsWith('/candidates/elections'))
          return json([
            { id: 'check', date: '2099-11-03', label: 'General election', type: 'general' },
          ]);
        if (
          url.pathname.endsWith('/candidates/suggest') ||
          url.pathname.endsWith('/address-suggestions')
        ) {
          const input = req.postDataJSON().address ?? req.postDataJSON().address_text;
          requests.push({ input, at: Date.now() });
          // Hold replies so edits can cancel them and late completion is exercised.
          await new Promise((resolve) => setTimeout(resolve, 250));
          const address = input.startsWith('15')
            ? '15 W Kellogg Blvd, Saint Paul, MN 55102'
            : '350 S 5th St, Minneapolis, MN 55415';
          const body =
            path === '/candidates'
              ? [{ id: address, address }]
              : {
                  data: {
                    suggestions: [
                      {
                        matched_address: address,
                        latitude: 44.97,
                        longitude: -93.26,
                        state_code: 'MN',
                      },
                    ],
                  },
                  links: null,
                };
          return json(body).catch(() => {});
        }
        if (
          url.origin === new URL(base).origin &&
          ['GET', 'HEAD'].includes(req.method()) &&
          !url.pathname.startsWith('/api/')
        )
          return route.continue();
        return route.abort();
      });
      await page.goto(`${base}${path}`);
      const field = page.getByRole('combobox', { name: 'Full street address', exact: true });
      await field.waitFor();
      // Expo initially paints the HTML shell; the real editable field proves hydration.
      await field.fill('350 S 5');
      await expect.poll(() => requests.length).toBe(1);
      // A real space key must retain the reply already underway.
      await field.press('End');
      await field.press('Space');
      await expect(page.getByRole('option')).toHaveCount(1);
      await page.waitForTimeout(200);
      assert.equal(requests.length, 1, 'surrounding space reuses the pending query');
      const first = requests.length;
      assert.equal(first, 1);
      await field.fill('350 S 5th');
      await expect.poll(() => requests.length).toBe(2);
      await expect(page.getByRole('option')).toHaveCount(1);
      const cacheStart = Date.now();
      await field.fill(' 350 S 5  ');
      await expect(page.getByRole('option')).toHaveCount(1);
      const cacheMs = Date.now() - cacheStart;
      assert.equal(requests.length, 2, 'exact input reuses its successful response');
      await field.press('Escape');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await field.press('ArrowDown');
      await expect(page.getByRole('option', { selected: true })).toHaveCount(1);
      await field.fill('15 W Ke');
      await field.fill('350 S 5');
      await expect(page.getByRole('option')).toHaveText('350 S 5th St, Minneapolis, MN 55415');
      await page.waitForTimeout(450);
      await expect(page.getByRole('option')).toHaveText('350 S 5th St, Minneapolis, MN 55415');
      await field.fill('');
      await field.fill('350 S 5');
      await expect.poll(() => requests.filter((r) => r.input === '350 S 5').length).toBe(2);
      await expect(page.getByRole('option')).toHaveCount(1);
      await page.getByRole('heading', { level: 1 }).click();
      await expect(page.getByRole('listbox')).toHaveCount(0);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'no horizontal overflow',
      );
      reports.push({ path, width, cacheMs, requestCount: requests.length, result: 'passed' });
      await context.close();
    }
  }
  console.log(JSON.stringify(reports, null, 2));
} finally {
  await browser.close();
}
