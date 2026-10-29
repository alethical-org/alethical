import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import { DonorsByEmployer, employerConfirmation, groupDonors } from '../pages/DonorsByEmployer';
import type { IdentityRecords, ReceivedRow } from '../pages/payments/data';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

const SPELLING = 'Example Health Association';

function gift(
  contributor: string | null,
  amount: string | null,
  on: string | null,
  record: number,
  recipient = 'Example Candidate Committee',
  registration = '90001',
): ReceivedRow {
  return {
    recipient_registration_number: registration,
    recipient_name: recipient,
    contributor,
    contributor_type: 'Individual',
    employer: SPELLING,
    amount,
    received_on: on,
    year: 2026,
    receipt_type: 'Contribution',
    record_number: record,
  };
}

const GIFTS: ReceivedRow[] = [
  gift('Example, Wen', '1000.0000', '2026-06-03', 1),
  gift('EXAMPLE, WEN', '250.0000', '2025-11-02', 2, 'Example Senate Caucus', '90005'),
  gift('Example, Wen', '300.0000', '2025-10-01', 3),
  gift('Example, Priya', null, null, 4, 'Example Action PAC', '90004'),
];

function page(payments: ReceivedRow[], { hasMore = false, state = '' } = {}) {
  return {
    name: SPELLING,
    role: 'employer',
    year: null,
    state: state || (payments.length ? 'reported' : 'not_reported'),
    payments,
    page: { limit: 250, offset: 0, has_more: hasMore, total_payments: null },
    linkable_registration_numbers: ['90001', '90005'],
    dataset: 'contributions',
    source_url: 'https://cfb.mn.gov/x',
    release_id: 'release-1',
    fetched_at: '2026-10-29T06:49:45Z',
  };
}

