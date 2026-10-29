import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import {
  accountFigures,
  accountsFrom,
  contestLabel,
  DONOR_THRESHOLD_SENTENCE,
  type CommitteeYear,
  type FinanceYears,
} from '../parts/CampaignFinance';
import {
  committeeIdFor,
  LegislatorProfile,
  serviceLine,
  type LegislatorRecord,
} from '../pages/Legislator';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

const CURRENT: LegislatorRecord = {
  id: 'db54',
  slug: 'patty-acomb',
  full_name: 'Patty Acomb',
  current_service: {
    chamber: 'house',
    party: 'DFL',
    district: { code: '45B', label: 'District 45B' },
    profile_url: 'https://www.house.leg.state.mn.us/members/members.asp?id=15513',
  },
  committees: [
    { name: 'Energy Finance and Policy', role: 'Co-Chair' },
    { name: 'Taxes', role: null },
  ],
  service_history: {
    term: 4,
    periods: [{ chamber: 'house', initial_year: 2018, reelection_years: [2020] }],
  },
  campaign_committees: [
    { registration_number: '18272', committee_name: 'Acomb, Patty House Committee' },
  ],
  stats: { chief_bill_count: 1 },
};

const FORMER: LegislatorRecord = {
  id: 'fbc5',
  slug: 'former-member',
  full_name: 'Former Member',
  committees: [],
  campaign_committees: [],
  stats: { chief_bill_count: 0 },
};

const YEARS: FinanceYears = {
  link_state: 'confirmed',
  payment_copied_at: { contributions: '2026-10-28T17:39:35Z' },
  years: [
    { year: 2024, committees: [{ registration_number: '18272' }] },
    { year: 2025, committees: [{ registration_number: '18272' }] },
    { year: 2026, committees: [] },
  ],
};

const Y2025: CommitteeYear = {
  registration_number: '18272',
  committee_name: 'Acomb, Patty House Committee',
  register_kind: 'candidate_committee',
  checked: { checked_on: '2026-08-31' },
  split: {
    state: 'shown',
    reported_total: '30655.0000',
    reported_through: '2025-12-31',
    first_payment_on: '2025-01-13',
    last_payment_on: '2025-12-31',
  },
  money_in: {
    state: 'reported',
    itemized_contribution_total: '15130.0000',
    itemized_contribution_payments: 61,
    reported_period_start: '2025-01-01',
  },
  money_out: { state: 'reported', itemized_payment_total: '3485.5500', itemized_payments: 54 },
};

const Y2024: CommitteeYear = {
  ...Y2025,
  split: { state: 'no_reported_total', reported_total: null },
  money_in: { state: 'not_reported' },
  money_out: { state: 'reported', itemized_payment_total: '120.0000', itemized_payments: 1 },
};

const OUTSIDE_2025 = {
  state: 'reported',
  about: { office: 'House', district: '45B' },
  year: 2025,
  figures: { first_paid_on: '2025-08-13', last_paid_on: '2025-10-11' },
  groups: [
    {
      spender: 'Example Political Fund',
      spender_registration_number: '80012',
      spender_linkable: true,
      direction: 'For',
      amount: '5297.7400',
      row_count: 8,
    },
    {
      spender: 'Example Action PAC',
      spender_registration_number: '30037',
      spender_linkable: true,
      direction: 'Against',
      amount: null,
      row_count: 2,
    },
  ],
};

const BILL = {
  id: '94-2025-HF1596',
  file_type: 'HF',
  file_number: 1596,
  title: 'A bill for an act relating to Metropolitan Council; amending Minnesota Statutes 2024',
  current_status: 'House rule 4.20, interim disposition of bills, returned to',
  status_key: 'proposed',
  latest_action_at: '2025-04-01T00:00:00Z',
  ai_analysis: { short_title: 'Metropolitan Council Personnel Complaint Data as Public' },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let container: HTMLDivElement;
let root: Root;
let requests: string[];

beforeEach(() => {
  clearReadCache();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  requests = [];
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type Answer = (url: string) => Response | Promise<Response>;

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(path: string, answer: Answer) {
  window.history.replaceState(null, '', path);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requests.push(input);
      return answer(input);
    }),
  );
  await act(async () => {
    root.render(<LegislatorProfile match={matchRoute(path.split('?')[0])!} />);
  });
  await settle();
}

