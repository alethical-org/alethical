// Show what Cloudflare's browser beacon actually reports for a first page load and
// for a click inside Alethical, by reading the beacon's own payloads.
//
// Why this exists. Alethical's real-visitor page-speed figures come from Cloudflare,
// and 2 of them could not be reconciled with a browser measurement of the same page:
// a first load measured far faster than the app takes to draw, and a click inside the
// site measured slower than a cold load, which is backwards
// (https://github.com/alethical-org/alethical/issues/1988). A percentile cannot be
// argued with; a payload can be read. This reads them.
//
// What it establishes, reproduced on 4 Sep 2026 against production, 3 times:
//
//   1. On a first load, the beacon's main-content element is the server-written
//      snapshot (`#root>div.page-snapshot>div.ps-inner>p.ps-prose`), at 264 ms. So
//      the figure means "the snapshot's text appeared", not "the app drew". The lab
//      measurements on issue 1966 time the second moment. Both are right about
//      different moments.
//   2. The program rewrites the address to the address it is already on, about 300 ms
//      after load (`replaceState` to the same URL). Cloudflare's beacon hooks address
//      changes, so it opens a "clicked inside the site" record that nobody clicked,
//      for the address the reader already had.
//   3. That phantom record is the one that carries the app's own larger paint, at
//      648 to 672 ms, timed from the original page load. It also ends the first-load
//      record early, which is why first-load figures look better than the app feels.
//   4. The record opened by a real click never sent a main-content or layout figure
//      at all, in any run, including after the page was genuinely hidden.
//
// So "clicked inside the site" in Cloudflare's data is mostly our own address rewrite
// timed against the original page load, and it is not comparable with a first load.
//
// Then, with `--slow`, which throttles the connection and the processor to what the
// slowest quarter of real visits looks like, 2 more things that only appear there:
//
//   5. Layout movement does NOT follow main content's split, and the order flips.
//      On a slow load the app draws before the program's address rewrite, so the
//      movement lands on the page-load record: on `/money` the beacon named
//      `#root>div.page-snapshot` and 0.0294 at 10,813 ms, with the rewrite at
//      11,344 ms. On a fast load the rewrite comes first, at about 300 ms, and the
//      movement lands on the phantom record instead. Since the published figure is
//      the slowest 1 in 4, it is the page-load record's, and it is the app replacing
//      the snapshot (https://github.com/alethical-org/alethical/issues/1982).
//   6. A second, smaller mover: the snapshot's own text drops about 39 px when the
//      web font arrives, 0.0138 at 3,352 ms on the home page, moving `P.ps-prose`,
//      `P.ps-sub` and `NAV.ps-links`. The fonts load from Google Fonts with
//      `display=swap` in `apps/frontend/public/index.html`.
//
// Neither run reproduced the 1.0 the published figure shows; both read 0.03 to 0.06.
// So the mechanism is established here and the size is not.
//
// Reads public pages only. Every beacon request is answered locally, so nothing this
// probe generates reaches Cloudflare and no measurement of a robot enters our data.
//
// Run it from `apps/frontend`:
//
//   node scripts/report-page-load-beacons.mjs
//   node scripts/report-page-load-beacons.mjs https://www.alethical.com/money "Committees"
//   node scripts/report-page-load-beacons.mjs --slow https://www.alethical.com/money

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
// `--slow` is where the interesting readings are: on a fast connection the app draws
// after the program has already rewritten the address, and the movement is booked
// somewhere else. The published figure is the slowest 1 in 4, so this is the case
// that produces it.
const SLOW = args.includes('--slow');
const positional = args.filter((value) => value !== '--slow');
const START_URL = positional[0] ?? 'https://www.alethical.com/';
const LINK_NAME = positional[1] ?? 'Search Bills';
// Long enough that a reader-shaped pause is unmistakable in the timings: any figure
// that includes it is timed from the page load rather than from the click.
const READING_PAUSE_MS = 9000;
// A slow mobile connection and a slow processor, close enough to the shape of a
// bad real visit that the movement it provokes is the movement readers see.
const SLOW_KILOBITS = 400;
const SLOW_LATENCY_MS = 400;
const SLOW_CPU_FACTOR = 4;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const beacons = [];
await page.route('**/cdn-cgi/rum**', async (route) => {
  let body = null;
  try {
    body = route.request().postData();
  } catch {
    body = null;
  }
  beacons.push(body);
  await route.fulfill({ status: 204, body: '' });
});

