import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import { Organization } from '../pages/Organization';
import {
  EMPTY_SECTION,
  INCOMPLETE,
  paymentCopyItems,
  periodOf,
  rolesOf,
  SECTION_FAILED,
} from '../pages/organization/data';
import type { Identity, IdentityConfirmation } from '../pages/organization/types';
import { clearOrganizationLoads } from '../pages/organization/useLoad';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SURVIVOR = '33333333-3333-4333-8333-333333333333';

function confirmation(
  id: string,
  record_kind: string,
  record_key: string,
  extra: Partial<IdentityConfirmation> = {},
): IdentityConfirmation {
  return {
    id,
    identity_id: ORG,
    record_kind,
    record_key,
    relation: 'Same organization',
    status: 'confirmed',
    checked_at: '2026-10-21T15:00:00Z',
    basis: 'The filing names the association.',
    evidence: {
      source: 'cf_contribution_row',
      snapshot_id: 'snap',
      locator: '44',
      url: null,
      quote: 'EXAMPLE HEALTH ASSOCIATION',
    },
    records: [],
    ...extra,
  };
}

const PROFILE: Identity = {
  id: ORG,
  kind: 'organization',
  name: 'Example Health Association',
  status: 'active',
  created_at: '2026-10-20T15:00:00Z',
  confirmations: [
    confirmation('c-lob', 'principal', '8450', {
      evidence: {
        source: 'lobbying_expenditure_row',
        snapshot_id: 'snap',
        locator: '12',
        url: null,
        quote: 'EXAMPLE HEALTH ASSN',
      },
    }),
    confirmation('c-give', 'donor_name', 'Example Health Association'),
    confirmation('c-old', 'donor_name', 'Example Health Assn', {
      status: 'withdrawn',
    }),
    confirmation('c-emp', 'employer_name', 'Example Health Association'),
    confirmation('c-paid', 'payee_name', 'Example Health Association'),
    confirmation('c-ie', 'independent_payee_name', 'Example Health Association'),
    confirmation('c-rel', 'committee', '30004', {
      relation: 'Supporting association named on the committee’s registration',
      evidence: {
        source: 'cf_filer',
        snapshot_id: 'snap',
        locator: '30004',
        url: null,
        quote: 'SUPPORTING ASSOCIATION',
      },
    }),
  ],
};

const EMPTY: Identity = { ...PROFILE, confirmations: [] };

function listing(kind: string, fingerprints: unknown[]) {
  return { record_kind: kind, record_key: 'Example Health Association', fingerprints };
}

const mine = { id: 'c', identity: { id: ORG, kind: 'organization', name: 'x' } };
const theirs = { id: 'd', identity: { id: OTHER, kind: 'organization', name: 'y' } };

const DONOR_LISTING = listing('donor_name', [
  {
    fingerprint: 'a'.repeat(64),
    fields: { receipt_date: '2026-02-20', amount: '2500.0000' },
    // 2 identical rows: each is its own record and neither is added to the other.
    rows: [
      { row_number: 44, year: 2026 },
      { row_number: 45, year: 2026 },
    ],
    confirmation: mine,
  },
  {
    fingerprint: 'b'.repeat(64),
    fields: { receipt_date: '2025-05-01', amount: '900.0000' },
    rows: [{ row_number: 46, year: 2025 }],
    confirmation: theirs,
  },
  {
    fingerprint: 'c'.repeat(64),
    fields: { receipt_date: '2025-06-01', amount: '700.0000' },
    rows: [{ row_number: 47, year: 2025 }],
    confirmation: null,
  },
]);

function given(record_number: number, received_on: string, amount: string, extra = {}) {
  return {
    recipient_registration_number: '30004',
    recipient_name: 'Example Senate Caucus',
    recipient_type: 'PTU',
    contributor: 'Example Health Association',
    contributor_registration_number: null,
    contributor_type: 'Other',
    employer: null,
    amount,
    received_on,
    year: Number(received_on.slice(0, 4)),
    receipt_type: 'Contribution',
    in_kind: 'No',
    in_kind_description: null,
    contributor_zip: '55401',
    contributor_state: 'MN',
    record_number,
    ...extra,
  };
}

function page(dataset: string, payments: unknown[], linkable: string[] = ['30004', '30005']) {
  return {
    name: 'Example Health Association',
    state: 'reported',
    payments,
    page: { limit: 250, offset: 0, has_more: false, total_payments: null },
    linkable_registration_numbers: linkable,
    dataset,
    source_url: `https://cfb.mn.gov/download/${dataset}`,
    release_id: 'rel-1',
    fetched_at: '2026-10-28T17:00:00Z',
  };
}