function answering(record: LegislatorRecord, overrides: Partial<Record<string, Response>> = {}) {
  return (url: string): Response => {
    for (const [key, response] of Object.entries(overrides)) {
      if (url.includes(key) && response) return response.clone();
    }
    if (url.includes('/campaign-finance/years')) return json(YEARS);
    if (url.includes('/campaign-finance?year=2025'))
      return json({ year: 2025, committees: [Y2025] });
    if (url.includes('/campaign-finance?year=2024'))
      return json({ year: 2024, committees: [Y2024] });
    if (url.includes('/outside-spending') && url.includes('year=2025')) return json(OUTSIDE_2025);
    if (url.includes('/outside-spending'))
      return json({ state: 'not_reported', year: 2024, groups: [] });
    if (url.includes('/bills?role=chief_author')) return json([BILL]);
    if (url.endsWith('/sessions'))
      return json([
        { slug: '94-2025-regular', is_current: true, year_start: 2025, year_end: 2026 },
      ]);
    if (url.includes('/finance/legislative-committees'))
      return json([
        {
          id: 'c-energy',
          name: 'Energy Finance and Policy',
          chamber: 'Minnesota House of Representatives',
          session: '94-2025-regular',
        },
        {
          id: 'c-tax-h',
          name: 'Taxes',
          chamber: 'Minnesota House of Representatives',
          session: '94-2025-regular',
        },
        { id: 'c-tax-s', name: 'Taxes', chamber: 'Minnesota Senate', session: '94-2025-regular' },
      ]);
    if (url.includes('/finance/landing/counts'))
      return json({
        current_legislature_bills: {
          state: 'reported',
          count: 10518,
          first_year: 2025,
          last_year: 2026,
          copied_at: '2026-10-20T15:00:00Z',
        },
      });
    if (url.includes('/people/')) return new Response(null, { status: 404 });
    if (url.includes(`/legislators/${record.slug}?include`)) return json(record);
    return new Response(null, { status: 500 });
  };
}

const text = () => container.textContent ?? '';

