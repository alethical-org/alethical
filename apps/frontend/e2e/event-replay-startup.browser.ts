import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const articlePath = '/blog/events/forward-debate-2026';
const hostSelector = '#stable-event-document';
const shell = readFileSync(resolve(process.cwd(), 'dist/index.html'), 'utf8');
const entryPath = shell.match(
  /<script[^>]+src="([^"?]*\/_expo\/static\/js\/web\/index-[^"?]+\.js)"/,
)?.[1];
if (!entryPath) throw new Error('Build the real frontend before running replay startup checks');

// This child and official-API-shaped controller prove continuity and controls.
// They deliberately make no claim about real YouTube sound, picture or availability.
const playerHtml = `<!doctype html><title>Illustrative player</title>
<button id="play">Play example</button><p id="state">Not playing</p>
<script>document.getElementById('play').onclick=function(){
  window.examplePlaying=true;
  document.getElementById('state').textContent='Playing example';
};</script>`;
const playerApi = `window.YT={Player:class{
  constructor(frame,options){this.frame=frame;queueMicrotask(()=>{
    frame.dataset.exampleControllerReady='true';options.events.onReady();
  });}
  seekTo(seconds){this.frame.dataset.lastSeek=String(seconds);}
  destroy(){this.frame.dataset.exampleDestroyed='true';}
}};window.onYouTubeIframeAPIReady();`;

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // Deny all writes, even if an app regression unexpectedly attempts one.
    if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
    if (url.origin === origin) {
      if (/^\/(?:api|auth)\//.test(url.pathname)) return route.abort();
      return route.continue();
    }
    if (url.origin === 'https://www.youtube-nocookie.com' && url.pathname.startsWith('/embed/'))
      return route.fulfill({ contentType: 'text/html', body: playerHtml });
    if (url.href === 'https://www.youtube.com/iframe_api')
      return route.fulfill({ contentType: 'text/javascript', body: playerApi });
    if (
      url.origin === 'https://api.alethical.com' &&
      /^\/api\/v1\/comments\/articles\/[^/]+$/.test(url.pathname)
    )
      return route.fulfill({
        json: { data: { items: [], next_cursor: null } },
        headers: { 'access-control-allow-origin': '*' },
      });
    // Public decorative images are read from this build, never the live website.
    if (url.origin === 'https://www.alethical.com' && request.resourceType() === 'image') {
      const response = await route.fetch({ url: `${origin}${url.pathname}` });
      return route.fulfill({ response });
    }
    // Metrics, auth, other APIs and all other external traffic stay blocked.
    return route.abort();
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
});

async function gateAppEntry(page: Page) {
  let release!: () => void;
  let requested!: () => void;
  const held = new Promise<void>((done) => (release = done));
  const reached = new Promise<void>((done) => (requested = done));
  const url = new URL(entryPath!, test.info().project.use.baseURL!).href;
  // Hold only the actual built application entry. HTML, CSS, fonts, lazy chunks
  // and the existing SSR child frame load normally, under the production CSP.
  await page.route(
    url,
    async (route) => {
      requested();
      await held;
      await route.continue();
    },
    { times: 1 },
  );
  return { release, reached };
}

