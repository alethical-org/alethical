// Break a real cold page load into the stages that make up the wait, so a speed
// fix can be aimed at the stage that dominates rather than at a guess.
//
// Why this exists. Cloudflare publishes one number per page: how long the slowest
// quarter of real visitors wait for the main content to appear. On `/bills` that
// number is 4,152 ms against a 2,500 ms target
// (https://github.com/alethical-org/alethical/issues/2025). One number cannot say
// which part of the load is spending the time, and the 3 candidates want opposite
// fixes: a large program wants splitting, a slow data request wants a smaller
// response, and slow drawing wants less work per card.
//
// What it reports, per run:
//
//   html          the server's first response, which already carries the readable
//                 text snapshot
//   program       downloading the app's own program files
//   start         parsing and running that program until it replaces the snapshot
//   list request  the data request the list makes, from its first byte to its last
//   draw          from that response arriving to the cards being on screen
//
// EVERY RUN AFTER THE FIRST READS A WARM NEARBY CACHE, so the figure this reports for
// a screen's own data request is the best case rather than the only case. On `/bills`
// the same answer takes 565 ms at the origin against 90 ms cached, and this probe can
// only ever see the second number. Read the cold one separately, with a cache-busting
// parameter straight at the data service, and quote both with the cache state named.
// Do not go on to say which one a reader gets: how often a copy is already held is
// unmeasured, a first-time visitor can be handed one somebody else's visit put there,
// and copies are held per location rather than once for everybody.
//
// By default it throttles to the same 400 kbit connection, 400 ms latency and 4x
// slower processor as `report-page-load-beacons.mjs --slow`, so the 2 probes
// describe the same visit. That profile is harsher than a real bad visit, which is
// useful for saying which stage dominates and misleading if read as a total: pass
// `--kbit`, `--latency` and `--cpu` to land near the figure being explained. Every
// run gets a brand-new browser context, so no run reuses another's cache.
//
// Reads public pages only, and sends nothing: every beacon request is answered
// locally, so no measurement of a robot enters our real-visitor data.
//
// Run it from `apps/frontend`:
//
//   node scripts/report-page-load-stages.mjs
//   node scripts/report-page-load-stages.mjs --url https://www.alethical.com/bills
//   node scripts/report-page-load-stages.mjs --viewport phone --runs 9
//   node scripts/report-page-load-stages.mjs --kbit 1600 --latency 150
//   node scripts/report-page-load-stages.mjs --fast          (no throttling)

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 || at === args.length - 1 ? fallback : args[at + 1];
};

const URL_UNDER_TEST = flag('url', 'https://www.alethical.com/bills');
const RUNS = Number(flag('runs', '9'));
// The 3 program files the first response itself asks for, by the stable part of
// their names (apps/frontend/public/index.html links them).
const ENTRY_PROGRAM_FILES = ['__expo-metro-runtime', '__common-', '/index-'];
const FAST = args.includes('--fast');
// A phone-sized window and a laptop-sized one draw different numbers of cards and
// take different layout paths, so a figure from one does not speak for the other.
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 900 },
};
const VIEWPORT_NAME = flag('viewport', 'desktop');
// `--width` and `--height` override the preset, so a run can sweep the sizes
// between them. Which element counts as the main content changes with width,
// and so does the figure, so the size is never incidental.
const VIEWPORT = {
  width: Number(flag('width', String((VIEWPORTS[VIEWPORT_NAME] ?? VIEWPORTS.desktop).width))),
  height: Number(flag('height', String((VIEWPORTS[VIEWPORT_NAME] ?? VIEWPORTS.desktop).height))),
};

// Same numbers as report-page-load-beacons.mjs --slow, so the 2 probes describe
// the same visit.
const SLOW_KILOBITS = Number(flag('kbit', '400'));
const SLOW_LATENCY_MS = Number(flag('latency', '400'));
const SLOW_CPU_FACTOR = Number(flag('cpu', '4'));

// How long to wait for the cards before giving up on a run.
const PATIENCE_MS = FAST ? 30000 : 90000;

