import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import {
  billFamily,
  countLabel,
  moneyFamilies,
  SearchResults,
  type MoneyGroup,
  type MoneySearch,
} from '../pages/Search';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

const KINDS = [
  'people',
  'committees',
  'gave',
  'got_paid',
  'got_paid_independent',
  'lobbyists',
  'principals',
];

function group(kind: string, overrides: Partial<MoneyGroup> = {}): MoneyGroup {
  return {
    kind,
    state: 'not_reported',
    results: [],
    total: 0,
    at_least: null,
    has_more: false,
    reason: null,
    ...overrides,
  };
}

function money(groups: Partial<Record<string, Partial<MoneyGroup>>> = {}): MoneySearch {
  return {
    state: 'reported',
    q: 'davis',
    min_query_length: 3,
    groups: KINDS.map((kind) => group(kind, groups[kind])),
  };
}

const DAVIS = money({
  people: {
    state: 'reported',
    total: 1,
    results: [
      {
        kind: 'person',
        id: 'd6db837e',
        full_name: 'Ben Davis',
        chamber: 'house',
        district_code: '06A',
      },
    ],
  },
  lobbyists: {
    state: 'reported',
    total: 3,
    results: ['6445', '2461', '1000'].map((reg, index) => ({
      kind: 'lobbyist',
      name: `Davis, Lobbyist ${index}`,
      registration_number: reg,
    })),
  },
  committees: {
    state: 'reported',
    total: 1,
    results: [
      {
        kind: 'committee',
        filer_kind: 'candidate_committee',
        registration_number: '18822',
        name: 'Davis, Ben House Committee',
      },
    ],
  },
  gave: {
    state: 'reported',
    total: 192,
    has_more: true,
    results: [{ kind: 'payment_name', name: 'Davis', role: 'contributor' }],
  },
  got_paid: {
    state: 'reported',
    total: 2,
    results: [
      { kind: 'payment_name', name: 'Davis Printing', role: 'vendor' },
      { kind: 'payment_name', name: 'Davis, Dominique', role: 'vendor' },
    ],
  },
  got_paid_independent: {
    state: 'reported',
    total: 1,
    results: [{ kind: 'payment_name', name: 'Davis, Dominique', role: 'independent_vendor' }],
  },
});

const BILLS = {
  bills: [
    {
      id: '94-2026-HF3363',
      file_type: 'HF',
      file_number: 3363,
      title: 'A bill for an act relating to campaign finance; classifying street addresses',
      ai_analysis: { short_title: 'Campaign Finance Address Privacy And Security Rules' },
    },
  ],
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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
    root.render(<SearchResults match={matchRoute('/search')!} />);
  });
  await settle();
}

const both: Answer = (url) =>
  url.includes('/campaign-finance/search') ? json(DAVIS) : json(BILLS);

function family(title: string): HTMLElement {
  const heading = [...container.querySelectorAll('h2')].find((item) =>
    item.textContent?.startsWith(title),
  );
  return heading!.closest('section')!;
}

