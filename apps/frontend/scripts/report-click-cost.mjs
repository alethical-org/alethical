// What a click inside Alethical costs, beside arriving at the same address fresh.
//
// Why this exists. Clicking a link inside the site looked slower than loading a
// page from nothing, which is backwards: the program is already in the browser
// (https://github.com/alethical-org/alethical/issues/1988). The figure that
// raised it could not be used, because Cloudflare's records for an address
// change are our own start-up rather than a reader clicking anything
// (`report-page-load-beacons.mjs`). This measures a click directly instead.
//
// It reports 3 moments, because a first load has 2 of them and a click has 1:
//
//   fresh: text   the server's own written text for that address is on screen.
//                 A reader can read it. `api/page.ts` writes it.
//   fresh: app    the app has replaced that text and drawn the address's records.
//   click: app    from the click, the app has drawn the address's records.
//
// The reader-facing comparison is `click: app` against `fresh: text`, because
// those are the 2 moments a reader waits for. `click: app` against `fresh: app`
// compares the program's own work on the 2 routes in.
//
// One test decides "the records are on screen" for both routes, per address, so
// nothing here can flatter one of them. A predicate is source text for a
// function baked into the injected script rather than built at run time: the
// site's content policy forbids evaluating a string, and a probe that quietly
// fell back to a looser check would print a confident wrong number.
//
// Reads public pages only. It clicks real links and makes the reads a real click
// makes, so run it against production sparingly; it sends no beacon of its own
// because every beacon request is answered locally.
//
// Run it from `apps/frontend`:
//
//   node scripts/report-click-cost.mjs
//   node scripts/report-click-cost.mjs --runs 5 --trace
//   node scripts/report-click-cost.mjs --origin http://localhost:8098 --clicks-only
//
// `--clicks-only` is for a local build, which has no server-written text, so its
// first-load columns would describe nothing.

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 || at === args.length - 1 ? fallback : args[at + 1];
};

const ORIGIN = flag('origin', 'https://www.alethical.com');
const RUNS = Number(flag('runs', '3'));
const ONLY = flag('only', null);
const TRACE = args.includes('--trace');
const CLICKS_ONLY = args.includes('--clicks-only');
const SLOW = args.includes('--slow');

// The same slow visit the other 2 probes emulate, so all 3 describe one reader.
const SLOW_KILOBITS = 400;
const SLOW_LATENCY_MS = 400;
const SLOW_CPU = 4;

/** Each `content` is source text for a function taking no arguments. */
const JOURNEYS = [
  {
    name: 'home -> bills',
    from: '/',
    to: '/bills',
    click: 'a[href="/bills"]',
    content: `document.querySelectorAll('a[href^="/bills/94-"]').length >= 5`,
  },
  {
    name: 'money -> committees',
    from: '/money',
    to: '/money/committees',
    click: 'a[href="/money/committees"]',
    content: `document.querySelectorAll('a[href^="/money/committees/"]').length >= 10`,
  },
  {
    name: 'money -> races',
    from: '/money',
    to: '/money/races',
    click: 'a[href="/money/races"]',
    content: `/[0-9][0-9,]*\\s+candidate committees/.test(document.body.innerText)`,
  },
  {
    name: 'money -> outside spending',
    from: '/money',
    to: '/money/outside-spending',
    click: 'a[href="/money/outside-spending"]',
    content: `document.querySelectorAll('a[href*="/money/outside-spending?spender="]').length >= 5`,
  },
  {
    name: 'committees -> a committee',
    from: '/money/committees',
    to: '/money/committees/100-percent-future-fund-41363',
    click: 'a[href="/money/committees/100-percent-future-fund-41363"]',
    content: `document.body.innerText.includes('Figures for')`,
  },
  {
    name: 'bills -> a bill',
    from: '/bills',
    to: '/bills/94-2025-HF719',
    click: 'a[href="/bills/94-2025-HF719"]',
    content: `document.body.innerText.includes('HF 719')`,
  },
  {
    name: 'home -> legislators',
    from: '/',
    to: '/legislators',
    click: 'a[href="/legislators"]',
    content: `document.querySelectorAll('a[href^="/legislators/"]').length >= 5`,
  },
];

function watcher(path, content) {
  return `
window.__marks = { readable: null, app: null, clickAt: null };
window.__needClick = false;
window.__onPath = () => location.pathname === ${JSON.stringify(path)};
window.__content = () => { try { return !!(${content}); } catch (e) { return false; } };
window.__textGone = () => !document.querySelector('.page-snapshot');
document.addEventListener('click', () => {
  if (window.__needClick && window.__marks.clickAt === null) {
    window.__marks.clickAt = performance.now();
  }
}, true);
window.__watch = () => {
  const look = () => {
    const marks = window.__marks;
    const started = !window.__needClick || marks.clickAt !== null;
    if (started && window.__onPath()) {
      if (marks.readable === null && window.__content()) {
        const at = performance.now();
        requestAnimationFrame(() => { if (marks.readable === null) marks.readable = at; });
      }
      if (marks.app === null && window.__textGone() && window.__content()) {
        const at = performance.now();
        requestAnimationFrame(() => { if (marks.app === null) marks.app = at; });
      }
    }
    if (marks.app !== null) return;
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
};
window.__arm = () => {
  window.__marks = { readable: null, app: null, clickAt: null };
  window.__needClick = true;
  window.__watch();
};
`;
}

