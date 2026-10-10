import { expect, test, type Locator, type Page, type Route, type TestInfo } from '@playwright/test';

// Local rendered acceptance only. Every API/provider request is intercepted,
// including all writes; no QA database, provider account, or email is changed.
const candidateId = 'f'.repeat(64);
const claimId = '00000000-0000-4000-8000-000000000091';
const accountId = '00000000-0000-4000-8000-000000000092';
const applicantId = '00000000-0000-4000-8000-000000000093';
const profilePath = `/candidates/${candidateId}`;
const claimPath = '/api/v1/candidate-claims/me';
const adminPath = '/api/v1/admin/candidate-claims';
const linkLabel = 'Link to a campaign website or official record';
const explanationLabel = 'Explain your role and how Alethical can confirm it';
const noteLabel = 'Private review note';
const record = {
  candidate: { id: candidateId, name: 'Example Interaction Candidate', sortName: 'Candidate' },
  office: 'School board member',
  votingArea: 'Example School District',
  election: { id: 'fictional', label: 'General election', date: '2099-11-03', type: 'general' },
  electionEnded: false,
  source: {
    authority: 'Example Election Office',
    url: 'https://example.org/election',
    checkedDate: '2026-10-08',
  },
};
const pending = {
  id: claimId,
  candidate_id: candidateId,
  user_id: applicantId,
  candidate_name: record.candidate.name,
  office: record.office,
  voting_area: record.votingArea,
  election_name: record.election.label,
  election_date: record.election.date,
  account_email: 'fictional-applicant@example.invalid',
  status: 'pending',
  version: 1,
  evidence_url: 'https://example.org/campaign',
  request_note: 'Candidate\n\nFictional evidence for a controlled browser test',
  created_at: '2026-10-08T12:00:00Z',
  submitted_at: '2026-10-08T12:00:00Z',
  official_source: record.source,
  official_checked_at: '2026-10-08T12:00:00Z',
  election_ended: false,
  can_manage: false,
  can_request_review: false,
  history: [],
  history_complete: true,
  approval_block: null,
};
type Held = { route: Route; path: string; method: string; body: unknown };
async function fixture(page: Page, role: 'candidate' | 'admin' | 'check-admin' = 'candidate') {
  const app = new URL(test.info().project.use.baseURL!);
  if (!['127.0.0.1', 'localhost'].includes(app.hostname))
    throw Error('Only a local app is allowed');
  page.on('pageerror', (error) => console.log('Fictional browser error:', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Error'))
      console.log('Fictional console error:', message.text());
  });
  const email = `${role}@profile-interactions.invalid`;
  const user = {
    id: accountId,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Example Browser Reviewer' },
    created_at: '2026-01-01T00:00:00Z',
  };
  await page.addInitScript(
    ({ user }) => {
      const session = {
        access_token: 'clearly-fake-local-interaction-token',
        refresh_token: 'clearly-fake-local-refresh',
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user,
      };
      localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
      localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session));
    },
    { user },
  );
  const state = {
    claims: [] as Record<string, unknown>[],
    detail: { ...pending } as Record<string, unknown>,
    statement: {
      body: 'Published fictional campaign statement',
      updated_at: '2026-10-08T12:00:00Z',
      version: 1,
    } as null | { body: string; updated_at: string; version: number },
    queue: [{ ...pending }] as Record<string, unknown>[],
    writes: [] as Held[],
    reads: [] as string[],
    handlers: new Map<string, (route: Route) => Promise<unknown> | void>(),
  };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === app.origin && !url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/api/v1/site-metrics/events') return route.fulfill({ status: 204 });
    if (path === '/auth/v1/user') return route.fulfill({ json: user });
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (request.method() !== 'GET') {
      state.writes.push({ route, path, method: request.method(), body: request.postDataJSON() });
      return; // Explicitly held until the test resolves it; never falls through.
    }
    state.reads.push(path);
    const override = state.handlers.get(path);
    if (override) return override(route);
    if (path === '/api/v1/me')
      return route.fulfill({
        json: {
          data: {
            id: accountId,
            primary_email: email,
            display_name: 'Example Browser Reviewer',
            sign_in_methods: { google: false, password: true },
            ...(role === 'check-admin' ? {} : { is_admin: role === 'admin' }),
          },
        },
      });
    if (path === '/api/v1/admin/access')
      return route.fulfill({ json: { data: { is_admin: true } } });
    if (path === `/api/v1/candidates/${candidateId}`) return route.fulfill({ json: record });
    if (path === `/api/v1/candidate-statements/${candidateId}`)
      return route.fulfill({ json: { statement: null } });
    if (path === claimPath)
      return route.fulfill({
        json: {
          account_id: accountId,
          claims: state.claims,
          is_admin: role === 'admin',
          request_eligibility: { allowed: true, reason: null },
          already_claimed: false,
        },
      });
    if (path === `/api/v1/candidate-claims/${claimId}/statement`)
      return route.fulfill({
        json: { account_id: accountId, statement: state.statement, history: [] },
      });
    if (path === adminPath)
      return route.fulfill({
        json: { account_id: accountId, claims: state.queue, offset: 0, has_more: false },
      });
    if (path === `${adminPath}/${claimId}`)
      return route.fulfill({ json: { account_id: accountId, claim: state.detail } });
    if (path === `${adminPath}/pending-count`)
      return route.fulfill({ json: { account_id: accountId, pending_count: 1 } });
    if (path === '/api/v1/admin/candidate-statement-reports')
      return route.fulfill({
        json: { account_id: accountId, reports: [], offset: 0, has_more: false },
      });
    // Unused tracking/account services get no data; external services never run.
    return route.fulfill({ status: 404, json: { detail: 'Unconfigured fictional response' } });
  });
  return {
    state,
    hold(path: string) {
      const held: Route[] = [];
      state.handlers.set(path, (route) => {
        held.push(route);
      });
      return held;
    },
    restore(path: string) {
      state.handlers.delete(path);
    },
  };
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
async function bounds(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  return control.evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { width: r.width, height: r.height, left: r.left, top: r.top };
  });
}
async function sameBox(control: Locator, before: Awaited<ReturnType<typeof bounds>>) {
  const after = await bounds(control);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
}
async function repeatPress(page: Page, control: Locator, touch = false) {
  const box = (await control.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}
async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
async function style(control: Locator) {
  return control.evaluate((element) => {
    const s = getComputedStyle(element);
    return {
      background: s.backgroundColor,
      border: s.borderColor,
      outline: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      focusVisible: element.matches(':focus-visible'),
    };
  });
}
async function activeHover(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  const resting = await style(control);
  await control.hover();
  expect((await style(control)).background).not.toBe(resting.background);
  await page.mouse.move(1, 1);
}
async function inactiveHover(page: Page, control: Locator) {
  await page.mouse.move(1, 1);
  const resting = await style(control);
  await control.hover();
  expect(await style(control)).toEqual(resting);
}
async function keyboardFocus(page: Page, control: Locator) {
  // WebKit moves Tab between text fields only; Option+Tab reaches every control, as in Safari.
  const key = page.context().browser()?.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab';
  for (let step = 0; step < 70; step++) {
    await page.keyboard.press(key);
    if (await control.evaluate((element) => element === document.activeElement)) return;
  }
  throw Error('Control was not reachable with the keyboard');
}

for (const width of [390, 1280]) {
  test(`I01 profile status loading failure retry at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const api = await fixture(page);
    api.state.claims = [{ ...pending }];
    const held = api.hold(claimPath);
    await page.goto(profilePath);
    await expect(page.getByText('Loading profile claim status…', { exact: true })).toBeVisible();
    await expect.poll(() => held.length).toBeGreaterThan(0);
    api.state.handlers.set(claimPath, (route) => route.fulfill({ status: 503, json: {} }));
    await Promise.all(held.map((route) => route.fulfill({ status: 503, json: {} })));
    await expect(
      page.getByText('We couldn’t load your profile claim status', { exact: true }),
    ).toBeVisible();
    await screenshot(page, info, 'profile-status-failure');
    api.restore(claimPath);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'View profile claim status', exact: true }),
    ).toBeVisible();
    if (width === 1280)
      await activeHover(
        page,
        page.getByRole('link', { name: 'View profile claim status', exact: true }),
      );
    await noHorizontalOverflow(page);
    expect(api.state.writes).toHaveLength(0);
  });
}

test.describe('phone touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('I02 long form validation and uncertain submission recovery', async ({ page }, info) => {
    const api = await fixture(page);
    await page.goto(`${profilePath}/claim`);
    await page.getByRole('radio', { name: 'Candidate', exact: true }).tap();
    await page
      .getByLabel(linkLabel, { exact: true })
      .fill(`https://example.org/${'a'.repeat(2000)}`);
    await page.getByLabel(explanationLabel, { exact: true }).fill('a'.repeat(1901));
    await page.getByRole('button', { name: 'Submit profile claim request', exact: true }).tap();
    await expect(
      page.getByText('Use a web address with no more than 2000 characters', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Keep your explanation to 1900 characters or fewer', { exact: true }),
    ).toBeVisible();
    expect(api.state.writes).toHaveLength(0);
    await screenshot(page, info, 'long-validation-errors');
    await page.getByLabel(linkLabel, { exact: true }).fill('https://example.org/campaign');
    await page
      .getByLabel(explanationLabel, { exact: true })
      .fill('Fictional campaign evidence for this controlled request');
    const button = page.getByRole('button', { name: 'Submit profile claim request', exact: true });
    const before = await bounds(button);
    await button.tap();
    const busy = page.getByRole('button', {
      name: 'Submitting profile claim request…',
      exact: true,
    });
    await expect(busy).toHaveAttribute('aria-disabled', 'true');
    await sameBox(busy, before);
    await repeatPress(page, busy, true);
    await expect.poll(() => api.state.writes.length).toBe(1);
    await screenshot(page, info, 'submit-busy-phone');
    await api.state.writes[0].route.fulfill({ status: 503, json: {} });
    await expect(
      page.getByText(
        'We couldn’t confirm whether your profile claim request was submitted. Reload its status before trying again.',
        { exact: true },
      ),
    ).toBeVisible();
    api.state.claims = [{ ...pending }];
    await page.getByRole('button', { name: 'Reload profile claim status', exact: true }).tap();
    await expect(
      page.getByRole('heading', { name: 'Profile claim request received', exact: true }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
  });
  test('I03 account sheet accepts its lower admin row without clicking through', async ({
    page,
  }, info) => {
    const api = await fixture(page, 'admin');
    await page.goto(profilePath);
    await expect(
      page.getByRole('link', { name: 'Review profile claim requests', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Account menu', exact: true }).tap();
    const sheet = page.getByRole('dialog', { name: 'Account', exact: true });
    const row = sheet.getByRole('link', { name: /Profile claim requests/ });
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible();
    await screenshot(page, info, 'account-sheet-phone');
    await row.tap();
    await expect(page).toHaveURL(/\/admin\/candidate-claims$/);
    await expect(sheet).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Profile claim requests', exact: true }),
    ).toBeVisible();
    expect(api.state.writes).toHaveLength(0);
  });
});

for (const width of [390, 1280]) {
  test(`I04 uncertain statement save and give-up recovery at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const api = await fixture(page);
    api.state.claims = [{ ...pending, status: 'approved', can_manage: true }];
    await page.goto(`${profilePath}/manage`);
    const editor = page.getByRole('textbox', { name: 'Campaign statement', exact: true });
    await editor.fill('Unsaved fictional words that must survive a failed save');
    const save = page.getByRole('button', { name: 'Save changes', exact: true });
    if (width === 1280) {
      await activeHover(page, save);
      await activeHover(page, page.getByRole('button', { name: 'Remove statement', exact: true }));
    }
    const before = await bounds(save);
    await save.click();
    const busy = page.getByRole('button', { name: 'Saving…', exact: true });
    await sameBox(busy, before);
    if (width === 1280) await inactiveHover(page, busy);
    await repeatPress(page, busy);
    await expect.poll(() => api.state.writes.length).toBe(1);
    await api.state.writes[0].route.fulfill({ status: 503, json: {} });
    await expect(
      page.getByText('We couldn’t complete this request', { exact: true }),
    ).toBeVisible();
    await expect(editor).toHaveValue('Unsaved fictional words that must survive a failed save');
    await expect(editor).toBeEditable();
    // Try again reads what is saved first; the save had not landed, so it is sent once more.
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect.poll(() => api.state.writes.length).toBe(2);
    expect(api.state.writes[1].body).toMatchObject({
      body: 'Unsaved fictional words that must survive a failed save',
    });
    api.state.statement = {
      body: 'Unsaved fictional words that must survive a failed save',
      updated_at: '2026-10-09T12:00:00Z',
      version: 2,
    };
    await api.state.writes[1].route.fulfill({ json: { statement: api.state.statement } });
    await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();
    await expect(editor).toHaveValue('Unsaved fictional words that must survive a failed save');
    await screenshot(page, info, 'uncertain-save-recovered');
    await page.getByRole('button', { name: 'Give up this profile claim', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Give up this profile claim?', exact: true });
    const confirm = dialog.getByRole('button', { name: 'Give up profile claim', exact: true });
    if (width === 1280) await activeHover(page, confirm);
    const confirmBefore = await bounds(confirm);
    await confirm.click();
    const giving = dialog.getByRole('button', { name: 'Giving up profile claim…', exact: true });
    await sameBox(giving, confirmBefore);
    await expect(
      dialog.getByRole('button', { name: 'Keep profile claim', exact: true }),
    ).toHaveAttribute('aria-disabled', 'true');
    await repeatPress(page, giving);
    await expect.poll(() => api.state.writes.length).toBe(3);
    await screenshot(page, info, 'give-up-busy');
    await api.state.writes[2].route.fulfill({ status: 503, json: {} });
    await expect(
      page.getByText(
        'We couldn’t confirm whether your profile claim was given up. Reload its status before trying again.',
        { exact: true },
      ),
    ).toBeVisible();
    api.state.claims = [
      {
        ...pending,
        status: 'withdrawn',
        can_manage: false,
        last_event_kind: 'given_up',
        statement_removed: true,
      },
    ];
    await page.getByRole('button', { name: 'Reload profile claim status', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByText(/You gave up your profile claim/)).toBeVisible();
    await noHorizontalOverflow(page);
  });
}

test('I05 admin list slow failure retry and unknown decision recovery', async ({ page }, info) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  const api = await fixture(page, 'admin');
  const held = api.hold(adminPath);
  await page.goto('/admin/candidate-claims');
  await expect(page.getByText('Loading profile claim requests…', { exact: true })).toBeVisible();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  api.state.handlers.set(adminPath, (route) => route.fulfill({ status: 503, json: {} }));
  await Promise.all(held.map((route) => route.fulfill({ status: 503, json: {} })));
  await expect(
    page.getByText('Profile claim requests are unavailable', { exact: true }),
  ).toBeVisible();
  api.restore(adminPath);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await activeHover(page, page.getByRole('button', { name: 'Pending', exact: true }));
  await page
    .getByRole('link', {
      name: `Review profile claim request for ${record.candidate.name}`,
      exact: true,
    })
    .click();
  await page.getByLabel(noteLabel, { exact: true }).fill('x'.repeat(2001));
  await page.getByRole('button', { name: 'Reject request', exact: true }).click();
  await expect(
    page.getByText('Keep the private review note to 2000 characters or fewer', { exact: true }),
  ).toBeVisible();
  expect(api.state.writes).toHaveLength(0);
  await page
    .getByLabel(noteLabel, { exact: true })
    .fill('Fictional independent review evidence for a controlled decision');
  const reject = page.getByRole('button', { name: 'Reject request', exact: true });
  const before = await bounds(reject);
  await reject.click();
  const busy = page.getByRole('button', { name: 'Rejecting request…', exact: true });
  await sameBox(busy, before);
  await repeatPress(page, busy);
  await expect.poll(() => api.state.writes.length).toBe(1);
  await screenshot(page, info, 'decision-busy');
  await api.state.writes[0].route.fulfill({ status: 503, json: {} });
  await expect(
    page.getByText(
      'We couldn’t confirm whether this profile claim decision was saved. Reload the request before trying again.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject request', exact: true })).toHaveCount(0);
  api.state.detail = { ...pending, status: 'rejected', version: 2 };
  await page.getByRole('button', { name: 'Reload profile claim request', exact: true }).click();
  await expect(page.getByText('Profile claim not approved', { exact: true })).toBeVisible();
  await screenshot(page, info, 'decision-unknown-recovered');
});

test('I06 admin hover focus disabled hover and enlarged evidence', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const api = await fixture(page, 'admin');
  api.state.detail = {
    ...pending,
    evidence_url: `https://example.org/${'long-public-evidence-'.repeat(60)}`,
    request_note: 'Fictional evidence '.repeat(80),
    approval_block: { reason: 'official_record_mismatch', message: 'Unused source message' },
  };
  await page.goto(`/admin/candidate-claims?claim=${claimId}`);
  const reject = page.getByRole('button', { name: 'Reject request', exact: true });
  const approve = page.getByRole('button', { name: 'Approve request', exact: true });
  await reject.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  const ready = await style(reject);
  await reject.hover();
  expect((await style(reject)).background).not.toBe(ready.background);
  await approve.hover();
  const disabled = await style(approve);
  await page.mouse.move(1, 1);
  expect(await style(approve)).toEqual(disabled);
  await keyboardFocus(page, reject);
  expect(await style(reject)).toMatchObject({ outline: 'solid', focusVisible: true });
  await screenshot(page, info, 'admin-keyboard-focus');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: 'Review profile claim request', exact: true }),
  ).toHaveCSS('font-size', '30px');
  await page.evaluate(() => {
    // Controlled 200% text enlargement, not browser zoom or an OS text setting.
    const values = [...document.body.querySelectorAll<HTMLElement>('*')].map((element) => {
      const css = getComputedStyle(element);
      return { element, font: parseFloat(css.fontSize), line: parseFloat(css.lineHeight) };
    });
    for (const { element, font, line } of values) {
      if (Number.isFinite(font)) element.style.fontSize = `${font * 2}px`;
      if (Number.isFinite(line)) element.style.lineHeight = `${line * 2}px`;
    }
  });
  await noHorizontalOverflow(page);
  const evidenceLink = page
    .locator('a')
    .filter({ hasText: api.state.detail.evidence_url as string });
  await evidenceLink.scrollIntoViewIfNeeded();
  await screenshot(page, info, 'admin-long-url-double-text');
  await info.attach('enlarged-link-bounds', {
    contentType: 'application/json',
    body: JSON.stringify(
      await evidenceLink.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return {
          viewport: innerWidth,
          link: element.getBoundingClientRect().toJSON(),
          contents: [...range.getClientRects()].map((rect) => rect.toJSON()),
        };
      }),
    ),
  });
  const confirmed = await page.getByText('Email confirmed', { exact: true }).boundingBox();
  const submitted = await page.getByText('Submitted', { exact: true }).boundingBox();
  await info.attach('enlarged-label-bounds', {
    contentType: 'application/json',
    body: JSON.stringify({ confirmed, submitted }),
  });
  expect(submitted!.y).toBeGreaterThanOrEqual(confirmed!.y + confirmed!.height);
  expect(
    await evidenceLink.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].every(
        (rect) => rect.left >= -1 && rect.right <= innerWidth + 1,
      );
    }),
  ).toBe(true);
  const trailingArrow = evidenceLink.locator('svg');
  await trailingArrow.scrollIntoViewIfNeeded();
  await expect(trailingArrow).toBeInViewport();
  const arrowBox = (await trailingArrow.boundingBox())!;
  expect(arrowBox.x).toBeGreaterThanOrEqual(0);
  expect(arrowBox.x + arrowBox.width).toBeLessThanOrEqual(391);
  expect(
    await evidenceLink.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let last: Text | null = null;
      while (walker.nextNode())
        if (walker.currentNode.textContent?.trim()) last = walker.currentNode as Text;
      const range = document.createRange();
      range.setStart(last!, last!.length - 1);
      range.setEnd(last!, last!.length);
      const character = range.getBoundingClientRect();
      const arrow = element.querySelector('svg')!.getBoundingClientRect();
      return arrow.top < character.bottom && arrow.bottom > character.top;
    }),
  ).toBe(true);
  await screenshot(page, info, 'admin-long-url-trailing-arrow-double-text');
  await page.getByLabel(noteLabel, { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel(noteLabel, { exact: true })).toBeVisible();
  await screenshot(page, info, 'admin-long-evidence-double-text');
  await reject.scrollIntoViewIfNeeded();
  const rejectBox = (await reject.boundingBox())!;
  expect(rejectBox.x).toBeGreaterThanOrEqual(0);
  expect(rejectBox.x + rejectBox.width).toBeLessThanOrEqual(391);
  await screenshot(page, info, 'admin-actions-double-text');
  expect(api.state.writes).toHaveLength(0);
});