describe('Search results', () => {
  it('reads the money search and the bill search separately, uncapped', async () => {
    await render('/search?q=davis', both);
    expect(requests).toContain(
      'https://api.example.test/api/v1/campaign-finance/search?q=davis&limit=50',
    );
    expect(requests).toContain(
      'https://api.example.test/api/v1/search?q=davis&types=bills&limit=20',
    );
    expect(container.textContent).toContain(
      'Results for “davis” · each record family is counted on its own',
    );
  });

  it('draws every family with its own count, marks and links only to built pages', async () => {
    await render('/search?q=davis', both);
    const people = family('People');
    expect(people.querySelector('h2')?.textContent).toBe('People4');
    expect(people.querySelectorAll('li')).toHaveLength(3);
    const legislator = people.querySelector('a');
    expect(legislator?.getAttribute('href')).toBe(
      '/legislators/d6db837e?from=%2Fsearch%3Fq%3Ddavis',
    );
    expect(legislator?.textContent).toContain('Legislator · House District 06A');
    expect(people.querySelector('.f-mark-person')).not.toBeNull();
    // Lobbyists link to their own built page.
    const lobbyistLinks = [...people.querySelectorAll('a')].filter((a) =>
      a.getAttribute('href')?.startsWith('/lobbying/lobbyists/'),
    );
    expect(lobbyistLinks.length).toBeGreaterThan(0);

    const committees = family('Committees');
    expect(committees.querySelector('a')?.getAttribute('href')).toBe(
      '/money/committees/18822?from=%2Fsearch%3Fq%3Ddavis',
    );
    expect(committees.textContent).toContain('Candidate committee · Registration 18822');
    expect(committees.querySelector('.f-mark-committee')).not.toBeNull();

    const bills = family('Bills');
    expect(bills.textContent).toContain('Campaign Finance Address Privacy And Security Rules');
    expect(bills.textContent).not.toContain('A bill for an act');
    expect(bills.querySelector('.f-code')?.textContent).toBe('HF 3363');
    expect(bills.textContent).toContain('2025–26 · House');

    expect(family('Organizations').textContent).toContain('No matching records');
    expect(family('Organizations').querySelector('h2')?.textContent).toBe('Organizations0');
  });

  it('keeps printed names apart, lists a payee once and never adds the 2 payee files', async () => {
    await render('/search?q=davis', both);
    const printed = family('Payments under a name');
    // 192 donor spellings counted by the server; the 2 payee spellings are both
    // in 1 file's complete list, so the other file adds no new name.
    expect(printed.querySelector('h2')?.textContent).toBe('Payments under a name194');
    expect(printed.textContent).toContain('A printed name is not a confirmed person or business');
    // Each spelling opens Payments under this name, never a merged record.
    const spellings = [...printed.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(spellings.length).toBeGreaterThan(0);
    expect(spellings.every((href) => href?.startsWith('/money/names/'))).toBe(true);
    expect(printed.querySelector('.f-mark-printed')).not.toBeNull();
  });

  it('expands a family in place and keeps it in the address', async () => {
    await render('/search?q=davis', both);
    const more = family('People').querySelector<HTMLButtonElement>('.sr-more')!;
    expect(more.textContent).toBe('View all');
    await act(async () => more.click());
    expect(window.location.search).toBe('?q=davis&family=people');
    expect(family('People').querySelectorAll('li')).toHaveLength(4);
    expect(family('People').querySelector('.sr-more')).toBeNull();
  });

  it('shows the 3 grey rows per family while loading', async () => {
    await render('/search?q=davis', () => new Promise<Response>(() => {}));
    expect(container.textContent).toContain('Searching for “davis”');
    expect(container.querySelectorAll('.f-skeleton')).toHaveLength(5);
  });

  it('fails 1 family on its own and retries it', async () => {
    let calls = 0;
    await render('/search?q=davis', (url) => {
      if (!url.includes('/campaign-finance/search')) return json(BILLS);
      calls += 1;
      return json(
        calls === 1
          ? {
              ...DAVIS,
              groups: DAVIS.groups.map((g) =>
                g.kind === 'principals' ? { ...g, state: 'unavailable', reason: 'no_release' } : g,
              ),
            }
          : DAVIS,
      );
    });
    const orgs = family('Organizations');
    expect(orgs.querySelector('[role="alert"]')?.textContent).toContain(
      'We couldn’t load these results',
    );
    expect(family('People').querySelectorAll('li')).toHaveLength(3);
    await act(async () => orgs.querySelector<HTMLButtonElement>('button')!.click());
    await settle();
    expect(family('Organizations').querySelector('[role="alert"]')).toBeNull();
    expect(calls).toBe(2);
  });

  it('fails only the bills family when the bill search fails', async () => {
    await render('/search?q=davis', (url) =>
      url.includes('/campaign-finance/search') ? json(DAVIS) : new Response(null, { status: 503 }),
    );
    expect(family('Bills').querySelector('[role="alert"]')).not.toBeNull();
    expect(family('People').querySelector('[role="alert"]')).toBeNull();
  });

  it('says no matching records once when every family searched and found nothing', async () => {
    await render('/search?q=zzzz', (url) =>
      url.includes('/campaign-finance/search') ? json(money()) : json({ bills: [] }),
    );
    expect(container.textContent).toContain('No matching recordsTry another name or bill number');
    expect(container.querySelectorAll('section')).toHaveLength(0);
  });

  it('asks for 3 characters rather than claiming nothing matched', async () => {
    await render('/search?q=ab', both);
    expect(requests).toHaveLength(0);
    expect(family('People').textContent).toContain('Type at least 3 characters');
    expect(container.textContent).not.toContain('No matching records');
  });

  it('asks for a query when none was given', async () => {
    await render('/search', both);
    expect(container.textContent).toContain('Enter a name or bill number');
    expect(requests).toHaveLength(0);
  });
});

describe('family counts', () => {
  it('prints a floor, never a capped number, when the server stopped counting', () => {
    const families = moneyFamilies(
      money({
        gave: {
          state: 'reported',
          total: null,
          at_least: 200,
          has_more: true,
          results: [{ kind: 'payment_name', name: 'Smith', role: 'contributor' }],
        },
      }),
    );
    const printed = families.printed;
    expect(printed.state).toBe('rows');
    if (printed.state === 'rows') expect(countLabel(printed.count)).toBe('At least 200');
  });

  it('treats an incomplete payee file as a floor of the larger file', () => {
    const families = moneyFamilies(
      money({
        got_paid: {
          state: 'reported',
          total: 71,
          has_more: true,
          results: [{ kind: 'payment_name', name: 'A', role: 'vendor' }],
        },
        got_paid_independent: {
          state: 'reported',
          total: 1,
          results: [{ kind: 'payment_name', name: 'B', role: 'independent_vendor' }],
        },
      }),
    );
    if (families.printed.state === 'rows') {
      expect(countLabel(families.printed.count)).toBe('At least 71');
    } else {
      throw new Error('expected rows');
    }
  });

  it('counts a full page of bills as a floor', () => {
    const full = billFamily(
      Array.from({ length: 20 }, (_, index) => ({
        id: `94-2026-HF${index}`,
        file_type: 'HF',
        file_number: index,
      })),
    );
    if (full.state === 'rows') expect(countLabel(full.count)).toBe('At least 20');
    const some = billFamily([{ id: '94-2026-SF1', file_type: 'SF', file_number: 1 }]);
    if (some.state === 'rows') expect(countLabel(some.count)).toBe('1');
  });
});
