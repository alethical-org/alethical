import { expect, test, type Page } from '@playwright/test';

// Local fixtures only: every API and outside request is intercepted. No real
// claims, account changes, source writes or email sends can leave these tests.
const id = 'e'.repeat(64);
const source = {
  authority: 'Example Election Office',
  url: 'https://example.org/ballot',
  checkedDate: '2026-10-08',
};
const baseRecord = {
  candidate: {
    id,
    name: 'Example Candidate',
    sortName: 'Example Candidate',
    party: 'Example party',
  },
  office: 'School board member for the combined community education district',
  votingArea: 'Example School District',
  election: { id: 'fictional', label: 'General election', date: '2024-11-05', type: 'general' },
  electionEnded: true,
  source,
};
async function fixture(
  page: Page,
  result?: Record<string, unknown>,
  ballotSource = source,
  details: Record<string, unknown> = {},
) {
  const app = new URL(test.info().project.use.baseURL!);
  if (!['127.0.0.1', 'localhost'].includes(app.hostname)) throw Error('Local app required');
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === app.origin && !url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === `/api/v1/candidates/${id}`)
      return route.fulfill({ json: { ...baseRecord, source: ballotSource, result, ...details } });
    if (url.pathname === `/api/v1/candidate-statements/${id}`)
      return route.fulfill({ json: { statement: null } });
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404, json: { detail: 'Unused local fixture' } });
  });
  await page.goto(`/candidates/${id}`);
  await expect(page.getByRole('heading', { name: 'Official candidate record' })).toBeVisible();
}
const resultsSource = { ...source, url: 'https://example.org/results' };
for (const [date, outcome] of [
  ['2015-11-03', 'not-elected'],
  ['2019-11-05', 'elected'],
  ['2024-11-05', 'not-elected'],
]) {
  test(`historical ${date} record retains its saved ballot and ${outcome}`, async ({ page }) => {
    await fixture(
      page,
      { status: 'certified', outcome, source: resultsSource },
      { ...source, retained: true } as typeof source,
      { election: { ...baseRecord.election, date } },
    );
    await expect(page.getByTestId('candidate-record-status')).toHaveText(
      outcome === 'elected' ? 'Elected' : 'Not elected',
    );
    await expect(
      page.getByText('Ballot record saved October 8, 2026', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Checked October 8, 2026', { exact: true })).toBeVisible();
    await expect(page.getByText(/Both checked/)).toHaveCount(0);
  });
}
test('certified without a candidate outcome stays in the source area', async ({ page }) => {
  await fixture(page, { status: 'certified', source: resultsSource });
  await expect(page.getByTestId('candidate-record-status')).toHaveCount(0);
  await expect(page.getByText('Election results', { exact: true })).toBeVisible();
  await expect(page.getByText('Certified', { exact: true })).toBeVisible();
});
test('joint ticket keeps people and service context separate from the statewide outcome', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await fixture(page, { status: 'certified', outcome: 'elected', source: resultsSource }, source, {
    candidate: { ...baseRecord.candidate, name: 'Example Candidate and Example Running Mate' },
    office: 'Governor and Lieutenant Governor',
    votingArea: 'Minnesota',
    isJointTicket: true,
    people: [
      {
        id: '00000000-0000-4000-8000-000000000084',
        name: 'Example Candidate',
        profileUrl: '/people/00000000-0000-4000-8000-000000000084',
      },
      {
        id: '00000000-0000-4000-8000-000000000085',
        name: 'Example Running Mate',
        profileUrl: '/people/00000000-0000-4000-8000-000000000085',
      },
    ],
    legislator: {
      id: 'example-service',
      slug: 'example-candidate',
      name: 'Example Candidate',
      profileUrl: '/legislators/example-candidate',
      serviceStatus: 'current',
      isReelection: false,
      office: 'State Senator',
      votingArea: 'District 1',
    },
  });
  await expect(page.getByTestId('candidate-record-status')).toHaveText('Elected');
  await expect(page.getByRole('link', { name: /View person profile,/ })).toHaveCount(2);
  await expect(page.getByRole('link', { name: /View legislator profile/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: info.outputPath('joint-ticket-service-phone.png'),
    fullPage: true,
  });
});
for (const width of [1280, 900, 390]) {
  test(`final status and sources at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page, {
      status: 'certified',
      outcome: 'not-elected',
      source: resultsSource,
      certification: { authority: source.authority, url: source.url },
    });
    const status = page.getByTestId('candidate-record-status');
    await expect(status).toHaveText('Not elected');
    await expect(page.getByText('Election results', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Certified', { exact: true })).toBeVisible();
    await expect(page.getByText('Both checked October 8, 2026', { exact: true })).toBeVisible();
    await expect(page.getByText('Checked October 8, 2026', { exact: true })).toHaveCount(0);
    const box = await status.boundingBox();
    const office = await page.getByText(baseRecord.office, { exact: true }).boundingBox();
    const area = await page.getByText(baseRecord.votingArea, { exact: true }).boundingBox();
    expect(box).not.toBeNull();
    if (width === 390) {
      expect(box!.y).toBeGreaterThan(office!.y);
      expect(box!.y + box!.height).toBeLessThanOrEqual(area!.y);
    } else {
      expect(box!.x).toBeGreaterThan(office!.x + office!.width);
      expect(Math.round(box!.width)).toBe(200);
    }
    expect(await status.locator('svg').getAttribute('aria-hidden')).toBe('true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`profile-${width}.png`), fullPage: true });
  });
}
for (const [status, label] of [
  ['pending', 'Election results pending'],
  ['unofficial', 'Unofficial election results'],
  ['recount', 'Election recount in progress'],
  ['tie', 'Election tie unresolved'],
  ['unavailable', 'Election results unavailable'],
]) {
  test(`profile ${status} names the race once`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await fixture(page, { status, source: resultsSource });
    await expect(page.getByText(label, { exact: true })).toHaveCount(1);
    await expect(page.getByTestId('candidate-record-status')).toHaveText(label);
    if (status === 'unofficial')
      await expect(
        page.getByText('These results have not been certified', { exact: true }),
      ).toBeVisible();
    const bg = await page
      .getByTestId('candidate-record-status')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe(status === 'unavailable' ? 'rgb(255, 255, 255)' : 'rgb(241, 242, 244)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`${status}.png`), fullPage: true });
  });
}
test('retained ballot and different source dates stay separate', async ({ page }) => {
  await fixture(
    page,
    {
      status: 'certified',
      outcome: 'elected',
      source: { ...resultsSource, checkedDate: '2026-10-07' },
      certification: { authority: source.authority, url: source.url, date: '2024-11-12' },
    },
    { ...source, retained: true } as typeof source,
  );
  await expect(
    page.getByText('Ballot record saved October 8, 2026', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Checked October 7, 2026', { exact: true })).toBeVisible();
  await expect(page.getByText('Certified November 12, 2024', { exact: true })).toBeVisible();
  await expect(page.getByText(/Both checked/)).toHaveCount(0);
});
test('withdrawal is distinct from a profile claim', async ({ page }) => {
  await fixture(page, { status: 'pending', outcome: 'withdrew', source: resultsSource });
  await expect(page.getByTestId('candidate-record-status')).toHaveText('Withdrew from election');
  await expect(page.getByText('Election results pending', { exact: true })).toHaveCount(1);
});
test('no result leaves only the ballot source', async ({ page }) => {
  await fixture(page);
  await expect(page.getByTestId('candidate-record-status')).toHaveCount(0);
  await expect(page.getByText('Checked October 8, 2026', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Results from/ })).toHaveCount(0);
});

for (const role of [
  'claim',
  'approved',
  'pending',
  'rejected',
  'withdrawn',
  'revoked',
  'ended',
  'admin',
]) {
  test(`profile action ${role} uses its approved fill and feedback`, async ({ page }, info) => {
    await page.setViewportSize({ width: 900, height: 1000 });
    const app = new URL(test.info().project.use.baseURL!);
    if (!['localhost', '127.0.0.1'].includes(app.hostname)) throw Error('Local app required');
    const user = {
      id: '00000000-0000-4000-8000-000000000092',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'fixture@example.invalid',
      email_confirmed_at: '2026-01-01T00:00:00Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    };
    await page.addInitScript((user) => {
      const session = JSON.stringify({
        access_token: 'clearly-fake-local-token',
        refresh_token: 'clearly-fake-local-refresh',
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user,
      });
      localStorage.setItem('sb-127-auth-token', session);
      localStorage.setItem('sb-localhost-auth-token', session);
    }, user);
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === app.origin && !url.pathname.startsWith('/api/')) return route.continue();
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
      if (url.pathname === '/api/v1/me')
        return route.fulfill({
          json: {
            data: {
              id: user.id,
              primary_email: user.email,
              display_name: 'Fixture reviewer',
              is_admin: role === 'admin',
              sign_in_methods: { google: false, password: true },
            },
          },
        });
      if (url.pathname === '/api/v1/admin/access')
        return route.fulfill({ json: { data: { is_admin: role === 'admin' } } });
      if (url.pathname === `/api/v1/candidates/${id}`)
        return route.fulfill({
          json: {
            ...baseRecord,
            election: { ...baseRecord.election, date: '2099-11-03' },
            electionEnded: role === 'ended',
          },
        });
      if (url.pathname === `/api/v1/candidate-statements/${id}`)
        return route.fulfill({ json: { statement: null } });
      if (url.pathname === '/api/v1/candidate-claims/me')
        return route.fulfill({
          json: {
            account_id: user.id,
            is_admin: role === 'admin',
            request_eligibility: { allowed: true, reason: null },
            already_claimed: false,
            claims:
              role === 'claim' || role === 'admin'
                ? []
                : [
                    {
                      id: '00000000-0000-4000-8000-000000000091',
                      candidate_id: id,
                      user_id: user.id,
                      status: role === 'ended' ? 'pending' : role,
                      can_manage: role === 'approved',
                      election_ended: role === 'ended',
                      history: [],
                    },
                  ],
          },
        });
      return route.fulfill({ status: 404, json: { detail: 'Unused local fixture' } });
    });
    await page.goto(`/candidates/${id}`);
    const primary = role === 'claim' || role === 'approved';
    const label =
      role === 'admin'
        ? 'Review profile claim requests'
        : role === 'claim'
          ? 'Claim this candidate profile'
          : role === 'approved'
            ? 'Manage this profile'
            : 'View profile claim status';
    const button = page.getByRole('link', { name: label, exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    const read = () =>
      button.evaluate((el) => ({
        bg: getComputedStyle(el).backgroundColor,
        ink: getComputedStyle(el.firstElementChild!).color,
      }));
    expect((await read()).bg).toBe(primary ? 'rgb(46, 212, 126)' : 'rgb(17, 21, 15)');
    if (!primary) expect((await read()).ink).toBe('rgb(255, 255, 255)');
    await button.hover();
    expect((await read()).bg).toBe(primary ? 'rgb(40, 191, 113)' : 'rgb(44, 50, 44)');
    await page.mouse.down();
    await expect
      .poll(async () => (await read()).bg)
      .toBe(primary ? 'rgb(35, 173, 102)' : 'rgb(0, 0, 0)');
    await page.mouse.move(1, 1);
    await page.mouse.up();
    for (let step = 0; step < 65; step++) {
      await page.keyboard.press('Tab');
      if (await button.evaluate((el) => el === document.activeElement)) break;
    }
    expect(
      await button.evaluate((el) => el === document.activeElement && el.matches(':focus-visible')),
    ).toBe(true);
    expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.screenshot({ path: info.outputPath(`claim-${role}.png`), fullPage: true });
  });
}

for (const [status, outcome] of [
  ['recount', undefined],
  ['tie', undefined],
  ['unavailable', undefined],
  ['certified', 'elected'],
  ['certified', 'not-elected'],
] as const) {
  const name = outcome ?? status;
  for (const width of [1280, 900, 390]) {
    test(`${name} stays readable with doubled text at ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1100 });
      await fixture(page, { status, outcome, source: resultsSource });
      await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll<HTMLElement>('[dir="auto"]')).map(
          (el) => ({
            el,
            font: parseFloat(getComputedStyle(el).fontSize),
            line: parseFloat(getComputedStyle(el).lineHeight),
          }),
        );
        for (const { el, font, line } of labels) {
          el.style.fontSize = `${font * 2}px`;
          if (Number.isFinite(line)) el.style.lineHeight = `${line * 2}px`;
        }
      });
      const block = page.getByTestId('candidate-record-status');
      await expect(block).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      expect(
        await block.evaluate((el) =>
          Array.from(el.querySelectorAll<HTMLElement>('[dir="auto"]')).every((child) => {
            // Glyph tails may extend a pixel or 2 past a tight line box; what matters
            // is that no text is cut off sideways and every line sits inside the block.
            const box = el.getBoundingClientRect();
            const text = child.getBoundingClientRect();
            return (
              child.scrollWidth <= child.clientWidth + 1 &&
              text.left >= box.left - 1 &&
              text.right <= box.right + 1 &&
              text.top >= box.top - 1 &&
              text.bottom <= box.bottom + 1
            );
          }),
        ),
      ).toBe(true);
      // Each word of the status stays whole: no word starts on one line and ends on the next.
      expect(
        await block.evaluate((el) => {
          const label = Array.from(el.querySelectorAll<HTMLElement>('[dir="auto"]')).at(-1)!;
          const text = label.firstChild!;
          const range = document.createRange();
          let offset = 0;
          return label.textContent!.split(' ').every((word) => {
            range.setStart(text, offset);
            range.setEnd(text, offset + word.length);
            offset += word.length + 1;
            return range.getClientRects().length === 1;
          });
        }),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`double-text-${width}.png`), fullPage: true });
    });
  }
}