const browser = await chromium.launch({ headless: true });

// Everything the page did, collected inside the page so each figure is timed by the
// browser rather than by this script's own clock.
const OBSERVE = () => {
  window.__stages = {
    appTookOver: null,
    cardsDrawn: null,
    cardCount: 0,
    lcp: null,
    snapshotSeen: false,
  };

  // The first response already carries a readable snapshot: a heading and a plain
  // list of the same bills, as real links. So a link to a bill is NOT evidence the
  // app has drawn anything. The roll-call link inside a card is, because only the
  // app's own card renders one.
  const countCards = () =>
    document.querySelectorAll('a[href*="/bills/"][href*="tab=votes"]').length;

  const look = () => {
    if (document.querySelector('.page-snapshot')) {
      window.__stages.snapshotSeen = true;
    } else if (window.__stages.snapshotSeen && window.__stages.appTookOver === null) {
      window.__stages.appTookOver = Math.round(performance.now());
    }
    const cards = countCards();
    if (cards > window.__stages.cardCount) {
      window.__stages.cardCount = cards;
      window.__stages.cardsDrawn = Math.round(performance.now());
    }
  };

  // documentElement can still be null at the instant this runs, so wait for a
  // document to observe rather than throwing and losing every other reading.
  const start = () => {
    if (!document.documentElement) {
      requestAnimationFrame(start);
      return;
    }
    look();
    new MutationObserver(look).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };
  start();

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__stages.lcp = {
        at: Math.round(entry.startTime),
        element: entry.element
          ? entry.element.tagName +
            '.' +
            String(entry.element.className || '')
              .split(' ')
              .slice(0, 2)
              .join('.')
          : 'unknown',
      };
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const runs = [];
for (let run = 0; run < RUNS; run += 1) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.route('**/cdn-cgi/rum**', (route) => route.fulfill({ status: 204, body: '' }));
  const measuredBodies = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/bills')) measuredBodies.push(response.body());
  });
  await page.addInitScript(OBSERVE);

  const devtools = await context.newCDPSession(page);
  if (!FAST) {
    await devtools.send('Network.enable');
    await devtools.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: SLOW_LATENCY_MS,
      downloadThroughput: (SLOW_KILOBITS * 1024) / 8,
      uploadThroughput: (SLOW_KILOBITS * 1024) / 8,
    });
    await devtools.send('Emulation.setCPUThrottlingRate', { rate: SLOW_CPU_FACTOR });
  }

  await page.goto(URL_UNDER_TEST, { waitUntil: 'commit', timeout: PATIENCE_MS });
  await page
    .waitForFunction(() => window.__stages?.cardCount >= 5, null, { timeout: PATIENCE_MS })
    .catch(() => {});
  // Let a late card and a late largest-paint land before reading.
  await page.waitForTimeout(FAST ? 1500 : 4000);

  const reading = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] ?? {};
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      start: Math.round(entry.startTime),
      end: Math.round(entry.responseEnd),
      bytes: entry.encodedBodySize,
      kind: entry.initiatorType,
    }));
    return {
      stages: window.__stages,
      html: { start: Math.round(nav.requestStart ?? 0), end: Math.round(nav.responseEnd ?? 0) },
      resources,
    };
  });

  await context.close();

  // Only the program files the first response itself asks for. A chunk the app
  // fetches later is a different story and would make "the program finished
  // downloading" land after the app had already started.
  const programFiles = reading.resources.filter((entry) =>
    ENTRY_PROGRAM_FILES.some((name) => entry.name.includes(name)),
  );
  const laterProgramFiles = reading.resources.filter(
    (entry) => entry.name.includes('/_expo/') && !programFiles.includes(entry),
  );
  const listRequests = reading.resources.filter((entry) => entry.name.includes('/api/v1/bills'));
  const programEnd = programFiles.length ? Math.max(...programFiles.map((f) => f.end)) : null;
  const programStart = programFiles.length ? Math.min(...programFiles.map((f) => f.start)) : null;
  const programBytes = programFiles.reduce((sum, f) => sum + (f.bytes ?? 0), 0);
  const listStart = listRequests.length ? Math.min(...listRequests.map((r) => r.start)) : null;
  const listEnd = listRequests.length ? Math.max(...listRequests.map((r) => r.end)) : null;
  // A cross-origin response does not expose its size to the page, so take it from
  // the browser's own view of the response instead.
  const listBytes = (await Promise.all(measuredBodies.map((body) => body.catch(() => null))))
    .filter(Boolean)
    .reduce((sum, body) => sum + body.length, 0);

  runs.push({
    htmlEnd: reading.html.end,
    programStart,
    programEnd,
    programBytes,
    listStart,
    listEnd,
    listBytes,
    listCount: listRequests.length,
    laterProgramBytes: laterProgramFiles.reduce((sum, f) => sum + (f.bytes ?? 0), 0),
    appTookOver: reading.stages.appTookOver,
    cardsDrawn: reading.stages.cardsDrawn,
    cardCount: reading.stages.cardCount,
    lcp: reading.stages.lcp?.at ?? null,
    lcpElement: reading.stages.lcp?.element ?? null,
  });

  const last = runs[runs.length - 1];
  console.log(
    `  run ${run + 1}: html ${last.htmlEnd} ms, program done ${last.programEnd} ms, ` +
      `app took over ${last.appTookOver} ms, list ${last.listStart}-${last.listEnd} ms, ` +
      `${last.cardCount} cards at ${last.cardsDrawn} ms, main content ${last.lcp} ms`,
  );
}

