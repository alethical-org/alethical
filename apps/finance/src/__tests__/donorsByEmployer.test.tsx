import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import {
  DonorsByEmployer,
  donorHref,
  employerConfirmation,
  paymentHref,
  spellingMeta,
  type DonorGroup,
  type DonorPaymentRow,
  type EmployerDonors,
  type EmployerSpellings,
} from '../pages/DonorsByEmployer';
import type { IdentityRecords } from '../pages/payments/data';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

const SPELLING = 'Example Health Association';
const FETCHED = '2026-10-29T06:49:45Z';

function gift(
  record: number,
  amount: string | null,
  on: string | null,
  recipient = 'Example Candidate Committee',
  registration = '90001',
  filer = true,
): DonorPaymentRow {
  return {
    recipient_registration_number: registration,
    recipient_name: recipient,
    contributor: null,
    contributor_type: 'Individual',
    employer: SPELLING,
    amount,
    received_on: on,
    year: on ? Number(on.slice(0, 4)) : null,
    receipt_type: 'Contribution',
    record_number: record,
    recipient_is_filer: filer,
  };
}

function group(
  name: string | null,
  payments: DonorPaymentRow[],
  count = payments.length,
): DonorGroup {
  return {
    key: name === null ? `record:${payments[0].record_number}` : `name:${name}`,
    name,
    record_number: name === null ? payments[0].record_number : null,
    payment_count: count,
    payments: payments.map((item) => ({ ...item, contributor: name })),
  };
}

const GROUPS: DonorGroup[] = [
  group('Example, Wen', [gift(1, '1000.0000', '2026-06-03'), gift(3, '300.0000', '2025-10-01')]),
  group('EXAMPLE, WEN', [gift(2, '250.0000', '2025-11-02', 'Example Senate Caucus', '90005')]),
  group('Example, Priya', [gift(4, null, null, 'Example Action PAC', '90004', false)]),
];

function donors(rows: DonorGroup[], { hasMore = false, state = '' } = {}): EmployerDonors {
  return {
    state: (state || (rows.length ? 'reported' : 'not_reported')) as EmployerDonors['state'],
    name: SPELLING,
    rows,
    total: rows.length,
    page: { limit: 20, offset: 0, has_more: hasMore },
    release_id: 'release-1',
    fetched_at: FETCHED,
  };
}

function spellings(rows: EmployerSpellings['rows'], hasMore = false): EmployerSpellings {
  return {
    state: rows.length ? 'reported' : 'not_reported',
    q: 'health',
    rows,
    total: rows.length,
    page: { limit: 50, offset: 0, has_more: hasMore },
    fetched_at: FETCHED,
  };
}

const LIST = spellings([
  {
    name: 'EXAMPLE HEALTH ASSN',
    record_count: 2,
    donor_name_count: 2,
    unnamed_records: 0,
    confirmed_records: 0,
  },
  {
    name: SPELLING,
    record_count: 4,
    donor_name_count: 3,
    unnamed_records: 0,
    confirmed_records: 2,
  },
]);

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

function answer({
  list = LIST,
  detail = donors(GROUPS),
  identity = records([]) as IdentityRecords | Response,
}: {
  list?: EmployerSpellings | Response;
  detail?: EmployerDonors | Response;
  identity?: IdentityRecords | Response;
} = {}): Answer {
  return (url) => {
    const respond = (value: unknown) => (value instanceof Response ? value : json(value));
    if (url.pathname.endsWith('/finance/identities/records')) return respond(identity);
    if (url.pathname.endsWith('/finance/employers/donors')) return respond(detail);
    if (url.pathname.endsWith('/finance/employers')) return respond(list);
    return json(null, 404);
  };
}

function donor(name: string): HTMLElement {
  return container.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!;
}

function setWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      query === '(max-width: 767px)'
        ? width < 768
        : query === '(min-width: 1100px)' && width >= 1100,
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe('Donors by employer', () => {
  it('holds only the search box at the start, and reads nothing', async () => {
    await render('/money/employers', answer());
    expect(container.querySelector('h1')?.textContent).toBe('Donors by employer');
    expect(container.textContent).toContain('Employer name as printed');
    expect(requests).toHaveLength(0);
  });

  it('searches the employer directory and opens the first spelling beside the list', async () => {
    setWidth(1280);
    await render('/money/employers?q=health', answer());
    const search = requests.find((url) => url.pathname.endsWith('/finance/employers'))!;
    expect(search.searchParams.get('q')).toBe('health');
    expect(container.textContent).toContain('Employer spellings');
    expect(container.textContent).toContain('2 spellings');
    const items = [...container.querySelectorAll('.de-spelling-item')];
    expect(items.map((item) => item.querySelector('.de-spelling-meta')?.textContent)).toEqual([
      '2 donor names',
      '3 donor names · Confirmed for 2 of 4 records',
    ]);
    expect(items[1].getAttribute('href')).toBe(
      '/money/employers/Example%20Health%20Association?q=health',
    );
    // On a computer the first spelling opens until another is chosen.
    expect(items[0].getAttribute('aria-current')).toBe('true');
    expect(container.querySelector('#de-employer-h')?.textContent).toBe('EXAMPLE HEALTH ASSN');
  });

  it('keeps the list beside the chosen spelling on a computer, and only the detail on a phone', async () => {
    setWidth(1280);
    await render(`${PATH}?q=health`, answer());
    expect(container.querySelector('.de-layout')?.hasAttribute('data-split')).toBe(true);
    expect(container.querySelector('.de-spelling-item[aria-current]')?.textContent).toContain(
      SPELLING,
    );
    expect(container.textContent).not.toContain('Back to Employer spellings');
    // The directory's own count of donor names.
    expect(container.querySelector('.de-donors-head')?.textContent).toContain('3 donor names');

    act(() => root.unmount());
    root = createRoot(container);
    setWidth(375);
    await render(`${PATH}?q=health`, answer());
    expect(container.querySelector('.de-spellings')).toBeNull();
    const back = [...container.querySelectorAll('a')].find(
      (link) => link.textContent === 'Back to Employer spellings',
    )!;
    expect(back.getAttribute('href')).toBe('/money/employers?q=health');
  });

  it('opens a typed spelling of under 3 characters exactly, since the directory needs 3', async () => {
    await render('/money/employers?q=ab', answer());
    expect(requests.some((url) => url.pathname.endsWith('/finance/employers'))).toBe(false);
  });

  it('lists each donor spelling apart with its own payments, never a total', async () => {
    setWidth(1280);
    await render(PATH, answer());
    const read = requests.find((url) => url.pathname.endsWith('/finance/employers/donors'))!;
    expect(read.searchParams.get('name')).toBe(SPELLING);
    expect(container.querySelector('.de-donors-head')?.textContent).toContain('3 donor names');
    expect(donor('Example, Wen').textContent).toContain('2 payment records');
    expect(donor('EXAMPLE, WEN').textContent).toContain('1 payment record');
    const wen = donor('Example, Wen');
    // The donor's own page, all years.
    expect(wen.querySelector('.de-donor-name')?.getAttribute('href')).toMatch(
      /^\/money\/names\/Example%2C%20Wen\?role=donor&from=/,
    );
    // Each payment opens its committee at the record's year, its kind's tab and the donor.
    expect(wen.querySelector('.de-recipient-link')?.getAttribute('href')).toMatch(
      /^\/money\/committees\/90001\?year=2026&tab=individuals&name=Example%2C\+Wen&from=/,
    );
    const priya = donor('Example, Priya');
    expect(priya.textContent).toContain('Date not given');
    expect(priya.textContent).toContain('Amount not given');
    expect(priya.querySelector('.de-recipient a')).toBeNull();
    expect(container.textContent).not.toContain('$1,550');
    expect(container.textContent).toContain(
      'Employer names and payments: Minnesota Campaign Finance and Public Disclosure Board contribution files, copied Oct 29, 2026. Employer names are printed as each donor wrote them.',
    );
  });

  it('gives each identity its own line and its own profile link', async () => {
    await render(
      PATH,
      answer({
        identity: records(
          [
            { id: 'org-1', kind: 'organization', name: 'Example Health', confirmed: 1 },
            { id: 'org-2', kind: 'organization', name: 'Example Health Duluth', confirmed: 1 },
          ],
          3,
        ),
      }),
    );
    const lines = [...container.querySelectorAll('.de-confirm')];
    expect(lines.map((line) => line.querySelector('.de-confirm-text')?.textContent)).toEqual([
      'Confirmed as Example Health for 1 of 3 records',
      'Confirmed as Example Health Duluth for 1 of 3 records',
    ]);
    expect(lines[1].querySelector('a')?.getAttribute('href')).toMatch(/^\/organizations\/org-2\?/);
  });

  it('says no organization confirms the spelling, with no link to an unbuilt screen', async () => {
    await render(PATH, answer());
    const line = container.querySelector('.de-confirm')!;
    expect(line.textContent).toBe('No organization record confirms this spelling');
    expect(line.querySelector('a')).toBeNull();
  });

  it('says the check could not be read rather than that nothing confirms', async () => {
    await render(PATH, answer({ identity: json(null, 422) }));
    expect(container.querySelector('.de-confirm .de-confirm-text')?.textContent).toBe(
      'We couldn’t check whether an organization record confirms this spelling',
    );
  });

  it('says so when no donor printed the spelling, in the list and on the spelling', async () => {
    await render('/money/employers?q=zzzz', answer({ list: { ...spellings([]), q: 'zzzz' } }));
    expect(container.textContent).toContain(
      'No employer printed as “zzzz” appears in the copied contribution records. This does not mean no donor works there.',
    );
    act(() => root.unmount());
    root = createRoot(container);
    await render(PATH, answer({ detail: donors([]) }));
    expect(container.textContent).toContain(
      `No employer printed as “${SPELLING}” appears in the copied contribution records.`,
    );
    expect(container.querySelector('.de-donor')).toBeNull();
  });

  it('says our copy could not be read rather than that nothing was filed', async () => {
    await render(PATH, answer({ detail: donors([], { state: 'unavailable' }) }));
    expect(container.textContent).toContain('We could not read this part of our records just now');
    expect(container.textContent).not.toContain('This does not mean no donor works there');
  });

  it('shows the loading lines while the spellings and donors load', async () => {
    await render('/money/employers?q=health', hang);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Loading employer spellings…',
    );
    act(() => root.unmount());
    root = createRoot(container);
    await render(PATH, hang);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading…');
  });

  it('fails without a claim about the employer, and tries again', async () => {
    let calls = 0;
    await render(PATH, (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(records([]));
      calls += 1;
      return calls === 1 ? json(null, 500) : json(donors(GROUPS));
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

  it('reads more donors and more payments from the same copy of the file', async () => {
    const wen = group('Example, Wen', [gift(1, '1000.0000', '2026-06-03')], 2);
    await render(PATH, (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(records([]));
      if (url.pathname.endsWith('/donor-payments')) {
        return json({
          state: 'reported',
          payments: [{ ...gift(3, '300.0000', '2025-10-01'), contributor: 'Example, Wen' }],
          page: { limit: 50, offset: 1, has_more: false },
        });
      }
      if (url.searchParams.get('offset')) return json(donors([GROUPS[2]]));
      return json(donors([wen], { hasMore: true }));
    });
    expect(container.querySelector('.de-donors-head')?.textContent).toContain(
      '1 donor name so far',
    );
    const showPayments = donor('Example, Wen').querySelector<HTMLButtonElement>('.pn-more-btn')!;
    expect(showPayments.textContent).toBe('Show more payments');
    await act(async () => showPayments.click());
    await settle();
    const read = requests.find((url) => url.pathname.endsWith('/donor-payments'))!;
    expect(read.searchParams.get('donor')).toBe('Example, Wen');
    expect(read.searchParams.get('offset')).toBe('1');
    expect(read.searchParams.get('release_id')).toBe('release-1');
    expect(donor('Example, Wen').querySelectorAll('.de-row:not(.de-head)')).toHaveLength(2);
    expect(donor('Example, Wen').querySelector('.pn-more-btn')).toBeNull();

    const showDonors = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent === 'Show more',
    )!;
    await act(async () => showDonors.click());
    await settle();
    const page = requests.find(
      (url) => url.pathname.endsWith('/employers/donors') && url.searchParams.get('offset'),
    )!;
    expect(page.searchParams.get('offset')).toBe('1');
    expect(page.searchParams.get('release_id')).toBe('release-1');
    expect(donor('Example, Priya')).toBeTruthy();
    expect(container.querySelector('.de-donors-head')?.textContent).toContain('2 donor names');
  });

  it('says a failed load of more donors plainly, and tries it again', async () => {
    let later = 0;
    await render(PATH, (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(records([]));
      if (url.searchParams.get('offset')) {
        later += 1;
        return later === 1 ? json(null, 500) : json(donors([GROUPS[2]]));
      }
      return json(donors(GROUPS.slice(0, 2), { hasMore: true }));
    });
    const show = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent === 'Show more',
    )!;
    await act(async () => show.click());
    await settle();
    const alert = container.querySelector('.de-results > .pn-more [role="alert"]')!;
    expect(alert.textContent).toContain('We couldn’t load more donors');
    expect(alert.textContent).not.toContain('problem on our side');
    await act(async () => alert.querySelector<HTMLButtonElement>('button')!.click());
    await settle();
    expect(donor('Example, Priya')).toBeTruthy();
  });

  it('says the Board’s file changed when a later page answers 409, and reloads', async () => {
    let firsts = 0;
    await render(PATH, (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) return json(records([]));
      if (url.searchParams.get('offset')) return json(null, 409);
      firsts += 1;
      return json({
        ...donors(GROUPS.slice(0, 2), { hasMore: true }),
        release_id: `release-${firsts}`,
      });
    });
    const show = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent === 'Show more',
    )!;
    await act(async () => show.click());
    await settle();
    const alert = container.querySelector('.de-results [role="alert"]')!;
    expect(alert.textContent).toContain('The Board’s file changed. Reload the records.');
    const reload = alert.querySelector<HTMLButtonElement>('button')!;
    expect(reload.textContent).toBe('Reload the records');
    const before = firsts;
    await act(async () => reload.click());
    await settle();
    // The first page is read again, from the file now published.
    expect(firsts).toBe(before + 1);
    expect(container.querySelector('.de-results [role="alert"]')).toBeNull();
  });

  it('says a failed load of more spellings plainly', async () => {
    await render('/money/employers?q=health', (url) => {
      if (url.searchParams.get('offset')) return json(null, 500);
      if (url.pathname.endsWith('/finance/employers')) return json(spellings(LIST.rows, true));
      return answer()(url);
    });
    const show = container.querySelector<HTMLButtonElement>('.de-list-more button')!;
    await act(async () => show.click());
    await settle();
    const alert = container.querySelector('.de-list-more [role="alert"]')!;
    expect(alert.textContent).toContain('We couldn’t load more employer spellings');
    expect(alert.querySelector('button')?.textContent).toBe('Try again');
  });

  it('returns to Search results when opened directly', async () => {
    await render('/money/employers', answer());
    const back = container.querySelector<HTMLAnchorElement>('.f-back')!;
    expect(back.textContent).toBe('Back to Search results');
    expect(back.getAttribute('href')).toBe('/search');
  });

  it('tells apart spellings that differ only by stray spaces', async () => {
    setWidth(1280);
    const spaced = (name: string) => ({ ...LIST.rows[0], name });
    await render(
      '/money/employers?q=target',
      answer({ list: spellings([spaced(' Target '), spaced('Target'), spaced('Target ')]) }),
    );
    expect(
      [...container.querySelectorAll('.de-spelling-name')].map((item) => item.textContent),
    ).toEqual(['“ Target ”', 'Target', '“Target ”']);
    expect(container.querySelector('#de-employer-h')?.textContent).toBe('“ Target ”');
    expect(container.querySelector('.de-spelling-item')?.getAttribute('href')).toBe(
      '/money/employers/%20Target%20?q=target',
    );
  });

  it('counts a donor’s records as payment records', async () => {
    await render(PATH, answer());
    expect(donor('Example, Wen').querySelector('.de-donor-head .de-count')?.textContent).toBe(
      '2 payment records',
    );
  });

  it('offers Try again when the confirmation check could not be read', async () => {
    let checks = 0;
    await render(PATH, (url) => {
      if (url.pathname.endsWith('/finance/identities/records')) {
        checks += 1;
        return checks === 1 ? json(null, 500) : json(records([]));
      }
      return answer()(url);
    });
    const line = container.querySelector('.de-confirm')!;
    expect(line.textContent).toContain(
      'We couldn’t check whether an organization record confirms this spelling',
    );
    await act(async () => line.querySelector<HTMLButtonElement>('button')!.click());
    await settle();
    expect(container.querySelector('.de-confirm')?.textContent).toBe(
      'No organization record confirms this spelling',
    );
  });

  it('names the kept spellings’ own search when a new search fails', async () => {
    setWidth(1280);
    await render('/money/employers?q=health', answer());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        new URL(input).pathname.endsWith('/finance/employers')
          ? json(null, 500)
          : answer()(new URL(input)),
      ),
    );
    window.history.replaceState(null, '', '/money/employers?q=other');
    await act(async () => {
      root.render(<DonorsByEmployer match={matchRoute('/money/employers')!} />);
    });
    await settle();
    expect(container.querySelector('.de-spellings-head .de-count')?.textContent).toBe(
      '2 spellings matching “health”',
    );
  });
});

describe('Donors by employer helpers', () => {
  it('words a spelling with its donor names and any confirmed records', () => {
    expect(spellingMeta(LIST.rows[0])).toBe('2 donor names');
    expect(spellingMeta({ ...LIST.rows[0], donor_name_count: 1 })).toBe('1 donor name');
    expect(spellingMeta(LIST.rows[1])).toBe('3 donor names · Confirmed for 2 of 4 records');
  });

  it('links a payment only to a held filer, leaving an unknown year unclaimed', () => {
    expect(paymentHref(gift(9, '5.0000', null), 'A', '/x')).toBe(
      '/money/committees/90001?tab=individuals&name=A',
    );
    expect(paymentHref(gift(9, '5.0000', null, 'X', '90001', false), 'A', '/x')).toBeNull();
    expect(donorHref(null, '/x')).toBeNull();
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