test('I07 account count failure and slow diagonal menu pointer movement', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const api = await fixture(page, 'admin');
  const held = api.hold(`${adminPath}/pending-count`);
  await page.goto(profilePath);
  const trigger = page.getByRole('button', {
    name: 'Account panel for Example Browser Reviewer',
    exact: true,
  });
  await trigger.click();
  const row = page.getByRole('link', { name: /Profile claim requests/ });
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAccessibleName(/0 pending/);
  await expect.poll(() => held.length).toBeGreaterThan(0);
  api.state.handlers.set(`${adminPath}/pending-count`, (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await Promise.all(held.map((route) => route.fulfill({ status: 503, json: {} })));
  await expect(row).not.toHaveAccessibleName(/0 pending/);
  const from = (await trigger.boundingBox())!;
  const first = page.getByRole('link', { name: /^Tracked/ }).filter({ visible: true });
  const to = (await first.boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2 - 20, y: to.y + to.height / 2 };
  await page.mouse.move(start.x, start.y);
  for (let step = 1; step <= 30; step++) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * step) / 30,
      start.y + ((end.y - start.y) * step) / 30,
    );
    await page.waitForTimeout(25);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  }
  const lower = (await row.boundingBox())!;
  await page.mouse.move(lower.x + lower.width / 2, lower.y + lower.height / 2, { steps: 20 });
  await expect(row).toBeVisible();
  await screenshot(page, info, 'desktop-menu-count-unavailable');
  await row.click();
  await expect(page).toHaveURL(/\/admin\/candidate-claims$/);
  await expect(
    page.getByRole('heading', { name: 'Profile claim requests', exact: true }),
  ).toBeVisible();
  expect(api.state.writes).toHaveLength(0);
});