test('person election rows retain outcome words and neutral certification', async ({
  page,
}, info) => {
  await fixture(page);
  await page.route('**/api/v1/people/00000000-0000-4000-8000-000000000084', (route) =>
    route.fulfill({
      json: {
        id: '00000000-0000-4000-8000-000000000084',
        name: baseRecord.candidate.name,
        service: [],
        research: { items: [], nextCursor: null },
        elections: [
          {
            candidateId: id,
            profileUrl: `/candidates/${id}`,
            name: baseRecord.candidate.name,
            office: baseRecord.office,
            votingArea: baseRecord.votingArea,
            election: baseRecord.election,
            source,
            isJointTicket: false,
            result: { status: 'certified', outcome: 'not-elected', source: resultsSource },
          },
        ],
      },
    }),
  );
  await page.goto('/people/00000000-0000-4000-8000-000000000084');
  const loss = page.getByText('Not elected', { exact: true });
  await expect(loss).toBeVisible();
  expect(await loss.evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor)).toBe(
    'rgb(253, 236, 236)',
  );
  const status = page.getByText('Election results', { exact: true });
  await expect(status).toBeVisible();
  expect(await status.evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor)).toBe(
    'rgb(241, 242, 244)',
  );
  await expect(page.getByRole('link', { name: /^View election record,/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('person-election-row.png'), fullPage: true });
});
test('candidate race cards use the same statuses and preserve profile arrival', async ({
  page,
}, info) => {
  await fixture(page);
  const election = {
    ...baseRecord.election,
    capabilities: { addressLookup: 'current-ballot', results: true, historicalRecords: true },
    officialResultsUrl: source.url,
  };
  await page.route('**/api/v1/candidates/elections', (route) =>
    route.fulfill({ json: [election] }),
  );
  await page.route('**/api/v1/candidates/suggest', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/candidates/lookup', (route) =>
    route.fulfill({
      json: {
        kind: 'results',
        electionId: election.id,
        matchedAddress: '123 Example Street, Minneapolis, MN 55401',
        resultsAvailable: true,
        electionEnded: true,
        coverage: [],
        races: ['certified', 'pending', 'unofficial', 'recount', 'tie', 'unavailable'].map(
          (status, i) => ({
            id: `race-${i}`,
            group: 'school',
            office: `Example school board ${i + 1}`,
            votingArea: baseRecord.votingArea,
            source,
            result: { status, source: resultsSource },
            entries: [
              {
                kind: 'candidate',
                candidate: {
                  ...baseRecord.candidate,
                  result: { status, ...(status === 'certified' ? { outcome: 'not-elected' } : {}) },
                },
              },
            ],
          }),
        ),
      },
    }),
  );
  await page.goto('/candidates');
  await page
    .getByRole('combobox', { name: 'Full street address', exact: true })
    .fill('123 Example Street, Minneapolis, MN 55401');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(page.getByText('Not elected', { exact: true })).toBeVisible();
  for (const label of [
    'Election results',
    'Election results pending',
    'Unofficial election results',
    'Election recount in progress',
    'Election tie unresolved',
    'Election results unavailable',
  ])
    await expect(
      page.locator('[id$="-school-body"]').getByText(label, { exact: true }),
    ).toBeVisible();
  await page.screenshot({ path: info.outputPath('race-statuses.png'), fullPage: true });
  await page
    .getByRole('link', { name: 'View profile, Example Candidate', exact: true })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Official candidate record' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/candidates/${id}$`));
});
