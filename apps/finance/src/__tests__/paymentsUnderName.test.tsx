import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import {
  confirmedIdentities,
  copyLines,
  countLine,
  emptyLine,
  PaymentsUnderName,
  positionNote,
  roleFromParam,
  sectionsFor,
} from '../pages/PaymentsUnderName';
import type { NamePayments, OutsideRow, ReceivedRow, SpentRow } from '../pages/payments/data';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

const FETCHED = '2026-10-29T06:49:45Z';

function spent(overrides: Partial<SpentRow> = {}): SpentRow {
  return {
    committee_registration_number: '30558',
    committee_name: 'Education Minn PAC',
    vendor_name: 'Example Media LLC',
    amount: '1250.5000',
    paid_on: '2026-07-20',
    year: 2026,
    expenditure_type: 'General Expenditure',
    purpose: 'Media buy',
    record_number: 11,
    ...overrides,
  };
}

function outsideRow(overrides: Partial<OutsideRow> = {}): OutsideRow {
  return {
    spender: 'Example Action PAC',
    spender_registration_number: '40001',
    affected_committee_name: 'Example, Morgan',
    stance: 'For',
    vendor_name: 'Example Media LLC',
    amount: '900.0000',
    paid_on: '2026-10-19',
    year: 2026,
    expenditure_type: 'Independent Expenditure',
    purpose: 'Postcards',
    record_number: 21,
    ...overrides,
  };
}

function receivedRow(overrides: Partial<ReceivedRow> = {}): ReceivedRow {
  return {
    recipient_registration_number: '19369',
    recipient_name: 'Example Candidate Committee',
    contributor: 'Example, Wen',
    contributor_type: 'Individual',
    employer: 'Example Health Association',
    amount: '250.0000',
    received_on: '2026-09-18',
    year: 2026,
    receipt_type: 'Contribution',
    record_number: 31,
    ...overrides,
  };
}

