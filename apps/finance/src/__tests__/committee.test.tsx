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
  reportLabel,
  sortGroups,
  sumAmounts,
  tabOfKind,
  tableTotal,
} from '../pages/committee/data';
import { clearYearPayments } from '../pages/committee/useYearPayments';
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
  register: { state: 'reported', kind: 'candidate_committee', name: 'Example Candidate Committee' },
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
        '/committees/90001/finance': {
          status: 200,
          body: {
            ...FINANCE,
            money_out: {
              ...FINANCE.money_out,
              state: 'not_reported',
              reported_total: null,
              reported_through: null,
            },
          },
        },
      }),
    );
    expect(text()).toContain('Contributions$438,900');
    expect(text()).toContain(
      'We do not hold an official spending total for this committee for this year',
    );
    expect(text()).not.toContain('Expenditures$');
  });

  it('shows the official figures, the 6 tabs with counts, and grouped names', async () => {
    await render('/money/committees/90001', loadedAnswers());
    expect(container.querySelector('h1')?.textContent).toBe('Example Candidate Committee');
    expect(text()).toContain('Candidate committee');
    expect(text()).toContain('Registration 90001');
    expect(text()).toContain('Report: 2026 Pre-Primary Report · Amendment 1');
    expect(text()).toContain('Contributions$438,900');
    expect(text()).toContain('Expenditures$171,268');
    expect(text()).toContain(
      'Period Jan 1, 2026 to Jul 20, 2026. Figures are as filed in the selected report.',
    );
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    // The Miscellaneous receipt is no contribution and sits in no tab.
    expect(tabs).toEqual([
      'Individuals4',
      'Lobbyists0',
      'Committees & Funds1',
      'Party Units1',
      'Other kinds0',
      'Expenditures2',
    ]);
    expect(text()).toContain('2 names · 4 payment records');
    // One amount is missing, so neither the name's sum nor the table's total is shown.
    expect(text()).toContain(
      'Itemized contributions Unavailable because a payment amount is missing',
    );
    expect(text()).toContain('Example, Jordan A · 2 payment records');
    expect(text()).toContain('$3,500');
    expect(container.querySelector('[role="table"]')?.getAttribute('aria-label')).toBe(
      'Contributions, Individuals',
    );
  });

  it('opens a name to its payments with missing values left missing', async () => {
    await render('/money/committees/90001', loadedAnswers());
    const toggle = [...container.querySelectorAll('button')].find((item) =>
      item.getAttribute('aria-label')?.startsWith('Show the 2 payment records from EXAMPLE, PRIYA'),
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
    expect(text()).toContain('1 payment record with a disclosure statement');
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

  it('jumps from a matched notice to its payment under Party Units', async () => {
    await render('/money/committees/90001', loadedAnswers());
    expect(text()).toContain('Large-contribution notices');
    const jump = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Also a payment in the list above, under Party Units'),
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
    expect(text()).toContain(
      'Total itemized expenditures Unavailable because a payment amount is missing',
    );
    expect(container.querySelector('[role="table"]')?.getAttribute('aria-label')).toBe(
      'Expenditures',
    );
  });

  it('says what an empty year holds, never $0', async () => {
    await render(
      '/money/committees/90001',
      loadedAnswers({
        '/committees/90001/finance': {
          status: 200,
          body: {
            ...FINANCE,
            money_in: {
              ...FINANCE.money_in,
              state: 'not_reported',
              reported_total: null,
              reported_through: null,
            },
            money_out: {
              ...FINANCE.money_out,
              state: 'not_reported',
              reported_total: null,
              reported_through: null,
            },
          },
        },
        '/committees/90001/payments?direction=received': {
          status: 200,
          body: page('not_reported', []),
        },
      }),
    );
    expect(text()).toContain('No official report figures are held for 2026.');
    expect(text()).toContain(
      'No Individuals contribution records are held for this account and year',
    );
    expect(text()).not.toContain('$0');
  });

  it('offers Try again when the committee cannot be read', async () => {
    await render(
      '/money/committees/90001',
      loadedAnswers({ '/committees/90001/finance': { status: 500 } }),
    );
    expect(text()).toContain('We couldn’t load this committee right now');
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
    expect(groupCountLabel(group)).toBe('2 payment records, both with a disclosure statement');
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
    expect(tableTotal(groups)).toBe('Unavailable because a payment amount is missing');
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
