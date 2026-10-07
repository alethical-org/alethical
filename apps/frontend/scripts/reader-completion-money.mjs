import { readFile } from 'node:fs/promises';

// Snapshot figures and independently written UI expectations are deliberately
// separate. Changing a supplied response must not change the expected answer.
export const MONEY_EXPECTATIONS = {
  real: {
    year: 2025,
    name: 'Abeler, Jim Senate Committee',
    registration: '17868',
    contributions: '$97,703',
    expenditures: '$33,006',
    period: 'Figures for Jan 1, 2025 – Dec 31, 2025',
    source: 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/17868/2025/',
  },
  missing: {
    year: 2024,
    name: 'Synthetic missing-total committee',
    registration: '99998',
  },
  zero: {
    year: 2024,
    name: 'Synthetic zero-total committee',
    registration: '99999',
  },
};

export const MONEY_FAILURE_MODES = ['unavailable', 'wrong-amount', 'missing-as-zero'];

export async function readerMoneyFixtures({ failMoney } = {}) {
  if (failMoney !== undefined && !MONEY_FAILURE_MODES.includes(failMoney))
    throw new Error('Invalid money failure fixture');
  const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  const profile = await read('./fixtures/reader-legislator-jim-abeler.json');
  const committee = await read(
    '../src/components/campaignMoney/__tests__/fixtures/committee-donation-cards-17868-2025.json',
  );
  const payments = await read('../src/lib/__tests__/fixtures/campaign-money-17868-2025.json');
  const envelope = (year, committees) => ({
    data: {
      legislator_id: profile.id,
      year,
      link_state: 'confirmed',
      release_id: payments.data.release_id,
      fetched_at: payments.data.fetched_at,
      // The retained snapshot does not establish a report-copy date. Exercise
      // the existing honest fallback rather than manufacture one.
      filings_copied_at: null,
      committees,
      other_office_committees: 0,
      committees_outside_this_year: [],
    },
  });
  const synthetic = (key, zero) => {
    const expected = MONEY_EXPECTATIONS[key];
    return {
      registration_number: expected.registration,
      committee_name_as_reviewed: expected.name,
      committee_name: expected.name,
      office: 'Senate',
      register_kind: 'candidate_committee',
      checked: null,
      filing_schedule: { state: 'filings_cannot_answer' },
      money_in: {
        state: zero ? 'not_reported' : 'reported',
        itemized_contribution_total: zero ? null : '123.0000',
        itemized_contribution_payments: zero ? null : 1,
        other_receipts: [],
        reported_period_start: zero ? '2024-01-01' : null,
      },
      money_out: {
        state: 'reported',
        // A named-payment sum must never substitute for a missing report total.
        itemized_payment_total: zero ? '0.0000' : '456.0000',
        reported_total: zero ? '0.0000' : null,
        reported_through: zero ? '2024-12-31' : null,
        by_type: [],
      },
      split: {
        state: zero ? 'shown' : 'no_reported_total',
        reported_total: zero ? '0.0000' : null,
        reported_through: zero ? '2024-12-31' : null,
        named_total: zero ? null : '123.0000',
        named_payments: zero ? null : 1,
        first_payment_on: zero ? null : '2024-06-15',
        last_payment_on: zero ? null : '2024-06-15',
      },
    };
  };
  const responses = new Map([
    [2025, envelope(2025, [committee])],
    [2024, envelope(2024, [synthetic('missing', false), synthetic('zero', true)])],
  ]);
  return {
    profile,
    response(pathname, searchParams) {
      const yearValues = searchParams.getAll('year');
      if (yearValues.length !== 1 || !/^(2024|2025)$/.test(yearValues[0])) return undefined;
      const year = Number(yearValues[0]);
      if (
        [profile.id, profile.slug].some(
          (id) => pathname === `/api/v1/legislators/${id}/campaign-finance`,
        )
      ) {
        if (failMoney === 'unavailable') return undefined;
        const response = structuredClone(responses.get(year));
        if (failMoney === 'wrong-amount' && year === 2025)
          response.data.committees[0].split.reported_total = '96703.7500';
        if (failMoney === 'missing-as-zero' && year === 2024)
          response.data.committees[0].money_out.reported_total = '0.0000';
        return response;
      }
      if (
        pathname === '/api/v1/committees/17868/payments' &&
        year === 2025 &&
        searchParams.get('direction') === 'received' &&
        (searchParams.get('offset') ?? '0') === '0'
      )
        return structuredClone(payments);
      return undefined;
    },
  };
}