describe('Legislator profile', () => {
  it('shows current service, committees with their members’ accounts links, and chief-authored bills', async () => {
    await render('/legislators/patty-acomb', answering(CURRENT));
    expect(container.querySelector('h1')?.textContent).toBe('Patty Acomb');
    expect(text()).toContain(
      'Currently serving as State Representative · House District 45B · DFL',
    );
    expect(text()).toContain('Party as recorded: DFL');
    expect(text()).toContain('Elected to the House');
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain(
      '/legislature/committees/c-energy/members?from=%2Flegislators%2Fpatty-acomb',
    );
    // Taxes exists in both chambers; the House member's row opens the House one.
    expect(links).toContain(
      '/legislature/committees/c-tax-h/members?from=%2Flegislators%2Fpatty-acomb',
    );
    expect(text()).toContain('Co-Chair');
    expect(text()).toContain('Member');
    // Plain-language title, never the statutory one.
    expect(text()).toContain('Metropolitan Council Personnel Complaint Data as Public');
    expect(text()).not.toContain('A bill for an act');
    expect(text()).toContain('HF 1596');
    expect(text()).toContain('Introduced · Apr 1, 2025');
    expect(text()).toContain('2025–26 session');
    expect(links).toContain('/bills/94-2025-HF1596?from=%2Flegislators%2Fpatty-acomb');
    expect(links).toContain(CURRENT.current_service!.profile_url);
    expect(text()).toContain('Bills updated Oct 20, 2026');
    expect(text()).toContain('Payment files copied Oct 28, 2026');
  });

  it('shows each confirmed account’s newest year with both figures and the donor sentence', async () => {
    await render('/legislators/patty-acomb', answering(CURRENT));
    const card = container.querySelector('.cf-account')!;
    expect(card.textContent).toContain('Acomb, Patty House Committee');
    expect(card.textContent).toContain('Candidate committee · Registration 18272');
    expect(card.textContent).toContain('Checked on Aug 31, 2026');
    expect(card.textContent).toContain('$30,655');
    expect(card.textContent).toContain('Report period Jan 1, 2025 to Dec 31, 2025');
    expect(card.textContent).toContain('$15,130');
    expect(card.textContent).toContain(
      'Payment period Jan 13, 2025 to Dec 31, 2025 · 61 payment records',
    );
    expect(card.textContent).toContain('$3,485');
    expect(card.textContent).toContain(DONOR_THRESHOLD_SENTENCE);
    const pressed = card.querySelector('[aria-pressed="true"]');
    expect(pressed?.textContent).toBe('2025');
    // Key figures under the name read the same account-year.
    expect(container.querySelector('.cf-key')?.textContent).toContain(
      'Acomb, Patty House Committee · Year 2025',
    );
    const open = [...card.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Open campaign'),
    );
    expect(open?.getAttribute('href')).toBe(
      '/money/committees/18272?year=2025&from=%2Flegislators%2Fpatty-acomb',
    );
  });

  it('lists outside spending by contest as filed, and an unknown amount as incomplete', async () => {
    await render('/legislators/patty-acomb', answering(CURRENT));
    const contest = container.querySelector('.cf-contest')!;
    expect(contest.textContent).toContain('State Representative · District 45B · 2025');
    expect(contest.textContent).toContain('Payments dated Aug 13, 2025 to Oct 11, 2025');
    expect(contest.textContent).toContain('Example Political Fund');
    expect(contest.textContent).toContain('For');
    expect(contest.textContent).toContain('$5,297');
    expect(contest.textContent).toContain('8 payment records');
    expect(contest.textContent).toContain('Incomplete: a payment amount is missing');
    expect(text()).not.toContain('No confirmed records are held for this section');
  });

  it('a year with no report total and no itemized rows says so, never $0', async () => {
    await render('/legislators/patty-acomb?year=2024', answering(CURRENT));
    const card = container.querySelector('.cf-account')!;
    expect(card.querySelector('[aria-pressed="true"]')?.textContent).toBe('2024');
    expect(card.textContent).toContain('Report total unavailable');
    expect(card.textContent).toContain('Not reported');
    expect(card.textContent).not.toContain('$0');
    expect(card.textContent).toContain('We do not hold an official contribution total');
    expect(text()).toContain('No confirmed records are held for this section');
  });

  it('a requested year the account does not hold gets its own Not held chip', async () => {
    await render('/legislators/patty-acomb?year=2019', answering(CURRENT));
    const card = container.querySelector('.cf-account')!;
    expect(card.querySelector('[aria-pressed="true"]')?.textContent).toBe('2019');
    expect(card.textContent).toContain('Not held');
    expect(requests.some((url) => url.includes('campaign-finance?year=2019'))).toBe(false);
  });

  it('a former legislator inherits no current title, party, district or committees', async () => {
    await render(
      '/legislators/former-member',
      answering(FORMER, {
        '/campaign-finance/years': json({ link_state: 'unconfirmed', years: [] }),
        '/bills?role': json([]),
      }),
    );
    expect(container.querySelector('h1')?.textContent).toBe('Former Member');
    expect(text()).not.toContain('Currently serving');
    expect(text()).not.toContain('Party as recorded');
    expect(text()).toContain('Committee assignments are held for current service only');
    expect(text()).toContain('No campaign committee is confirmed for this service record');
    expect(text()).toContain('No chief-authored bills are held for this service');
    expect(text()).not.toContain('Official source website');
    expect(requests.some((url) => url.includes('/finance/legislative-committees'))).toBe(false);
  });

  it('shows the bills failure with Try again', async () => {
    await render(
      '/legislators/patty-acomb',
      answering(CURRENT, { '/bills?role': new Response(null, { status: 500 }) }),
    );
    expect(text()).toContain('We couldn’t load these bills. This is a problem on our side.');
    expect(
      [...container.querySelectorAll('button')].some((b) => b.textContent === 'Try again'),
    ).toBe(true);
  });

  it('answers an unknown record with the unavailable state', async () => {
    await render('/legislators/nobody', () => new Response(null, { status: 404 }));
    expect(container.querySelector('h1')?.textContent).toBe('This record is no longer available');
    expect(text()).toContain('No legislator record with this reference is in the current copy.');
  });

  it('a failed record read offers Try again and shows no other record', async () => {
    await render('/legislators/patty-acomb', () => new Response(null, { status: 503 }));
    expect(text()).toContain('We couldn’t load this record. This is a problem on our side.');
    expect(container.querySelector('h1')).toBeNull();
  });

  it('shows a return link only when reached with from', async () => {
    await render(
      '/legislators/patty-acomb?from=%2Fpeople%3Ftype%3Dlegislators',
      answering(CURRENT),
    );
    const back = container.querySelector('.f-back');
    expect(back?.textContent).toBe('Back to People');
    expect(back?.getAttribute('href')).toBe('/people?type=legislators');
  });
});

