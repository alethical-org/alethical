import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import {
  committeeHref,
  copyLines,
  countLine,
  coverageLine,
  excerptAmount,
  excerptText,
  rowIdentityNote,
  filerFromParam,
  scopedSections,
  scopeLine,
  identityCoverage,
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
    filer = null as string | null,
    total = payments.length as number | null,
    identities = [] as Array<{
      id: string;
      kind: string;
      name: string;
      reference?: string;
      confirmed_records: number;
    }>,
    release = 'release-1',
  } = {},
) {
  return {
    name,
    role,
    year,
    filer,
    record_kind: 'payee_name',
    identities,
    state,
    payments,
    page: {
      limit: 200,
      offset: 0,
      has_more: hasMore,
      total_payments: state === 'reported' ? total : null,
    },
    linkable_registration_numbers: linkable,
    dataset: 'x',
    source_url:
      'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/?download=1',
    release_id: release,
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
  it('focuses the requested payment section after the records load', async () => {
    await render('/money/names/Example%20Media%20LLC?role=payee&section=outside-payments', payee);
    expect(document.activeElement).toBe(section('Outside spending payments').querySelector('h2'));
    expect(
      requests
        .filter((url) => url.pathname.endsWith('/payments-under-name'))
        .map(role)
        .sort(),
    ).toEqual(['independent_vendor', 'vendor']);
  });

  it('reads the 2 payee files separately and draws each as its own section', async () => {
    await render('/money/names/Example%20Media%20LLC?role=payee', payee);
    const payments = requests.filter((url) => url.pathname.endsWith('/payments-under-name'));
    expect(payments.map((url) => role(url)).sort()).toEqual(['independent_vendor', 'vendor']);
    expect(payments[0].searchParams.get('name')).toBe('Example Media LLC');
    // Finance's own route, which adds each row's facts, a page of 200 at a time.
    expect(payments[0].pathname).toBe('/api/v1/finance/payments-under-name');
    expect(payments[0].searchParams.get('limit')).toBe('200');
    expect(payments[0].searchParams.get('filer')).toBeNull();
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
      '/money/committees/30558?year=2026&tab=expenditures&name=Example+Media+LLC&from=%2Fmoney%2Fnames%2FExample%2520Media%2520LLC%3Frole%3Dpayee',
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
      'Minnesota’s payment files copied Oct 29, 2026. This is a copy date, not a reporting period.',
    );
    // The similar-names section carries this caveat in the drawing (Round 29).
    expect(container.textContent).not.toContain('Different spellings appear separately');
    // Nothing confirms the spelling, in either file.
    const identity = container.querySelector('[aria-label="Identity"]')!;
    expect(identity.textContent).toContain('No confirmed identity for this spelling');
    // Confirm identities is built, so the card opens it for this spelling and role.
    expect(identity.querySelector('a')?.getAttribute('href')).toMatch(
      /^\/money\/identities\?name=[^&]+&role=payee/,
    );
  });

  it('opens the held locators of the source row', async () => {
    await render('/money/names/Example%20Media%20LLC', payee);
    const view = section('Campaign payments').querySelector<HTMLButtonElement>('.pn-view')!;
    await act(async () => view.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('Example Media LLC · $1,250');
    const rows = Object.fromEntries(
      [...dialog.querySelectorAll('.f-sources-row')].map((item) => [
        item.querySelector('dt')?.textContent,
        item.querySelector('dd')?.textContent,
      ]),
    );
    expect(rows).toEqual({
      'Saved source': 'Expenditure file',
      'Source version': 'Copy of Oct 29, 2026',
      Row: '11',
      Filer: 'Education Minn PAC',
      Date: 'Jul 20, 2026',
      Amount: '$1,250',
      Type: 'Media buy',
    });
    expect(dialog.textContent).toContain('SOURCE TEXT');
    expect(dialog.textContent).toContain('No saved source excerpt held');
    expect(dialog.textContent).toContain('Not checked');
    // No excerpt is held, so the Board's own file is linked.
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
      '/money/committees/19369?year=2026&tab=individuals&name=Example%2C+Wen',
    );
    expect(campaign.textContent).toContain(
      'The count is of matching records, not a confirmed count of separate donations.',
    );
    // Identity counts come with the rows, so no separate identity read is made.
    expect(requests.some((url) => url.pathname.endsWith('/finance/identities/records'))).toBe(
      false,
    );
  });

  it('keeps each donor on an employer row and the money theirs', async () => {
    await render('/money/names/Example%20Health%20Association?role=employer', (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(NO_IDENTITY);
      return json(
        page(
          'employer',
          [
            {
              ...receivedRow(),
              excerpt: [
                ['Recipient reg num', '19369'],
                ['Amount', '250.0000'],
                ['Receipt date', '2026-09-18'],
                ['Contributor', 'Example, Wen'],
                ['Contrib zip', '55401'],
              ],
            },
          ],
          { name: 'Example Health Association' },
        ),
      );
    });
    expect(container.textContent).toContain('Employer name as reported');
    expect(container.querySelector('.pn-notice')?.textContent).toBe(
      'Employer name as written in contribution records, not the organization’s giving',
    );
    expect(section('Campaign payments').textContent).toContain('· Donor: Example, Wen');
    // The Committee link filters to the donor who printed the employer.
    expect(section('Campaign payments').querySelector('a')?.getAttribute('href')).toContain(
      'tab=individuals&name=Example%2C+Wen',
    );
    const view = section('Campaign payments').querySelector<HTMLButtonElement>('.pn-view')!;
    await act(async () => view.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('Example Health Association · $250');
    expect(dialog.textContent).toContain('Employer as filed');
    // The served excerpt, in the file's own order; the ZIP as filed comes from it.
    expect(dialog.querySelector('blockquote')?.textContent).toBe(
      'Recipient reg num: 19369\nAmount: 250.00\nReceipt date: Sep 18, 2026\nContributor: Example, Wen\nContrib zip: 55401',
    );
    expect(dialog.textContent).toContain('ZIP as filed55401');
    // An excerpt is held, so the generic Board link is not offered.
    expect(dialog.querySelector('a[href*="cfb.mn.gov"]')).toBeNull();
    expect(dialog.textContent).toContain('Example Health Association');
    expect(dialog.textContent).toContain('Contribution file');
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

  it('says a section our copy cannot read is not held, never the failure line', async () => {
    await render('/money/names/Example%20Media%20LLC', (url) =>
      role(url) === 'vendor'
        ? json(page('vendor', [], { state: 'unavailable' }))
        : json(page('independent_vendor', [outsideRow()], { linkable: ['40001'] })),
    );
    const campaign = section('Campaign payments');
    expect(campaign.textContent).toContain('We could not read this part of our records just now');
    expect(campaign.querySelector('[role="alert"]')).toBeNull();
    expect(campaign.textContent).not.toContain('We couldn’t load');
    expect(campaign.querySelector('.pn-count')).toBeNull();
    // The other file still shows its own records, and no identity count is claimed.
    expect(section('Outside spending payments').textContent).toContain('Example Action PAC');
    expect(container.querySelector('.pn-identity')).toBeNull();
  });

  it('keeps the failure line with Try again for a server error', async () => {
    await render('/money/names/Example%20Media%20LLC', (url) =>
      role(url) === 'vendor'
        ? json(null, 503)
        : json(page('independent_vendor', [outsideRow()], { linkable: ['40001'] })),
    );
    const alert = section('Campaign payments').querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('We couldn’t load these results.');
    expect(alert.querySelector('button')?.textContent).toBe('Try again');
    expect(section('Campaign payments').textContent).not.toContain(
      'We could not read this part of our records',
    );
  });

  it('shows only the records loaded when more are filed, and reads the next page', async () => {
    await render('/money/names/Example%20Media%20LLC', (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(NO_IDENTITY);
      if (role(url) !== 'vendor') return json(page('independent_vendor', []));
      return !url.searchParams.get('offset')
        ? json(page('vendor', [spent()], { hasMore: true, total: 2 }))
        : json(page('vendor', [spent({ record_number: 12, paid_on: '2026-06-01' })], { total: 2 }));
    });
    const campaign = section('Campaign payments');
    // The server counts every row in scope, so the count is exact before all load.
    expect(campaign.querySelector('.pn-count')?.textContent).toBe('2 records');
    const more = campaign.querySelector<HTMLButtonElement>('.pn-more-btn')!;
    expect(more.textContent).toBe('Show more payments');
    await act(async () => more.click());
    await settle();
    const next = requests.filter((url) => url.searchParams.get('offset') === '1');
    expect(next).toHaveLength(1);
    // Pinned to the first page's copy of the Board's file.
    expect(next[0].searchParams.get('release_id')).toBe('release-1');
    expect(section('Campaign payments').querySelectorAll('.pn-row:not(.pn-head)')).toHaveLength(2);
    expect(section('Campaign payments').querySelector('.pn-more-btn')).toBeNull();
  });

  it('says the Board’s file changed when page 2 answers 409, and starts over', async () => {
    let firstPages = 0;
    await render('/money/names/Example%20Media%20LLC', (url) => {
      if (role(url) !== 'vendor') return json(page('independent_vendor', []));
      if (url.searchParams.get('offset')) return json(null, 409);
      firstPages += 1;
      return json(
        page('vendor', [spent()], {
          hasMore: true,
          total: 2,
          release: firstPages === 1 ? 'release-1' : 'release-2',
        }),
      );
    });
    await act(async () =>
      section('Campaign payments').querySelector<HTMLButtonElement>('.pn-more-btn')!.click(),
    );
    await settle();
    const alert = section('Campaign payments').querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('The Board’s file changed. Reload the records.');
    expect(section('Campaign payments').querySelector('.pn-more-btn')).toBeNull();
    // The loaded rows stay while the reader decides.
    expect(section('Campaign payments').textContent).toContain('Education Minn PAC');
    const reload = alert.querySelector('button')!;
    expect(reload.textContent).toBe('Reload the records');
    await act(async () => reload.click());
    await settle();
    expect(firstPages).toBe(2);
    expect(section('Campaign payments').querySelector('[role="alert"]')).toBeNull();
    expect(section('Campaign payments').querySelector('.pn-more-btn')).toBeTruthy();
  });

  it('lands on the not-held state when the pinned file is gone and nothing is published', async () => {
    let firstPages = 0;
    await render('/money/names/Example%20Media%20LLC', (url) => {
      if (role(url) !== 'vendor') return json(page('independent_vendor', []));
      if (url.searchParams.get('offset')) return json(null, 409);
      firstPages += 1;
      return firstPages === 1
        ? json(page('vendor', [spent()], { hasMore: true, total: 2 }))
        : json(page('vendor', [], { state: 'unavailable' }));
    });
    await act(async () =>
      section('Campaign payments').querySelector<HTMLButtonElement>('.pn-more-btn')!.click(),
    );
    await settle();
    const reload =
      section('Campaign payments').querySelector<HTMLButtonElement>('[role="alert"] button')!;
    await act(async () => reload.click());
    await settle();
    const campaign = section('Campaign payments');
    expect(campaign.textContent).toContain('We could not read this part of our records just now');
    expect(campaign.querySelector('[role="alert"]')).toBeNull();
    expect(campaign.textContent).not.toContain('We couldn’t load');
  });

  it('says a failed next page without claiming anything, and tries it again', async () => {
    let later = 0;
    await render('/money/names/Example%20Media%20LLC', (url) => {
      if (role(url) !== 'vendor') return json(page('independent_vendor', []));
      if (!url.searchParams.get('offset')) {
        return json(page('vendor', [spent()], { hasMore: true, total: 2 }));
      }
      later += 1;
      return later === 1
        ? json(null, 500)
        : json(page('vendor', [spent({ record_number: 12 })], { total: 2 }));
    });
    await act(async () =>
      section('Campaign payments').querySelector<HTMLButtonElement>('.pn-more-btn')!.click(),
    );
    await settle();
    const alert = section('Campaign payments').querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('We couldn’t load more payments');
    expect(alert.textContent).not.toContain('problem on our side');
    await act(async () => alert.querySelector<HTMLButtonElement>('button')!.click());
    await settle();
    expect(section('Campaign payments').querySelectorAll('.pn-row:not(.pn-head)')).toHaveLength(2);
  });

  it('lists every identity holding records of the spelling, each with its own count', async () => {
    await render('/money/names/Example%20Media%20LLC?year=2026', (url) => {
      if (url.pathname.endsWith('/finance/identities/org-uuid-1')) {
        return json({
          id: 'org-uuid-1',
          kind: 'organization',
          name: 'Example Media',
          confirmations: [
            {
              record_kind: 'payee_name',
              record_key: 'Example Media LLC',
              status: 'confirmed',
              checked_at: '2026-10-02T15:00:00Z',
            },
          ],
        });
      }
      if (url.pathname.includes('/finance/identities/')) return json(null, 500);
      const identified = {
        identity: { id: 'org-uuid-1', kind: 'organization', name: 'Example Media' },
      };
      if (role(url) === 'vendor') {
        return json(
          page('vendor', [{ ...spent(), ...identified }, spent({ record_number: 13 })], {
            year: 2026,
            total: 4,
            identities: [
              {
                id: 'org-uuid-1',
                kind: 'organization',
                name: 'Example Media',
                reference: 'ORG-0002',
                confirmed_records: 2,
              },
              {
                id: 'org-uuid-2',
                kind: 'organization',
                name: 'Example Duluth',
                confirmed_records: 1,
              },
            ],
          }),
        );
      }
      return json(
        page('independent_vendor', [outsideRow()], {
          year: 2026,
          linkable: ['40001'],
          total: 1,
          identities: [
            { id: 'org-uuid-1', kind: 'organization', name: 'Example Media', confirmed_records: 1 },
          ],
        }),
      );
    });
    const box = container.querySelector('[aria-label="Confirmed identity"]')!;
    expect(box.querySelector('.pn-identity-label')?.textContent).toBe('CONFIRMED IDENTITIES');
    const items = [...box.querySelectorAll('.pn-identity-item')].map((item) => item.textContent);
    // Counts cover both payee files in the read's scope; the reference prints where
    // served, never the id; the checked day only where it was read.
    expect(items).toEqual([
      'Example MediaConfirmed for 3 of 5 records in 2026 · ORG-0002 · Checked on Oct 2, 2026',
      'Example DuluthConfirmed for 1 of 5 records in 2026',
    ]);
    expect(box.textContent).not.toContain('org-uuid');
    expect(box.querySelector('a')?.getAttribute('href')).toMatch(
      /^\/organizations\/org-uuid-1\?from=/,
    );
    expect(box.textContent).not.toContain('Review confirmation');
    // Each row says the identity its own fingerprint is confirmed to.
    const rows = section('Campaign payments').querySelectorAll('.pn-row:not(.pn-head)');
    expect(rows[0].textContent).toContain('· Confirmed as Example Media');
    expect(rows[1].textContent).not.toContain('Confirmed as');
  });

  it('makes no identity claim while a file’s payments have failed', async () => {
    await render('/money/names/Example%20Media%20LLC', (url) =>
      role(url) === 'vendor' ? json(page('vendor', [spent()])) : json(null, 500),
    );
    expect(container.querySelector('.pn-identity')).toBeNull();
  });

  it('opens Organization’s View payments link scoped to its filer and file', async () => {
    await render(
      '/money/names/Example%20Media%20LLC?role=payee&filer=30558&dataset=expenditures&year=2026',
      (url) =>
        json(
          page('vendor', [spent()], {
            year: 2026,
            filer: url.searchParams.get('filer'),
            total: 3,
            hasMore: true,
            identities: [
              {
                id: 'org-uuid-1',
                kind: 'organization',
                name: 'Example Media',
                confirmed_records: 1,
              },
            ],
          }),
        ),
    );
    const payments = requests.filter((url) => url.pathname.endsWith('/payments-under-name'));
    // Only the named file is read, narrowed on the server to the filer and the year.
    expect(payments.map(role)).toEqual(['vendor']);
    expect(payments[0].searchParams.get('filer')).toBe('30558');
    expect(payments[0].searchParams.get('year')).toBe('2026');
    expect(container.textContent).not.toContain('Outside spending payments');
    const campaign = section('Campaign payments');
    // The filer's own count, from the server, though not every row is loaded.
    expect(campaign.querySelector('.pn-count')?.textContent).toBe('3 records');
    expect(container.querySelector('.pn-scope')?.textContent).toBe(
      'Showing records filed by Education Minn PAC, campaign payments fileClear all',
    );
    // Identity counts are over the same filer scope.
    expect(container.querySelector('.pn-identity-note')?.textContent).toBe(
      'Confirmed for 1 of 3 records in 2026',
    );

    const clear = container.querySelector<HTMLButtonElement>('.pn-scope button')!;
    await act(async () => clear.click());
    expect(window.location.search).toBe('?role=payee&year=2026');
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
    // Under a filer scope the read cannot know no payments exist at all.
    const scoped = { name: 'A B', role: 'vendor', year: 2025 } as NamePayments<unknown>;
    expect(emptyLine(scoped, 'Education Minn PAC')).toBe(
      'No campaign payments under “A B” are recorded for Education Minn PAC in 2025',
    );
  });

  it('counts each identity over every file the role reads, and waits for all of them', () => {
    const answer = (total: number | null, identities: NamePayments<unknown>['identities']) =>
      ({ state: 'reported', total, identities }) as NamePayments<unknown>;
    const first = answer(2, [
      { id: 'a', kind: 'organization', name: 'A', confirmed_records: 2 },
      { id: 'b', kind: 'person', name: 'B', confirmed_records: 0 },
    ]);
    const second = answer(5, [
      { id: 'a', kind: 'organization', name: 'A', reference: 'ORG-1', confirmed_records: 1 },
    ]);
    expect(identityCoverage([first, second])).toEqual({
      records: 7,
      identities: [{ id: 'a', kind: 'organization', name: 'A', reference: null, confirmed: 3 }],
    });
    expect(identityCoverage([first, null])).toBeNull();
    // No count served means no claim.
    expect(identityCoverage([answer(null, [])])).toBeNull();
    expect(
      identityCoverage([{ state: 'not_reported', total: null, identities: [] } as never]),
    ).toEqual({ records: 0, identities: [] });
  });

  it('prints a stored decimal in the excerpt with 2 decimals, never below the cent', () => {
    expect(excerptAmount('1250.5000')).toBe('1250.50');
    expect(excerptAmount('900.0000')).toBe('900.00');
    expect(excerptAmount('-150.2500')).toBe('-150.25');
    expect(excerptAmount('12.3456')).toBe('12.3456');
    expect(excerptAmount('12.3450')).toBe('12.345');
    // Text that is not a stored decimal prints as served.
    expect(excerptAmount('19369')).toBe('19369');
    expect(excerptAmount('Example, Wen')).toBe('Example, Wen');
  });

  it('prints the served excerpt in its own order, dates as dates and blanks as not given', () => {
    expect(
      excerptText([
        ['Recipient reg num', '19369'],
        ['Amount', '250.0000'],
        ['Receipt date', '2026-09-18'],
        ['Year', '2026'],
        ['Contributor', 'Example, Wen'],
        ['Contrib zip', null],
      ]),
    ).toBe(
      'Recipient reg num: 19369\nAmount: 250.00\nReceipt date: Sep 18, 2026\nYear: 2026\nContributor: Example, Wen\nContrib zip: Not given',
    );
    expect(excerptText(null)).toBeNull();
    expect(excerptText([])).toBeNull();
    expect(rowIdentityNote({ identity: { id: 'x', kind: 'organization', name: 'A' } })).toBe(
      'Confirmed as A',
    );
    expect(rowIdentityNote({ identity: null })).toBeNull();
  });

  it('narrows to the address’s file only where the role reads it', () => {
    expect(scopedSections('payee', 'independent').map((spec) => spec.id)).toEqual([
      'outside-payments',
    ]);
    expect(scopedSections('payee', 'contributions').map((spec) => spec.id)).toEqual([
      'campaign-payments',
      'outside-payments',
    ]);
    expect(scopedSections('donor', '').map((spec) => spec.id)).toEqual(['campaign-payments']);
    expect(scopeLine('A', 'independentExpenditures')).toBe(
      'Showing records filed by A, outside spending file',
    );
    expect(scopeLine(null, 'contributions')).toBe('Showing records from the contributions file');
    expect(scopeLine(null, null)).toBeNull();
    expect(filerFromParam('example-pac-30558')).toBe('30558');
    expect(filerFromParam(' 30558 ')).toBe('30558');
    expect(filerFromParam('')).toBeNull();
  });

  it('words the coverage with its year', () => {
    expect(coverageLine(2, 4, null)).toBe('Confirmed for 2 of 4 records');
    expect(coverageLine(1, 1, 2025)).toBe('Confirmed for 1 of 1 record in 2025');
  });

  it('links a record to its committee’s tab, year and name, and leaves an unknown year out', () => {
    expect(committeeHref('5', new Set(['5']), null, 'party', 'A B', '/x')).toBe(
      '/money/committees/5?tab=party&name=A+B',
    );
    expect(committeeHref('5', new Set(), 2025, 'party', 'A B', '/x')).toBeNull();
  });
});