const GIVEN_PAGE = page('contributions', [
  given(44, '2026-02-20', '2500.0000'),
  given(45, '2026-02-20', '2500.0000'),
  given(46, '2025-05-01', '900.0000'),
  given(47, '2025-06-01', '700.0000'),
]);

const PAYEE_LISTING = listing('payee_name', [
  {
    fingerprint: 'd'.repeat(64),
    fields: { transaction_date: '2025-03-02', amount: '1200.0000' },
    rows: [{ row_number: 70, year: 2025 }],
    confirmation: mine,
  },
  {
    fingerprint: 'e'.repeat(64),
    fields: { transaction_date: '2026-01-09', amount: '-200.0000' },
    rows: [{ row_number: 71, year: 2026 }],
    confirmation: mine,
  },
  {
    fingerprint: 'f'.repeat(64),
    fields: { transaction_date: '2026-04-01', amount: null },
    rows: [{ row_number: 72, year: 2026 }],
    confirmation: mine,
  },
]);

function paid(record_number: number, paid_on: string, amount: string | null, committee: string) {
  return {
    committee_registration_number: committee,
    committee_name: committee === '30004' ? 'Example Senate Caucus' : 'Example Candidate Committee',
    vendor_name: 'Example Health Association',
    vendor_city: 'Minneapolis',
    vendor_state: 'MN',
    affected_committee_name: null,
    affected_committee_registration_number: null,
    amount,
    unpaid_amount: null,
    paid_on,
    year: Number(paid_on.slice(0, 4)),
    expenditure_type: 'Campaign Expenditure',
    purpose: 'Printing',
    in_kind: 'No',
    in_kind_description: null,
    record_number,
  };
}

const PAID_PAGE = page('expenditures', [
  paid(70, '2025-03-02', '1200.0000', '30004'),
  paid(71, '2026-01-09', '-200.0000', '30004'),
  paid(72, '2026-04-01', null, '30005'),
  paid(73, '2026-05-01', '5000.0000', '30005'),
]);

const IE_LISTING = listing('independent_payee_name', [
  {
    fingerprint: '9'.repeat(64),
    fields: { transaction_date: '2025-10-21', amount: '20000.0000' },
    rows: [{ row_number: 300, year: 2025 }],
    confirmation: mine,
  },
]);

const IE_PAGE = page(
  'independent_expenditures',
  [
    {
      spender: 'Example Political Fund',
      spender_registration_number: '80012',
      affected_committee_name: null,
      affected_committee_registration_number: null,
      stance: 'For',
      vendor_name: 'Example Health Association',
      amount: '20000.0000',
      unpaid_amount: null,
      paid_on: '2025-10-21',
      year: 2025,
      expenditure_type: 'Independent Expenditure',
      purpose: 'Mailers',
      record_number: 300,
    },
  ],
  ['80012'],
);

const PRINCIPAL = {
  release_id: 'lob',
  copied_at: '2026-10-29T11:20:32Z',
  entity_id: 8450,
  state: 'reported',
  name: 'Example Health Assn',
  latest_reported_year: 2025,
  spending: {
    state: 'reported',
    rows: [
      { year: 2025, record_number: 1, total_spent: '412000.0000' },
      { year: 2024, record_number: 2, total_spent: '388250.0000' },
    ],
  },
  lobbyists: {
    state: 'reported',
    total: 2,
    rows: [
      { registration_number: '90101', name: 'Example, Jordan A' },
      { registration_number: '90104', name: 'Example, Wen' },
    ],
  },
};

