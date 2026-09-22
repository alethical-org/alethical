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
// **It clicks twice, and that is not decoration.** The beacon closes a record and
// sends its figures when the NEXT move begins, or never. So a probe that clicks once
// and stops reads "none sent" for that click and concludes clicks are unmeasurable,
// which is exactly what an earlier version of this script did and what
// https://github.com/alethical-org/alethical/issues/2336 corrected. Never cut the
// second click.
//
// What it established, against production on 22 September 2026:
//
//   1. On a first load the beacon's main-content element is now the app's own paint,
//      not the server-written snapshot. Before the fix below, our own start-up call
//      closed the page-load record early and the figure was the snapshot's text:
//      724 ms on a slow visit to /money whose app drew at 9,428 ms.
//   2. The program used to rewrite the address to the address it already had, about
//      300 ms after load (`replaceState` with no address at all). The beacon listens
//      for the browser's navigate event, which that call fires whether or not the
//      address moves, so it opened a "clicked inside the site" record nobody clicked.
//      `apps/frontend/public/index.html` now writes that history entry before the
//      beacon's own file has been parsed, so no record opens for it.
//   3. A real click IS measured: 103 ms for / to /bills, 35 ms for the click back,
//      read from the beacon's own payloads. Both arrive only once the move after
//      them begins.
//   4. The last move of a visit is never reported. Hiding the page does not close
//      the open record, so a reader's final click is always missing.
//
// Then, with `--slow`, which throttles the connection and the processor to what the
// slowest quarter of real visits looks like, layout movement is worth watching too:
// the published layout figure is the app replacing the snapshot
// (https://github.com/alethical-org/alethical/issues/1982), and on `/money` 3 runs
// named `#root>div.page-snapshot` and its children at 10.8 to 11.0 seconds. Neither
// run reproduced the 1.0 the published figure shows; both read 0.03 to 0.06. So the
// mechanism is established here and the size is not.
//
// Reads public pages only. Every beacon request is answered locally, so nothing this
// probe generates reaches Cloudflare and no measurement of a robot enters our data.
//
// Run it from `apps/frontend`:
//
//   node scripts/report-page-load-beacons.mjs
//   node scripts/report-page-load-beacons.mjs https://www.alethical.com/money "Committees" "Money in politics"
//   node scripts/report-page-load-beacons.mjs --slow https://www.alethical.com/money

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
// `--slow` is where the interesting readings are: the published figure is the
// slowest 1 in 4, so this is the case that produces it.
const SLOW = args.includes('--slow');
const positional = args.filter((value) => value !== '--slow');
const START_URL = positional[0] ?? 'https://www.alethical.com/';
// Two links, because the first click's record is only sent once the second begins.
const FIRST_LINK = positional[1] ?? 'Search Bills';
const SECOND_LINK = positional[2] ?? 'Alethical home';
// Long enough that a reader-shaped pause is unmistakable in the timings: any figure
// that includes it is timed from the page load rather than from the click.
const READING_PAUSE_MS = SLOW ? 14000 : 9000;
const AFTER_CLICK_MS = SLOW ? 20000 : 7000;
// A slow mobile connection and a slow processor, close enough to the shape of a
// bad real visit that the movement it provokes is the movement readers see.
const SLOW_KILOBITS = 400;
const SLOW_LATENCY_MS = 400;
const SLOW_CPU_FACTOR = 4;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const beacons = [];
const startedAt = Date.now();
await page.route('**/cdn-cgi/rum**', async (route) => {
  let body = null;
  try {
    body = route.request().postData();
  } catch {
    body = null;
  }
  beacons.push({ body, at: Date.now() - startedAt });
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

await page.goto(START_URL, { waitUntil: 'load', timeout: SLOW ? 180000 : 30000 });
await page.waitForTimeout(READING_PAUSE_MS);

const clicks = [];
for (const name of [FIRST_LINK, SECOND_LINK]) {
  const at = Math.round(await page.evaluate(() => performance.now()));
  await page.getByRole('link', { name }).first().click();
  await page.waitForTimeout(AFTER_CLICK_MS);
  clicks.push({ name, at, landedOn: await page.evaluate(() => location.pathname) });
}

const addressChanges = await page.evaluate(() => window.__addressChanges);
const shifts = await page.evaluate(() => window.__shifts);

// Hiding the page is when the beacon sends a finished page-load record, so a
// synthetic event is not enough: the visibility has to actually change.
await devtoolsForThrottling
  .send('Emulation.setPageVisibilityOverride', { visibility: 'hidden' })
  .catch(() => {});
await page.waitForTimeout(2500);
await browser.close();

const records = beacons
  .map(({ body, at }) => {
    try {
      return { ...JSON.parse(body), sentAt: at };
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const origin = new URL(START_URL).origin;
const firstClickAt = clicks[0].at;
const line = (record) => {
  const kind = record.nt ?? 'unknown';
  const finished = record.eventType === 3 ? 'finished' : 'opened';
  const where = (record.location ?? '').replace(origin, '') || '/';
  const main = record.lcp ? `${record.lcp.value} ms` : 'none sent';
  const element = record.lcp?.element ? ` via ${record.lcp.element.slice(0, 60)}` : '';
  const movement = record.cls ? `, layout movement ${record.cls.value.toFixed(4)}` : '';
  return `  ${kind.padEnd(13)} ${finished.padEnd(9)} ${where.padEnd(14)} main content ${main}${movement}${element}`;
};

console.log(
  `Started at ${START_URL}, waited ${READING_PAUSE_MS} ms, then clicked "${FIRST_LINK}" and "${SECOND_LINK}".` +
    (SLOW
      ? ` Throttled to ${SLOW_KILOBITS} kbit, ${SLOW_LATENCY_MS} ms latency, processor ${SLOW_CPU_FACTOR}x slower.`
      : ' Not throttled: pass --slow for the case that produces the published figure.'),
);
for (const click of clicks) {
  console.log(`Clicked "${click.name}" at ${click.at} ms after load; landed on ${click.landedOn}.`);
}
console.log('');
console.log('Address changes the program made:');
if (addressChanges.length === 0) {
  console.log('  none');
}
for (const change of addressChanges) {
  const clicked = change.at >= firstClickAt - 200 ? 'a click' : 'nobody clicked this';
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
// A "clicked inside the site" record that exists before anyone clicked is the
// failure this probe was written to find. The beacon opens one for any
// history.replaceState the page makes once the beacon is running, address change or
// not, and that record then carries the app's own paint timed from the page load
// while the first-load record is closed early without it.
const phantoms = records.filter(
  (record) => record.nt === 'routing-apis' && record.sentAt < firstClickAt,
);

console.log('');
if (phantoms.length === 0) {
  console.log(
    'No "clicked inside the site" record existed before the first click, which is\n' +
      "what apps/frontend/public/index.html's history-entry program is for: it gives\n" +
      "this history entry its identifier before the beacon's own file is parsed, so\n" +
      'the beacon never sees the call (issue 2336). The first-load record above should\n' +
      "name one of the app's own elements, not the server-written snapshot's text.",
  );
} else {
  console.log(
    `${phantoms.length} "clicked inside the site" record(s) existed before anyone clicked.\n` +
      'Something on the page called history.replaceState while the beacon was running.\n' +
      'Those records are not clicks, and the first-load record above was closed early\n' +
      "without the app's own paint (issue 2336).",
  );
}
