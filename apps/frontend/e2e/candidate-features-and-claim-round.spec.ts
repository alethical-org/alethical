import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

// Local rendered acceptance only, with labelled fictional records. Every API and
// sign-in request is intercepted and every write is held for the test to answer;
// no account, claim, statement, report or email anywhere is created or changed.
const candidateId = 'e'.repeat(64);
const claimId = '00000000-0000-4000-8000-000000000190';
const accountId = '00000000-0000-4000-8000-000000000191';
const profilePath = `/candidates/${candidateId}`;
const mePath = '/api/v1/candidate-claims/me';
const bands = [
  { name: 'computer', width: 1280 },
  { name: 'tablet', width: 900 },
  { name: 'phone', width: 390 },
] as const;
const record = {
  candidate: { id: candidateId, name: 'Example Person A', sortName: 'A, Example' },
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
const claim = {
  id: claimId,
  candidate_id: candidateId,
  candidate_name: record.candidate.name,
  office: record.office,
  voting_area: record.votingArea,
  election_name: record.election.label,
  election_date: record.election.date,
  status: 'pending',
  version: 1,
  evidence_url: 'https://example-campaign.org/about',
  request_note:
    'Candidate\n\nIllustrative: I am the candidate. My campaign website lists this account’s email on its contact page.',
  submitted_at: '2026-10-09T15:00:00Z',
  election_ended: false,
  can_manage: false,
  can_request_review: false,
};
type Held = { route: Route; path: string; method: string; body: unknown };

async function fixture(page: Page, options: { signedIn?: boolean; admin?: boolean } = {}) {
  const app = new URL(test.info().project.use.baseURL!);
  if (!['127.0.0.1', 'localhost'].includes(app.hostname))
    throw Error('Only a local app is allowed');
  const signedIn = options.signedIn ?? true;
  const email = 'fictional-applicant@example.invalid';
  const user = {
    id: accountId,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Example Browser Applicant' },
    created_at: '2026-01-01T00:00:00Z',
  };
  if (signedIn)
    await page.addInitScript(
      ({ user }) => {
        const session = {
          access_token: 'clearly-fake-local-round-token',
          refresh_token: 'clearly-fake-local-round-refresh',
          token_type: 'bearer',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user,
        };
        localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
      },
      { user },
    );
  const state = {
    record: { ...record } as Record<string, unknown>,
    me: {
      account_id: accountId,
      claims: [] as Record<string, unknown>[],
      is_admin: Boolean(options.admin),
      request_eligibility: { allowed: true, reason: null } as {
        allowed: boolean;
        reason: string | null;
      },
      already_claimed: false,
    },
    publicStatement: null as null | Record<string, unknown>,
    privateStatement: null as null | Record<string, unknown>,
    detail: null as null | Record<string, unknown>,
    writes: [] as Held[],
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
      return;
    }
    const override = state.handlers.get(path);
    if (override) return override(route);
    if (path === '/api/v1/me')
      return route.fulfill({
        json: {
          data: {
            id: accountId,
            primary_email: email,
            display_name: 'Example Browser Applicant',
            sign_in_methods: { google: false, password: true },
            is_admin: Boolean(options.admin),
          },
        },
      });
    if (path === '/api/v1/admin/access')
      return options.admin
        ? route.fulfill({ json: { data: { is_admin: true } } })
        : route.fulfill({ status: 403, json: {} });
    if (path === `/api/v1/candidates/${candidateId}`) return route.fulfill({ json: state.record });
    if (path === `/api/v1/candidate-statements/${candidateId}`)
      return route.fulfill({ json: { statement: state.publicStatement } });
    if (path === mePath) return route.fulfill({ json: state.me });
    if (path === `/api/v1/candidate-claims/${claimId}/statement`)
      return route.fulfill({
        json: { account_id: accountId, statement: state.privateStatement, history: [] },
      });
    if (path === `/api/v1/admin/candidate-claims/${claimId}`)
      return route.fulfill({ json: { account_id: accountId, claim: state.detail } });
    if (path === '/api/v1/admin/candidate-claims/pending-count')
      return route.fulfill({ json: { account_id: accountId, pending_count: 1 } });
    return route.fulfill({ status: 404, json: { detail: 'Unconfigured fictional response' } });
  });
  return state;
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}
async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
async function box(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  return (await control.boundingBox())!;
}
// Design's settled statement spacing, top / sides / bottom, for the content area and its white
// text box; the disclosure footer keeps 10px top and bottom with the content's side padding.
const statementSpacing = {
  computer: { content: [26, 28, 24], quote: [20, 22, 20], footer: [10, 28] },
  tablet: { content: [24, 24, 22], quote: [18, 20, 18], footer: [10, 24] },
  phone: { content: [20, 18, 18], quote: [16, 16, 16], footer: [10, 18] },
} as const;
async function expectStatementSpacing(card: Locator, name: keyof typeof statementSpacing) {
  const measured = await card.evaluate((element) => {
    const [content, footer] = [...element.children] as HTMLElement[];
    const quote = content.children[1] as HTMLElement;
    const read = (node: HTMLElement) => {
      const css = getComputedStyle(node);
      return [css.paddingTop, css.paddingLeft, css.paddingRight, css.paddingBottom].map(parseFloat);
    };
    return { content: read(content), quote: read(quote), footer: read(footer) };
  });
  const want = statementSpacing[name];
  expect(measured.content).toEqual([
    want.content[0],
    want.content[1],
    want.content[1],
    want.content[2],
  ]);
  expect(measured.quote).toEqual([want.quote[0], want.quote[1], want.quote[1], want.quote[2]]);
  expect(measured.footer).toEqual([want.footer[0], want.footer[1], want.footer[1], want.footer[0]]);
}
async function doubleText(page: Page) {
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
}