function records(identities: IdentityRecords['identities'], count = 4): IdentityRecords {
  return {
    record_kind: 'employer_name',
    record_key: SPELLING,
    records: count,
    confirmed: identities.reduce((sum, item) => sum + item.confirmed, 0),
    identities,
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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
  await act(async () => {
    root.render(<DonorsByEmployer match={matchRoute(path.split('?')[0])!} />);
  });
  await settle();
}

const PATH = '/money/employers/Example%20Health%20Association';

function answer(
  payments: ReturnType<typeof page>,
  identity: IdentityRecords | Response = records([]),
): Answer {
  return (url) => {
    if (url.pathname.endsWith('/finance/identities/records')) {
      return identity instanceof Response ? identity : json(identity);
    }
    return json(payments);
  };
}

function donor(name: string): HTMLElement {
  return container.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!;
}

describe('Donors by employer', () => {
  it('holds only the search box at the spelling list, and reads nothing', async () => {
    await render('/money/employers', answer(page(GIFTS)));
    expect(requests).toHaveLength(0);
    expect(container.querySelector('h1')?.textContent).toBe('Donors by employer, as printed');
    expect(container.textContent).toContain(
      'Where people who name an employer give. Each spelling is its own entry, and each donor’s payments are their own, never the employer’s money.',
    );
    expect(container.textContent).toContain('Employer name as printed');
    const input = container.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '  EXAMPLE HEALTH ASSN ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));
    });
    expect(window.location.pathname).toBe('/money/employers/EXAMPLE%20HEALTH%20ASSN');
  });

  it('reads the exact spelling and lists each donor spelling apart, with no totals', async () => {
    await render(PATH, answer(page(GIFTS)));
    const read = requests.find((url) => url.pathname.endsWith('/payments-under-name'))!;
    expect(read.searchParams.get('role')).toBe('employer');
    expect(read.searchParams.get('name')).toBe(SPELLING);
    const identity = requests.find((url) => url.pathname.endsWith('/finance/identities/records'))!;
    expect(identity.searchParams.get('record_kind')).toBe('employer_name');
    expect(identity.searchParams.get('record_key')).toBe(SPELLING);

    expect(container.querySelector('.de-label')?.textContent).toBe('EMPLOYER AS PRINTED');
    expect(container.querySelector('h2')?.textContent).toBe(SPELLING);
    expect(container.textContent).toContain('Donors who printed this employer');
    expect(container.querySelector('.de-donors-head')?.textContent).toContain('3 donor names');

    const wen = donor('Example, Wen');
    expect(wen.textContent).toContain('2 payments');
    expect(wen.textContent).toContain('$1,000');
    expect(wen.textContent).toContain('$300');
    expect(wen.textContent).not.toContain('$1,300');
    expect(wen.querySelector('a')?.getAttribute('href')).toBe(
      '/money/names/Example%2C%20Wen?role=donor&from=%2Fmoney%2Femployers%2FExample%2520Health%2520Association',
    );
    // A second spelling of what may be the same person stays its own entry.
    expect(donor('EXAMPLE, WEN').textContent).toContain('1 payment');
    expect(container.textContent).not.toContain('$1,550');

    const header = wen.querySelector('.de-head')!;
    expect(header.textContent).toBe('RECIPIENTEMPLOYER NAME AS PRINTEDDATEAMOUNT');
    const row = wen.querySelectorAll('.de-row:not(.de-head)')[0];
    expect(row.querySelector('.de-employer')?.textContent).toBe(SPELLING);
    expect(row.querySelector('a')?.getAttribute('href')).toContain(
      '/money/committees/90001?year=2026&tab=individuals',
    );

    const priya = donor('Example, Priya');
    expect(priya.textContent).toContain('Date not given');
    expect(priya.textContent).toContain('Amount not given');
    // Not held as a filer here, so the recipient is plain text.
    expect(priya.querySelector('.de-recipient a')).toBeNull();

    expect(container.textContent).toContain(
      'Employer names and payments: Minnesota Campaign Finance and Public Disclosure Board contribution files, copied Oct 29, 2026. Employer names are printed as each donor wrote them.',
    );
  });

  it('never pairs a new spelling’s confirmation with the earlier spelling’s donors', async () => {
    await render(PATH, answer(page(GIFTS)));
    expect(container.textContent).toContain('Example Health Association');
    // The next spelling's confirmation answers at once; its donors are still loading.
    const next = '/money/employers/Target';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input);
        if (url.pathname.endsWith('/finance/identities/records')) {
          return json(
            records([{ id: 'org-9', kind: 'organization', name: 'Target', confirmed: 4 }]),
          );
        }
        return hang(url, init);
      }),
    );
    window.history.replaceState(null, '', next);
    await act(async () => {
      root.render(<DonorsByEmployer match={matchRoute(next)!} />);
    });
    await settle();
    expect(container.textContent).not.toContain('organization record confirms this spelling');
  });

  it('names the organization only where its record confirms this spelling', async () => {
    await render(
      PATH,
      answer(
        page(GIFTS),
        records([{ id: 'org-1', kind: 'organization', name: 'Example Health', confirmed: 4 }]),
      ),
    );
    const line = container.querySelector('.de-confirm')!;
    expect(line.textContent).toContain(
      'The Example Health organization record confirms this spelling',
    );
    expect(line.textContent).not.toContain('Confirmed for');
    expect(line.querySelector('a')?.getAttribute('href')).toMatch(/^\/organizations\/org-1\?from=/);
    expect(line.textContent).toContain('Open\u00a0profile');
  });

  it('says how many records a partial confirmation covers', async () => {
    await render(
      PATH,
      answer(
        page(GIFTS),
        records([{ id: 'org-1', kind: 'organization', name: 'Example Health', confirmed: 1 }]),
      ),
    );
    expect(container.querySelector('.de-confirm')?.textContent).toContain(
      'Confirmed for 1 of 4 records',
    );
  });

  it('never counts a person confirmation as the organization’s', async () => {
    await render(
      PATH,
      answer(page(GIFTS), records([{ id: 'p-1', kind: 'person', name: 'Wen', confirmed: 1 }])),
    );
    const line = container.querySelector('.de-confirm')!;
    expect(line.textContent).toBe('No organization record confirms this spelling');
    // The confirm-identities page is not built yet, so no link to it.
    expect(line.querySelector('a')).toBeNull();
  });

  it('says the check could not be read rather than that nothing confirms', async () => {
    await render(PATH, answer(page(GIFTS), json(null, 422)));
    expect(container.querySelector('.de-confirm')?.textContent).toBe(
      'We couldn’t check whether an organization record confirms this spelling',
    );
  });

  it('says so when no donor printed the spelling', async () => {
    await render(PATH, answer(page([])));
    expect(container.textContent).toContain(
      `No employer printed as “${SPELLING}” appears in the copied contribution records. This does not mean no donor works there.`,
    );
    expect(container.querySelector('.de-donor')).toBeNull();
  });

  it('says our copy could not be read rather than that nothing was filed', async () => {
    await render(PATH, answer(page([], { state: 'unavailable' })));
    expect(container.textContent).toContain('We could not read this part of our records just now');
    expect(container.textContent).not.toContain('This does not mean no donor works there');
  });

  it('shows the loading line while the donors load', async () => {
    await render(PATH, hang);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading…');
  });

  it('fails without a claim about the employer, and tries again', async () => {
    let calls = 0;
    await render(PATH, (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(records([]));
      calls += 1;
      return calls === 1 ? json(null, 500) : json(page(GIFTS));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'We couldn’t load these donors. This is a problem on our side and says nothing about what was filed under this employer.',
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    );
    await settle();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('.de-donors-head')?.textContent).toContain('3 donor names');
  });

  it('counts only what is loaded while more payments are filed', async () => {
    await render(PATH, answer(page(GIFTS, { hasMore: true })));
    expect(container.querySelector('.de-donors-head')?.textContent).toContain(
      '3 donor names so far',
    );
    expect(donor('Example, Wen').textContent).toContain('2 payments so far');
    expect(container.querySelector('.pn-more-btn')?.textContent).toBe('Show more payments');
  });
});

describe('Donors by employer helpers', () => {
  it('groups by the exact printed name and keeps unnamed rows apart', () => {
    const donors = groupDonors(
      [...GIFTS, gift(null, '5.0000', '2026-01-01', 8), gift(null, '6.0000', '2026-01-02', 9)],
      SPELLING,
      new Set(['90001']),
      '/money/employers/x',
    );
    expect(donors.map((item) => [item.name, item.payments.length])).toEqual([
      ['Example, Wen', 2],
      ['EXAMPLE, WEN', 1],
      ['Example, Priya', 1],
      ['Name not given in the filing', 1],
      ['Name not given in the filing', 1],
    ]);
    expect(donors[3].href).toBeNull();
    expect(donors[1].payments[0].href).toBeNull();
  });

  it('reads the confirmation states', () => {
    expect(employerConfirmation(null, false)).toEqual({ state: 'loading' });
    expect(employerConfirmation(null, true)).toEqual({ state: 'unknown' });
    expect(employerConfirmation(records([]), false)).toEqual({ state: 'unconfirmed' });
    expect(
      employerConfirmation(
        records([{ id: 'o', kind: 'organization', name: 'O', confirmed: 0 }]),
        false,
      ),
    ).toEqual({ state: 'unconfirmed' });
  });
});