describe('Legislator helpers', () => {
  it('names a current seat and never a former one', () => {
    expect(serviceLine(CURRENT)).toBe(
      'Currently serving as State Representative · House District 45B · DFL',
    );
    expect(serviceLine(FORMER)).toBeNull();
  });

  it('matches a committee by name in the member’s chamber, never across chambers', () => {
    const list = [
      {
        id: 'h',
        name: 'Taxes',
        chamber: 'Minnesota House of Representatives',
        session: '94-2025-regular',
      },
      { id: 's', name: 'Taxes', chamber: 'Minnesota Senate', session: '94-2025-regular' },
      {
        id: 'h2',
        name: 'Taxes',
        chamber: 'Minnesota House of Representatives',
        session: '94-2025-special-1',
      },
    ];
    expect(committeeIdFor('Taxes', 'Senate', list)).toBe('s');
    expect(committeeIdFor('Taxes', 'House', list)).toBe('h');
    expect(committeeIdFor('Taxes', '', list)).toBeNull();
    expect(committeeIdFor('Unknown', 'House', list)).toBeNull();
  });

  it('lists accounts only once confirmed, each with its own years newest first', () => {
    expect(accountsFrom({ ...YEARS, link_state: 'unconfirmed' })).toEqual([]);
    expect(accountsFrom(YEARS, CURRENT.campaign_committees)).toEqual([
      { registrationNumber: '18272', name: 'Acomb, Patty House Committee', years: [2025, 2024] },
    ]);
  });

  it('keeps the report total and the itemized sum as separate figures', () => {
    const [reported, contributions, expenditures] = accountFigures(Y2025);
    expect(reported).toMatchObject({
      label: 'Reported contributions',
      value: '$30,655',
      isFigure: true,
    });
    expect(contributions).toMatchObject({ label: 'Itemized contributions', value: '$15,130' });
    expect(expenditures).toMatchObject({
      label: 'Itemized expenditures',
      basis: '54 payment records',
    });
    expect(accountFigures(null).map((figure) => figure.value)).toEqual([
      'Not held',
      'Not held',
      'Not held',
    ]);
    const unavailable = accountFigures({ ...Y2025, money_in: { state: 'unavailable' } });
    expect(unavailable[1].value).toBe("We couldn't load this");
  });

  it('names a contest by seat, district and year', () => {
    expect(contestLabel('Senate', '12', 2026)).toBe('State Senator · District 12 · 2026');
    expect(contestLabel('Governor', null, 2026)).toBe('Governor · 2026');
  });
});