const TIMEOUT = SLOW ? 240000 : 90000;
const drawn = () => window.__marks.app !== null;

async function slowDown(page, context) {
  if (!SLOW) return;
  const devtools = await context.newCDPSession(page);
  await devtools.send('Network.enable');
  await devtools.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: SLOW_LATENCY_MS,
    downloadThroughput: (SLOW_KILOBITS * 1024) / 8,
    uploadThroughput: (SLOW_KILOBITS * 1024) / 8,
  });
  await devtools.send('Emulation.setCPUThrottlingRate', { rate: SLOW_CPU });
}

async function freshPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  // Answered here, so no measurement of a robot reaches our real-visitor records.
  await page.route('**/cdn-cgi/rum**', (route) => route.fulfill({ status: 204, body: '' }));
  return { context, page };
}

async function arriveFresh(browser, journey) {
  const { context, page } = await freshPage(browser);
  await page.addInitScript(watcher(journey.to, journey.content) + 'window.__watch();');
  await slowDown(page, context);
  try {
    await page.goto(ORIGIN + journey.to, { waitUntil: 'commit', timeout: TIMEOUT });
    await page.waitForFunction(drawn, null, { timeout: TIMEOUT, polling: 100 });
    const marks = await page.evaluate(() => window.__marks);
    return { readable: Math.round(marks.readable), app: Math.round(marks.app) };
  } finally {
    await context.close();
  }
}

async function clickThrough(browser, journey) {
  const { context, page } = await freshPage(browser);
  await page.addInitScript(watcher(journey.to, journey.content));
  await slowDown(page, context);
  try {
    await page.goto(ORIGIN + journey.from, { waitUntil: 'load', timeout: TIMEOUT });
    await page.waitForSelector(journey.click, { timeout: TIMEOUT });
    // The page a reader has been reading is finished before they click it.
    await page.waitForTimeout(SLOW ? 8000 : 4000);
    await page.evaluate(() => window.__arm());
    await page.click(journey.click, { timeout: TIMEOUT });
    await page.waitForFunction(drawn, null, { timeout: TIMEOUT, polling: 100 });
    return await page.evaluate(() => {
      const marks = window.__marks;
      return {
        app: Math.round(marks.app - marks.clickAt),
        fetched: performance
          .getEntriesByType('resource')
          .filter((one) => one.startTime >= marks.clickAt - 5 && one.startTime <= marks.app + 5)
          .map((one) => ({
            name: one.name.replace(location.origin, ''),
            start: Math.round(one.startTime - marks.clickAt),
            took: Math.round(one.duration),
          })),
      };
    });
  } finally {
    await context.close();
  }
}

const middle = (numbers) => {
  const sorted = numbers.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const half = sorted.length / 2;
  return sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : Math.round((sorted[half - 1] + sorted[half]) / 2);
};
const signed = (value) => (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value}` : '?');

const browser = await chromium.launch({ headless: true });
console.log(
  `${ORIGIN} — ${RUNS} runs of each, middle figure shown, in milliseconds.` +
    (SLOW
      ? ` Throttled to ${SLOW_KILOBITS} kbit, ${SLOW_LATENCY_MS} ms latency, processor ${SLOW_CPU}x slower.`
      : ' Not throttled.'),
);
console.log('');
console.log(
  CLICKS_ONLY
    ? `${'journey'.padEnd(28)}${'click'.padStart(8)}`
    : `${'journey'.padEnd(28)}${'fresh: text'.padStart(12)}${'fresh: app'.padStart(11)}` +
        `${'click'.padStart(8)}${'vs text'.padStart(9)}${'vs app'.padStart(8)}`,
);

for (const journey of JOURNEYS) {
  if (ONLY && !journey.name.includes(ONLY)) continue;
  const readable = [];
  const drawnFresh = [];
  const clicked = [];
  let lastTrace = null;
  for (let run = 0; run < RUNS; run += 1) {
    if (!CLICKS_ONLY) {
      try {
        const arrival = await arriveFresh(browser, journey);
        readable.push(arrival.readable);
        drawnFresh.push(arrival.app);
      } catch (failure) {
        readable.push(NaN);
        drawnFresh.push(NaN);
        console.error('  arriving failed:', journey.name, String(failure).slice(0, 140));
      }
    }
    try {
      const click = await clickThrough(browser, journey);
      clicked.push(click.app);
      lastTrace = click.fetched;
    } catch (failure) {
      clicked.push(NaN);
      console.error('  clicking failed:', journey.name, String(failure).slice(0, 140));
    }
  }
  const text = middle(readable);
  const app = middle(drawnFresh);
  const click = middle(clicked);
  console.log(
    CLICKS_ONLY
      ? `${journey.name.padEnd(28)}${String(click).padStart(8)}   [${clicked.join(', ')}]`
      : `${journey.name.padEnd(28)}${String(text).padStart(12)}${String(app).padStart(11)}` +
          `${String(click).padStart(8)}${signed(click - text).padStart(9)}` +
          `${signed(click - app).padStart(8)}   [${clicked.join(', ')}]`,
  );
  if (TRACE && lastTrace) {
    if (lastTrace.length === 0)
      console.log('      nothing was fetched between the click and the records');
    for (const one of lastTrace) {
      console.log(
        `      +${String(one.start).padStart(5)} ms  took ${String(one.took).padStart(5)} ms  ${one.name.slice(0, 84)}`,
      );
    }
  }
}
await browser.close();