const COMMITTEE = {
  registration_number: '30004',
  committee_name: 'Example Action PAC',
  entity_type: 'PCF',
  entity_sub_type: 'PC',
  year: 2026,
  register: {
    state: 'reported',
    kind: 'political_committee_or_fund',
    name: 'Example Action PAC',
    copied_on: '2026-10-28',
  },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Answer = (url: string) => Response | Promise<Response>;

function answering(identity: Identity, overrides: Record<string, Response> = {}): Answer {
  return (raw) => {
    const url = decodeURIComponent(raw).replace(/\+/g, ' ');
    for (const [key, response] of Object.entries(overrides)) {
      if (url.includes(key)) return response.clone();
    }
    if (url.includes('/finance/identities/records')) {
      if (url.includes('record_kind=donor_name')) return json(DONOR_LISTING);
      if (url.includes('record_kind=payee_name')) return json(PAYEE_LISTING);
      if (url.includes('record_kind=independent_payee_name')) return json(IE_LISTING);
    }
    if (url.includes(`/finance/identities/${identity.id}`)) return json(identity);
    if (url.includes('payments-under-name') && url.includes('role=contributor'))
      return json(GIVEN_PAGE);
    if (url.includes('payments-under-name') && url.includes('role=vendor')) return json(PAID_PAGE);
    if (url.includes('payments-under-name') && url.includes('role=independent_vendor'))
      return json(IE_PAGE);
    if (url.includes('/lobbying/principals/8450')) return json(PRINCIPAL);
    if (url.includes('/committees/30004/finance')) return json(COMMITTEE);
    return new Response(null, { status: 500 });
  };
}

let container: HTMLDivElement;
let root: Root;
let requests: string[];

beforeEach(() => {
  clearReadCache();
  clearOrganizationLoads();
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

async function settle() {
  for (let i = 0; i < 8; i += 1) {
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
    root.render(<Organization match={matchRoute(path.split('?')[0])!} />);
  });
  await settle();
}

const text = () => container.textContent ?? '';

function section(title: string): HTMLElement {
  const heading = [...container.querySelectorAll('h2')].find((h) => h.textContent === title);
  return heading!.closest('section')!;
}

function rowsOf(title: string) {
  return [...section(title).querySelectorAll('li')].map((li) => li.textContent ?? '');
}

describe('Organization profile', () => {
  it('shows exactly the confirmed records in each section, never adding across them', async () => {
    await render(`/organizations/${ORG}`, answering(PROFILE));
    expect(container.querySelector('h1')?.textContent).toBe('Example Health Association');
    expect(text()).toContain('ORGANIZATION PROFILE');
    const roles = [...container.querySelectorAll('[role="listitem"]')].map((r) => r.textContent);
    expect(roles).toEqual(['Lobbying principal', 'Political donor', 'Payment recipient']);

    // Lobbying: the principal with its latest reported year and lobbyists as listed.
    const lob = rowsOf('Lobbying');
    expect(lob).toHaveLength(1);
    expect(lob[0]).toContain('Principal · Entity ID 8450');
    expect(lob[0]).toContain(
      'Reported spending 2025 · 2 lobbyists listed: Example, Jordan A; Example, Wen',
    );
    expect(lob[0]).toContain('$412,000');
    expect(section('Lobbying').textContent).toContain('Listed Oct 29, 2026');

    // Political giving: the 2 identical confirmed rows are 2 rows; rows confirmed for
    // another identity or for none never appear.
    const give = rowsOf('Political giving');
    expect(give).toHaveLength(2);
    for (const row of give) {
      expect(row).toContain('Example Senate Caucus');
      expect(row).toContain('Feb 20, 2026 · Contribution');
      expect(row).toContain('$2,500');
    }
    expect(section('Political giving').textContent).not.toContain('$5,000');
    expect(section('Political giving').textContent).not.toContain('$900');
    expect(section('Political giving').textContent).not.toContain('$700');
    expect(section('Political giving').textContent).toContain('Period Feb 20, 2026');

    // Payments received: per committee and file; refunds keep their sign; a missing
    // amount withholds that committee's total; an unconfirmed row is left out.
    const recd = rowsOf('Payments received');
    expect(recd).toHaveLength(3);
    const caucus = recd.find((row) => row.includes('Example Senate Caucus'))!;
    expect(caucus).toContain('2 payment records · Mar 2, 2025 to Jan 9, 2026 · Printing');
    expect(caucus).toContain('$1,000');
    const candidate = recd.find((row) => row.includes('Example Candidate Committee'))!;
    expect(candidate).toContain('1 payment record · Apr 1, 2026');
    expect(candidate).toContain(INCOMPLETE);
    expect(candidate).not.toContain('$5,000');
    const outside = recd.find((row) => row.includes('Example Political Fund'))!;
    expect(outside).toContain('Position as filed: For');
    expect(outside).toContain('$20,000');
    expect(section('Payments received').textContent).toContain('Period Mar 2, 2025 to Apr 1, 2026');

    expect(section('Payments made').textContent).toContain(EMPTY_SECTION);

    const rel = rowsOf('Related committees and funds');
    expect(rel).toHaveLength(1);
    expect(rel[0]).toContain('Example Action PAC');
    expect(rel[0]).toContain(
      'Political committee · Registration 30004 · Supporting association named on the committee’s registration',
    );

    // The withdrawn spelling and the employer spelling are never read.
    expect(requests.some((url) => url.includes('Assn&') || url.includes('Assn'))).toBe(false);
    expect(requests.some((url) => url.includes('employer'))).toBe(false);
  });

  it('links each row to its record with return context', async () => {
    await render(`/organizations/${ORG}`, answering(PROFILE));
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    const from = encodeURIComponent(`/organizations/${ORG}`);
    expect(hrefs).toContain(`/lobbying/principals/8450?from=${from}`);
    expect(hrefs).toContain(`/money/committees/30004?year=2026&tab=other&from=${from}`);
    expect(hrefs).toContain(`/money/committees/30004?tab=expenditures&year=2026&from=${from}`);
    expect(hrefs).toContain(`/money/committees/80012?tab=independent&year=2025&from=${from}`);
    expect(hrefs).toContain(`/money/names/Example%20Health%20Association?role=payee&from=${from}`);
    expect(hrefs).toContain(`/money/committees/30004?from=${from}`);
    // Nothing links to the public site or to unbuilt pages.
    expect(hrefs.some((href) => href?.includes('/money/identities'))).toBe(false);
  });

  it('prints each source once with its own copy dates, and the official identifier', async () => {
    await render(`/organizations/${ORG}`, answering(PROFILE));
    const sources = container.querySelector('.f-sources')!.textContent ?? '';
    expect(sources).toContain('Minnesota Campaign Finance and Public Disclosure Board');
    expect(sources).toContain('Campaign payment files copied Oct 28, 2026');
    expect(sources).toContain('Lobbyist list and spending reports copied Oct 29, 2026');
    expect(sources).toContain('Committee registrations copied Oct 28, 2026');
    expect(sources).toContain(`Organization reference ${ORG}`);
    expect(sources).toContain('Official identifiers');
    expect(sources).toContain('Lobbying principal entity ID 8450');
    // No street address, phone or email is copied from a record into the profile.
    expect(text()).not.toContain('55401');
  });

  it('opens the confirmation evidence and a payment’s source', async () => {
    await render(`/organizations/${ORG}`, answering(PROFILE));
    const button = section('Lobbying').querySelector('button')!;
    await act(async () => button.click());
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Example Health Assn');
    expect(dialog.textContent).toContain('Lobbying spending reports');
    expect(dialog.textContent).toContain('EXAMPLE HEALTH ASSN');
    expect(dialog.textContent).toContain('Checked on Oct 21, 2026');
    await act(async () =>
      (dialog.querySelector('[aria-label="Close source evidence"]') as HTMLElement).click(),
    );
    const give = section('Political giving').querySelector('button')!;
    await act(async () => give.click());
    const payment = container.querySelector('[role="dialog"]')!;
    expect(payment.textContent).toContain('Example Health Association to Example Senate Caucus');
    expect(payment.textContent).toContain('Contributions file');
    expect(payment.textContent).toContain('Not checked');
  });

  it('shows the empty state in every section when nothing is confirmed', async () => {
    await render(`/organizations/${ORG}`, answering(EMPTY));
    for (const title of [
      'Lobbying',
      'Political giving',
      'Payments received',
      'Payments made',
      'Related committees and funds',
    ]) {
      expect(section(title).textContent).toContain(EMPTY_SECTION);
    }
    expect(container.querySelector('[aria-label="Roles"]')).toBeNull();
    expect(text()).not.toContain('Official identifiers');
    expect(requests).toHaveLength(1);
  });

  it('fails a section, not the page, when the file moved between reads', async () => {
    const moved = json(
      page('contributions', [
        given(44, '2026-02-20', '2600.0000'),
        given(45, '2026-02-20', '2500.0000'),
      ]),
    );
    await render(`/organizations/${ORG}`, answering(PROFILE, { 'role=contributor': moved }));
    expect(section('Political giving').textContent).toContain(SECTION_FAILED);
    expect(section('Political giving').textContent).toContain('Try again');
    expect(section('Political giving').textContent).not.toContain('$2,600');
    expect(rowsOf('Lobbying')).toHaveLength(1);
  });

  it('shows the failure with Try again when the record cannot be read', async () => {
    let fail = true;
    await render(`/organizations/${ORG}`, (url) =>
      fail ? new Response(null, { status: 500 }) : answering(EMPTY)(url),
    );
    expect(text()).toContain('We couldn’t load this record. This is a problem on our side.');
    fail = false;
    const retry = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Try again',
    )!;
    await act(async () => retry.click());
    await settle();
    expect(container.querySelector('h1')?.textContent).toBe('Example Health Association');
  });

  it('says the record is no longer available for an unknown reference', async () => {
    await render(`/organizations/${ORG}`, () => new Response(null, { status: 404 }));
    expect(container.querySelector('h1')?.textContent).toBe('This record is no longer available');
    expect(text()).toContain('No organization with this reference is in the current copy.');
  });

  it('never reads a reference that is not an identity id', async () => {
    await render('/organizations/example-health-association', answering(PROFILE));
    expect(container.querySelector('h1')?.textContent).toBe('This record is no longer available');
    expect(requests).toHaveLength(0);
  });

  it('treats a person’s reference as no organization', async () => {
    await render(`/organizations/${ORG}`, answering({ ...EMPTY, kind: 'person' }));
    expect(container.querySelector('h1')?.textContent).toBe('This record is no longer available');
  });

  it('opens the surviving record for a merged reference, keeping the return context', async () => {
    const merged: Identity = { ...EMPTY, status: 'merged', redirect_to: SURVIVOR };
    await render(
      `/organizations/${ORG}?from=%2Fmoney%2Frecipients`,
      answering(merged, {
        [`/finance/identities/${SURVIVOR}`]: json({ ...EMPTY, id: SURVIVOR }),
      }),
    );
    expect(window.location.pathname).toBe(`/organizations/${SURVIVOR}`);
    expect(window.location.search).toBe('?from=%2Fmoney%2Frecipients');
  });

  it('opens a correction page listing every record a split reference became', async () => {
    const split: Identity = {
      ...EMPTY,
      status: 'split',
      split_into: [
        { id: OTHER, kind: 'organization', name: 'Example Health Association' },
        { id: SURVIVOR, kind: 'organization', name: 'Example Health Foundation' },
      ],
    };
    await render(`/organizations/${ORG}`, answering(split));
    expect(container.querySelector('h1')?.textContent).toBe(
      'Example Health Association was split into 2 records',
    );
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    const from = encodeURIComponent(`/organizations/${ORG}`);
    expect(hrefs).toContain(`/organizations/${OTHER}?from=${from}`);
    expect(hrefs).toContain(`/organizations/${SURVIVOR}?from=${from}`);
    expect(text()).not.toContain('Political giving');
  });

  it('shows a back link only when reached with one', async () => {
    await render(`/organizations/${ORG}?from=%2Fmoney%2Frecipients`, answering(EMPTY));
    expect(text()).toContain('Back to Vendors and payees');
    act(() => root.unmount());
    root = createRoot(container);
    await render(`/organizations/${ORG}`, answering(EMPTY));
    expect(text()).not.toContain('Back to');
  });
});

describe('Organization derived labels', () => {
  it('states a period from its earliest and latest dates', () => {
    expect(periodOf(['2026-01-09', '2025-03-02', null])).toBe('Mar 2, 2025 to Jan 9, 2026');
    expect(periodOf(['2026-01-09', '2026-01-09'])).toBe('Jan 9, 2026');
    expect(periodOf([null, undefined])).toBeNull();
  });

  it('names payment files once when they share a copy day, else each with its own', () => {
    expect(paymentCopyItems({})).toEqual([]);
    expect(
      paymentCopyItems({
        contributions: '2026-10-28T17:00:00Z',
        expenditures: '2026-10-28T18:00:00Z',
      }),
    ).toEqual(['Campaign payment files copied Oct 28, 2026']);
    const split = paymentCopyItems({
      contributions: '2026-10-29T06:49:45Z',
      expenditures: '2026-10-09T21:05:10Z',
    });
    expect(split).toHaveLength(2);
    expect(split[0]).toContain('Contributions file copied Oct');
    expect(split[1]).toContain('Spending file copied Oct');
    expect(paymentCopyItems({ independentExpenditures: null })).toEqual([
      'Outside-spending file copy date unavailable',
    ]);
  });

  it('claims only the roles the held records support', () => {
    expect(rolesOf(false, false, false)).toEqual([]);
    expect(rolesOf(true, false, true)).toEqual(['Lobbying principal', 'Payment recipient']);
  });
});
