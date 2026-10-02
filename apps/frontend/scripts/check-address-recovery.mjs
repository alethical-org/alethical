// Isolated browser checks. All candidate responses are local fixtures, all writes
// are intercepted, and only public civic addresses are used. This does not test
// real phone keyboard autofill or prove the cause of a previously reported reload.
// BASE_URL=http://localhost:19058 node scripts/check-address-recovery.mjs
// Add --skip-recovery for an Expo development server without release chunks.
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from '@playwright/test';

const base = process.env.BASE_URL;
if (!base) throw new Error('Set BASE_URL to the preview or deployed site to check');
const recovery = !process.argv.includes('--skip-recovery');
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex < 0 ? '' : process.argv[onlyIndex + 1];
const browserType = process.argv.includes('--webkit')
  ? webkit
  : process.argv.includes('--firefox')
    ? firefox
    : chromium;
const browser = await browserType.launch({ headless: true });
const publicAddress = '350 S 5th St, Minneapolis, MN 55415';
const countryAddress = `${publicAddress}, United States`;
const candidateId = 'a'.repeat(64);
const election = {
  id: 'browser-check',
  label: 'State general election',
  date: '2099-11-03',
  type: 'general',
};
const source = {
  authority: 'Browser check fixture',
  url: 'https://example.org/records',
  checkedDate: '2026-10-02',
};
const results = {
  kind: 'results',
  electionId: election.id,
  matchedAddress: publicAddress,
  races: [
    {
      id: 'browser-race',
      group: 'state',
      office: 'State Representative',
      votingArea: 'House District 1A',
      seatCount: 1,
      source,
      entries: [
        {
          kind: 'candidate',
          candidate: {
            id: candidateId,
            name: 'Illustrative Browser Candidate',
            sortName: 'Browser',
          },
        },
      ],
    },
  ],
  coverage: [],
};
const report = [];
async function fresh(contextOptions = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    ...contextOptions,
  });
  const requests = [];
  const lookupReplies = [];
  const suggestions = [];
  const page = await context.newPage();
  let documents = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents += 1;
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/candidates/elections')) return json([election]);
    if (path.endsWith('/candidates/suggest')) return json(suggestions);
    if (path.endsWith('/candidates/lookup')) {
      requests.push(request.postDataJSON());
      return json(lookupReplies.shift() ?? results);
    }
    if (path.endsWith(`/candidates/${candidateId}`))
      return json({
        candidate: results.races[0].entries[0].candidate,
        election,
        office: 'State Representative',
        votingArea: 'House District 1A',
        source,
      });
    // Never send contact forms, metrics, sign-in requests, or other writes.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
      return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
  page.setDefaultTimeout(20000);
  return { context, page, requests, lookupReplies, suggestions, documents: () => documents };
}
async function silentFill(field, value) {
  await field.evaluate((node, text) => {
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, text);
  }, value);
}
async function waitForResults(page) {
  await page.getByText('Illustrative Browser Candidate', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => location.pathname), '/candidates');
  assert.equal(await page.evaluate(() => location.search), '');
}
async function submitFixture(page, from, method) {
  await page.goto(`${base}${from}`, { waitUntil: 'domcontentloaded' });
  const field = page.getByRole(from === '/' ? 'textbox' : 'combobox', {
    name: 'Full street address',
    exact: true,
  });
  await field.waitFor();
  // Wait for supported-election retrieval before replacing the field silently.
  const button = page.getByRole('button', { name: 'Find my candidates', exact: true });
  await button.waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (node) => node.textContent?.trim() === 'Find my candidates' && !node.disabled,
    ),
  );
  if (method === 'blur-button') await field.focus();
  await silentFill(field, countryAddress);
  if (method === 'keyboard') await field.press('Enter');
  else {
    if (method === 'blur-button') await field.evaluate((node) => node.blur());
    await button.click();
  }
  await waitForResults(page);
}
async function lateScriptFailure(page) {
  const path = '/_expo/static/js/web/address-recovery-check-missing.js';
  await page.route(`**${path}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 404, body: '' });
  });
  await page.evaluate(
    (path) =>
      new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = path;
        script.onerror = () => resolve();
        document.head.append(script);
      }),
    path,
  );
}
async function check(name, operation, contextOptions) {
  if (only && !name.includes(only)) return;
  const state = await fresh(contextOptions);
  try {
    await operation(state);
    report.push({ check: name, result: 'passed' });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        submitted: state.requests.length,
        lastSubmissionMatchedVisibleFixture: state.requests.at(-1)?.address === countryAddress,
        location: await state.page.evaluate(() => location.pathname),
        fieldMatchesFixture: await state.page
          .locator('textarea, input')
          .evaluateAll(
            (nodes, value) => nodes.some((node) => node.value === value),
            countryAddress,
          ),
        retryVisible: await state.page
          .getByRole('button', { name: 'Try again', exact: true })
          .count(),
        emptyErrorVisible: await state.page
          .getByText('Enter your full Minnesota street address', { exact: true })
          .count(),
      }) + '\n',
    );
    throw new Error(`${name}: ${error instanceof Error ? error.message : 'Failed'}`);
  } finally {
    await state.context.close();
  }
}
try {
  for (const from of ['/', '/candidates']) {
    for (const method of ['keyboard', 'button', 'blur-button']) {
      await check(`${from} silent browser fill via ${method}`, async (state) => {
        await submitFixture(state.page, from, method);
        assert.equal(state.requests.length, 1, 'Search submitted more than once');
        assert.equal(
          state.requests[0].address,
          countryAddress,
          'Search did not use visible field value',
        );
      });
    }
  }
  await check(
    'editing the previous address stays open until explicit cached submission',
    async (state) => {
      await submitFixture(state.page, '/candidates', 'keyboard');
      await state.page.getByRole('button', { name: 'Change address', exact: true }).click();
      const field = state.page.getByRole('combobox', { name: 'Full street address', exact: true });
      await field.fill('350 S');
      await field.fill(countryAddress);
      await state.page.waitForTimeout(1000);
      assert.equal(await field.inputValue(), countryAddress);
      assert.equal(state.requests.length, 1);
      await field.press('Enter');
      await field.waitFor({ state: 'detached' });
      await waitForResults(state.page);
      assert.equal(await field.count(), 0);
      assert.equal(
        state.requests.length,
        1,
        'Exact recent submission should use its cached result',
      );
    },
  );
  for (const action of ['click', 'tap']) {
    await check(
      `visible suggestions allow the first Search button ${action}`,
      async (state) => {
        await submitFixture(state.page, '/candidates', 'keyboard');
        state.suggestions.push({ id: 'civic', label: publicAddress, address: publicAddress });
        await state.page.getByRole('button', { name: 'Change address', exact: true }).click();
        const field = state.page.getByRole('combobox', {
          name: 'Full street address',
          exact: true,
        });
        await field.fill(`${countryAddress} `);
        await state.page.getByRole('option').waitFor();
        const button = state.page.getByRole('button', { name: 'Find my candidates', exact: true });
        const box = await button.boundingBox();
        if (action === 'tap')
          await state.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        else await state.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await state.page.waitForFunction(() => !document.querySelector('textarea'));
        await waitForResults(state.page);
        assert.equal(state.requests.length, 1);
      },
      { hasTouch: true },
    );
  }
  if (recovery) {
    await check(
      'failed homepage search corrected by keyboard survives delayed script failure for 30 seconds',
      async (state) => {
        state.lookupReplies.push({ kind: 'no-match' });
        await state.page.goto(base, { waitUntil: 'domcontentloaded' });
        const field = state.page.getByRole('textbox', { name: 'Full street address', exact: true });
        await field.waitFor();
        await silentFill(field, countryAddress);
        await field.press('Enter');
        await state.page
          .getByText(
            'We couldn’t match that address: check the street address, city, and ZIP code',
            { exact: true },
          )
          .waitFor();
        await field.fill(publicAddress);
        await field.press('Enter');
        await waitForResults(state.page);
        assert.equal(state.requests.length, 2);
        assert.equal(state.requests[1].address, publicAddress);
        assert.equal(await state.page.evaluate(() => window.__alethicalScreenDrawn), true);
        const before = state.documents();
        await lateScriptFailure(state.page);
        await state.page.waitForTimeout(30000);
        await waitForResults(state.page);
        assert.equal(state.documents(), before, 'Working results triggered a document reload');
      },
    );
    await check('direct homepage disables automatic reload after drawing', async (state) => {
      await state.page.goto(base, { waitUntil: 'domcontentloaded' });
      const field = state.page.getByRole('textbox', { name: 'Full street address', exact: true });
      await field.fill(publicAddress);
      assert.equal(await state.page.evaluate(() => window.__alethicalScreenDrawn), true);
      const before = state.documents();
      await lateScriptFailure(state.page);
      await state.page.waitForTimeout(1000);
      assert.equal(await field.inputValue(), publicAddress);
      assert.equal(state.documents(), before);
    });
    await check(
      'candidate profile download failure keeps Back and prior results working',
      async (state) => {
        await state.page.route('**/_expo/static/js/web/CandidateProfileScreen-*.js', (route) =>
          route.abort('failed'),
        );
        await submitFixture(state.page, '/candidates', 'keyboard');
        const before = state.documents();
        await state.page
          .getByRole('link', { name: 'View profile, Illustrative Browser Candidate', exact: true })
          .click();
        await state.page.getByText('This page hit a problem', { exact: true }).waitFor();
        assert.equal(state.documents(), before);
        await state.page.goBack();
        await waitForResults(state.page);
        assert.equal(state.documents(), before);
        assert.equal(state.requests.length, 1);
      },
    );
    await check('contact draft survives delayed script failure without a send', async (state) => {
      await state.page.goto(`${base}/about/contact`, { waitUntil: 'domcontentloaded' });
      const field = state.page.getByRole('textbox', { name: 'MESSAGE', exact: true });
      await field.fill('Private browser check draft, never sent');
      assert.equal(await state.page.evaluate(() => window.__alethicalScreenDrawn), true);
      const before = state.documents();
      await lateScriptFailure(state.page);
      await state.page.waitForTimeout(1000);
      assert.equal(await field.inputValue(), 'Private browser check draft, never sent');
      assert.equal(state.documents(), before);
    });
    await check(
      'failed sign-in download can close without losing an entered address',
      async (state) => {
        let failedChunks = 0;
        await state.page.route('**/_expo/static/js/web/signInBundle-*.js', (route) => {
          failedChunks += 1;
          return route.abort('failed');
        });
        await state.page.goto(base, { waitUntil: 'domcontentloaded' });
        const field = state.page.getByRole('textbox', { name: 'Full street address', exact: true });
        await field.fill(publicAddress);
        const before = state.documents();
        await state.page.getByRole('button', { name: 'Open menu', exact: true }).click();
        await state.page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await state.page.getByText('This page hit a problem', { exact: true }).waitFor();
        assert.ok(failedChunks > 0, 'The sign-in download failure was not exercised');
        await state.page.getByRole('button', { name: 'Close', exact: true }).click();
        await state.page
          .getByText('This page hit a problem', { exact: true })
          .waitFor({ state: 'hidden' });
        assert.equal(await field.inputValue(), publicAddress);
        assert.equal(state.documents(), before);
        assert.equal(state.requests.length, 0);
      },
    );
    await check(
      'initial required screen failure uses at most 1 automatic reload',
      async (state) => {
        let failedChunks = 0;
        await state.page.route('**/_expo/static/js/web/CandidatesScreen-*.js', (route) => {
          failedChunks += 1;
          return route.abort('failed');
        });
        await state.page
          .goto(`${base}/candidates`, { waitUntil: 'domcontentloaded' })
          .catch(() => {});
        await state.page.getByText('This page hit a problem', { exact: true }).waitFor();
        await state.page.waitForTimeout(1500);
        assert.ok(failedChunks >= 2, 'Initial failure/retry was not exercised');
        assert.equal(state.documents(), 2, 'Recovery did not stop after 1 automatic reload');
        assert.equal(
          await state.page.evaluate(() =>
            sessionStorage.getItem('alethical.release-program-reload'),
          ),
          '1',
        );
      },
    );
  }
  assert.ok(report.length > 0, 'No browser checks matched the requested filter');
  process.stdout.write(
    JSON.stringify(
      {
        browser: browserType.name(),
        checks: report,
        limitations: [
          'Browser value replacement is simulated, not native saved-address keyboard autofill',
          'Candidate API fixtures test browser behavior, not government matching',
          '390px viewport is not physical iOS or Android testing',
          'Injected script failures do not establish the cause of the original reported reset',
        ],
      },
      null,
      2,
    ) + '\n',
  );
} catch (error) {
  process.stderr.write(`FAIL ${error instanceof Error ? error.message : 'Browser check failed'}\n`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