await browser.close();

const pick = (key) => runs.map((r) => r[key]).filter((v) => v != null);
const gap = (from, to) =>
  runs
    .map((r) => (r[from] != null && r[to] != null ? r[to] - r[from] : null))
    .filter((v) => v != null);

console.log('');
console.log(
  `${URL_UNDER_TEST} on a ${VIEWPORT_NAME}-sized window (${VIEWPORT.width}x${VIEWPORT.height}), ` +
    `${RUNS} runs, fresh browser each time.` +
    (FAST
      ? ' Not throttled.'
      : ` Throttled to ${SLOW_KILOBITS} kbit, ${SLOW_LATENCY_MS} ms latency, processor ${SLOW_CPU_FACTOR}x slower.`),
);
console.log('');
console.log('Middle run of each stage, in milliseconds from the moment the page starts loading:');
const row = (label, values) =>
  console.log(
    `  ${label.padEnd(34)} ${String(median(values) ?? 'not seen').padStart(7)}` +
      (values.length ? `   (${Math.min(...values)} to ${Math.max(...values)})` : ''),
  );
row('first response finished', pick('htmlEnd'));
row('program files finished downloading', pick('programEnd'));
row('app replaced the snapshot', pick('appTookOver'));
row('list request started', pick('listStart'));
row('list request finished', pick('listEnd'));
row('cards on screen', pick('cardsDrawn'));
row('main content (what Cloudflare times)', pick('lcp'));
const elements = [...new Set(runs.map((r) => r.lcpElement).filter(Boolean))];
console.log(`  the main-content element was ${elements.join(', ') || 'never reported'}`);
console.log('');
console.log('How long each stage itself took:');
row('downloading the program', gap('programStart', 'programEnd'));
row('starting the program', gap('programEnd', 'appTookOver'));
row('waiting for the list request', gap('listStart', 'listEnd'));
row('drawing the cards after it arrived', gap('listEnd', 'cardsDrawn'));
console.log('');
console.log(
  `  program bytes over the wire: ${median(pick('programBytes'))?.toLocaleString()}   ` +
    `list bytes over the wire: ${median(pick('listBytes'))?.toLocaleString()}   ` +
    `later program bytes: ${median(pick('laterProgramBytes'))?.toLocaleString()}   ` +
    `list requests: ${median(pick('listCount'))}   cards: ${median(pick('cardCount'))}`,
);