for (const band of bands) {
  test.describe(`${band.name} ${band.width}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: band.width, height: 1000 });
    });

    test('features page: direct visit and return to the claim step', async ({ page }) => {
      const api = await fixture(page, { signedIn: false });
      await page.goto('/candidates/features');
      await expect(page.getByText('On the roadmap', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Candidate profile features' }),
      ).toBeVisible();
      const find = page.getByRole('link', { name: 'Find candidates', exact: true });
      await expect(find).toBeVisible();
      expect((await box(find)).height).toBeGreaterThanOrEqual(52);
      await expect(page.getByText('Continue claiming this candidate profile')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Go back' })).toHaveAttribute(
        'href',
        '/candidates',
      );
      const who = await box(page.getByRole('heading', { level: 2, name: 'Who you are' }));
      const first = await box(
        page.getByRole('heading', { level: 3, name: 'Your background and experience' }),
      );
      const second = await box(
        page.getByRole('heading', { level: 3, name: 'Your positions on the issues' }),
      );
      if (band.width >= 1100) {
        expect(Math.round(who.width)).toBeLessThanOrEqual(260);
        expect(first.x).toBeGreaterThan(who.x + 260);
        expect(Math.abs(first.y - second.y)).toBeLessThan(2);
      } else if (band.width >= 768) {
        expect(first.y).toBeGreaterThan(who.y + who.height);
        expect(Math.abs(first.y - second.y)).toBeLessThan(2);
      } else {
        expect(second.y).toBeGreaterThan(first.y + first.height);
        expect(Math.abs((await box(find)).width - (band.width - 40))).toBeLessThanOrEqual(2);
      }
      await noHorizontalOverflow(page);
      await shot(page, `features-direct-${band.name}`);
      await page.goto(`/candidates/features?candidate=${candidateId}`);
      const resume = page.getByRole('link', {
        name: 'Continue claiming this candidate profile',
        exact: true,
      });
      await expect(resume).toBeVisible();
      await expect(page.getByText('Example Person A', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Find candidates' })).toHaveCount(0);
      expect((await box(resume)).height).toBeGreaterThanOrEqual(52);
      expect((await box(resume)).y).toBeLessThan(
        (await box(page.getByRole('heading', { level: 2, name: 'Who you are' }))).y,
      );
      await shot(page, `features-from-claim-${band.name}`);
      await resume.click();
      await expect(page).toHaveURL(new RegExp(`${profilePath}/claim$`));
      await expect(page.getByRole('button', { name: 'Sign in to continue' })).toBeVisible();
      await doubleText(page);
      await noHorizontalOverflow(page);
      expect(api.writes).toHaveLength(0);
    });

    test('claim page signed out, open and closed', async ({ page }) => {
      const api = await fixture(page, { signedIn: false });
      await page.goto(`${profilePath}/claim`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Claim this candidate profile' }),
      ).toBeVisible();
      const features = page.getByRole('link', { name: 'Explore candidate profile features' });
      await expect(features).toHaveAttribute(
        'href',
        `/candidates/features?candidate=${candidateId}`,
      );
      await expect(page.getByText('Candidate for', { exact: true })).toBeVisible();
      const signIn = page.getByRole('button', { name: 'Sign in to continue', exact: true });
      const note = page.getByText(
        'Alethical reviews requests from candidates and authorized campaign representatives. Approved access lets you manage campaign information, not official records.',
        { exact: true },
      );
      expect((await box(note)).y).toBeGreaterThan((await box(signIn)).y);
      await shot(page, `claim-signed-out-${band.name}`);
      await features.click();
      await expect(page).toHaveURL(/\/candidates\/features\?candidate=/);
      await page.getByRole('link', { name: 'Go back' }).click();
      await expect(page).toHaveURL(new RegExp(`${profilePath}/claim$`));
      api.record = { ...record, electionEnded: true };
      await page.goto(`${profilePath}/claim`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Profile claims closed for this election' }),
      ).toBeVisible();
      await expect(page.getByText('This election has ended', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Sign in to view claim status', exact: true }),
      ).toBeVisible();
      await expect(page.getByText('Explore candidate profile features')).toHaveCount(0);
      await shot(page, `claim-closed-signed-out-${band.name}`);
      expect(api.writes).toHaveLength(0);
    });

    test('claim form keeps answers across the features page and shows the receipt', async ({
      page,
    }) => {
      const api = await fixture(page);
      await page.goto(`${profilePath}/claim`);
      await expect(
        page.getByText(
          'Alethical reviews each request. We may contact you, the candidate or the campaign by email or phone to confirm your identity and permission to manage this profile.',
        ),
      ).toBeVisible();
      await expect(page.getByText('Help voters understand')).toHaveCount(0);
      await page.getByRole('button', { name: 'Submit profile claim request' }).click();
      await expect(page.getByText('Choose your role', { exact: true })).toBeVisible();
      await expect(page.getByRole('radio', { name: 'Candidate', exact: true })).toBeFocused();
      await expect(
        page
          .getByRole('alert')
          .filter({ hasText: 'Explain your role and how Alethical can confirm it' }),
      ).toBeVisible();
      await shot(page, `claim-form-errors-${band.name}`);
      await page.getByRole('radio', { name: 'Authorized campaign representative' }).check();
      await page
        .getByLabel('Link to a campaign website or official record', { exact: true })
        .fill('https://example-campaign.org/about');
      await page
        .getByLabel('Explain your role and how Alethical can confirm it', { exact: true })
        .fill('short');
      await expect(
        page.getByText(
          'Add more detail about how we can confirm your role (at least 20 characters)',
        ),
      ).toBeVisible();
      // An in-app trip to the features page and back keeps every answer and message.
      await page.evaluate((path) => {
        window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, `/candidates/features?candidate=${candidateId}`);
      await page.getByRole('link', { name: 'Continue claiming this candidate profile' }).click();
      await expect(page).toHaveURL(new RegExp(`${profilePath}/claim$`));
      await expect(
        page.getByLabel('Link to a campaign website or official record', { exact: true }),
      ).toHaveValue('https://example-campaign.org/about');
      await expect(
        page.getByRole('radio', { name: 'Authorized campaign representative' }),
      ).toBeChecked();
      await expect(
        page.getByText(
          'Add more detail about how we can confirm your role (at least 20 characters)',
        ),
      ).toBeVisible();
      await page
        .getByLabel('Explain your role and how Alethical can confirm it', { exact: true })
        .fill('Illustrative: the candidate can confirm this through the county filing phone.');
      const submit = page.getByRole('button', { name: 'Submit profile claim request' });
      const before = await box(submit);
      await submit.click();
      const busy = page.getByRole('button', { name: 'Submitting profile claim request…' });
      await expect(busy).toHaveAttribute('aria-disabled', 'true');
      const during = await box(busy);
      expect(Math.abs(during.width - before.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(during.height - before.height)).toBeLessThanOrEqual(1);
      await busy.click({ force: true });
      await expect.poll(() => api.writes.length).toBe(1);
      api.me = {
        ...api.me,
        claims: [
          {
            ...claim,
            request_note: `Authorized campaign representative\n\nIllustrative: the candidate can confirm this through the county filing phone.`,
          },
        ],
        request_eligibility: { allowed: false, reason: 'profile_claim_pending' },
      };
      await api.writes[0].route.fulfill({
        json: { account_id: accountId, claim: api.me.claims[0] },
      });
      const received = page.getByRole('heading', {
        level: 1,
        name: 'Profile claim request received',
      });
      await expect(received).toBeVisible();
      // Focus moves to the status heading's focus target so the new state is announced.
      expect(
        await received.evaluate((heading) => document.activeElement?.contains(heading) ?? false),
      ).toBe(true);
      await expect(page.getByText('Submitted October 9, 2026', { exact: true })).toBeVisible();
      await expect(
        page.getByText('Authorized campaign representative', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('This information is not shown on your public profile', { exact: true }),
      ).toBeVisible();
      const withdraw = page.getByRole('button', { name: 'Withdraw request', exact: true });
      await expect(withdraw).toBeVisible();
      await shot(page, `claim-receipt-${band.name}`);
      const ready = await box(withdraw);
      await withdraw.click();
      const withdrawing = page.getByRole('button', { name: 'Withdrawing request…' });
      const busyBox = await box(withdrawing);
      expect(Math.abs(busyBox.width - ready.width)).toBeLessThanOrEqual(1);
      await withdrawing.click({ force: true });
      await expect.poll(() => api.writes.length).toBe(2);
      await doubleText(page);
      await noHorizontalOverflow(page);
      await shot(page, `claim-receipt-200-${band.name}`);
    });

    test('status screens and the admin account', async ({ page }) => {
      const api = await fixture(page);
      for (const [status, heading, action] of [
        ['rejected', 'Profile claim not approved', 'Request another review'],
        ['withdrawn', 'Profile claim request withdrawn', 'Start a new request'],
        ['revoked', 'Profile claim revoked', 'Request another review'],
      ] as const) {
        api.me = {
          ...api.me,
          claims: [{ ...claim, status, can_request_review: true }],
          request_eligibility: { allowed: true, reason: null },
        };
        await page.goto(`${profilePath}/claim`);
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
        await expect(page.getByRole('button', { name: action, exact: true })).toBeVisible();
        if (band.width < 768)
          expect(
            Math.abs(
              (await box(page.getByRole('button', { name: action, exact: true }))).width -
                (band.width - 40),
            ),
          ).toBeLessThanOrEqual(2);
        await expect(page.getByText(/administrator/)).toHaveCount(0);
        await shot(page, `status-${status}-${band.name}`);
      }
      api.me = { ...api.me, claims: [], already_claimed: true };
      await page.goto(`${profilePath}/claim`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'This profile is already claimed' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Request a review', exact: true }),
      ).toBeVisible();
      await shot(page, `status-taken-${band.name}`);
      expect(api.writes).toHaveLength(0);
    });

    test('manage: date under the editor, Save changes on edit, limits and dialogs', async ({
      page,
    }) => {
      const api = await fixture(page);
      api.me = { ...api.me, claims: [{ ...claim, status: 'approved', can_manage: true }] };
      api.privateStatement = {
        body: 'I’m running for the school board because I want budget meetings to be easier to follow.',
        updated_at: '2026-10-02T15:00:00Z',
        published_at: '2026-09-18T15:00:00Z',
        edited_at: '2026-10-02T15:00:00Z',
        version: 2,
      };
      await page.goto(`${profilePath}/manage`);
      await expect(page.getByText('Edited October 2, 2026', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
      await expect(page.getByText('Unsaved changes')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Go back' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'View public profile' })).toBeVisible();
      const editor = page.getByRole('textbox', { name: 'Campaign statement' });
      expect((await box(editor)).height).toBeGreaterThanOrEqual(136);
      const showPreview = page.getByRole('button', { name: 'Preview' });
      await showPreview.click();
      const preview = page
        .getByText('PREVIEW', { exact: true })
        .locator('xpath=following-sibling::*[1]');
      await expect(
        preview.getByText(String(api.privateStatement.body), { exact: true }),
      ).toBeVisible();
      await expect(preview.getByRole('button', { name: 'Report this statement' })).toHaveCount(0);
      await expectStatementSpacing(preview, band.name);
      await shot(page, `manage-preview-${band.name}`);
      await showPreview.click();
      await expect(page.getByText('PREVIEW', { exact: true })).toHaveCount(0);
      await shot(page, `manage-published-${band.name}`);
      await editor.fill(`${'x'.repeat(1995)} and more`);
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
      await expect(page.getByText('2004 / 2000 characters', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('Keep your statement to 2000 characters or fewer')).toBeVisible();
      await expect(editor).toBeFocused();
      expect((await box(editor)).height).toBeLessThanOrEqual(521);
      expect(api.writes).toHaveLength(0);
      await shot(page, `manage-over-limit-${band.name}`);
      await editor.fill('A shorter edited statement');
      const giveUp = page.getByRole('button', { name: 'Give up this profile claim' });
      await giveUp.click();
      const dialog = page.getByRole('dialog', { name: 'Give up this profile claim?' });
      await expect(dialog.getByText('Example Person A', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Your unsaved changes will also be discarded.')).toBeVisible();
      const keep = await box(dialog.getByRole('button', { name: 'Keep profile claim' }));
      const risky = await box(dialog.getByRole('button', { name: 'Give up profile claim' }));
      expect(Math.abs(keep.width - risky.width)).toBeLessThanOrEqual(1);
      if (band.width < 768) expect(risky.y).toBeGreaterThan(keep.y);
      else expect(risky.x).toBeGreaterThan(keep.x);
      await shot(page, `manage-give-up-${band.name}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(giveUp).toBeFocused();
      await expect(editor).toHaveValue('A shorter edited statement');
      expect(api.writes).toHaveLength(0);
    });

    test('public statement card, report reload and failed statement retry', async ({ page }) => {
      const api = await fixture(page, { signedIn: false });
      api.publicStatement = {
        body: 'I’m running for the school board.\n\nIf elected, I will hold an open question session before each budget vote.',
        updated_at: '2026-10-02T15:00:00Z',
        published_at: '2026-09-18T15:00:00Z',
        edited_at: '2026-10-02T15:00:00Z',
        version: 2,
      };
      await page.goto(profilePath);
      await expect(
        page.getByRole('heading', { level: 2, name: 'Campaign statement' }),
      ).toBeVisible();
      await expect(page.getByText('Edited October 2, 2026', { exact: true })).toBeVisible();
      await expect(
        page.getByText(
          'Alethical verified this account’s authority to represent the campaign, not the statement’s accuracy',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.getByText('Written by the campaign, not Alethical')).toHaveCount(0);
      await expect(page.getByText('Campaign access verified')).toHaveCount(0);
      await expect(
        page.getByRole('link', { name: 'Claim this candidate profile', exact: true }),
      ).toBeVisible();
      await expectStatementSpacing(
        page.getByRole('region', { name: 'Campaign statement' }),
        band.name,
      );
      await shot(page, `profile-statement-${band.name}`);
      await page.getByRole('button', { name: 'Report this statement' }).click();
      const dialog = page.getByRole('dialog', { name: 'Report this statement' });
      await expect(dialog.getByText('Up to 2000 characters')).toHaveCount(0);
      await dialog.getByRole('textbox', { name: 'Reason' }).fill('Fictional reason');
      await expect(dialog.getByText('16 / 2000 characters')).toBeVisible();
      await dialog.getByRole('button', { name: 'Submit report' }).click();
      await expect.poll(() => api.writes.length).toBe(1);
      await api.writes[0].route.fulfill({ status: 409, json: { detail: 'changed' } });
      await expect(
        dialog.getByText(
          'The campaign statement changed. Review the updated statement before submitting your report.',
        ),
      ).toBeVisible();
      api.publicStatement = {
        ...api.publicStatement,
        body: 'A changed fictional statement',
        version: 3,
        edited_at: '2026-10-05T15:00:00Z',
      };
      await dialog.getByRole('button', { name: 'Reload statement' }).click();
      const panel = dialog.getByRole('region', { name: 'Updated statement' });
      await expect(panel).toBeFocused();
      await expect(panel.getByText('Edited October 5, 2026')).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: 'Reason' })).toHaveValue('Fictional reason');
      expect(api.writes).toHaveLength(1);
      await shot(page, `report-updated-statement-${band.name}`);
      await page.keyboard.press('Escape');
      api.handlers.set(`/api/v1/candidate-statements/${candidateId}`, (route) =>
        route.fulfill({ status: 503, json: {} }),
      );
      await page.goto(profilePath);
      const failure = page.getByText('We couldn’t load the campaign statement', { exact: true });
      await expect(failure).toBeVisible();
      const held: Route[] = [];
      api.handlers.set(`/api/v1/candidate-statements/${candidateId}`, (route) => {
        held.push(route);
      });
      const retry = page.getByRole('button', { name: 'Try again', exact: true });
      const before = await box(retry);
      await retry.click();
      const busy = page.getByRole('button', { name: 'Trying again…', exact: true });
      await expect(busy).toHaveAttribute('aria-disabled', 'true');
      await expect(failure).toBeVisible();
      const during = await box(busy);
      expect(Math.abs(during.width - before.width)).toBeLessThanOrEqual(1);
      await expect(page.getByText('Official candidate record')).toBeVisible();
      await shot(page, `statement-retrying-${band.name}`);
      await expect.poll(() => held.length).toBeGreaterThan(0);
      await held[0].fulfill({ json: { statement: null } });
      await expect(failure).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 2, name: 'Campaign statement' })).toHaveCount(
        0,
      );
    });

    test('admin request review: labels, block above the decision, history details', async ({
      page,
    }) => {
      const api = await fixture(page, { admin: true });
      api.detail = {
        ...claim,
        user_id: '00000000-0000-4000-8000-000000000199',
        account_email: null,
        official_source: record.source,
        official_checked_at: '2026-10-08T11:10:00Z',
        approval_block: {
          reason: 'email_unconfirmed',
          message:
            'The applicant must confirm their account email before this profile claim request can be approved',
        },
        history: [
          {
            id: 'h1',
            kind: 'submitted',
            created_at: '2026-10-08T15:00:00Z',
            evidence_url: 'https://example-campaign.org/about',
            request_note: claim.request_note,
          },
        ],
        history_complete: true,
      };
      await page.goto(`/admin/candidate-claims?claim=${claimId}`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Review profile claim request' }),
      ).toBeVisible();
      await expect(
        page.getByText(
          'Approval lets this account manage campaign information, not official records',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.getByText('Pending review', { exact: true })).toBeVisible();
      await expect(page.getByText('Email confirmed')).toHaveCount(0);
      const approve = page.getByRole('button', { name: 'Approve request', exact: true });
      await expect(approve).toHaveAttribute('aria-disabled', 'true');
      const block = page.getByText(
        'The applicant must confirm their account email before this profile claim request can be approved',
      );
      expect((await box(block)).y).toBeLessThan((await box(approve)).y);
      await expect(
        page.getByRole('button', { name: 'Reject request', exact: true }),
      ).not.toHaveAttribute('aria-disabled', 'true');
      if (band.width >= 1100) {
        // One line of label text draws a single 44px-minimum box, border included.
        const verify = page.locator('label').filter({ hasText: 'I independently verified' });
        expect((await box(verify)).height).toBeLessThanOrEqual(50);
      }
      await expect(approve).toHaveCSS('border-top-color', 'rgb(236, 239, 241)');
      const summary = page.getByText('View submitted information', { exact: true });
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByText('Role', { exact: true }).last()).toBeVisible();
      await shot(page, `admin-request-${band.name}`);
      expect(api.writes).toHaveLength(0);
    });
  });
}