async function expectMounted(page: Page) {
  await expect(page.getByRole('heading', { name: 'Reader comments', exact: true })).toBeVisible();
  await expect(page.locator(`${hostSelector} [data-event-nav] .ps-nav`)).toHaveCount(0);
  await expect(
    page
      .locator(`${hostSelector} [data-event-nav]`)
      .getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
}

async function scrollPosition(page: Page) {
  return page.locator(hostSelector).evaluate((host) => Math.round(host.scrollTop));
}

async function savedPosition(page: Page) {
  return page.evaluate(() => {
    const entry = window.history.state?.__alethical;
    return entry
      ? sessionStorage.getItem(`alethical:scroll:${entry.sessionId}:${entry.entryId}`)
      : null;
  });
}

async function saveDeepPosition(page: Page) {
  await page.goto(articlePath);
  await expectMounted(page);
  await expect(page.getByText('No comments yet', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.locator('#reader-comments').scrollIntoViewIfNeeded();
  await page.mouse.move(1000, 600);
  await page.mouse.wheel(0, 100_000);
  await expect
    .poll(() =>
      page
        .locator(hostSelector)
        .evaluate((host) => Math.abs(host.scrollTop - (host.scrollHeight - host.clientHeight))),
    )
    .toBeLessThanOrEqual(2);
  const position = await scrollPosition(page);
  expect(position).toBeGreaterThan(500);
  await expect.poll(() => savedPosition(page)).toBe(String(position));
  return position;
}

async function reloadPending(page: Page, saved: number) {
  const gate = await gateAppEntry(page);
  await page.reload({ waitUntil: 'commit' });
  await gate.reached;
  await expect(page.locator(hostSelector)).toHaveAttribute(
    'data-event-pending-scroll',
    String(saved),
  );
  // These are actual browser dimensions and offsets, with native scroll anchoring
  // enabled. No mocked scrollTop, timers or modeled document height is involved.
  expect(await scrollPosition(page)).toBeLessThan(saved - 100);
  return gate;
}

test('built app keeps the playing child, header focus and timestamp history through startup', async ({
  page,
}) => {
  await page.route(/\/signInBundle-[^/]+\.js$/, (route) => route.abort());
  const gate = await gateAppEntry(page);
  try {
    await page.goto(articlePath, { waitUntil: 'commit' });
    await gate.reached;
    await expect(page.getByText('Example content for testing', { exact: true })).toBeVisible();
    await expect(page.locator(`${hostSelector} .ps-nav`)).toBeVisible();
    await page.keyboard.press('Tab');
    const home = page.getByRole('link', { name: 'Alethical home', exact: true });
    await expect(home).toBeFocused();
    const identity = await page.evaluateHandle(() => {
      const iframe = document.querySelector<HTMLIFrameElement>('#replay-player')!;
      return { iframe, child: iframe.contentWindow };
    });
    const child = page.frameLocator('#replay-player');
    await child.getByRole('button', { name: 'Play example', exact: true }).click();
    await expect(child.getByText('Playing example', { exact: true })).toBeVisible();
    // Return to the static navigation control reached by the first Tab before
    // allowing the real header portal to replace it.
    await home.focus();
    gate.release();
    await expectMounted(page);
    await expect(page.getByRole('link', { name: 'Alethical home', exact: true })).toBeFocused();
    await expect
      .poll(() =>
        identity.evaluate(
          ({ iframe, child }) =>
            iframe === document.querySelector('#replay-player') && iframe?.contentWindow === child,
        ),
      )
      .toBe(true);
    await expect(child.getByText('Playing example', { exact: true })).toBeVisible();
    const player = page.locator('#replay-player');
    await expect(player).toHaveAttribute('data-example-controller-ready', 'true');
    const src = await player.getAttribute('src');
    const seek = async (seconds: 20 | 40) => {
      await page
        .getByRole('link', {
          name: seconds === 20 ? '0:20 Longer answer example' : '0:40 Closing example',
          exact: true,
        })
        .click();
      await expect(player).toHaveAttribute('data-last-seek', String(seconds));
      await expect(page).toHaveURL(new RegExp(`\\?t=${seconds}#watch$`));
    };
    await seek(20);
    await seek(40);
    await page.goBack();
    await expect(player).toHaveAttribute('data-last-seek', '20');
    await page.goForward();
    await expect(player).toHaveAttribute('data-last-seek', '40');
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${articlePath}$`));
    await expect(player).toHaveAttribute('data-last-seek', '20');
    await expect(player).toHaveAttribute('src', src!);
    expect(
      await identity.evaluate(
        ({ iframe, child }) =>
          iframe === document.querySelector('#replay-player') && iframe?.contentWindow === child,
      ),
    ).toBe(true);
    await expect(child.getByText('Playing example', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const failure = page.getByRole('dialog', { name: 'Sign-in unavailable', exact: true });
    await expect(failure).toBeVisible();
    const close = failure.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeVisible();
    await close.click();
    await expect(failure).toHaveCount(0);
    expect(
      await identity.evaluate(
        ({ iframe, child }) =>
          iframe === document.querySelector('#replay-player') && iframe?.contentWindow === child,
      ),
    ).toBe(true);
    await expect(child.getByText('Playing example', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Alethical home', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(hostSelector)).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveAttribute('data-stable-event-document');
    await expect(
      page.locator('#root').getByRole('link', { name: 'Alethical home', exact: true }),
    ).toBeVisible();
    await identity.dispose();
  } finally {
    gate.release();
  }
});

test('real deep saved scroll is restored after header and comments add their height', async ({
  page,
}) => {
  const saved = await saveDeepPosition(page);
  const gate = await reloadPending(page, saved);
  try {
    gate.release();
    await expectMounted(page);
    await expect(page.getByText('No comments yet', { exact: true })).toBeVisible();
    await expect
      .poll(async () => Math.abs((await scrollPosition(page)) - saved))
      .toBeLessThanOrEqual(2);
    await expect(page.locator(hostSelector)).not.toHaveAttribute('data-event-pending-scroll');
    await expect.poll(() => savedPosition(page)).toBe(String(saved));
  } finally {
    gate.release();
  }
});

for (const action of ['Tab', 'wheel'] as const) {
  test(`${action} while restoration waits preserves the reader's new position through startup`, async ({
    page,
  }) => {
    const saved = await saveDeepPosition(page);
    const gate = await reloadPending(page, saved);
    try {
      if (action === 'Tab') {
        await page.keyboard.press('Tab');
        await expect(page.getByRole('link', { name: 'Alethical home', exact: true })).toBeFocused();
      } else {
        await page.mouse.move(1000, 600);
        await page.mouse.wheel(0, -400);
      }
      await expect(page.locator(hostSelector)).not.toHaveAttribute('data-event-pending-scroll');
      const readerPosition = await scrollPosition(page);
      expect(readerPosition).toBeLessThan(saved - 100);
      const anchor =
        action === 'wheel'
          ? await page.locator(hostSelector).evaluateHandle((host) =>
              Array.from(host.querySelectorAll('main h2,main h3,main p,main summary')).find(
                (node) => {
                  const box = node.getBoundingClientRect();
                  return box.top >= 80 && box.bottom <= innerHeight - 40;
                },
              ),
            )
          : null;
      const anchorTop = anchor
        ? await anchor.evaluate((node) => {
            if (!node) throw new Error('Expected a visible article reading anchor');
            return node.getBoundingClientRect().top;
          })
        : null;
      gate.release();
      await expectMounted(page);
      if (action === 'Tab') {
        await expect(page.getByRole('link', { name: 'Alethical home', exact: true })).toBeFocused();
        await expect
          .poll(async () => Math.abs((await scrollPosition(page)) - readerPosition))
          .toBeLessThanOrEqual(2);
      } else {
        // Native anchoring may change the numeric offset when the header changes.
        // The same words must stay at the same visible position for a wheel reader.
        await expect
          .poll(async () =>
            Math.abs(
              (await anchor!.evaluate((node) => node!.getBoundingClientRect().top)) - anchorTop!,
            ),
          )
          .toBeLessThanOrEqual(2);
        expect(await scrollPosition(page)).toBeLessThan(saved - 100);
        await anchor!.dispose();
      }
      const finalPosition = await scrollPosition(page);
      await expect.poll(() => savedPosition(page)).toBe(String(finalPosition));
    } finally {
      gate.release();
    }
  });
}

test('server article uses the same computed text treatment as the shared article without snapshot ancestors', async ({
  page,
}) => {
  const gate = await gateAppEntry(page);
  try {
    await page.goto(articlePath, { waitUntil: 'commit' });
    await gate.reached;
    await expect(page.locator('.replay-content')).toBeVisible();
    const comparisons = await page.locator('.replay-content').evaluate((article) => {
      // A temporary test-only copy gives the browser the identical shared markup
      // without any snapshot ancestor. It adds no production test hook or CSS.
      const copy = article.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('iframe,script').forEach((node) => node.remove());
      copy.style.position = 'fixed';
      copy.style.left = '-10000px';
      copy.style.visibility = 'hidden';
      document.body.append(copy);
      try {
        return [
          '[data-replay-seek]',
          'h3[id^="topic-"]',
          '.event-downloads a',
          'details a',
          'summary',
        ].map((selector) => {
          const style = (node: Element) => {
            const computed = getComputedStyle(node);
            return {
              fontSize: computed.fontSize,
              fontWeight: computed.fontWeight,
              marginTop: computed.marginTop,
              underline: computed.textDecorationLine,
              color: computed.color,
            };
          };
          return {
            selector,
            stable: style(article.querySelector(selector)!),
            ordinary: style(copy.querySelector(selector)!),
          };
        });
      } finally {
        copy.remove();
      }
    });
    for (const { selector, stable, ordinary } of comparisons)
      expect(stable, selector).toEqual(ordinary);
  } finally {
    gate.release();
  }
});
