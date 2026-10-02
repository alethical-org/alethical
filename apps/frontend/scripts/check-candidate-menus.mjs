// Browser regression for candidate header stacking and complete menu journeys.
// Uses public civic addresses and intercepted records; every other write is blocked.
// BASE_URL=http://localhost:19067 node scripts/check-candidate-menus.mjs [--webkit]
import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';

const base = process.env.BASE_URL;
if (!base) throw new Error('Set BASE_URL to the running frontend');
const browser = await (process.argv.includes('--webkit') ? webkit : chromium).launch();
const candidateId = 'a'.repeat(64);
const election = {
  id: 'menu-check',
  label: 'General election',
  date: '2099-11-03',
  type: 'general',
};
const candidate = { id: candidateId, name: 'Illustrative Menu Candidate', sortName: 'Candidate' };
const source = {
  authority: 'Browser fixture',
  url: 'https://example.org',
  checkedDate: '2026-10-02',
};
const record = {
  candidate,
  election,
  office: 'State Representative',
  votingArea: 'House District 1A',
  source,
};
const results = {
  kind: 'results',
  electionId: election.id,
  matchedAddress: '350 S 5th St, Minneapolis, MN 55415',
  races: [
    {
      id: 'race',
      group: 'state',
      office: record.office,
      votingArea: record.votingArea,
      seatCount: 1,
      source,
      entries: [{ kind: 'candidate', candidate }],
    },
  ],
  coverage: [],
};
async function fresh(width = 1440, touch = false) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    hasTouch: touch,
    serviceWorkers: 'block',
  });
  await context.route('**/*', (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const json = (body) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.isNavigationRequest()) return route.continue();
    if (path.endsWith('/candidates/elections'))
      return json([
        election,
        { ...election, id: 'second', label: 'Special election', date: '2099-12-01' },
      ]);
    if (path.endsWith('/candidates/suggest')) return json([]);
    if (path.endsWith('/candidates/lookup'))
      return json({ ...results, electionId: request.postDataJSON().electionId });
    if (path.endsWith(`/candidates/${candidateId}`)) return json(record);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
      return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  return { context, page };
}
async function arrive(page, surface) {
  await page.goto(
    `${base}${surface === 'profile' ? `/candidates/${candidateId}` : surface === 'home' ? '/' : '/candidates'}`,
    { waitUntil: 'domcontentloaded' },
  );
  if (surface === 'results') {
    await page
      .getByRole('combobox', { name: 'Full street address', exact: true })
      .fill(results.matchedAddress);
    await page.getByRole('button', { name: 'Find my candidates', exact: true }).click();
    await page.getByText(candidate.name, { exact: true }).waitFor();
  }
  await page.evaluate(() => document.fonts.ready);
}
async function travel(page, trigger, from, to) {
  for (let i = 0; i <= 30; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 30, from.y + ((to.y - from.y) * i) / 30);
    await page.waitForTimeout(50);
    assert.equal(
      await trigger.getAttribute('aria-expanded'),
      'true',
      'Menu closed during continuous pointer travel',
    );
  }
}
try {
  for (const surface of ['home', 'empty', 'results', 'profile']) {
    for (const [name, lastRow] of [
      ['Search', 'Find my legislators'],
      ['About', 'Contact us'],
    ]) {
      const { context, page } = await fresh();
      try {
        await arrive(page, surface);
        const trigger = page.getByRole('button', { name, exact: true });
        await trigger.hover();
        const row = page.getByRole('link', { name: new RegExp(`^${lastRow}`) }).first();
        await row.waitFor();
        const a = await trigger.boundingBox(),
          b = await row.boundingBox();
        const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
        const left = { x: b.x + 8, y: b.y + b.height / 2 },
          right = { x: b.x + b.width - 8, y: left.y };
        await travel(page, trigger, start, left);
        await travel(page, trigger, left, right);
        assert.ok(
          await row.evaluate((node) => {
            const r = node.getBoundingClientRect();
            return [8, r.width / 2, r.width - 8].every((x) =>
              node.contains(document.elementFromPoint(r.x + x, r.y + r.height / 2)),
            );
          }),
          'Page content blocks the menu row',
        );
        await travel(page, trigger, right, start);
        await page.mouse.move(5, 800);
        await page.waitForTimeout(200);
        await trigger.focus();
        await trigger.press('Enter');
        await row.waitFor();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'A');
        await page.keyboard.press('Escape');
        assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        await trigger.press('Enter');
        const destination = new URL(await row.getAttribute('href'), base).pathname;
        await row.focus();
        await row.press('Enter');
        await page.waitForFunction((path) => location.pathname === path, destination);
        console.log(
          `PASS ${surface}: ${name} pointer path, row hit area, keyboard selection and Escape`,
        );
      } finally {
        await context.close();
      }
    }
  }
  for (const width of [820, 390, 320]) {
    const { context, page } = await fresh(width, true);
    try {
      await arrive(page, 'results');
      const picker = page.getByRole('combobox');
      await picker.tap();
      const menu = page.getByRole('listbox');
      await menu.waitFor();
      const r = await menu.boundingBox();
      assert.ok(r.x >= 0 && r.x + r.width <= width, 'Election choices leave the screen');
      await page.getByRole('option', { name: /Special election/ }).tap();
      await menu.waitFor({ state: 'hidden' });
      assert.match(await picker.textContent(), /Special election/);
      await picker.tap();
      await page.getByRole('heading', { name: 'Find my candidates', exact: true }).tap();
      await menu.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Open menu', exact: true }).tap();
      // The phone drawer is portalled after the underlying footer link.
      const contact = page.getByRole('link', { name: 'Contact us', exact: true }).last();
      await contact.waitFor();
      await page.waitForTimeout(300);
      const backdropExposed = await page.evaluate(
        () => document.elementFromPoint(5, 450)?.getAttribute('aria-label') === 'Close menu',
      );
      if (backdropExposed) await page.touchscreen.tap(5, 450);
      else await page.getByRole('button', { name: 'Close menu', exact: true }).last().tap();
      await page.getByRole('button', { name: 'Open menu', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Open menu', exact: true }).tap();
      await page.waitForTimeout(300);
      await contact.tap();
      await page.waitForFunction(() => location.pathname === '/about/contact');
      console.log(
        `PASS ${width}px touch: election choice, outside dismissal, header menu selection`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