function page(
  role: string,
  payments: unknown[],
  {
    state = payments.length ? 'reported' : 'not_reported',
    hasMore = false,
    linkable = ['30558', '19369'],
    fetchedAt = FETCHED,
    name = 'Example Media LLC',
    year = null as number | null,
  } = {},
) {
  return {
    name,
    role,
    year,
    state,
    payments,
    page: { limit: 250, offset: 0, has_more: hasMore, total_payments: null },
    linkable_registration_numbers: linkable,
    dataset: 'x',
    source_url:
      'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/?download=1',
    release_id: 'release-1',
    fetched_at: fetchedAt,
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const NO_IDENTITY = {
  record_kind: 'payee_name',
  record_key: 'x',
  records: 3,
  confirmed: 0,
  identities: [],
};

let container: HTMLDivElement;
let root: Root;
let requests: URL[];

beforeEach(() => {
  clearReadCache();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  requests = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type Answer = (url: URL, init?: RequestInit) => Response | Promise<Response>;

/** A read that never answers until the page abandons it, so it frees its slot. */
const hang: Answer = (_url, init) =>
  new Promise<Response>((_, reject) =>
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
  );

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(path: string, answer: Answer) {
  window.history.replaceState(null, '', path);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      requests.push(url);
      return answer(url, init);
    }),
  );
  const pathname = path.split('?')[0];
  await act(async () => {
    root.render(<PaymentsUnderName match={matchRoute(pathname)!} />);
  });
  await settle();
}

function role(url: URL) {
  return url.searchParams.get('role');
}

const payee: Answer = (url) => {
  if (url.pathname.endsWith('/finance/identities/records')) return json(NO_IDENTITY);
  if (role(url) === 'vendor') return json(page('vendor', [spent()]));
  return json(page('independent_vendor', [outsideRow()], { linkable: ['40001'] }));
};

function section(title: string): HTMLElement {
  const heading = [...container.querySelectorAll('h2')].find((item) => item.textContent === title);
  return heading!.closest('section')!;
}

describe('Payments under this name', () => {
  it('reads the 2 payee files separately and draws each as its own section', async () => {
    await render('/money/names/Example%20Media%20LLC?role=payee', payee);
    const payments = requests.filter((url) => url.pathname.endsWith('/payments-under-name'));
    expect(payments.map((url) => role(url)).sort()).toEqual(['independent_vendor', 'vendor']);
    expect(payments[0].searchParams.get('name')).toBe('Example Media LLC');
    expect(payments[0].searchParams.get('limit')).toBe('250');
    expect(payments[0].searchParams.get('year')).toBeNull();

    expect(container.querySelector('h1')?.textContent).toBe('Payments under this name');
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('Example Media LLC');
    expect(container.textContent).toContain('Name as reported');
    expect(container.textContent).toContain(
      'Records are grouped by the name printed in the source',
    );

    const campaign = section('Campaign payments');
    expect(campaign.textContent).toContain('1 record');
    expect(campaign.textContent).toContain('Jul 20, 2026');
    expect(campaign.textContent).toContain('$1,250');
    expect(campaign.textContent).not.toContain('$1,250.50');
    expect(campaign.textContent).toContain('Media buy');
    expect(campaign.querySelector('a')?.getAttribute('href')).toBe(
      '/money/committees/30558?year=2026&tab=expenditures&from=%2Fmoney%2Fnames%2FExample%2520Media%2520LLC%3Frole%3Dpayee',
    );
    expect(campaign.textContent).toContain(
      'Each record comes from the paying committee’s filing. A payee is not necessarily a commercial vendor.',
    );

    const outside = section('Outside spending payments');
    expect(outside.textContent).toContain('Position as filed: For Example, Morgan');
    expect(outside.querySelector('a')?.getAttribute('href')).toContain(
      '/money/committees/40001?year=2026&tab=independent',
    );
    // No total of any kind across committees or files.
    expect(container.textContent).not.toMatch(/\$2,150/);

    expect(container.textContent).toContain(
      'Minnesota’s payment files copied Oct 29, 2026. This is a copy date, not a reporting period. The report totals were copied separately.',
    );
    expect(container.textContent).toContain(
      'Different spellings appear separately, and a matching name alone does not establish identity.',
    );
  });

  it('opens the source evidence titled payer to recipient', async () => {
    await render('/money/names/Example%20Media%20LLC', payee);
    const view = section('Campaign payments').querySelector<HTMLButtonElement>('.pn-view')!;
    await act(async () => view.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('Education Minn PAC to Example Media LLC');
    expect(dialog.textContent).toContain('Itemized expenditures file');
    expect(dialog.textContent).toContain('Not checked');
    expect(dialog.textContent).toContain('Copied');
    expect(dialog.textContent).toContain('Oct 29, 2026');
    expect(dialog.querySelector('a')?.getAttribute('href')).toBe(
      'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/?download=1',
    );
  });

  it('reads a donor name as received payments, without outside spending', async () => {
    await render('/money/names/Example%2C%20Wen?role=donor&year=2026', (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(NO_IDENTITY);
      return json(page('contributor', [receivedRow()], { name: 'Example, Wen', year: 2026 }));
    });
    const payments = requests.filter((url) => url.pathname.endsWith('/payments-under-name'));
    expect(payments).toHaveLength(1);
    expect(role(payments[0])).toBe('contributor');
    expect(payments[0].searchParams.get('year')).toBe('2026');
    expect(container.textContent).not.toContain('Outside spending payments');
    const campaign = section('Campaign payments');
    expect(campaign.querySelector('a')?.getAttribute('href')).toContain(
      '/money/committees/19369?year=2026&tab=individuals',
    );
    expect(campaign.textContent).toContain(
      'The count is of matching records, not a confirmed count of separate donations.',
    );
    const identity = requests.find((url) => url.pathname.endsWith('/finance/identities/records'))!;
    expect(identity.searchParams.get('record_kind')).toBe('donor_name');
    expect(identity.searchParams.get('record_key')).toBe('Example, Wen');
  });

  it('keeps each donor on an employer row and the money theirs', async () => {
    await render('/money/names/Example%20Health%20Association?role=employer', (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(NO_IDENTITY);
      return json(page('employer', [receivedRow()], { name: 'Example Health Association' }));
    });
    expect(container.textContent).toContain('Employer name as reported');
    expect(container.textContent).toContain(
      'This is the employer name written in contribution records, not the organisation’s giving',
    );
    expect(section('Campaign payments').textContent).toContain('· Donor: Example, Wen');
    const view = section('Campaign payments').querySelector<HTMLButtonElement>('.pn-view')!;
    await act(async () => view.click());
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(
      'Example, Wen to Example Candidate Committee',
    );
  });

  it('says a missing amount and date are missing, never zero', async () => {
    await render('/money/names/Example%20Media%20LLC', (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(NO_IDENTITY);
      if (role(url) === 'vendor') {
        return json(
          page('vendor', [
            spent({ amount: null, paid_on: null, committee_registration_number: '9' }),
          ]),
        );
      }
      return json(page('independent_vendor', []));
    });
    const campaign = section('Campaign payments');
    expect(campaign.textContent).toContain('Amount not given');
    expect(campaign.textContent).toContain('Date not given in the public file');
    expect(campaign.textContent).not.toContain('$0');
    // A committee this release does not hold as a filer is plain text.
    expect(campaign.querySelector('a')).toBeNull();
  });

  it('says nothing is recorded under the spelling, per section and year', async () => {
    await render('/money/names/ZZZ?year=2025', (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(NO_IDENTITY);
      return json(page(role(url)!, [], { name: 'ZZZ', year: 2025 }));
    });
    expect(container.textContent).toContain(
      'No campaign payments are recorded under “ZZZ” in 2025. This does not mean none were made.',
    );
    expect(container.textContent).toContain(
      'No outside spending payments are recorded under “ZZZ” in 2025. This does not mean none were made.',
    );
    expect(container.querySelector('[role="table"]')).toBeNull();
  });

  it('shows Loading while every file loads', async () => {
    await render('/money/names/Example', hang);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading…');
  });

  it('fails without claiming nothing was filed, and tries again', async () => {
    let calls = 0;
    await render('/money/names/Example', (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(NO_IDENTITY);
      calls += 1;
      if (calls <= 2) return json(null, 500);
      return json(page(role(url)!, [], { name: 'Example' }));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'We couldn’t load these results. This is a problem on our side and says nothing about what was filed under this name.',
    );
    const retry = container.querySelector<HTMLButtonElement>('[role="alert"] button')!;
    await act(async () => retry.click());
    await settle();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('No campaign payments are recorded under “Example”');
  });

  it('shows only the records loaded when more are filed, and reads the next page', async () => {
    await render('/money/names/Example%20Media%20LLC', (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(NO_IDENTITY);
      if (role(url) !== 'vendor') return json(page('independent_vendor', []));
      return url.searchParams.get('offset') === '0'
        ? json(page('vendor', [spent()], { hasMore: true }))
        : json(page('vendor', [spent({ record_number: 12, paid_on: '2026-06-01' })]));
    });
    const campaign = section('Campaign payments');
    expect(campaign.textContent).toContain('Showing the first 1 payment record, newest first');
    expect(campaign.textContent).toContain('We load up to 250 payment records at a time.');
    const more = campaign.querySelector<HTMLButtonElement>('.pn-more-btn')!;
    expect(more.textContent).toBe('Show more payments');
    await act(async () => more.click());
    await settle();
    const next = requests.filter((url) => url.searchParams.get('offset') === '1');
    expect(next).toHaveLength(1);
    expect(section('Campaign payments').textContent).toContain('2 records');
    expect(section('Campaign payments').querySelector('.pn-more-btn')).toBeNull();
  });

  it('shows a confirmed identity only where its record confirms this spelling', async () => {
    await render('/money/names/Example%20Media%20LLC', (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) {
        return url.searchParams.get('record_kind') === 'payee_name'
          ? json({
              ...NO_IDENTITY,
              records: 4,
              confirmed: 1,
              identities: [
                { id: 'org-uuid-1', kind: 'organization', name: 'Example Media', confirmed: 1 },
              ],
            })
          : json(NO_IDENTITY);
      }
      return payee(url);
    });
    const box = container.querySelector('[aria-label="Confirmed identity"]')!;
    expect(box.textContent).toContain('CONFIRMED IDENTITY');
    expect(box.textContent).toContain('Example Media');
    expect(box.textContent).toContain('Organization profile');
    expect(box.textContent).toContain('Campaign payments: Confirmed for 1 of 4 records');
    expect(box.querySelector('a')?.getAttribute('href')).toMatch(
      /^\/organizations\/org-uuid-1\?from=/,
    );
  });

  it('shows no identity box when nothing confirms the spelling', async () => {
    await render('/money/names/Example%20Media%20LLC', payee);
    expect(container.querySelector('[aria-label="Confirmed identity"]')).toBeNull();
  });

  it('changes the record type in the address', async () => {
    await render('/money/names/Example%20Media%20LLC', payee);
    const button = [...container.querySelectorAll<HTMLButtonElement>('.f-dropdown-button')].find(
      (item) => item.textContent?.startsWith('Record type'),
    )!;
    expect(button.textContent).toContain('Payee');
    await act(async () => button.click());
    const donor = [...container.querySelectorAll<HTMLButtonElement>('.f-dropdown-option')].find(
      (item) => item.textContent === 'Donor',
    )!;
    await act(async () => donor.click());
    expect(window.location.search).toBe('?role=donor');
  });
});

describe('Payments under this name helpers', () => {
  it('lands an unknown role on Payee', () => {
    expect(roleFromParam('vendor')).toBe('payee');
    expect(roleFromParam('donor')).toBe('donor');
    expect(roleFromParam(null)).toBe('payee');
  });

  it('gives Payee 2 sections and the others 1', () => {
    expect(sectionsFor('payee').map((spec) => spec.serverRole)).toEqual([
      'vendor',
      'independent_vendor',
    ]);
    expect(sectionsFor('donor').map((spec) => spec.serverRole)).toEqual(['contributor']);
    expect(sectionsFor('employer').map((spec) => spec.serverRole)).toEqual(['employer']);
  });

  it('counts exactly only while every record is loaded', () => {
    expect(countLine(1, false)).toBe('1 record');
    expect(countLine(1250, false)).toBe('1,250 records');
    expect(countLine(250, true)).toBe('Showing the first 250 payment records, newest first');
  });

  it('dates each file on its own when the copy days differ', () => {
    expect(
      copyLines([
        { file: 'expenditures', fetchedAt: '2026-10-09T21:05:10Z' },
        { file: 'independentExpenditures', fetchedAt: '2026-10-29T06:50:13Z' },
      ]),
    ).toEqual([
      'Spending file copied Oct 9,\u00a02026',
      'Outside-spending file copied Oct 29,\u00a02026',
    ]);
    expect(copyLines([{ file: 'contributions', fetchedAt: null }])).toEqual([
      'Contributions file copy date unavailable',
    ]);
    expect(copyLines([])).toEqual([]);
  });

  it('reads the stance as filed and never picks one', () => {
    expect(positionNote(outsideRow({ stance: 'Against' }))).toBe(
      'Position as filed: Against Example, Morgan',
    );
    expect(positionNote(outsideRow({ stance: null }))).toBe(
      'Spent about Example, Morgan, where the filing does not say which way',
    );
    expect(positionNote(outsideRow({ affected_committee_name: null }))).toBeNull();
  });

  it('labels an empty answer with its own name and year', () => {
    const data = { name: 'A B', role: 'independent_vendor', year: null } as NamePayments<unknown>;
    expect(emptyLine(data)).toBe(
      'No outside spending payments are recorded under “A B”. This does not mean none were made.',
    );
  });

  it('keeps only identities whose confirmations cover records, without adding files', () => {
    const identities = confirmedIdentities([
      {
        title: 'Campaign payments',
        records: {
          record_kind: 'payee_name',
          record_key: 'X',
          records: 2,
          confirmed: 2,
          identities: [
            { id: 'a', kind: 'organization', name: 'A', confirmed: 2 },
            { id: 'b', kind: 'person', name: 'B', confirmed: 0 },
          ],
        },
      },
      {
        title: 'Outside spending payments',
        records: {
          record_kind: 'independent_payee_name',
          record_key: 'X',
          records: 5,
          confirmed: 1,
          identities: [{ id: 'a', kind: 'organization', name: 'A', confirmed: 1 }],
        },
      },
    ]);
    expect(identities).toEqual([
      {
        id: 'a',
        kind: 'organization',
        name: 'A',
        partial: ['Outside spending payments: Confirmed for 1 of 5 records'],
      },
    ]);
  });
});