test('I08 administrator permission loading failure retry', async ({ page }, info) => {
  const api = await fixture(page, 'check-admin');
  const held = api.hold('/api/v1/admin/access');
  await page.goto(`/admin/candidate-claims?claim=${claimId}`);
  await expect(page.getByText('Checking administrator access…', { exact: true })).toBeVisible();
  await expect(page.getByText(pending.account_email, { exact: true })).toHaveCount(0);
  await expect.poll(() => held.length).toBeGreaterThan(0);
  api.state.handlers.set('/api/v1/admin/access', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await Promise.all(held.map((route) => route.fulfill({ status: 503, json: {} })));
  await expect(
    page.getByText('We couldn’t check administrator access', { exact: true }),
  ).toBeVisible();
  await screenshot(page, info, 'admin-permission-failure');
  api.restore('/api/v1/admin/access');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText(pending.account_email, { exact: true })).toBeVisible();
  expect(api.state.writes).toHaveLength(0);
});

test('I09 applicant load retry and unknown withdrawal preserve joint ticket return', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await fixture(page);
  const name = 'Example Person A and Example Person B';
  const ticket = {
    ...record,
    candidate: { ...record.candidate, name },
    office: 'Governor and Lieutenant Governor',
    isJointTicket: true,
    electionEnded: true,
    election: { ...record.election, date: '2024-11-05' },
  };
  api.state.handlers.set(`/api/v1/candidates/${candidateId}`, (route) =>
    route.fulfill({ json: ticket }),
  );
  api.state.claims = [
    {
      ...pending,
      candidate_name: name,
      office: ticket.office,
      election_date: ticket.election.date,
      election_ended: true,
    },
  ];
  const held = api.hold(claimPath);
  await page.goto(`${profilePath}/claim`);
  await expect(page.getByText('Loading profile claim status…', { exact: true })).toBeVisible();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  api.state.handlers.set(claimPath, (route) => route.fulfill({ status: 503, json: {} }));
  await Promise.all(held.map((route) => route.fulfill({ status: 503, json: {} })));
  await expect(
    page.getByText('We couldn’t load your profile claim status', { exact: true }),
  ).toBeVisible();
  await screenshot(page, info, 'applicant-status-failure');
  api.restore(claimPath);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Election ended', exact: true })).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(
    page.getByText('Campaign website or official record', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Your explanation', { exact: true })).toBeVisible();
  const withdraw = page.getByRole('button', { name: 'Withdraw request', exact: true });
  const before = await bounds(withdraw);
  await withdraw.click();
  const busy = page.getByRole('button', { name: 'Withdrawing request…', exact: true });
  await sameBox(busy, before);
  await repeatPress(page, busy);
  await expect.poll(() => api.state.writes.length).toBe(1);
  await api.state.writes[0].route.fulfill({ status: 503, json: {} });
  await expect(
    page.getByText(
      'We couldn’t confirm whether your profile claim request was withdrawn. Reload its status before trying again.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw request', exact: true })).toHaveCount(0);
  await screenshot(page, info, 'withdrawal-unknown-joint-ticket');
  api.state.claims = [{ ...api.state.claims[0], status: 'withdrawn', version: 2 }];
  await page.getByRole('button', { name: 'Reload profile claim status', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Profile claim request withdrawn', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Profile claims are closed for this election', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'View public profile', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${profilePath}$`));
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
});

test('I10 statement report load failure retry retains its independent section', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await fixture(page, 'admin');
  const path = '/api/v1/admin/candidate-statement-reports';
  const held = api.hold(path);
  await page.goto('/admin/candidate-claims');
  await expect(page.getByText('Loading reports…', { exact: true })).toBeVisible();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  api.state.handlers.set(path, (route) => route.fulfill({ status: 503, json: {} }));
  await Promise.all(held.map((route) => route.fulfill({ status: 503, json: {} })));
  await expect(page.getByText('Statement reports are unavailable', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: `Review profile claim request for ${record.candidate.name}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('No unresolved statement reports', { exact: true })).toHaveCount(0);
  await screenshot(page, info, 'reports-failure-phone');
  api.restore(path);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('No unresolved statement reports', { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  expect(api.state.writes).toHaveLength(0);
});

test('I11 already claimed after election keeps closed explanation and public return', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await fixture(page);
  api.state.handlers.set(`/api/v1/candidates/${candidateId}`, (route) =>
    route.fulfill({
      json: {
        ...record,
        electionEnded: true,
        election: { ...record.election, date: '2024-11-05' },
      },
    }),
  );
  api.state.handlers.set(claimPath, (route) =>
    route.fulfill({
      json: {
        account_id: accountId,
        claims: [],
        is_admin: false,
        already_claimed: true,
        request_eligibility: { allowed: false, reason: 'election_ended' },
      },
    }),
  );
  await page.goto(`${profilePath}/claim`);
  await expect(
    page.getByRole('heading', { name: 'This profile is already claimed', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Profile claims are closed for this election', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request a review', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Submit profile claim request', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'View public profile', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${profilePath}$`));
  await expect(
    page.getByRole('heading', { name: record.candidate.name, exact: true }),
  ).toBeVisible();
  await screenshot(page, info, 'other-owner-closed-public-return');
  expect(api.state.writes).toHaveLength(0);
});

test('I12 browser back keep discard and forward preserve the correct draft boundary', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await fixture(page);
  api.state.claims = [{ ...pending, status: 'approved', can_manage: true }];
  await page.goto(profilePath);
  await activeHover(page, page.getByRole('link', { name: 'Manage this profile', exact: true }));
  await page.getByRole('link', { name: 'Manage this profile', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Campaign statement', exact: true });
  await editor.fill('Unsaved history check draft');
  await page.goBack();
  const dialog = page.getByRole('dialog', { name: 'You have unsaved changes', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(editor).toHaveValue('Unsaved history check draft');
  await expect(editor).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${profilePath}/manage$`));
  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${profilePath}$`));
  await expect(
    page.getByRole('heading', { name: record.candidate.name, exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(editor).toHaveValue('Published fictional campaign statement');
  await screenshot(page, info, 'back-discard-forward-clean-editor');
  expect(api.state.writes).toHaveLength(0);
});

test('I13 choosing Reject after an approval checkbox error keeps the busy action steady', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const api = await fixture(page, 'admin');
  await page.goto(`/admin/candidate-claims?claim=${claimId}`);
  await page
    .getByLabel(noteLabel, { exact: true })
    .fill('Fictional review evidence explaining why this request should be rejected');
  await page.getByRole('button', { name: 'Approve request', exact: true }).click();
  await expect(
    page.getByText(
      'Confirm that you independently verified the applicant’s identity and campaign authority before approving',
      { exact: true },
    ),
  ).toBeVisible();
  expect(api.state.writes).toHaveLength(0);
  const reject = page.getByRole('button', { name: 'Reject request', exact: true });
  const before = await bounds(reject);
  await reject.click();
  const busy = page.getByRole('button', { name: 'Rejecting request…', exact: true });
  await screenshot(page, info, 'reject-after-approval-error-busy');
  await sameBox(busy, before);
  await repeatPress(page, busy);
  await expect.poll(() => api.state.writes.length).toBe(1);
  await api.state.writes[0].route.fulfill({ status: 503, json: {} });
  await expect(
    page.getByRole('button', { name: 'Reload profile claim request', exact: true }),
  ).toBeVisible();
});