// Record every address change the program makes, so one nobody clicked is visible.
await page.addInitScript(() => {
  window.__addressChanges = [];
  const record = (how, url) =>
    window.__addressChanges.push({
      how,
      url: String(url),
      at: Math.round(performance.now()),
    });
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = function (state, title, url) {
    record('pushState', url ?? location.href);
    return push(state, title, url);
  };
  history.replaceState = function (state, title, url) {
    record('replaceState', url ?? location.href);
    return replace(state, title, url);
  };
  window.navigation?.addEventListener('navigate', (event) =>
    record('navigate event', event.destination?.url ?? ''),
  );

  // The beacon reports 1 element per record. This keeps every mover, with when it
  // moved, which is what says whether the app's handover or something earlier is
  // responsible.
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      window.__shifts.push({
        at: Math.round(entry.startTime),
        value: entry.value,
        moved: (entry.sources ?? []).map((source) => {
          const node = source.node;
          if (!node) return 'unknown';
          const classes = String(node.className ?? '')
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .join('.');
          return (node.tagName ?? node.nodeName) + (classes ? `.${classes}` : '');
        }),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
});

const devtoolsForThrottling = await context.newCDPSession(page);
if (SLOW) {
  await devtoolsForThrottling.send('Network.enable');
  await devtoolsForThrottling.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: SLOW_LATENCY_MS,
    downloadThroughput: (SLOW_KILOBITS * 1024) / 8,
    uploadThroughput: (SLOW_KILOBITS * 1024) / 8,
  });
  await devtoolsForThrottling.send('Emulation.setCPUThrottlingRate', {
    rate: SLOW_CPU_FACTOR,
  });
}

await page.goto(START_URL, { waitUntil: 'load', timeout: SLOW ? 120000 : 30000 });
await page.waitForTimeout(READING_PAUSE_MS);
const clickedAt = Math.round(await page.evaluate(() => performance.now()));
await page.getByRole('link', { name: LINK_NAME }).first().click();
await page.waitForTimeout(7000);
const addressChanges = await page.evaluate(() => window.__addressChanges);
const shifts = await page.evaluate(() => window.__shifts);
const landedOn = await page.evaluate(() => location.pathname);

// Hiding the page is when the beacon sends a finished record, so a synthetic event
// is not enough: the visibility has to actually change.
await devtoolsForThrottling
  .send('Emulation.setPageVisibilityOverride', { visibility: 'hidden' })
  .catch(() => {});
await page.waitForTimeout(2500);
await browser.close();

const records = beacons
  .map((body) => {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const origin = new URL(START_URL).origin;
const line = (record) => {
  const kind = record.nt ?? 'unknown';
  const finished = record.eventType === 3 ? 'finished' : 'opened';
  const where = (record.location ?? '').replace(origin, '') || '/';
  const main = record.lcp ? `${record.lcp.value} ms` : 'none sent';
  const element = record.lcp?.element ? ` via ${record.lcp.element.slice(0, 70)}` : '';
  const movement = record.cls ? `, layout movement ${record.cls.value.toFixed(4)}` : '';
  return `  ${kind.padEnd(13)} ${finished.padEnd(9)} ${where.padEnd(10)} main content ${main}${movement}${element}`;
};

console.log(
  `Started at ${START_URL}, waited ${READING_PAUSE_MS} ms, clicked "${LINK_NAME}".` +
    (SLOW
      ? ` Throttled to ${SLOW_KILOBITS} kbit, ${SLOW_LATENCY_MS} ms latency, processor ${SLOW_CPU_FACTOR}x slower.`
      : ' Not throttled: pass --slow for the case that produces the published figure.'),
);
console.log(`Clicked at ${clickedAt} ms after load; landed on ${landedOn}.`);
console.log('');
console.log('Address changes the program made:');
for (const change of addressChanges) {
  const clicked = change.at >= clickedAt - 200 ? 'the click' : 'nobody clicked this';
  console.log(
    `  ${String(change.at).padStart(6)} ms  ${change.how.padEnd(15)} ${change.url}  (${clicked})`,
  );
}
console.log('');
console.log('Everything that moved on the page:');
if (shifts.length === 0) {
  console.log('  nothing moved');
}
for (const shift of shifts) {
  console.log(
    `  ${String(shift.at).padStart(6)} ms  ${shift.value.toFixed(4)}  ${shift.moved.join(', ')}`,
  );
}
console.log('');
console.log('What the beacon reported:');
for (const record of records) {
  console.log(line(record));
}
console.log('');
console.log(
  'A figure on a "routing-apis" record for the address the reader already had is our\n' +
    'own address rewrite, timed from the page load. It is not a measurement of a click.',
);
