/**
 * Focused browser regression for /candidates Use my location and the Find buttons.
 * Every API reply and every device location below is a fixture, never a real reader;
 * requests to any API origin are answered here, so a local dev server or the CI
 * static build both work.
 *   node scripts/check-candidate-location.mjs http://localhost:19071 [screenshot dir] [--chromium]
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, webkit } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:19071';
const shots =
  process.argv[3] && !process.argv[3].startsWith('--')
    ? process.argv[3]
    : '/tmp/candidate-location-check';
const engines = process.argv.includes('--chromium') ? [chromium] : [chromium, webkit];
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use the local preview');
mkdirSync(shots, { recursive: true });
// Any origin: the built site may name its API differently from the dev server.
const isApi = (url) => new URL(url).pathname.includes('/api/v1/');
// Nothing else leaves the machine: unrelated outside requests get HTTP 503.
const blockOutside = (page) =>
  page.route(
    (url) => url.origin !== new URL(base).origin && !isApi(url),
    (route) => route.fulfill({ status: 503, body: '' }),
  );
const SUGGESTED = '917 North 7th Avenue East, DULUTH, MN 55805';
const LONG =
  '29308 Countryside Northwest Lakeshore Boulevard Extension North Apt 1204, Sample Lake Township, MN 55999';
const elections = [
  {
    id: '8334',
    canonicalKey: 'mn-2026-11-03-general',
    label: 'November 3, 2026 general election',
    date: '2026-11-03',
    type: 'general',
    sourceIds: { myballot: '8334', sosResults: '201' },
    capabilities: { addressLookup: 'current-ballot', results: false, historicalRecords: false },
    officialResultsUrl: 'https://electionresults.sos.mn.gov/Results/Index?ersElectionId=201',
  },
];
const results = (address) => ({
  kind: 'results',
  electionId: '8334',
  matchedAddress: address.toUpperCase(),
  races: [
    {
      id: 'race-1',
      group: 'state',
      office: 'State Representative District 7A',
      votingArea: 'House District 7A',
      entries: [
        {
          kind: 'candidate',
          candidate: { id: 'a'.repeat(64), name: 'Sample Person', sortName: 'Sample' },
        },
      ],
      source: {
        authority: 'Minnesota Secretary of State',
        url: 'https://myballotmn.sos.mn.gov/',
        checkedDate: '2026-10-09',
      },
    },
  ],
  coverage: [],
});

async function open(
  browser,
  width,
  {
    location,
    locate = { kind: 'address', address: SUGGESTED },
    lookupDelay = 0,
    suggestions = [],
  } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    hasTouch: width === 390,
    ...(location ? { geolocation: location, permissions: ['geolocation'] } : {}),
  });
  const page = await context.newPage();
  await blockOutside(page);
  const seen = { lookups: [], locates: [] };
  await page.route(isApi, async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON?.() ?? null;
    const reply = (json, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(json),
        headers: { 'access-control-allow-origin': '*' },
      });
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    if (url.pathname.endsWith('/candidates/elections')) return reply(elections);
    if (url.pathname.endsWith('/candidates/suggest')) return reply(suggestions);
    if (url.pathname.endsWith('/candidates/locate')) {
      seen.locates.push(body);
      assert(!url.search.includes('latitude'), 'A reading never travels in the address');
      if (locate === 'error') return reply({ title: 'unavailable' }, 503);
      return reply(locate);
    }
    if (url.pathname.endsWith('/candidates/lookup')) {
      seen.lookups.push(body);
      if (lookupDelay) await new Promise((yes) => setTimeout(yes, lookupDelay));
      return reply(results(body.address));
    }
    return reply({ title: 'not found' }, 404);
  });
  await page.goto(`${base}/candidates`);
  await page.getByLabel('Full street address', { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { page, context, seen };
}
const box = (locator) =>
  locator.evaluate((node) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      width: Math.round(width * 10) / 10,
      height: Math.round(height * 10) / 10,
    };
  });
// The visible icon and its word: the gap between them and their centre in the button.
const groupOf = (button) =>
  button.evaluate((node) => {
    const visible = (element) => !element.closest('[aria-hidden="true"]') || element.closest('svg');
    const svg = [...node.querySelectorAll('svg')].find((s) => {
      const layer = s.parentElement?.closest('[aria-hidden="true"]');
      return !layer || getComputedStyle(layer).opacity !== '0' || layer.contains(s) === false;
    });
    const hiddenLayers = [...node.querySelectorAll('[aria-hidden="true"]')].filter(
      (l) => getComputedStyle(l).opacity === '0',
    );
    const svgs = [...node.querySelectorAll('svg')].filter(
      (s) => !hiddenLayers.some((l) => l.contains(s)),
    );
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const words = [];
    let text;
    while ((text = walker.nextNode())) {
      if (hiddenLayers.some((l) => l.contains(text)) || !text.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      const rects = [...range.getClientRects()];
      words.push({
        text: text.textContent,
        left: Math.min(...rects.map((r) => r.left)),
        right: Math.max(...rects.map((r) => r.right)),
        top: rects[0].top,
      });
    }
    const icon = (svgs[0] ?? svg).getBoundingClientRect();
    const b = node.getBoundingClientRect();
    const left = icon.left;
    const right = Math.max(...words.map((w) => w.right));
    return {
      gap: Math.round((words[0].left - icon.right) * 10) / 10,
      offset: Math.round(((left + right) / 2 - (b.left + b.width / 2)) * 10) / 10,
      word: words.map((w) => w.text).join(''),
      void: visible,
    };
  });
const noHorizontalScroll = (page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

const report = [];
for (const engine of engines) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const width of [1280, 900, 390]) {
      const tag = `${engine.name()}-${width}`;
      // Entry layout and Find sizing.
      let { page, context } = await open(browser, width);
      const field = page.getByLabel('Full street address', { exact: true });
      const find = page.getByRole('button', { name: 'Find', exact: true });
      const locate = page.getByRole('button', { name: 'Use my location', exact: true });
      const findBox = await box(find);
      const locateBox = await box(locate);
      const fieldBox = await box(field);
      assert.equal(findBox.height, 60, `${tag} Find height`);
      assert.equal(locateBox.height, 60, `${tag} location height`);
      const column = await page
        .locator('h1')
        .evaluate((h) => h.parentElement.parentElement.getBoundingClientRect().width);
      assert(column <= 840.5, `${tag} entry column ${column}`);
      if (width === 390) {
        assert.equal(findBox.width, fieldBox.width, `${tag} phone Find full width`);
        assert.equal(locateBox.width, fieldBox.width, `${tag} phone location full width`);
        assert(locateBox.y > findBox.y && findBox.y > fieldBox.y, `${tag} phone stack`);
      } else {
        assert.equal(findBox.width, 150, `${tag} Find width`);
        assert.equal(locateBox.width, 200, `${tag} location width`);
        assert.equal(findBox.y, fieldBox.y, `${tag} 1 row`);
        assert.equal(locateBox.y, fieldBox.y, `${tag} 1 row`);
      }
      const ready = await groupOf(find);
      assert(Math.abs(ready.gap - 9) <= 0.6, `${tag} entry icon gap`);
      assert(Math.abs(ready.offset + 3) <= 1, `${tag} entry nudge ${ready.offset}`);
      const describedBy = (await field.getAttribute('aria-describedby')).split(' ');
      const help = page.locator(`[id="${describedBy[1]}"]`);
      assert.equal(
        await help.textContent(),
        'A city or ZIP code alone cannot identify your local races',
      );
      const helpBox = await box(help);
      const source = page.getByText(
        'Address lookup uses Minnesota’s Secretary of State and mapping services',
        { exact: true },
      );
      const sourceBox = await box(source);
      assert(helpBox.y < sourceBox.y && helpBox.y > findBox.y + 60, `${tag} help below divider`);
      const divider = await help.evaluate((node) => node.parentElement.getBoundingClientRect().top);
      const slotBottom = await page
        .locator(`[id="${describedBy[0]}"]`)
        .evaluate((node) => node.getBoundingClientRect().bottom);
      assert.equal(
        Math.round(divider - slotBottom),
        width === 390 ? 36 : 56,
        `${tag} message to divider`,
      );
      const outline = page.locator('img[aria-hidden="true"], [aria-hidden="true"] img').last();
      const outlineBox = await page.evaluate(() => {
        const node = [...document.querySelectorAll('img')].pop();
        const r = (node.closest('[aria-hidden="true"]') ?? node).getBoundingClientRect();
        return { width: r.width, height: r.height, x: r.x, y: r.y };
      });
      assert.equal(outlineBox.width, width === 390 ? 160 : 200, `${tag} outline width`);
      assert(
        Math.abs(
          outlineBox.x +
            outlineBox.width / 2 -
            (fieldBox.x + (width === 390 ? fieldBox.width : column) / 2),
        ) < 2,
        `${tag} outline centred`,
      );
      assert.equal(
        Math.round(outlineBox.y - (sourceBox.y + sourceBox.height)),
        40,
        `${tag} outline 40px below source`,
      );
      assert(await noHorizontalScroll(page), `${tag} no sideways scroll`);
      void outline;
      const padding = await field.evaluate((node) => getComputedStyle(node).paddingRight);
      assert.equal(padding, '18px', `${tag} empty right padding`);
      await field.fill('917 N 7th Ave E');
      assert.equal(await field.evaluate((node) => getComputedStyle(node).paddingRight), '60px');
      await page.screenshot({ path: `${shots}/${tag}-entry.png`, fullPage: true });
      await context.close();

      // Suggestions cover the help and source lines on computer and tablet, and every
      // row, including the last, takes the click; phones keep the list in the page.
      ({ page, context } = await open(browser, width, {
        suggestions: [1, 2, 3, 4, 5].map((n) => ({
          id: `s${n}`,
          label: `91${n} North 7th Avenue East, DULUTH, MN 55805`,
          address: `91${n} North 7th Avenue East, DULUTH, MN 55805`,
        })),
      }));
      const suggestField = page.getByLabel('Full street address', { exact: true });
      await suggestField.click();
      await suggestField.pressSequentially('917 North 7', { delay: 20 });
      const rows = page.locator('[data-address-option]');
      await rows.nth(4).waitFor();
      const last = await box(rows.nth(4));
      const helpLine = page.getByText('A city or ZIP code alone cannot identify your local races', {
        exact: true,
      });
      const helpLineBox = await box(helpLine);
      if (width !== 390)
        assert(last.y + last.height > helpLineBox.y, `${tag} list overlays the lines`);
      else assert(helpLineBox.y > last.y + last.height, `${tag} phone list pushes content`);
      for (const x of [last.x + 12, last.x + last.width / 2, last.x + last.width - 12]) {
        for (const index of [3, 4]) {
          const row = await box(rows.nth(index));
          const hit = await page.evaluate(
            ({ x, y }) =>
              document.elementFromPoint(x, y)?.closest('[data-address-option]')?.textContent ??
              null,
            { x, y: row.y + row.height / 2 },
          );
          assert.equal(
            hit,
            `91${index + 1} North 7th Avenue East, DULUTH, MN 55805`,
            `${tag} row ${index + 1} covers content at x ${x}`,
          );
        }
      }
      await page.screenshot({ path: `${shots}/${tag}-suggestions.png` });
      await page.mouse.click(last.x + last.width / 2, last.y + last.height / 2);
      await page.getByRole('button', { name: 'Change address', exact: true }).first().waitFor();
      await context.close();

      // Busy boxes stay put: entry Find and Use my location.
      ({ page, context } = await open(browser, width, {
        location: { latitude: 46.79, longitude: -92.09, accuracy: 6 },
        lookupDelay: 1200,
        locate: { kind: 'imprecise' },
      }));
      const entryFind = page.getByRole('button', { name: 'Find', exact: true });
      const entryReady = await box(entryFind);
      const locationReady = await box(
        page.getByRole('button', { name: 'Use my location', exact: true }),
      );
      await page.keyboard.press('Tab');
      for (
        let i = 0;
        i < 30 && !(await entryFind.evaluate((n) => n === document.activeElement));
        i += 1
      )
        await page.keyboard.press('Tab');
      const ring = await entryFind.evaluate((n) => {
        const style = getComputedStyle(n);
        return `${style.outlineStyle} ${style.outlineWidth} ${style.boxShadow}`;
      });
      assert(!/^none 0px none$/.test(ring), `${tag} keyboard focus visible on Find: ${ring}`);
      await page.screenshot({ path: `${shots}/${tag}-find-focus.png` });
      await page
        .getByLabel('Full street address', { exact: true })
        .fill('917 N 7th Ave E, Duluth, MN 55805');
      const entryFilled = await box(entryFind);
      await entryFind.click();
      const entryBusy = page.getByRole('button', { name: 'Finding…', exact: true });
      await entryBusy.waitFor();
      assert.deepEqual(await box(entryBusy), entryFilled, `${tag} entry busy box steady`);
      assert.equal(entryReady.height, 60);
      const entryBusyGroup = await groupOf(entryBusy);
      assert(
        Math.abs(entryBusyGroup.offset + 3) <= 1,
        `${tag} entry busy nudge ${entryBusyGroup.offset}`,
      );
      await page.getByRole('button', { name: 'Change address', exact: true }).first().waitFor();
      await context.close();
      ({ page, context } = await open(browser, width, {
        location: { latitude: 46.79, longitude: -92.09, accuracy: 6 },
      }));
      await page.route(
        (url) => url.pathname.endsWith('/api/v1/candidates/locate'),
        async (route) => {
          await new Promise((yes) => setTimeout(yes, 1500));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ kind: 'imprecise' }),
            headers: { 'access-control-allow-origin': '*' },
          });
        },
      );
      await page.getByRole('button', { name: 'Use my location', exact: true }).click();
      const locatingButton = page.getByRole('button', { name: 'Locating…', exact: true });
      await locatingButton.waitFor();
      assert.deepEqual(await box(locatingButton), locationReady, `${tag} locating box steady`);
      assert.equal(await locatingButton.getAttribute('aria-disabled'), 'true');
      await page.screenshot({ path: `${shots}/${tag}-locating.png` });
      await context.close();

      // Location blocked: no permission granted, so the browser denies.
      ({ page, context } = await open(browser, width));
      await page.getByLabel('Full street address', { exact: true }).fill('4821 Sample');
      await page.getByRole('button', { name: 'Use my location', exact: true }).click();
      await page.getByText('Location access is blocked: enter your street address').waitFor();
      const blockedField = page.getByLabel('Full street address', { exact: true });
      assert.equal(await blockedField.inputValue(), '4821 Sample');
      assert.equal(await blockedField.getAttribute('aria-invalid'), null);
      assert.equal(await blockedField.evaluate((node) => node === document.activeElement), true);
      await page.screenshot({ path: `${shots}/${tag}-blocked.png` });
      await context.close();

      for (const [name, locateReply, message] of [
        [
          'imprecise',
          { kind: 'imprecise' },
          'Your location isn’t precise enough: enter your street address',
        ],
        [
          'unavailable',
          'error',
          'Your location isn’t available right now: enter your street address',
        ],
      ]) {
        ({ page, context } = await open(browser, width, {
          location: { latitude: 46.79, longitude: -92.09, accuracy: 30 },
          locate: locateReply,
        }));
        await page.getByRole('button', { name: 'Use my location', exact: true }).click();
        await page.getByText(message).waitFor();
        await page.screenshot({ path: `${shots}/${tag}-${name}.png` });
        await context.close();
      }

      // Confirmation: focus, Enter, unit, busy steadiness, results.
      let seen;
      ({ page, context, seen } = await open(browser, width, {
        location: { latitude: 46.7952, longitude: -92.0906, accuracy: 6 },
        lookupDelay: 900,
      }));
      await page.getByLabel('Full street address', { exact: true }).fill('77 Earlier St');
      await page.getByRole('button', { name: 'Use my location', exact: true }).click();
      const heading = page.getByRole('heading', { name: 'Is this your home address?' });
      await heading.waitFor();
      assert.equal(
        await heading.evaluate((node) => node === document.activeElement),
        true,
        `${tag} heading focus`,
      );
      assert.deepEqual(seen.locates[0], { latitude: 46.7952, longitude: -92.0906, accuracy: 6 });
      await page.screenshot({ path: `${shots}/${tag}-confirm.png`, fullPage: true });
      const street = page.getByLabel('Street address', { exact: true });
      assert.equal(await street.inputValue(), SUGGESTED);
      const homeButton = page.getByRole('button', { name: 'This is my home address', exact: true });
      const homeBox = await box(homeButton);
      if (width === 390) assert.equal(homeBox.width, (await box(street)).width);
      else assert.equal(homeBox.width, 272);
      const unit = page.locator('input[placeholder="Apt 3"]');
      assert.equal((await box(unit)).width, width === 390 ? (await box(street)).width : 240);
      await page.getByRole('button', { name: 'Enter a different address', exact: true }).click();
      const restored = page.getByLabel('Full street address', { exact: true });
      assert.equal(await restored.inputValue(), '77 Earlier St');
      assert.equal(await restored.evaluate((node) => node === document.activeElement), true);
      await page.getByRole('button', { name: 'Use my location', exact: true }).click();
      await heading.waitFor();
      await unit.fill('3');
      await unit.press('Enter');
      const busy = page.getByRole('button', { name: 'Finding…', exact: true });
      await busy.waitFor();
      const busyBox = await box(busy);
      assert.deepEqual(busyBox, homeBox, `${tag} confirm busy box steady`);
      await page.screenshot({ path: `${shots}/${tag}-confirm-busy.png` });
      await page.getByRole('button', { name: 'Change address', exact: true }).first().waitFor();
      assert.equal(seen.lookups.length, 1, `${tag} 1 submission`);
      assert.equal(seen.lookups[0].address, '917 North 7th Avenue East #3, DULUTH, MN 55805');
      assert.equal(new URL(page.url()).pathname, '/candidates');
      assert(!page.url().includes('917'), 'No address in the page address');

      // Change address: 1 group, 9px gap, steady box, 1-line and 3-line addresses.
      for (const address of ['917 N 7th Ave E, Duluth, MN 55805', LONG]) {
        await page.getByRole('button', { name: 'Change address', exact: true }).first().click();
        const editField = page.getByLabel('Full street address', { exact: true });
        await editField.fill(address);
        const lines = await editField.evaluate((node) => Math.round((node.clientHeight - 30) / 24));
        const compact = page.getByRole('button', { name: 'Find', exact: true });
        const compactBox = await box(compact);
        assert.equal(compactBox.height, 52, `${tag} compact height`);
        const compactReady = await groupOf(compact);
        assert(
          Math.abs(compactReady.gap - 9) <= 0.6,
          `${tag} compact ready gap ${compactReady.gap}`,
        );
        assert(
          Math.abs(compactReady.offset + 3) <= 1,
          `${tag} compact nudge ${compactReady.offset}`,
        );
        const clear = page.getByRole('button', { name: 'Clear address', exact: true });
        const clearBox = await box(clear);
        const fieldTop = (await box(editField)).y;
        assert(Math.abs(clearBox.y - fieldTop - 6) <= 1, `${tag} clear level with first line`);
        await page.screenshot({ path: `${shots}/${tag}-change-${lines}-line-ready.png` });
        await compact.click();
        const compactBusy = page.getByRole('button', { name: 'Finding…', exact: true });
        await compactBusy.waitFor();
        assert.deepEqual(await box(compactBusy), compactBox, `${tag} compact busy box steady`);
        const compactBusyGroup = await groupOf(compactBusy);
        assert(Math.abs(compactBusyGroup.gap - 9) <= 0.6, `${tag} compact busy gap`);
        assert(
          Math.abs(compactBusyGroup.offset + 3) <= 1,
          `${tag} compact busy nudge ${compactBusyGroup.offset}`,
        );
        await page.screenshot({ path: `${shots}/${tag}-change-${lines}-line-busy.png` });
        report.push({ tag, lines, ready: compactReady, busy: compactBusyGroup, box: compactBox });
        await page.getByRole('button', { name: 'Change address', exact: true }).first().waitFor();
      }
      await context.close();

      // Legislator finder: same width and nudge.
      const legislatorContext = await browser.newContext({ viewport: { width, height: 1000 } });
      const legislator = await legislatorContext.newPage();
      await blockOutside(legislator);
      await legislator.route(isApi, (route) =>
        route.fulfill({ status: 404, body: '{}', headers: { 'access-control-allow-origin': '*' } }),
      );
      await legislator.goto(`${base}/find-my-legislator`);
      const legislatorFind = legislator.getByRole('button', {
        name: 'Find legislators',
        exact: true,
      });
      await legislatorFind.waitFor();
      await legislator.evaluate(() => document.fonts.ready);
      const legislatorBox = await box(legislatorFind);
      if (width !== 390) assert.equal(legislatorBox.width, 150, `${tag} legislator width`);
      const legislatorGroup = await groupOf(legislatorFind);
      assert(Math.abs(legislatorGroup.gap - 9) <= 0.6);
      assert(
        Math.abs(legislatorGroup.offset + 3) <= 1,
        `${tag} legislator nudge ${legislatorGroup.offset}`,
      );
      await legislator.screenshot({ path: `${shots}/${tag}-legislator.png` });
      await legislatorContext.close();
      report.push({ tag, entry: ready, legislator: legislatorGroup });
    }
    // Narrow and enlarged text: 320px and 200% zoom keep every control readable.
    // 320px is a 1280px window at 400%; 640px at 200% zoom doubles the type.
    for (const [viewport, zoom] of [
      [320, 1],
      [640, 2],
    ]) {
      const { page, context } = await open(browser, viewport, {
        location: { latitude: 46.79, longitude: -92.09, accuracy: 6 },
      });
      await page.evaluate((z) => (document.body.style.zoom = String(z)), zoom);
      await page.getByLabel('Full street address', { exact: true }).fill(LONG);
      assert(
        await noHorizontalScroll(page),
        `${engine.name()} ${viewport} zoom ${zoom} no sideways scroll`,
      );
      await page.screenshot({
        path: `${shots}/${engine.name()}-${viewport}-zoom${zoom}-entry.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Use my location', exact: true }).click();
      await page.getByRole('heading', { name: 'Is this your home address?' }).waitFor();
      assert(
        await noHorizontalScroll(page),
        `${engine.name()} ${viewport} zoom ${zoom} confirm no sideways scroll`,
      );
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('[role="button"],button')]
          .filter((b) => b.offsetParent && b.scrollWidth > b.clientWidth + 1)
          .map((b) => b.textContent),
      );
      assert.deepEqual(
        clipped,
        [],
        `${engine.name()} ${viewport} zoom ${zoom} buttons not clipped`,
      );
      await page.screenshot({
        path: `${shots}/${engine.name()}-${viewport}-zoom${zoom}-confirm.png`,
        fullPage: true,
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
console.log(JSON.stringify(report, null, 1));
console.log('candidate location and Find checks passed');
