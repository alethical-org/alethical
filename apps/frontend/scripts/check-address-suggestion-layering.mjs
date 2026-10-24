// Rendered stacking and input checks using local fixtures; no real lookup records.
// BASE_URL=http://localhost:19051 node scripts/check-address-suggestion-layering.mjs [--webkit]
import assert from 'node:assert/strict';
import { chromium, webkit, expect } from '@playwright/test';
const base = process.env.BASE_URL;
if (!base) throw new Error('Set BASE_URL');
const browser = await (process.argv.includes('--webkit') ? webkit : chromium).launch();
const reports = [];
const addresses = Array.from(
  { length: 5 },
  (_, i) => `${350 + i} S 5th Street, Minneapolis, MN 55415`,
);
try {
  for (const width of [1280, 900, 390]) {
    for (const path of ['/candidates', '/find-my-legislator']) {
      const context = await browser.newContext({
        viewport: { width, height: 1100 },
        hasTouch: width < 768,
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      const submitted = [];
      await context.route('**/*', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const json = (body) =>
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname.endsWith('/candidates/elections'))
          return json([
            { id: 'check', date: '2099-11-03', label: 'General election', type: 'general' },
            { id: 'primary', date: '2099-08-03', label: 'State primary', type: 'primary' },
          ]);
        if (url.pathname.endsWith('/candidates/suggest'))
          return json(addresses.map((address) => ({ id: address, label: address, address })));
        if (url.pathname.endsWith('/address-suggestions'))
          return json({
            data: {
              suggestions: addresses.map((address) => ({
                matched_address: address,
                latitude: 44.97,
                longitude: -93.26,
                state_code: 'MN',
              })),
            },
            links: null,
          });
        if (url.pathname.endsWith('/candidates/lookup')) {
          submitted.push(req.postDataJSON().address);
          if (submitted.at(-1) === addresses[4]) return json({ kind: 'no-match' });
          return json({
            kind: 'results',
            electionId: req.postDataJSON().electionId,
            matchedAddress: submitted.at(-1),
            races: [],
            coverage: [],
          });
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
      async function openAndHitTest() {
        await field.fill('350 S 5');
        await expect(page.getByRole('option')).toHaveCount(5);
        await page.getByRole('option').last().scrollIntoViewIfNeeded();
        const hits = await page.getByRole('option').evaluateAll((rows) =>
          rows.map((row) => {
            const r = row.getBoundingClientRect();
            return [0.15, 0.5, 0.85].every((y) =>
              [0.15, 0.5, 0.85].every((x) =>
                row.contains(document.elementFromPoint(r.left + r.width * x, r.top + r.height * y)),
              ),
            );
          }),
        );
        assert.ok(
          hits.every(Boolean),
          `${path} ${width}: every address must receive input across its full row: ${hits}`,
        );
        await field.press('Escape');
        await expect(page.getByRole('listbox')).toHaveCount(0);
        await field.press('ArrowDown');
        await expect(page.getByRole('option', { selected: true })).toHaveCount(1);
      }
      await openAndHitTest();
      if (path === '/candidates') {
        await field.press('Enter');
        await expect(
          page.getByRole('button', { name: 'Change address', exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Change address', exact: true }).click();
        await openAndHitTest();
        const panel = await page.getByRole('listbox').boundingBox();
        const election = await page.getByRole('combobox', { name: /Election/ }).boundingBox();
        if (width < 768)
          assert.ok(panel.y + panel.height <= election.y, 'phone list pushes election below it');
        else
          assert.ok(
            panel.y + panel.height > election.y,
            'test exercises actual overlap with election',
          );
        if (width < 768) await page.getByRole('option').nth(3).tap();
        else await page.getByRole('option').nth(3).click();
        await expect(
          page.getByRole('button', { name: 'Change address', exact: true }),
        ).toBeVisible();
        assert.equal(submitted.at(-1), addresses[3]);
        const electionControl = page.getByRole('combobox', { name: /Election/ });
        await electionControl.click();
        await expect(page.getByRole('listbox', { name: 'Election' })).toBeVisible();
        await electionControl.press('Escape');
        await expect(page.getByRole('listbox', { name: 'Election' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Change address', exact: true }).click();
        await openAndHitTest();
        await page.getByRole('option').last().click();
        await expect(
          page.getByText('We couldn’t match that address to election records', { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(`Showing results for ${addresses[3]}`, { exact: true }),
        ).toBeVisible();
      } else {
        await page.getByRole('heading', { level: 1 }).click();
        await expect(page.getByRole('listbox')).toHaveCount(0);
      }
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'no horizontal overflow',
      );
      reports.push({ path, width, result: 'passed' });
      await context.close();
    }
  }
  console.log(JSON.stringify(reports, null, 2));
} finally {
  await browser.close();
}
