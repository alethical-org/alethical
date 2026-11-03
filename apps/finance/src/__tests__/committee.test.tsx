import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { clearReadCache } from '../api/read';
import { SessionProvider } from '../auth/session';
import {
  contributionGroups,
  expenditureGroups,
  groupCountLabel,
  orderedRows,
  reportLabel,
  sortGroups,
  sumAmounts,
  tabOfKind,
  tableTotal,
} from '../pages/committee/data';
import { clearYearPayments } from '../pages/committee/useYearPayments';
import { kindView, stateRows } from '../pages/committee/Breakdowns';
import * as routes from '../routes';
import type { MadePayment, ReceivedPayment } from '../pages/committee/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.example.test';

function fakeSupabase() {
  const session = { access_token: 'token-1', user: { id: 'u1', email: 'r@example.test' } };
  return {
    auth: {
      getSession: async () => ({ data: { session: session as unknown as Session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  } as unknown as SupabaseClient;
}

function received(
  contributor: string,
  type: string,
  amount: string | null,
  on: string | null,
  record: number,
  receipt = 'Contribution',
  registration: string | null = null,
): ReceivedPayment {
  return {
    contributor,
    contributor_registration_number: registration,
    contributor_type: type,
    amount,
    received_on: on,
    receipt_type: receipt,
    in_kind: 'No',
    record_number: record,
  };
}

function made(vendor: string, amount: string | null, on: string, record: number): MadePayment {
  return {
    vendor_name: vendor,
    vendor_city: 'Saint Paul',
    vendor_state: 'MN',
    affected_committee_name: null,
    affected_committee_registration_number: null,
    amount,
    paid_on: on,
    expenditure_type: 'General Expenditure',
    purpose: 'Printing',
    in_kind: 'No',
    record_number: record,
  };
}

const RECEIVED: ReceivedPayment[] = [
  received('Example, Jordan A', 'Individual', '2000.0000', '2026-05-14', 11),
  received('Example, Jordan A', 'Individual', '1500.0000', '2026-01-09', 12),
  received('EXAMPLE, PRIYA', 'Individual', null, null, 13),
  received('EXAMPLE, PRIYA', 'Individual', '250.0000', '2026-02-01', 14),
  received(
    'Example State Central Committee',
    'Party Unit',
    '150000.0000',
    '2026-06-23',
    15,
    'Contribution',
    '20003',
  ),
  received('Example Builders Council', 'Political Committee/Fund', '5000.0000', '2026-07-02', 16),
  received('Interest Bank', 'Other', '12.0000', '2026-03-01', 17, 'Miscellaneous'),
];

const FINANCE = {
  registration_number: '90001',
  committee_name: 'Example Candidate Committee',
  entity_type: 'PCC',
  entity_sub_type: null,
  year: 2026,
  payment_copied_at: {
    contributions: '2026-10-27T17:00:00Z',
    expenditures: '2026-10-27T17:00:00Z',
    independent_expenditures: '2026-10-27T17:00:00Z',
  },
  filings_copied_at: '2026-10-27T03:00:00Z',
  register: {
    state: 'reported',
    kind: 'candidate_committee',
    name: 'Example Candidate Committee',
    registration_date: '2025-02-03',
    termination_date: null,
    retained: false,
    copied_on: null,
  },
  money_in: {
    state: 'reported',
    itemized_contribution_payments: 6,
    reported_total: '438900.5000',
    reported_through: '2026-07-20',
    reported_period_start: '2026-01-01',
  },
  money_out: {
    state: 'reported',
    itemized_payments: 2,
    reported_total: '171268.0000',
    reported_through: '2026-07-20',
  },
};

const FILINGS = {
  state: 'reported',
  filings: [
    {
      report_name: '2026 Pre-Primary Report',
      filing_year: 2026,
      period_end: '2026-07-20',
      period_start: '2026-01-01',
      amendment_count: 2,
      effective_amendment_index: 1,
    },
  ],
};

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    record_number: 7,
    report_name: '2026 Pre-Primary Report',
    report_type: 'Pre-Primary',
    cut_off_date: '2026-07-20',
    filed_date: '2026-07-27',
    effective_amendment_index: 1,
    special_election: false,
    period_start: '2026-01-01',
    beginning_cash_balance: '12000.0000',
    beginning_balance_as_of: '2026-01-01',
    ending_balance_as_of: '2026-07-20',
    contributions: '438900.5000',
    total_expenditures: '171268.0000',
    total_disbursements: null,
    total_receipts: '440100.0000',
    ending_cash_balance: '280832.0000',
    figures_state: 'reported',
    ...overrides,
  };
}

function reports(rows: unknown[] = [reportRow()]) {
  return {
    registration_number: '90001',
    year: 2026,
    state: rows.length ? 'reported' : 'not_reported',
    reports: rows,
  };
}

function page<T>(state: string, payments: T[], extra: Record<string, unknown> = {}) {
  return {
    state,
    payments,
    page: { limit: 250, offset: 0, has_more: false, total_payments: payments.length },
    linkable_registration_numbers: ['20003'],
    release_id: 'r1',
    fetched_at: '2026-10-27T17:00:00Z',
    ...extra,
  };
}

const NOTICES = {
  state: 'listed',
  registration_number: '90001',
  year: 2026,
  threshold: 'more_than_1000',
  windows: [
    {
      key: 'pre_primary',
      label: 'Before the primary',
      start: '2026-07-21',
      end: '2026-08-10',
      notices: [
        {
          id: 'n1',
          contributor: 'Example State Central Committee',
          amount: '150000.00',
          contribution_date: '2026-06-23',
          received_on: '2026-06-24',
          status: 'matched',
          matched_payment: { record_number: 15, contributor: 'Example State Central Committee' },
          pdf_url: 'https://cfb.mn.gov/notice.pdf',
        },
      ],
    },
  ],
  copied_on: '2026-10-27',
  any_amended: false,
  report_covered_through: '2026-10-19',
};

type Answers = Record<string, { status: number; body?: unknown }>;

function fetcherFor(answers: Answers) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/finance/access')) return new Response(null, { status: 200 });
    const path = url.replace(`${API}/api/v1`, '');
    const key = Object.keys(answers).find((prefix) => path.startsWith(prefix));
    const answer = key ? answers[key] : { status: 404 };
    return new Response(answer.body === undefined ? null : JSON.stringify({ data: answer.body }), {
      status: answer.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function loadedAnswers(overrides: Answers = {}): Answers {
  return {
    '/committees/90001/finance': { status: 200, body: FINANCE },
    '/committees/90001/filings': { status: 200, body: FILINGS },
    '/finance/committees/90001/report-figures': { status: 200, body: reports() },
    '/committees/90001/confirmation': {
      status: 200,
      body: {
        registration_number: '90001',
        current_claim_validated_at: new Date().toISOString(),
        confirmed_for: null,
      },
    },
    '/committees/90001/notices': { status: 200, body: NOTICES },
    '/committees/90001/disclosure-statements': {
      status: 200,
      body: {
        state: 'listed',
        registration_number: '90001',
        year: 2026,
        statements: [],
        copied_on: null,
      },
    },
    '/committees/90001/payments?direction=received': {
      status: 200,
      body: page('reported', RECEIVED, {
        disclosure_statements: [
          {
            record_number: 16,
            statement_id: 's1',
            state: 'read',
            pdf_url: 'https://cfb.mn.gov/s1.pdf',
          },
        ],
        statements_copied_on: '2026-10-27',
      }),
    },
    '/committees/90001/payments?direction=made': {
      status: 200,
      body: page('reported', [
        made('Example Printing Co', '8420.0000', '2026-04-22', 21),
        made('Example Printing Co', null, '2026-03-03', 22),
      ]),
    },
    '/committees/90001/payments?direction=independent_by': {
      status: 200,
      body: page('reported', []),
    },
    '/campaign-finance/disclosure-statements/s1': {
      status: 200,
      body: {
        id: 's1',
        state: 'read',
        donor_name: 'Example Builders Council',
        recipient_name: 'Example Candidate Committee',
        gift_date: '2026-07-02',
        gift_amount: '5000',
        pdf_url: 'https://cfb.mn.gov/s1.pdf',
        box: 3,
        sources: [{ name: 'Example Builders Fund', city: 'Saint Paul', state: 'MN', amount: null }],
        line_a: '3000',
        line_b: null,
        line_c: null,
        signed_on: '2026-07-01',
        received_on: '2026-07-06',
      },
    },
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T15:00:00Z'));
  clearReadCache();
  clearYearPayments();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(path: string, answers: Answers) {
  window.history.replaceState(null, '', path);
  vi.stubGlobal('fetch', fetcherFor(answers));
  await act(async () => {
    root.render(
      <SessionProvider supabase={fakeSupabase()} apiBaseUrl={API} screens>
        <App />
      </SessionProvider>,
    );
  });
  for (let i = 0; i < 6; i += 1) await act(async () => {});
}

const text = () => container.textContent ?? '';
const button = (words: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === words);

describe('Committee page', () => {
  it('says a missing official spending total in words, never as $0', async () => {
    await render(
      '/money/committees/90001',
      loadedAnswers({
        '/finance/committees/90001/report-figures': {
          status: 200,
          body: reports([reportRow({ total_expenditures: null, ending_cash_balance: null })]),
        },
      }),
    );
    expect(text()).toContain('Contributions$438,900');
    expect(text()).toContain('Ending balanceReport total unavailable');
    expect(text()).toContain(
      'We do not hold an official spending total for this committee for this year',
    );
    expect(text()).not.toContain('Total expenditures');
  });

  it('prints a filed $0 with its own-zero note and keeps the chosen report in the address', async () => {
    await render(
      '/money/committees/90001?report=8',
      loadedAnswers({
        '/finance/committees/90001/report-figures': {
          status: 200,
          body: reports([
            reportRow(),
            reportRow({
              record_number: 8,
              report_name: '2026 Pre-General Report',
              effective_amendment_index: 0,
              cut_off_date: '2026-10-19',
              period_start: '2026-07-21',
              total_expenditures: '0.0000',
            }),
          ]),
        },
      }),
    );
    expect(text()).toContain('Report: 2026 Pre-General Report · as filed');
    expect(text()).toContain('Total expenditures$0');
    expect(text()).toContain('The committee’s own report states $0 in expenditures.');
    const menu = button('Report: 2026 Pre-General Report · as filed')!;
    await act(async () => menu.click());
    const first = [...container.querySelectorAll('[role="option"] button')].find(
      (item) => item.textContent === '2026 Pre-Primary Report · Amendment 1',
    ) as HTMLButtonElement;
    await act(async () => first.click());
    expect(window.location.search).toContain('report=7');
    expect(text()).toContain('Total expenditures$171,268');
  });

  it('says the registration status the register gives', async () => {
    await render(
      '/money/committees/90001',
      loadedAnswers({
        '/committees/90001/finance': {
          status: 200,
          body: { ...FINANCE, register: { ...FINANCE.register, termination_date: '2026-07-28' } },
        },
      }),
    );
    expect(container.querySelector('.cmt-reg-status')?.textContent).toBe('Terminated Jul 28, 2026');
  });

  it('shows the official figures, the 6 tabs with counts, and grouped names', async () => {
    await render('/money/committees/90001', loadedAnswers());
    expect(container.querySelector('h1')?.textContent).toBe('Example Candidate Committee');
    expect(text()).toContain('Candidate committee');
    expect(text()).toContain('Registration 90001');
    expect(container.querySelector('.cmt-reg-status')?.textContent).toBe('Registered Feb 3, 2025');
    expect(text()).toContain('Report: 2026 Pre-Primary Report · Amendment 1');
    const figures = [...container.querySelectorAll('.cmt-figure-box dt')].map(
      (item) => item.textContent,
    );
    expect(figures).toEqual([
      'Beginning balance',
      'Total receipts',
      'Contributions',
      'Total expenditures',
      'Ending balance',
    ]);
    expect(text()).toContain('Contributions$438,900');
    expect(text()).toContain('Total expenditures$171,268');
    expect(text()).toContain(
      'Period Jan 1, 2026 to Jul 20, 2026. Figures are as filed in the selected report.',
    );
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    // The Miscellaneous receipt is no contribution and sits in no tab.
    expect(tabs).toEqual([
      'Individuals4',
      'Lobbyists0',
      'Committees and funds1',
      'Party units1',
      'Other kinds0',
      'Expenditures2',
    ]);
    expect(text()).toContain('2 names · 4 payment records');
    // One amount is missing, so neither the name's sum nor the table's total is shown.
    expect(text()).toContain('Itemized contributions Incomplete');
    expect(text()).toContain('Example, Jordan A · 2\u00a0payment\u00a0records');
    // About these records sits above Sources and updates; the Sources group
    // ends every line with a period because 1 line has 2 sentences.
    expect(container.querySelector('#cmt-about-h')?.textContent).toBe('About these records');
    expect(text()).toContain(
      'Registered with the Minnesota Campaign Finance and Public Disclosure Board.',
    );
    expect(text()).toContain('Minnesota’s list of large-contribution notices copied Oct 27, 2026.');
    expect(text()).toContain('$3,500');
    expect(container.querySelector('[role="table"]')?.getAttribute('aria-label')).toBe(
      'Contributions, Individuals',
    );
  });

  it("filters the names by the name a link carries, and by an older link's q", async () => {
    await render('/money/committees/90001?name=Jordan', loadedAnswers());
    expect(text()).toContain('Example, Jordan A');
    expect(text()).not.toContain('EXAMPLE, PRIYA');
    expect(container.querySelector<HTMLInputElement>('.cmt-field')?.value).toBe('Jordan');
    act(() => root.unmount());
    root = createRoot(container);
    clearReadCache();
    await render('/money/committees/90001?q=Jordan', loadedAnswers());
    expect(text()).toContain('Example, Jordan A');
    expect(text()).not.toContain('EXAMPLE, PRIYA');
  });

  it('opens a name to its payments with missing values left missing', async () => {
    await render('/money/committees/90001', loadedAnswers());
    const toggle = [...container.querySelectorAll('button')].find((item) =>
      item
        .getAttribute('aria-label')
        ?.startsWith('Show the 2\u00a0payment\u00a0records from EXAMPLE, PRIYA'),
    )!;
    await act(async () => toggle.click());
    expect(toggle.textContent).toContain('Hide details');
    expect(text()).toContain('Date not given in the public file');
    expect(text()).toContain('Amount not given');
    await act(async () => button('View source')!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Contributions file');
    expect(dialog.textContent).toContain('No saved source excerpt is held for this record');
    expect(dialog.textContent).toContain('Not checked');
    expect(dialog.querySelector('a')?.getAttribute('href')).toBe(
      'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/90001/2026/',
    );
  });

  it('links a registered committee name and shows a disclosure statement inside its payment', async () => {
    await render('/money/committees/90001?tab=committees', loadedAnswers());
    expect(text()).toContain('1\u00a0payment\u00a0record with a disclosure statement');
    expect(container.querySelector('a[href^="/money/committees/"]')).toBeNull();
    const toggle = button('Show details')!;
    await act(async () => toggle.click());
    for (let i = 0; i < 4; i += 1) await act(async () => {});
    expect(text()).toContain('This statement names the sources below for this contribution');
    expect(text()).toContain('Schedule A1');
    expect(text()).toContain('Example Builders Fund');
    expect(text()).toContain('Line B · Amount from sources not required to be itemized');
    expect(text()).toContain('Not reported');
    expect(text()).toContain('Signed: Jul 1, 2026 · Received by the Board: Jul 6, 2026');
  });

  it('jumps from a matched notice to its payment under Party units', async () => {
    await render('/money/committees/90001', loadedAnswers());
    expect(text()).toContain('Large-contribution notices');
    const jump = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Also a payment in the list above, under Party units'),
    )!;
    await act(async () => jump.click());
    await act(async () => {});
    expect(window.location.search).toContain('tab=party');
    const party = container.querySelector('a[href^="/money/committees/20003"]');
    expect(party?.textContent).toBe('Example State Central Committee');
    expect(container.querySelector('[data-jumped]')).not.toBeNull();
    expect(text()).toContain('Minnesota’s list of large-contribution notices copied Oct 27, 2026');
  });

  it('lists expenditures with a withheld total when an amount is missing', async () => {
    await render('/money/committees/90001?tab=expenditures', loadedAnswers());
    expect(text()).toContain('1 name · 2 payment records');
    expect(text()).toContain('Total itemized expenditures Incomplete');
    expect(container.querySelector('[role="table"]')?.getAttribute('aria-label')).toBe(
      'Expenditures',
    );
  });

  it('says what an empty year holds, never $0', async () => {
    await render(
      '/money/committees/90001',
      loadedAnswers({
        '/finance/committees/90001/report-figures': { status: 200, body: reports([]) },
        '/committees/90001/payments?direction=received': {
          status: 200,
          body: page('not_reported', []),
        },
      }),
    );
    expect(text()).toContain('No official report figures are held for 2026.');
    expect(text()).toContain('None held for 2026');
    expect(text()).not.toContain('$0');
  });

  it('offers Try again when the report figures cannot be read, keeping the payments', async () => {
    await render(
      '/money/committees/90001',
      loadedAnswers({ '/finance/committees/90001/report-figures': { status: 500 } }),
    );
    expect(text()).toContain('We couldn’t load the report information');
    expect(text()).toContain('Example, Jordan A');
  });

  it('carries the year on name links and sorts by payment date', async () => {
    await render('/money/committees/90001?tab=party&year=2026', loadedAnswers());
    expect(
      container.querySelector('a[href^="/money/committees/20003"]')?.getAttribute('href'),
    ).toBe(
      '/money/committees/20003?year=2026&from=%2Fmoney%2Fcommittees%2F90001%3Ftab%3Dparty%26year%3D2026',
    );
    await act(async () => {
      window.history.replaceState(null, '', '/money/committees/90001?sort=earliest');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    for (let i = 0; i < 4; i += 1) await act(async () => {});
    const names = [...container.querySelectorAll('.cmt-group-row .cmt-wrap > :first-child')].map(
      (item) => item.textContent,
    );
    expect(names).toEqual(['Example, Jordan A', 'EXAMPLE, PRIYA']);
    expect(text()).toContain('Sort names: Earliest payment first');
  });

  it('offers Try again when the committee cannot be read', async () => {
    await render(
      '/money/committees/90001',
      loadedAnswers({ '/committees/90001/finance': { status: 500 } }),
    );
    expect(text()).toContain('We couldn’t load this committee');
    expect(text()).not.toContain('problem on our side');
    expect(button('Try again')).toBeDefined();
  });

  it('says the record is unavailable for a number we do not hold', async () => {
    await render(
      '/money/committees/90001',
      loadedAnswers({ '/committees/90001/finance': { status: 404 } }),
    );
    expect(container.querySelector('h1')?.textContent).toBe('This record is no longer available');
  });

  it('shows the payments failure without inventing an empty list', async () => {
    await render(
      '/money/committees/90001',
      loadedAnswers({ '/committees/90001/payments?direction=received': { status: 500 } }),
    );
    expect(text()).toContain('We couldn’t load these payments right now.');
    expect(text()).not.toContain('contribution records are held');
  });
});

describe('Committee page, Media buys card', () => {
  const CONNECTIONS = '/finance/media-buys/connections';
  const KEY = 'kare-1234';
  const VERSION = 'a'.repeat(64);
  const ROW = {
    key: KEY,
    name: 'invoice.pdf',
    label: 'invoice.pdf',
    station: 'KARE',
    year: 2026,
    category: 'Local',
    kind: 'Invoice',
    uploaded_at: '2026-03-04',
    version_id: VERSION,
    version_count: 1,
    source_changed: false,
  };
  const card = () => container.querySelector('.mb-buys-card');
  const reads = () =>
    (fetch as unknown as { mock: { calls: [RequestInfo | URL][] } }).mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((url) => url.pathname.endsWith(CONNECTIONS));

  it('reads the files connected to this registration and sits above Related records', async () => {
    await render(
      '/money/committees/90001',
      loadedAnswers({
        [CONNECTIONS]: {
          status: 200,
          body: {
            agency_key: null,
            exact_name_count: 0,
            files: [ROW],
            total: 1,
            groups: [{ label: '', files: [{ ...ROW, role: 'Advertiser, as printed' }] }],
          },
        },
      }),
    );
    expect(reads().map((url) => [...url.searchParams])).toEqual([
      [
        ['kind', 'committee'],
        ['target', '90001'],
      ],
    ]);
    const aside = [...container.querySelectorAll('.cmt-aside h2')].map((h) => h.textContent);
    expect(aside.slice(-2)).toEqual(['Media buys', 'Related records']);
    expect(card()?.textContent).toContain('KARE invoice ·');
    expect(card()?.textContent).toContain('Advertiser, as printed');
    expect(card()?.querySelectorAll('a')).toHaveLength(1);
    expect(card()?.querySelector('a')?.getAttribute('href')).toBe(
      `/media-buys/files/${KEY}?version=${VERSION}&from=%2Fmoney%2Fcommittees%2F90001`,
    );
  });

  it('says no file is connected to the committee by its name', async () => {
    await render(
      '/money/committees/90001',
      loadedAnswers({
        [CONNECTIONS]: {
          status: 200,
          body: { agency_key: null, exact_name_count: 0, files: [], total: 0, groups: [] },
        },
      }),
    );
    const name = container.querySelector('h1')?.textContent;
    expect(name).toBeTruthy();
    expect(card()?.textContent).toContain(
      `No TV station files have a checked connection to ${name}`,
    );
  });

  it('says the files could not be loaded, with Try again', async () => {
    await render('/money/committees/90001', loadedAnswers({ [CONNECTIONS]: { status: 500 } }));
    expect(card()?.textContent).toContain('We couldn’t load these TV station files');
    expect(card()?.textContent).toContain('Try again');
    expect(card()?.textContent).not.toContain('problem on our side');
  });

  it('is left off while the TV station file page is off', async () => {
    const real = routes.isBuilt;
    const spy = vi
      .spyOn(routes, 'isBuilt')
      .mockImplementation((name) => name !== 'station-file' && real(name));
    await render('/money/committees/90001', loadedAnswers());
    expect(container.querySelector('h1')).toBeTruthy();
    expect(card()).toBeNull();
    expect(reads()).toHaveLength(0);
    spy.mockRestore();
  });
});

describe('Committee figures and labels', () => {
  it('maps filed contributor kinds to tabs', () => {
    expect(tabOfKind('Individual')).toBe('individuals');
    expect(tabOfKind('Lobbyist')).toBe('lobbyists');
    expect(tabOfKind('Political Committee/Fund')).toBe('committees');
    expect(tabOfKind('Party Unit')).toBe('party');
    expect(tabOfKind('Candidate Committee')).toBe('other');
    expect(tabOfKind(null)).toBe('other');
  });

  it('sums exactly and withholds a sum with a missing amount', () => {
    expect(sumAmounts(['0.1000', '0.2000'])).toBe('0.3000');
    expect(sumAmounts(['-2500.0000', '100.5000'])).toBe('-2399.5000');
    expect(sumAmounts(['1.0000', null])).toBeNull();
  });

  it('counts statements on a name in the drawn words', () => {
    const [group] = contributionGroups(
      [
        received('A', 'Individual', '1.0000', '2026-01-01', 1),
        received('A', 'Individual', '1.0000', '2026-01-02', 2),
      ],
      new Set(),
      [
        { record_number: 1, statement_id: 'x', state: 'read', pdf_url: 'p' },
        { record_number: 2, statement_id: 'y', state: 'read', pdf_url: 'p' },
      ],
    ).individuals;
    expect(groupCountLabel(group)).toBe(
      '2\u00a0payment\u00a0records, both with a disclosure statement',
    );
  });

  it('sorts a withheld total after every known total', () => {
    const groups = expenditureGroups(
      [
        made('B', null, '2026-01-01', 1),
        made('A', '5.0000', '2026-01-01', 2),
        made('C', '9.0000', '2026-01-01', 3),
      ],
      new Set(),
    );
    expect(sortGroups(groups, 'total').map((group) => group.name)).toEqual(['C', 'A', 'B']);
    expect(sortGroups(groups, 'smallest').map((group) => group.name)).toEqual(['A', 'C', 'B']);
    expect(tableTotal(groups)).toBe('Incomplete');
  });

  it('sorts by known payment dates with undated groups last, and orders payments to match', () => {
    const groups = expenditureGroups(
      [
        made('Undated', '1.0000', '', 1),
        made('Early', '1.0000', '2026-01-03', 2),
        made('Late', '1.0000', '2026-06-01', 3),
        made('Late', '1.0000', '2026-02-01', 4),
      ].map((payment) => (payment.paid_on ? payment : { ...payment, paid_on: null })),
      new Set(),
    );
    expect(sortGroups(groups, 'latest').map((group) => group.name)).toEqual([
      'Late',
      'Early',
      'Undated',
    ]);
    expect(sortGroups(groups, 'earliest').map((group) => group.name)).toEqual([
      'Early',
      'Late',
      'Undated',
    ]);
    const late = groups.find((group) => group.name === 'Late')!;
    expect(orderedRows(late, 'earliest').map((row) => row.date)).toEqual([
      '2026-02-01',
      '2026-06-01',
    ]);
  });

  it('names a report and the version our copy holds', () => {
    expect(
      reportLabel({
        report_name: '2026 Pre-Primary Report',
        filing_year: 2026,
        period_end: '2026-07-20',
        period_start: null,
        amendment_count: 1,
        effective_amendment_index: 0,
      }),
    ).toBe('2026 Pre-Primary Report · as filed');
  });
});

const BY_KIND = {
  state: 'reported',
  reported_through: '2026-07-20',
  lines: [
    {
      line_key: 'individuals_contributions',
      label_as_filed: 'A1 - Individuals',
      stated_total: '312450.0000',
      itemized_cash_total: '298200.0000',
      difference: '14250.0000',
    },
    {
      line_key: 'lobbyist_contributions',
      label_as_filed: 'A2 - Lobbyists',
      stated_total: '2500.0000',
      itemized_cash_total: '2500.0000',
      difference: '0.0000',
    },
  ],
};

const DONOR_STATES = {
  state: 'reported',
  year: 2026,
  rows: [
    { names: 19, cash_total: '9800.00', state: 'WI' },
    { names: 412, cash_total: '241300.00', state: 'MN' },
    { names: 11, cash_total: '15150.00', state: 'IA' },
    { names: 9, cash_total: '2200.00', state: 'unknown' },
  ],
  summary: {
    minnesota: { names: 412, cash_total: '241300.00' },
    other_states: { names: 30, cash_total: '24950.00' },
    unknown: { names: 9, cash_total: '2200.00' },
  },
  reference: {
    source_url: 'https://example.test/zips',
    as_of: '2026-07-01',
    copied_at: '2026-07-02',
  },
};

const NAME_CONNECTIONS = {
  state: 'reported',
  year: 2026,
  matching: 'exact_printed_name',
  numerator: 61,
  denominator: 455,
  distribution: [
    { other_committees: '0', names: 394 },
    { other_committees: '1', names: 41 },
    { other_committees: '2', names: 13 },
    { other_committees: '3', names: 4 },
    { other_committees: '4+', names: 3 },
  ],
  top_names: [
    { name: 'Example, Avery', other_committees: 5 },
    { name: 'Example, Wen', other_committees: 1 },
  ],
};

function withBlocks(
  blocks: Record<string, unknown>,
  base: Record<string, unknown> = FINANCE,
): Answers {
  return loadedAnswers({
    '/committees/90001/finance': { status: 200, body: { ...base, ...blocks } },
  });
}

describe('Committee page, breakdowns', () => {
  it('prints contributions by type as filed for the report they match, as chart and table', async () => {
    await render('/money/committees/90001', withBlocks({ stated_by_kind: BY_KIND }));
    const kind = container.querySelector('.cmt-bk-kind')!;
    expect(kind.textContent).toContain('Contributions by type, as filed');
    expect(kind.textContent).toContain('A1 - Individuals');
    expect(kind.textContent).toContain('Filed total $312,450');
    expect(kind.textContent).toContain('Itemized cash $298,200');
    expect(kind.textContent).toContain('Difference $14,250');
    expect(kind.textContent).toContain('Difference $0');
    expect(kind.textContent).toContain(
      'Filed totals and itemized cash through Jul\u00a020,\u00a02026',
    );
    // The breakdown sits inside the report card, before its period line.
    expect(container.querySelector('.cmt-official .cmt-bk-kind')).not.toBeNull();
    const table = [...kind.querySelectorAll('button')].find(
      (item) => item.textContent === 'Table',
    )!;
    await act(async () => table.click());
    expect(window.location.search).toContain('typeView=table');
    const heads = [...kind.querySelectorAll('thead th')].map((item) => item.textContent);
    expect(heads).toEqual(['TYPE', 'FILED TOTAL', 'ITEMIZED CASH', 'DIFFERENCE']);
    expect(kind.querySelector('tbody tr')?.textContent).toBe(
      'A1 - Individuals$312,450$298,200$14,250',
    );
  });

  it('shows no type figures for another report, a disagreement or a missing block', async () => {
    await render(
      '/money/committees/90001?report=8',
      loadedAnswers({
        '/committees/90001/finance': { status: 200, body: { ...FINANCE, stated_by_kind: BY_KIND } },
        '/finance/committees/90001/report-figures': {
          status: 200,
          body: reports([
            reportRow(),
            reportRow({
              record_number: 8,
              report_name: '2026 Pre-General Report',
              cut_off_date: '2026-10-19',
            }),
          ]),
        },
      }),
    );
    expect(container.querySelector('.cmt-bk-kind')?.textContent).toContain(
      'A type breakdown isn’t available for this report',
    );
    expect(container.querySelector('.cmt-bk-kind')?.textContent).not.toContain('$312,450');
    expect(kindView({ ...BY_KIND, state: 'sources_disagree', lines: [] }, '2026-07-20')).toEqual({
      state: 'disagree',
    });
    expect(kindView(undefined, '2026-07-20')).toEqual({ state: 'unavailable' });
    // A missing filed figure withholds the block rather than printing $0.
    expect(
      kindView({ ...BY_KIND, lines: [{ ...BY_KIND.lines[0], stated_total: null }] }, '2026-07-20'),
    ).toEqual({ state: 'unavailable' });
  });

  it('says when the sources disagree', async () => {
    await render(
      '/money/committees/90001',
      withBlocks({
        stated_by_kind: { state: 'sources_disagree', reported_through: '2026-07-20', lines: [] },
      }),
    );
    expect(container.querySelector('.cmt-bk-kind')?.textContent).toContain('The sources disagree');
  });

  it('lists individual cash by state, each other state when opened, and dates the ZIP reference', async () => {
    await render('/money/committees/90001', withBlocks({ donor_states: DONOR_STATES }));
    const card = container.querySelector('[aria-labelledby="cmt-states-h"]')!;
    expect(card.querySelector('h2')?.textContent).toBe('Individual contributions by state, 2026');
    const labels = () => [...card.querySelectorAll('.f-bar-label')].map((item) => item.textContent);
    expect(labels()).toEqual(['Minnesota', 'Other states', 'Unknown']);
    expect(card.textContent).toContain('$241,300 · Printed names 412');
    expect(card.textContent).toContain('using the reference dated Jul 1, 2026, not proof');
    const show = [...card.querySelectorAll('button')].find(
      (b) => b.textContent === 'Show each state',
    )!;
    expect(show.getAttribute('aria-expanded')).toBe('false');
    await act(async () => show.click());
    expect(labels()).toEqual(['Minnesota', 'Other states', 'Iowa', 'Wisconsin', 'Unknown']);
    expect(card.querySelector('[data-sub]')).not.toBeNull();
    expect(show.textContent).toBe('Hide each state');
  });

  it('says a state breakdown is not available rather than printing $0, and only for a candidate committee', async () => {
    await render('/money/committees/90001', withBlocks({}));
    const card = container.querySelector('[aria-labelledby="cmt-states-h"]')!;
    expect(card.textContent).toContain('A state breakdown isn’t available for 2026');
    expect(card.textContent).not.toContain('$0');
    expect(
      stateRows(
        {
          ...DONOR_STATES,
          summary: { ...DONOR_STATES.summary, unknown: { names: 9, cash_total: null } },
        },
        false,
      ),
    ).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    clearReadCache();
    await render(
      '/money/committees/90001',
      withBlocks(
        { donor_states: DONOR_STATES },
        {
          ...FINANCE,
          entity_type: 'PCF',
          register: { ...FINANCE.register, kind: 'political_committee_or_fund' },
        },
      ),
    );
    expect(container.querySelector('[aria-labelledby="cmt-states-h"]')).toBeNull();
    expect(container.querySelector('[aria-labelledby="cmt-names-h"]')).not.toBeNull();
  });

  it('counts printed donor names at other candidate committees and links each to its payments', async () => {
    await render('/money/committees/90001', withBlocks({ name_connections: NAME_CONNECTIONS }));
    const card = container.querySelector('[aria-labelledby="cmt-names-h"]')!;
    expect(card.querySelector('h2')?.textContent).toBe(
      'Donor names also at other candidate committees, 2026',
    );
    expect(card.textContent).toContain(
      '455 printed individual donor names · 61 also appear at another candidate committee',
    );
    const buckets = [...card.querySelectorAll('tbody th')].map((item) => item.textContent);
    expect(buckets).toEqual(['0', '1', '2', '3', '4 or more']);
    const links = [...card.querySelectorAll('a')];
    expect(links.map((link) => link.textContent)).toEqual([
      'Example, Avery5 other committees',
      'Example, Wen1 other committee',
    ]);
    expect(links[0].getAttribute('href')).toBe(
      '/money/names/Example%2C%20Avery?role=donor&year=2026&from=%2Fmoney%2Fcommittees%2F90001',
    );
    expect(card.textContent).toContain('A shared name does not show the same person.');
  });

  it('shows neither year card in a year with no contribution records held', async () => {
    await render(
      '/money/committees/90001',
      withBlocks({
        money_in: { ...FINANCE.money_in, state: 'not_reported' },
        name_connections: {
          ...NAME_CONNECTIONS,
          state: 'not_reported',
          numerator: null,
          denominator: null,
        },
      }),
    );
    expect(container.querySelector('[aria-labelledby="cmt-names-h"]')).toBeNull();
    expect(container.querySelector('[aria-labelledby="cmt-states-h"]')).toBeNull();
  });

  it('says when no names are held, or the connections are unavailable', async () => {
    await render(
      '/money/committees/90001',
      withBlocks({
        name_connections: {
          ...NAME_CONNECTIONS,
          state: 'not_reported',
          numerator: null,
          denominator: null,
        },
      }),
    );
    expect(container.querySelector('[aria-labelledby="cmt-names-h"]')?.textContent).toContain(
      'No individual contribution names are held for 2026',
    );
    act(() => root.unmount());
    root = createRoot(container);
    clearReadCache();
    await render(
      '/money/committees/90001',
      withBlocks({
        name_connections: {
          ...NAME_CONNECTIONS,
          state: 'unavailable',
          numerator: null,
          denominator: null,
        },
      }),
    );
    const card = container.querySelector('[aria-labelledby="cmt-names-h"]')!;
    expect(card.textContent).toContain('Name connections are unavailable for 2026');
    expect(card.querySelector('table')).toBeNull();
  });
});

describe('Committee page, return link', () => {
  it('falls back to Campaign money when opened with no usable earlier page', async () => {
    await render('/money/committees/90001?from=https%3A%2F%2Fexample.test', loadedAnswers());
    const back = container.querySelector<HTMLAnchorElement>('.f-back');
    expect(back?.textContent).toBe('Back to Campaign money');
    expect(back?.getAttribute('href')).toBe('/money');
  });

  it('keeps the named fallback while loading, on failure and when the record is gone', async () => {
    await render(
      '/money/committees/90001',
      loadedAnswers({ '/committees/90001/finance': { status: 500 } }),
    );
    expect(container.querySelector('.f-back')?.textContent).toBe('Back to Campaign money');
    act(() => root.unmount());
    root = createRoot(container);
    clearReadCache();
    await render(
      '/money/committees/90001',
      loadedAnswers({ '/committees/90001/finance': { status: 404 } }),
    );
    expect(container.querySelector('.f-back')?.textContent).toBe('Back to Campaign money');
  });

  it('returns to the earlier page when the address names one', async () => {
    await render('/money/committees/90001?from=%2Fmoney%2Fraces%2Fhouse-1a', loadedAnswers());
    const back = container.querySelector<HTMLAnchorElement>('.f-back');
    expect(back?.textContent).toBe('Back to Money by race');
    expect(back?.getAttribute('href')).toBe('/money/races/house-1a');
  });
});