test('a claim page opened from a link in a new tab carries unsent answers; no other tab does', async ({
  page,
  context,
  browserName,
}) => {
  const api = await fixture(page);
  const linkLabel = 'Link to a campaign website or official record';
  const noteLabel = 'Explain your role and how Alethical can confirm it';
  const typed = 'Illustrative: typed before opening a new tab.';
  const claimUrl = new RegExp(`${profilePath}/claim$`);
  await page.goto(`${profilePath}/claim`);
  await page.getByRole('radio', { name: 'Authorized campaign representative' }).check();
  await page.getByLabel(linkLabel, { exact: true }).fill('https://example-campaign.org/new-tab');
  await page.getByLabel(noteLabel, { exact: true }).fill(typed);
  // An in-app trip to the features page; signed in, the claim page has no features link.
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/candidates/features?candidate=${candidateId}`);
  const resume = page.getByRole('link', { name: 'Continue claiming this candidate profile' });
  const expectAnswers = async (tab: Page) => {
    await expect(tab).toHaveURL(claimUrl);
    await expect(tab.getByLabel(linkLabel, { exact: true })).toHaveValue(
      'https://example-campaign.org/new-tab',
    );
    await expect(
      tab.getByRole('radio', { name: 'Authorized campaign representative' }),
    ).toBeChecked();
    await expect(tab.getByLabel(noteLabel, { exact: true })).toHaveValue(typed);
    // The one-time code left the address at once; nothing private was ever in it.
    expect(new URL(tab.url()).hash).toBe('');
    expect(
      await tab.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }).includes('Illustrative'),
      ),
    ).toBe(false);
  };
  const expectEmpty = async (tab: Page) => {
    await expect(tab.getByLabel(linkLabel, { exact: true })).toHaveValue('');
    // Past the answer window, it is still empty.
    await tab.waitForTimeout(2000);
    await expect(tab.getByLabel(linkLabel, { exact: true })).toHaveValue('');
    await expect(tab.getByLabel(noteLabel, { exact: true })).toHaveValue('');
  };
  const gestures: NonNullable<Parameters<Locator['click']>[0]>[] = [
    { modifiers: ['ControlOrMeta'] },
    // Playwright's WebKit opens no tab for a middle click, so only Chromium checks it.
    ...(browserName === 'chromium' ? [{ button: 'middle' as const }] : []),
  ];
  for (const gesture of gestures) {
    const [opened] = await Promise.all([context.waitForEvent('page'), resume.click(gesture)]);
    await fixture(opened);
    await expectAnswers(opened);
    await opened.close();
  }
  // Opening the link's menu and dismissing it hands nothing to a tab opened another way.
  await resume.click({ button: 'right' });
  expect(await resume.getAttribute('href')).toMatch(/#claim-draft=[a-f0-9-]{36}$/);
  await page.keyboard.press('Escape');
  const plain = await context.newPage();
  await fixture(plain);
  await plain.goto(`${profilePath}/claim`);
  await expectEmpty(plain);
  // The original tab keeps its own answers, and the link shows its own address again.
  await resume.click();
  await expect(page.getByLabel(linkLabel, { exact: true })).toHaveValue(
    'https://example-campaign.org/new-tab',
  );
  expect(api.writes).toHaveLength(0);
});