// The nearest parent of the committee heading owns this committee's period and
// Money in / Money out blocks. Never allow another card's amount to satisfy it.
function committeeCard(region, expected) {
  return region
    .getByRole('heading', {
      level: 2,
      name: `${expected.name} - ${expected.registration}`,
      exact: true,
    })
    .locator('..');
}
function moneyBlock(card, name) {
  return card.getByRole('heading', { name, exact: true }).locator('..');
}
export async function assertRealMoney(page, expect) {
  const expected = MONEY_EXPECTATIONS.real;
  const region = page.getByRole('region', { name: 'Campaign money', exact: true });
  await expect(page.getByRole('heading', { level: 1, name: /Jim Abeler/ })).toBeVisible();
  await expect(
    region
      .getByRole('group', { name: 'Choose a year' })
      .getByRole('button', { name: '2025', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/[?&]year=2025(?:&|$)/);
  const card = committeeCard(region, expected);
  await expect(card).toBeVisible();
  await expect(card.getByTestId('campaign-money-period')).toContainText(expected.period);
  await expect(
    card.getByRole('link', { name: 'The Board’s record for this committee', exact: true }),
  ).toHaveAttribute('href', expected.source);
  const moneyIn = moneyBlock(card, 'Money in');
  await expect(moneyIn.getByText(expected.contributions, { exact: true })).toBeVisible();
  await expect(moneyIn.getByText('$67,100', { exact: true })).toBeVisible();
  await expect(
    moneyBlock(card, 'Money out').getByText(expected.expenditures, { exact: true }),
  ).toBeVisible();
  await expect(region).toContainText(
    'Minnesota’s payment files copied Sep 1, 2026. This is a copy date, not a reporting period. The report totals were copied separately.',
  );
  await expect(region.getByRole('heading', { level: 2, name: /Synthetic/ })).toHaveCount(0);
}

export async function checkMoneyFixtures(page, expect, check) {
  const region = page.getByRole('region', { name: 'Campaign money', exact: true });
  const chooseYear = async (year) => {
    await region
      .getByRole('group', { name: 'Choose a year' })
      .getByRole('button', { name: new RegExp(`^${year}(?:,|$)`) })
      .click();
    await expect(page).toHaveURL(new RegExp(`[?&]year=${year}(?:&|$)`));
    await expect(
      region
        .getByRole('group', { name: 'Choose a year' })
        .getByRole('button', { name: new RegExp(`^${year}(?:,|$)`) }),
    ).toHaveAttribute('aria-pressed', 'true');
  };
  await check('money-fixture-official-amounts-period-and-source', async () => {
    await chooseYear(2025);
    await assertRealMoney(page, expect);
  });
  await check('money-fixture-separate-committees-missing-versus-zero', async () => {
    await chooseYear(2024);
    const missing = committeeCard(region, MONEY_EXPECTATIONS.missing);
    const zero = committeeCard(region, MONEY_EXPECTATIONS.zero);
    await expect(missing).toBeVisible();
    await expect(zero).toBeVisible();
    await expect(committeeCard(region, MONEY_EXPECTATIONS.real)).toHaveCount(0);
    await expect(region).toContainText('each one reports to the state separately');
    await expect(region).toContainText('we never add them together');
    await expect(missing.getByTestId('campaign-money-period')).toContainText(
      'Payment dated Jun 15, 2024',
    );
    await expect(missing.getByTestId('campaign-money-period')).toContainText(
      'We do not hold an official contribution total for this committee for this year.',
    );
    await expect(moneyBlock(missing, 'Money in').getByText('$123', { exact: true })).toBeVisible();
    await expect(moneyBlock(missing, 'Money out')).toHaveText(
      'Money outWe do not hold an official spending total for this committee for this year',
    );
    await expect(missing.getByText('$0', { exact: true })).toHaveCount(0);
    await expect(missing.getByText('$456', { exact: true })).toHaveCount(0);
    await expect(zero.getByTestId('campaign-money-period')).toContainText(
      'Figures for Jan 1, 2024 – Dec 31, 2024',
    );
    await expect(
      zero.getByRole('link', { name: 'The Board’s record for this committee', exact: true }),
    ).toHaveAttribute(
      'href',
      'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/99999/2024/',
    );
    for (const name of ['Money in', 'Money out']) {
      const block = moneyBlock(zero, name);
      await expect(block.getByText('$0', { exact: true })).toBeVisible();
      await expect(block).toContainText('That is the filing’s own zero, not a gap in our records.');
      await expect(block).not.toContainText('We do not hold');
    }
    await expect(zero.getByText('$123', { exact: true })).toHaveCount(0);
  });
  await check('money-fixture-year-return-restores-matching-records', async () => {
    await chooseYear(2025);
    await assertRealMoney(page, expect);
  });
}
