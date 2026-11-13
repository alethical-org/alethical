import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LobbyingLobbyist,
  LobbyingLobbyistsPage,
  LobbyingPrincipal,
  LobbyingPrincipalsPage,
} from '@alethical/shared/lobbyingTypes';

import { clearReadCache } from '../api/read';
import {
  Lobbying,
  countPath,
  listPath,
  lobbyistContributions,
  pageCount,
  pageFromParam,
  principalsNote,
  principalSpending,
  sortFromParam,
  tabFromParam,
  yearFromParam,
} from '../pages/Lobbying';
import {
  Lobbyist,
  committeeTotal,
  contributionsReturn,
  firstShown,
  paymentKind,
  registrationStatus,
  revealed,
} from '../pages/Lobbyist';
import {
  Principal,
  distinctLobbyists,
  lobbyistsScope,
  spendingBars,
  spendingFigure,
} from '../pages/Principal';
import { notFoundLine, recordNumber } from '../pages/lobbying/parts';
import * as routes from '../routes';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.example.test';
const COPIED = '2026-10-29T11:20:32Z';
const SOURCES = { expenditures: null, lobbyists: null };

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({
    apiBaseUrl: 'https://api.example.test',
    accessToken: 'token',
  }),
}));

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

type Answer = (url: string) => Response | Promise<Response> | null;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Renders `page` at `path`; `answer` replies to everything but the identity lookup,
 * which answers "none" unless `identity` is given. */
async function render(
  path: string,
  page: (match: NonNullable<ReturnType<typeof matchRoute>>) => ReactElement,
  answer: Answer,
  identity: unknown = null,
) {
  window.history.replaceState(null, '', path);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requests.push(input);
      if (input.includes('/finance/identities/lookup')) return json(identity);
      return answer(input) ?? new Response('', { status: 500 });
    }),
  );
  const match = matchRoute(path.split('?')[0])!;
  await act(async () => {
    root.render(page(match));
  });
  await settle();
}

/** The page's words; arrow links bind their last 2 words with a no-break space. */
function text() {
  return (container.textContent ?? '').replace(/\u00a0/g, ' ');
}

function button(label: string) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label);
}

// ---------- Fixtures shaped like the shared Alethical API ----------

function lobbyistsPage(overrides: Partial<LobbyingLobbyistsPage> = {}): LobbyingLobbyistsPage {
  return {
    release_id: 'r1',
    copied_at: COPIED,
    sources: SOURCES,
    state: 'reported',
    limit: 50,
    offset: 0,
    q: '',
    matched_on: 'substring_of_the_filed_name',
    total: 1673,
    has_more: true,
    sort: 'name',
    lobbyists: [
      {
        registration_number: '1733',
        name: 'Aafedt, David M',
        formatted_name: 'David M Aafedt',
        principal_count: 8,
        donation_amount: null,
        donation_state: 'unavailable',
      },
      {
        registration_number: '6332',
        name: 'Aasen, Michael',
        formatted_name: 'Michael Aasen',
        principal_count: 1,
        donation_amount: '400.00',
        donation_state: 'reported',
      },
      {
        registration_number: '7001',
        name: 'Abbott, Lee',
        formatted_name: 'Lee Abbott',
        principal_count: 2,
        donation_amount: null,
        donation_state: 'no_records',
      },
    ],
    donations: {
      state: 'reported',
      year: 2025,
      available_years: [2025, 2024],
      release_id: 'c1',
      copied_at: '2026-10-28T06:49:45Z',
      source_url: null,
      eligible_count: 1,
    },
    ...overrides,
  };
}

function principalsPage(overrides: Partial<LobbyingPrincipalsPage> = {}): LobbyingPrincipalsPage {
  return {
    release_id: 'r1',
    copied_at: COPIED,
    sources: SOURCES,
    state: 'reported',
    limit: 50,
    offset: 0,
    q: '',
    matched_on: 'substring_of_the_filed_name',
    total: 3448,
    has_more: true,
    latest_reported_year: 2025,
    principals: [
      {
        entity_id: 8450,
        name: '100%',
        registered_names: [],
        state: 'reported',
        linkable: true,
        latest_reported_year: 2025,
      },
      {
        entity_id: 8887,
        name: 'AMP Robotics Corporation',
        registered_names: [],
        state: 'no_spending_rows',
        linkable: false,
        latest_reported_year: null,
      },
    ],
    ...overrides,
  };
}

const SUMMARY = {
  release_id: 'r1',
  copied_at: COPIED,
  sources: SOURCES,
  state: 'reported',
  registered_lobbyists: 1673,
  principals_reporting: 1748,
  latest_reported_year: 2025,
  first_year: 2014,
  last_year: 2025,
};

function directoryAnswer(lobbyists: () => Response, principals: () => Response): Answer {
  return (url) => {
    if (url.includes('/lobbying/summary')) return json(SUMMARY);
    if (url.includes('limit=1&') || url.endsWith('limit=1')) {
      return url.includes('/lobbying/principals')
        ? json(principalsPage({ principals: [] }))
        : json(lobbyistsPage({ lobbyists: [] }));
    }
    if (url.includes('/lobbying/principals')) return principals();
    if (url.includes('/lobbying/lobbyists')) return lobbyists();
    return null;
  };
}

it('finds a represented name even when the search starts on Lobbyists', async () => {
  await render(
    '/lobbying?tab=lobbyists&q=Xcel',
    (match) => <Lobbying match={match} />,
    directoryAnswer(
      () =>
        json(
          lobbyistsPage({
            state: 'not_reported',
            q: 'Xcel',
            total: 0,
            has_more: false,
            lobbyists: [],
          }),
        ),
      () =>
        json(
          principalsPage({
            q: 'Xcel',
            total: 1,
            has_more: false,
            principals: [
              {
                entity_id: 8450,
                name: 'Xcel Energy',
                registered_names: [],
                state: 'reported',
                linkable: true,
                latest_reported_year: 2025,
              },
            ],
          }),
        ),
    ),
  );
  expect(text()).toContain('Xcel Energy');
  expect(text()).toContain('Who lobbyists represent');
  expect(text()).toContain('No matches');
  expect(container.querySelectorAll('[role="table"]')).toHaveLength(1);
});

it('keeps represented matches when the lobbyist search fails', async () => {
  await render(
    '/lobbying?q=Xcel',
    (match) => <Lobbying match={match} />,
    directoryAnswer(
      () => new Response('', { status: 500 }),
      () =>
        json(
          principalsPage({
            q: 'Xcel',
            total: 1,
            has_more: false,
            principals: [
              {
                entity_id: 8450,
                name: 'Xcel Energy',
                registered_names: [],
                state: 'reported',
                linkable: true,
                latest_reported_year: 2025,
              },
            ],
          }),
        ),
    ),
  );
  expect(text()).toContain('Xcel Energy');
  expect(text()).toContain('Try again');
  expect(text()).not.toContain('Lobbyists (0)');
  expect(container.querySelector('button[type="submit"]')?.getAttribute('aria-label')).toBe(
    'Search',
  );
});

function payment(record: number, amount: string | null, date: string | null, extra = {}) {
  return {
    record_number: record,
    contributor_name: 'Kozak, Andrew',
    employer: 'North State Advisors',
    amount,
    received_on: date,
    in_kind: 'No',
    in_kind_description: null,
    identity_basis: 'source_registration_number' as const,
    ...extra,
  };
}

function lobbyist(overrides: Partial<LobbyingLobbyist> = {}): LobbyingLobbyist {
  return {
    release_id: 'r1',
    copied_at: COPIED,
    sources: SOURCES,
    registration_number: '141',
    state: 'reported',
    name: 'Kozak, Andrew',
    formatted_name: 'Andrew Kozak',
    latest_reported_year: 2025,
    principals: {
      state: 'reported',
      total: 2,
      rows: [
        {
          entity_id: 2263,
          name: 'American Express Co',
          spending_name: 'American Express',
          position: 1,
          linkable: true,
          state: 'reported',
        },
        {
          entity_id: 8887,
          name: 'AMP Robotics Corporation',
          spending_name: null,
          position: 2,
          linkable: false,
          state: 'no_spending_rows',
        },
      ],
    },
    contributions: {
      state: 'reported',
      payment_count: 7,
      committee_count: 2,
      release_id: 'c1',
      copied_at: '2026-10-29T06:49:45Z',
      source_url: 'https://cfb.mn.gov/download',
      years: [
        {
          year: 2026,
          payment_count: 4,
          committee_count: 1,
          committees: [
            {
              registration_number: '20006',
              name: 'DFL House Caucus',
              kind: 'party_unit',
              recipient_type: 'PTU',
              linkable: true,
              payment_count: 4,
              payments: [
                payment(605481, '100.0000', '2026-10-08', {
                  contributor_name: 'Kozak, Andrew V',
                }),
                payment(226423, '50.0000', '2026-09-17'),
                payment(226424, null, null),
                payment(226425, '75.0000', '2026-03-01', {
                  in_kind: 'Yes',
                  in_kind_description: 'Food',
                  identity_basis: 'official_report',
                }),
              ],
            },
          ],
        },
        {
          year: 2025,
          payment_count: 3,
          committee_count: 1,
          committees: [
            {
              registration_number: '17868',
              name: 'Abeler, Jim Senate Committee',
              kind: 'candidate_committee',
              recipient_type: 'PCC',
              linkable: true,
              payment_count: 3,
              payments: [
                payment(182076, '200.0000', '2025-11-26'),
                payment(178922, '100.0000', '2025-11-08'),
                payment(178923, '300.0000', '2025-01-08'),
              ],
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

function principal(overrides: Partial<LobbyingPrincipal> = {}): LobbyingPrincipal {
  return {
    release_id: 'r1',
    copied_at: COPIED,
    sources: SOURCES,
    entity_id: 8450,
    state: 'reported',
    name: 'Health Association',
    latest_reported_year: 2025,
    source_latest_year: 2025,
    spending: {
      state: 'reported',
      rows: [
        {
          year: 2025,
          record_number: 17497,
          puc_lobbying_amount: '0.0000',
          legislative_lobbying_amount: '4501.0000',
          administrative_lobbying_amount: '0.0000',
          mgu_lobbying_amount: null,
          general_lobbying_amount: '0.0000',
          total_spent: '4501.0000',
        },
        {
          year: 2024,
          record_number: 17496,
          puc_lobbying_amount: '0.0000',
          legislative_lobbying_amount: '1200.9900',
          administrative_lobbying_amount: '0.0000',
          mgu_lobbying_amount: '0.0000',
          general_lobbying_amount: '0.0000',
          total_spent: '1200.9900',
        },
      ],
    },
    lobbyists: {
      state: 'reported',
      total: 1,
      rows: [
        {
          registration_number: '5245',
          name: 'Vautrin, Aurora',
          formatted_name: 'Aurora Vautrin',
          principal_name_as_listed: 'Health Association',
          principal_name_differs: false,
        },
        {
          registration_number: '5245',
          name: 'Vautrin, Aurora',
          formatted_name: 'Aurora Vautrin',
          principal_name_as_listed: 'Health Assn',
          principal_name_differs: true,
        },
      ],
    },
    ...overrides,
  };
}

// ---------- Lobbying directory ----------

describe('Lobbying directory', () => {
  it('lists lobbyists with the contributions recorded in the selected year', async () => {
    await render(
      '/lobbying',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage()),
        () => json(principalsPage()),
      ),
    );
    expect(container.querySelector('h1')?.textContent).toBe('Lobbying');
    const list = requests.find((url) => url.includes('/lobbying/lobbyists?'));
    expect(list).toBe(`${API}/api/v1/finance/lobbying/lobbyists?sort=name&limit=50&offset=0`);
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(['Lobbyists1,673', 'Who lobbyists represent3,448']);
    expect(text()).toContain('Showing 1–3 of 1,673 registered lobbyists');
    expect(text()).toContain(
      'Find Minnesota lobbyists, who they represent, and reported lobbying spending',
    );
    expect(text()).not.toContain('part of a name.');
    const head = container.querySelector('.lb-head')?.textContent;
    expect(head).toBe('NameRegistration and clientsCampaign contributions in 2025');
    const rows = [...container.querySelectorAll('.lb-tr:not(.lb-head)')].map((row) =>
      row.textContent?.replace(/\u00a0/g, ' ').replace('Campaign contributions in 2025: ', ''),
    );
    expect(rows).toEqual([
      'Aafedt, David MRegistration number 17338 clients listedAmount unavailable',
      'Aasen, MichaelRegistration number 63321 client listed$400',
      'Abbott, LeeRegistration number 70012 clients listedNo matching contribution records',
    ]);
    const link = container.querySelector<HTMLAnchorElement>('[role="cell"] a');
    expect(link?.textContent).toBe('Aafedt, David M');
    expect(link?.getAttribute('href')).toBe(
      '/lobbying/lobbyists/1733?year=2025&from=%2Flobbying#contributions',
    );
    expect(container.querySelector('[role="cell"] .f-mark-person')).not.toBeNull();
    expect(text()).toContain('Contribution year: 2025');
    expect(text()).toContain('Sort by: Name A–Z');
    expect(button('Clear all')).toBeUndefined();
    expect(text()).toContain('Page 1 of 34');
    expect(container.querySelector('.lb-list-note')).toBeNull();
    expect(
      container.querySelector('.lb-table')?.nextElementSibling?.classList.contains('lb-pager'),
    ).toBe(true);
    const about = [...container.querySelectorAll('.lb-about li')].map((li) => li.textContent);
    expect(about).toContain(
      'Contribution totals use records matched to each lobbyist’s registration and include donated goods or services. They are not a complete record of giving.',
    );
    const sources = [...container.querySelectorAll('.f-sources p')].map((p) => p.textContent);
    expect(sources).toEqual([
      'State entity IDs and lobbyist registration numbers come from the Minnesota Campaign Finance and Public Disclosure Board',
      'Lobbying records copied: Oct 29, 2026',
      'Campaign contribution file copied: Oct 28, 2026',
      'Copy dates show when Alethical obtained the files, not the reporting periods they cover',
    ]);
    expect(text()).toContain('View Minnesota’s lobbying source files');
    expect(text()).not.toMatch(/organis|illustrative|example|sample|fixture|demo/i);
  });

  it('keeps the shown rows labelled with their own year when a new year fails to load', async () => {
    await render(
      '/lobbying',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage()),
        () => json(principalsPage()),
      ),
    );
    const failing = (url: string) =>
      url.includes('year=2024') && !url.includes('limit=1&')
        ? new Response(null, { status: 503 })
        : directoryAnswer(
            () => json(lobbyistsPage()),
            () => json(principalsPage()),
          )(url);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        requests.push(input);
        return failing(input) ?? new Response(null, { status: 404 });
      }),
    );
    const year = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.startsWith('Contribution year'),
    )!;
    await act(async () => year.click());
    const option = [...container.querySelectorAll<HTMLElement>('[role="option"] button')].find(
      (o) => o.textContent?.trim() === '2024',
    )!;
    await act(async () => option.click());
    await settle();
    expect(text()).toContain('Contribution year: 2024');
    expect(new URLSearchParams(window.location.search).get('year')).toBe('2024');
    // The 2025 rows stay, still labelled 2025, with a failure and Try again.
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('.lb-head')?.textContent).toContain(
      'Campaign contributions in 2025',
    );
    expect(container.querySelector('.lb-phone-only')?.textContent).toBe(
      'Campaign contributions in 2025: ',
    );
    expect(
      container.querySelector<HTMLAnchorElement>('[role="cell"] a')?.getAttribute('href'),
    ).toContain('year=2025');
  });

  it('sorts lobbyists by contributions on the server for a chosen completed year', async () => {
    await render(
      '/lobbying',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage()),
        () => json(principalsPage()),
      ),
    );
    const sortButton = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Sort by:'),
    )!;
    await act(async () => sortButton.click());
    const options = [...container.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options).toEqual([
      'Name A–Z',
      'Contributions: highest first',
      'Contributions: lowest first',
    ]);
    await act(async () => button('Contributions: highest first')!.click());
    await settle();
    expect(window.location.search).toBe('?sort=donations_desc');
    expect(requests.at(-1)).toBe(
      `${API}/api/v1/finance/lobbying/lobbyists?sort=donations_desc&limit=50&offset=0`,
    );
    const yearButton = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Contribution year:'),
    )!;
    await act(async () => yearButton.click());
    await act(async () => button('2024')!.click());
    await settle();
    expect(new URL(requests.at(-1)!).searchParams.get('year')).toBe('2024');
    expect(button('Clear all')).toBeDefined();
    await act(async () => button('Clear all')!.click());
    await settle();
    expect(window.location.search).toBe('');
  });

  it('never asks for the current, unfinished year’s contributions', async () => {
    const current = new Date().getFullYear();
    await render(
      `/lobbying?year=${current + 1}`,
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage()),
        () => json(principalsPage()),
      ),
    );
    const list = requests.find((url) => url.includes('/lobbying/lobbyists?sort=name&limit=50'));
    expect(new URL(list!).searchParams.get('year')).toBeNull();
  });

  it('keeps each tab’s own year and sort', async () => {
    await render(
      '/lobbying?year=2024&sort=donations_asc',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage()),
        () => json(principalsPage()),
      ),
    );
    const tab = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) =>
        t.textContent?.startsWith(label),
      )!;
    await act(async () => tab('Who lobbyists represent').click());
    await settle();
    const switched = new URLSearchParams(window.location.search);
    expect(switched.get('tab')).toBe('principals');
    expect(switched.get('lobbyistsYear')).toBe('2024');
    expect(switched.get('lobbyistsSort')).toBe('donations_asc');
    expect(requests).toContain(
      `${API}/api/v1/finance/lobbying/principals?sort=spending_desc&limit=50&offset=0`,
    );
    expect(text()).toContain('Sort by: Spending: highest first');
    await act(async () => tab('Lobbyists').click());
    await settle();
    const returned = new URLSearchParams(window.location.search);
    expect(returned.get('year')).toBe('2024');
    expect(returned.get('sort')).toBe('donations_asc');
  });

  it('opens the principals tab from the address, linking only principals with spending rows', async () => {
    await render(
      '/lobbying?tab=principals',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage()),
        () => json(principalsPage()),
      ),
    );
    const list = requests.find((url) => url.includes('/lobbying/principals?sort='));
    expect(list).toBe(
      `${API}/api/v1/finance/lobbying/principals?sort=spending_desc&limit=50&offset=0`,
    );
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain(
      'Who lobbyists represent',
    );
    expect(text()).toContain('Showing 1–2 of 3,448 represented people and organizations');
    expect(text()).toContain(
      'Individuals, companies, associations, unions, nonprofits and public bodies',
    );
    const links = [...container.querySelectorAll<HTMLAnchorElement>('[role="cell"] a')];
    expect(links.map((a) => a.textContent)).toEqual(['100%']);
    expect(links[0].getAttribute('href')).toBe(
      '/lobbying/principals/8450?from=%2Flobbying%3Ftab%3Dprincipals',
    );
    expect(text()).toContain('AMP Robotics Corporation');
    expect(text()).toContain('State entity ID 8887');
    expect(text()).toContain('No spending report available');
    expect(text()).toContain('Reported lobbying spending in');
    expect(container.querySelector('.lb-list-note')).toBeNull();
    expect(text()).toContain(
      'Includes names from past years; listing does not establish current representation',
    );
  });

  it('shows each year’s own spending row, never the latest total, with the period on links', async () => {
    const base = principalsPage();
    const rows = [
      {
        ...base.principals[0],
        spending_year: 2024,
        total_spent: '50000000',
        spending_state: 'reported' as const,
      },
      {
        ...base.principals[1],
        linkable: true,
        spending_year: 2024,
        total_spent: null,
        spending_state: 'not_reported' as const,
      },
    ];
    await render(
      '/lobbying?tab=principals&year=2024&sort=spending_asc',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage()),
        () => json({ ...base, year: 2024, years: [2025, 2024], principals: rows }),
      ),
    );
    const request = requests.find((url) => url.includes('/principals?sort=spending_asc'))!;
    expect(new URL(request).searchParams.get('year')).toBe('2024');
    expect(text()).toContain('Reported lobbying spending in 2024');
    expect(text()).toContain('$50,000,000');
    expect(text()).toContain('No spending report available');
    expect(container.querySelector('a[href^="/lobbying/principals/8450?year=2024"]')).toBeTruthy();
    expect(
      principalSpending({ ...rows[0], total_spent: null, spending_state: 'ambiguous' }, 2024),
    ).toBe('Amount unavailable: more than one report');
    expect(principalSpending({ ...rows[0], total_spent: '0' }, 2024)).toBe('$0');
    expect(principalSpending({ ...rows[1], linkable: false }, 2024)).toBe(
      'No spending report available',
    );
    await act(async () => button('Clear all')!.click());
    await settle();
    expect(new URL(requests.at(-1)!).searchParams.get('year')).toBeNull();
    expect(window.location.search).toBe('?tab=principals');
  });

  it('ignores an address year the server does not accept', async () => {
    await render(
      '/lobbying?tab=principals&year=2005',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage()),
        () => json(principalsPage()),
      ),
    );
    const request = requests.find((url) => url.includes('/principals'))!;
    expect(new URL(request).searchParams.get('year')).toBeNull();
  });

  it('updates and clears search as you type while keeping filters', async () => {
    await render(
      '/lobbying?tab=principals&year=2024&page=2&q=before',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage()),
        () => json(principalsPage()),
      ),
    );
    const input = container.querySelector<HTMLInputElement>('.lb-search input')!;
    async function enter(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => vi.advanceTimersByTimeAsync(250));
    }
    vi.useFakeTimers();
    try {
      await enter('Example');
      const params = new URLSearchParams(window.location.search);
      expect(params.get('q')).toBe('Example');
      expect(params.get('tab')).toBe('principals');
      expect(params.get('year')).toBe('2024');
      expect(params.get('page')).toBe('2');
      expect(requests.some((url) => url.includes('principals?q=Example'))).toBe(true);
      await enter('');
      expect(new URLSearchParams(window.location.search).has('q')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('searches the open tab on the server and says when nothing matches', async () => {
    await render(
      '/lobbying?q=zzzz',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () =>
          json(
            lobbyistsPage({
              state: 'not_reported',
              lobbyists: [],
              total: 0,
              has_more: false,
              q: 'zzzz',
            }),
          ),
        () => json(principalsPage()),
      ),
    );
    expect(requests.some((url) => url.includes('lobbyists?q=zzzz&sort=name'))).toBe(true);
    expect(text()).toContain('Lobbyists (0)');
    expect(text()).toContain('No matches');
    expect(container.querySelector('[aria-label="Lobbyists"] .lb-controls')).toBeNull();
    expect(container.querySelector('[aria-label="Lobbyists"] [role="table"]')).toBeNull();
    expect(requests.some((url) => url.includes('principals?q=zzzz'))).toBe(true);
  });

  it('says a failed load says nothing about who was listed, and tries again', async () => {
    let fail = true;
    await render(
      '/lobbying',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => (fail ? new Response('', { status: 500 }) : json(lobbyistsPage())),
        () => json(principalsPage()),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Couldn’t load the Board’s lobbyist list. This says nothing about who was listed.',
    );
    expect(text()).not.toContain('just now');
    expect(text()).not.toContain('1,673 registered lobbyists');
    fail = false;
    await act(async () => button('Try again')!.click());
    await settle();
    expect(text()).toContain('Aafedt, David M');
  });

  it('treats an unpublished lobbying pair as a failure, never as an empty list', async () => {
    await render(
      '/lobbying?tab=principals',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage()),
        () =>
          json(
            principalsPage({
              state: 'unavailable',
              total: null,
              principals: [],
            }),
          ),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t load the Board’s principal records. This says nothing about what was reported or registered.Try again',
    );
    expect(text()).not.toContain('No principal matches');
  });

  it('shows one empty state only after both searches succeed, without empty controls or tables', async () => {
    await render(
      '/lobbying?tab=principals&q=zzzz',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () =>
          json(
            lobbyistsPage({
              state: 'not_reported',
              q: 'zzzz',
              total: 0,
              has_more: false,
              lobbyists: [],
            }),
          ),
        () =>
          json(
            principalsPage({
              state: 'not_reported',
              q: 'zzzz',
              total: 0,
              has_more: false,
              principals: [],
            }),
          ),
      ),
    );
    expect(text()).toContain('No matches for “zzzz”');
    expect(text()).toContain(
      'Names appear as filed and spellings can vary. Try a shorter part of the name.',
    );
    expect(container.querySelectorAll('[role="table"]')).toHaveLength(0);
    expect(container.querySelectorAll('.lb-controls')).toHaveLength(0);
    expect(text()).not.toContain('Lobbyists (0)');
    expect(button('Clear search')).toBeDefined();
  });

  it.each([404, 500])(
    'keeps the exact old query and year beside retained rows after %s while the other group updates',
    async (status) => {
      const old = lobbyistsPage({ q: 'old' });
      await render(
        '/lobbying?q=old',
        (match) => <Lobbying match={match} />,
        (url) => {
          const parsed = new URL(url);
          if (url.includes('/summary')) return json(SUMMARY);
          if (url.includes('/lobbying/lobbyists?'))
            return parsed.searchParams.get('q') === 'new'
              ? new Response('', { status })
              : json(old);
          if (url.includes('/lobbying/principals?'))
            return json(
              principalsPage({
                q: parsed.searchParams.get('q') ?? '',
                principals: [
                  {
                    ...principalsPage().principals[0],
                    name:
                      parsed.searchParams.get('q') === 'new'
                        ? 'New organization'
                        : 'Old organization',
                  },
                ],
              }),
            );
          return null;
        },
      );
      const input = container.querySelector<HTMLInputElement>('#lob-name')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          'new',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        container
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
      await settle();
      const retained = container.querySelector('section[aria-label="Lobbyists"]')!;
      expect(retained.textContent).toContain('matching “old”');
      expect(retained.textContent).toContain('Campaign contributions in 2025');
      expect(retained.textContent).toContain('Previous results are shown');
      expect(retained.querySelector('h3')?.textContent).toBe('Lobbyists');
      expect(text()).toContain('New organization');
      expect(retained.querySelector('a')?.getAttribute('href')).toContain('year=2025');
    },
  );

  it('previews five per group and preserves independent full pages, links, browser return and browsing choices', async () => {
    await render(
      '/lobbying?tab=principals&year=2024&sort=spending_asc&page=2&q=clinic',
      (match) => <Lobbying match={match} />,
      (url) => {
        if (url.includes('/summary')) return json(SUMMARY);
        const params = new URL(url).searchParams;
        const offset = Number(params.get('offset') ?? 0);
        const q = params.get('q') ?? '';
        const length = Math.min(50, 60 - offset);
        if (url.includes('/lobbying/lobbyists?'))
          return json(
            lobbyistsPage({
              q,
              offset,
              total: 60,
              has_more: offset === 0,
              lobbyists: Array.from({ length }, (_, i) => ({
                ...lobbyistsPage().lobbyists[0],
                registration_number: String(offset + i),
                name: `Lobbyist ${offset + i}`,
              })),
            }),
          );
        if (url.includes('/lobbying/principals?'))
          return json({
            ...principalsPage(),
            q,
            offset,
            total: 60,
            has_more: offset === 0,
            year: Number(params.get('year') ?? 2025),
            years: [2025, 2024],
            principals: Array.from({ length }, (_, i) => ({
              ...principalsPage().principals[0],
              entity_id: offset + i,
              name: `Organization ${offset + i}`,
            })),
          });
        return null;
      },
    );
    expect(container.querySelectorAll('.lb-tr:not(.lb-head)')).toHaveLength(10);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    await act(async () =>
      [...container.querySelectorAll<HTMLAnchorElement>('a')]
        .find(
          (link) => link.textContent === 'View all matching represented people and organizations',
        )!
        .click(),
    );
    await settle();
    expect(document.activeElement).toBe(container.querySelector('.lb-heading-line h2'));
    const fullAddress = window.location.pathname + window.location.search;
    expect(new URLSearchParams(window.location.search).get('view')).toBe('principals');
    expect(container.querySelectorAll('.lb-tr:not(.lb-head)')).toHaveLength(50);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    await act(async () => button('Next')!.click());
    await settle();
    expect(container.querySelectorAll('.lb-tr:not(.lb-head)')).toHaveLength(10);
    expect(text()).toContain('Page 2 of 2');
    expect(new URLSearchParams(window.location.search).get('principalsSearchPage')).toBe('2');
    const record = container.querySelector<HTMLAnchorElement>('.lb-table a')!;
    expect(new URL(record.href).searchParams.get('from')).toBe(
      window.location.pathname + window.location.search,
    );
    const lobbyistsTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent?.startsWith('Lobbyists'),
    )!;
    await act(async () => lobbyistsTab.click());
    await settle();
    expect(text()).toContain('Page 1 of 2');
    await act(async () => container.querySelector<HTMLAnchorElement>('.lb-back a')!.click());
    await settle();
    expect(container.querySelectorAll('.lb-tr:not(.lb-head)')).toHaveLength(10);
    expect(document.activeElement).toBe(container.querySelector('.lb-heading-line h2'));
    // A copied or browser-restored full-list address carries its own view and scope.
    await act(async () => {
      window.history.replaceState(null, '', fullAddress);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await settle();
    expect(container.querySelectorAll('.lb-tr:not(.lb-head)')).toHaveLength(50);
    await act(async () => button('Clear search')!.click());
    await settle();
    expect(document.activeElement).toBe(container.querySelector('#lob-name'));
    const restored = new URLSearchParams(window.location.search);
    expect(restored.get('tab')).toBe('principals');
    expect(restored.get('year')).toBe('2024');
    expect(restored.get('sort')).toBe('spending_asc');
    expect(restored.get('page')).toBe('2');
    expect(restored.has('q')).toBe(false);
    expect(restored.has('view')).toBe(false);
    expect(text()).toContain('Page 2 of 2');
  });

  it('keeps a newly selected default year visible after its read fails', async () => {
    await render(
      '/lobbying?year=2024',
      (match) => <Lobbying match={match} />,
      (url) => {
        if (url.includes('/summary')) return json(SUMMARY);
        if (url.includes('/lobbying/principals?')) return json(principalsPage());
        if (url.includes('/lobbying/lobbyists?'))
          return url.includes('year=2024')
            ? json(lobbyistsPage({ donations: { ...lobbyistsPage().donations!, year: 2024 } }))
            : new Response('', { status: 500 });
        return null;
      },
    );
    const year = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Contribution year'),
    )!;
    await act(async () => year.click());
    await act(async () => button('2025')!.click());
    await settle();
    expect(text()).toContain('Contribution year: 2025');
    expect(container.querySelector('.lb-head')?.textContent).toContain(
      'Campaign contributions in 2024',
    );
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('keeps search years independent and restores the original browsing year when cleared', async () => {
    await render(
      '/lobbying?tab=principals&year=2024&q=energy',
      (match) => <Lobbying match={match} />,
      (url) => {
        if (url.includes('/summary')) return json(SUMMARY);
        const params = new URL(url).searchParams;
        if (url.includes('/lobbying/lobbyists?'))
          return json(
            lobbyistsPage({
              q: params.get('q') ?? '',
              donations: {
                ...lobbyistsPage().donations!,
                year: Number(params.get('year') ?? 2025),
              },
            }),
          );
        if (url.includes('/lobbying/principals?'))
          return json({
            ...principalsPage(),
            q: params.get('q') ?? '',
            year: Number(params.get('year') ?? 2025),
            years: [2025, 2024],
          });
        return null;
      },
    );
    const year = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Contribution year'),
    )!;
    await act(async () => year.click());
    await act(async () => button('2024')!.click());
    await settle();
    let params = new URLSearchParams(window.location.search);
    expect(params.get('lobbyistsSearchYear')).toBe('2024');
    expect(params.get('year')).toBe('2024');
    const spending = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Spending year'),
    )!;
    await act(async () => spending.click());
    await act(async () => button('2025')!.click());
    await settle();
    expect(container.querySelector('section[aria-label="Lobbyists"]')?.textContent).toContain(
      'Campaign contributions in 2024',
    );
    expect(
      container.querySelector('section[aria-label="Who lobbyists represent"]')?.textContent,
    ).toContain('Reported lobbying spending in 2025');
    await act(async () => button('Clear search')!.click());
    await settle();
    params = new URLSearchParams(window.location.search);
    expect(params.get('year')).toBe('2024');
    expect(params.has('lobbyistsSearchYear')).toBe(false);
    expect(params.has('principalsSearchYear')).toBe(false);
    expect(text()).toContain('Spending year: 2024');
  });

  it('shows a busy search until both groups settle, and does not repeat an unchanged submission', async () => {
    let answerPrincipals!: (response: Response) => void;
    await render(
      '/lobbying?q=energy',
      (match) => <Lobbying match={match} />,
      (url) => {
        if (url.includes('/summary')) return json(SUMMARY);
        if (url.includes('/lobbying/lobbyists?')) return json(lobbyistsPage({ q: 'energy' }));
        if (url.includes('/lobbying/principals?'))
          return new Promise<Response>((resolve) => {
            answerPrincipals = resolve;
          });
        return null;
      },
    );
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.getAttribute('aria-label')).toBe('Searching');
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(text()).toContain('Aafedt, David M');
    const before = requests.length;
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(requests).toHaveLength(before);
    await act(async () => answerPrincipals(json(principalsPage({ q: 'energy' }))));
    await settle();
    expect(submit.getAttribute('aria-label')).toBe('Search');
    expect(submit.hasAttribute('aria-disabled')).toBe(false);
    expect(container.querySelectorAll('.lb-count')).toHaveLength(0);
    expect(
      container.querySelector(
        'section[aria-label="Who lobbyists represent"] .lb-second .lb-phone-only',
      )?.textContent,
    ).toBe('State entity ID\u00a0');
  });

  it('adds history when entering and clearing search but replaces subsequent query edits', async () => {
    await render(
      '/lobbying?tab=principals&year=2024',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage()),
        () => json(principalsPage()),
      ),
    );
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    const input = container.querySelector<HTMLInputElement>('#lob-name')!;
    async function submit(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        container
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
      await settle();
    }
    try {
      await submit('energy');
      expect(push).toHaveBeenCalledTimes(1);
      const afterFirst = replace.mock.calls.length;
      await submit('energy two');
      expect(push).toHaveBeenCalledTimes(1);
      expect(replace.mock.calls.length).toBe(afterFirst + 1);
      await act(async () => button('Clear search')!.click());
      await settle();
      expect(push).toHaveBeenCalledTimes(2);
      await act(async () => {
        const back = new Promise<void>((resolve) =>
          window.addEventListener('popstate', () => resolve(), { once: true }),
        );
        window.history.back();
        await back;
      });
      await settle();
      expect(new URLSearchParams(window.location.search).get('q')).toBe('energy two');
      expect(input.value).toBe('energy two');
      expect(new URLSearchParams(window.location.search).get('year')).toBe('2024');
    } finally {
      push.mockRestore();
      replace.mockRestore();
    }
  });

  it('labels a valid empty represented group and refuses unavailable groups without inventing zero', async () => {
    await render(
      '/lobbying?q=person',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage({ q: 'person' })),
        () =>
          json(
            principalsPage({
              state: 'not_reported',
              q: 'person',
              total: 0,
              has_more: false,
              principals: [],
            }),
          ),
      ),
    );
    const represented = container.querySelector('section[aria-label="Who lobbyists represent"]')!;
    expect(represented.querySelector('h3')?.textContent).toBe('Who lobbyists represent (0)');
    expect(represented.textContent).toContain('No matches');
    expect(represented.querySelector('.lb-controls')).toBeNull();
    expect(represented.querySelector('[role="table"]')).toBeNull();
    expect(text()).toContain('Aafedt, David M');
  });

  it('shows retry for unavailable search responses instead of blank or empty groups', async () => {
    await render(
      '/lobbying?q=person',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () =>
          json(lobbyistsPage({ state: 'unavailable', q: 'person', total: null, lobbyists: [] })),
        () =>
          json(principalsPage({ state: 'unavailable', q: 'person', total: null, principals: [] })),
      ),
    );
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(text()).not.toContain('No matches');
    expect(text()).not.toContain('(0)');
    expect(container.querySelector('button[type="submit"]')?.getAttribute('aria-label')).toBe(
      'Search',
    );
  });

  it('builds its reads and labels from the address', () => {
    expect(tabFromParam('principals')).toBe('principals');
    expect(tabFromParam('other')).toBe('lobbyists');
    expect(pageFromParam('3')).toBe(3);
    expect(pageFromParam('-2')).toBe(1);
    expect(pageCount(1673)).toBe(34);
    expect(pageCount(null)).toBe(1);
    expect(sortFromParam('lobbyists', 'spending_desc')).toBe('name');
    expect(sortFromParam('principals', '')).toBe('spending_desc');
    expect(yearFromParam('lobbyists', '2014')).toBe('');
    expect(yearFromParam('lobbyists', '2024')).toBe('2024');
    expect(yearFromParam('principals', 'abcd')).toBe('');
    expect(yearFromParam('principals', '2008')).toBe('');
    expect(yearFromParam('principals', '2009')).toBe('2009');
    expect(listPath('lobbyists', 'kozak', 2)).toBe(
      'finance/lobbying/lobbyists?q=kozak&sort=name&limit=50&offset=50',
    );
    expect(listPath('lobbyists', '', 1, '2024', 'donations_asc')).toBe(
      'finance/lobbying/lobbyists?sort=donations_asc&year=2024&limit=50&offset=0',
    );
    expect(listPath('principals', '', 1, '', 'name')).toBe(
      'finance/lobbying/principals?limit=50&offset=0',
    );
    expect(countPath('principals')).toBe('finance/lobbying/principals?limit=1');
    expect(principalsNote(null, null)).toBe(
      'Includes names from past years; listing does not establish current representation',
    );
    const row = lobbyistsPage().lobbyists[0];
    expect(
      lobbyistContributions({
        ...row,
        donation_state: 'reported',
        donation_amount: '0',
      }),
    ).toBe('$0');
    expect(lobbyistContributions({ ...row, donation_state: 'no_records' })).toBe(
      'No matching contribution records',
    );
    expect(lobbyistContributions({ ...row, donation_state: undefined })).toBe('Amount unavailable');
  });
});

// ---------- Lobbyist ----------

describe('Lobbyist record', () => {
  const ANSWER =
    (record: LobbyingLobbyist | null, status = 200) =>
    (url: string) =>
      url.includes('/lobbying/lobbyists/')
        ? record
          ? json(record)
          : new Response('', { status })
        : null;

  it('shows the registration, the organisations listed and matched contribution records', async () => {
    await render(
      '/lobbying/lobbyists/141?from=%2Flobbying',
      (match) => <Lobbyist match={match} />,
      ANSWER(lobbyist()),
    );
    expect(requests).toContain(`${API}/api/v1/lobbying/lobbyists/141`);
    expect(container.querySelector('.f-back')?.textContent).toBe('Back to Lobbying');
    expect(container.querySelector('h1')?.textContent).toBe('Kozak, Andrew');
    expect(text()).toContain('LOBBYIST');
    // The dot ends the registration's line, so a wrapped status never starts with it.
    expect(container.querySelector('.lb-reg')?.textContent).toBe('Registration number 141\u00a0·');
    expect(container.querySelector('.lb-status')?.textContent).toBe('Registered on the copy date');

    // Organisations: the spending file's name, the listed spelling noted, unlinked without spending.
    const orgLinks = [...container.querySelectorAll<HTMLAnchorElement>('.lb-row-link')];
    expect(orgLinks.map((a) => a.getAttribute('href'))).toEqual([
      '/lobbying/principals/2263?from=%2Flobbying%2Flobbyists%2F141%3Ffrom%3D%252Flobbying',
    ]);
    expect(orgLinks[0].textContent).toContain('American Express');
    expect(orgLinks[0].textContent).toContain(
      'State entity ID 2263 · registered as American Express Co in the lobbyist list',
    );
    expect(text()).toContain('No spending page available');

    expect(text()).toContain(
      'The lobbyist list shows which organizations this lobbyist represented on the copy date',
    );
    expect(container.querySelector('.lb-note-flush')?.textContent).toBe(
      'It does not show past clients',
    );

    // Contributions: 5 shown of 7, grouped by filing year and committee; a committee's
    // total adds all its records under the shared rule, withheld for a missing amount.
    expect(container.querySelector('#contributions h2')?.textContent).toBe(
      'Campaign contribution records matched to this lobbyist',
    );
    expect(text()).toContain('Campaign contributions, separate from lobbying spending');
    expect(text()).toContain('7 matching records · showing 5');
    expect(text()).toContain('1 committee · 4 payment records');
    expect(text()).toContain('DFL House Caucus');
    expect(text()).toContain('Oct 8, 2026');
    expect(text()).toContain('$100');
    expect(text()).toContain('Date not given in the public file');
    expect(text()).toContain('Amount not given');
    expect(text()).toContain('Donated goods or services · Food');
    expect(text()).toContain('Filed as Kozak, Andrew V');
    expect(text()).toContain('Identity confirmed in an official report');
    expect(container.querySelectorAll('.lbl-pay')).toHaveLength(5);
    const totals = [...container.querySelectorAll('.lbl-committee-total')].map(
      (t) => t.textContent,
    );
    expect(totals).toEqual(['Missing payment amount', '$600']);
    expect(text()).not.toContain('$225');
    // A record's committee opens on its Lobbyists tab for that year and printed name;
    // Back to Lobbyist returns to this page's contributions for that year.
    const committee = container.querySelector<HTMLAnchorElement>('a.lbl-committee-name');
    const href = new URL(committee!.getAttribute('href')!, 'https://finance.test');
    expect(href.pathname).toBe('/money/committees/20006');
    expect([...href.searchParams.entries()]).toEqual([
      ['year', '2026'],
      ['tab', 'lobbyists'],
      ['name', 'Kozak, Andrew V'],
      ['from', '/lobbying/lobbyists/141?from=%2Flobbying&year=2026#contributions'],
    ]);
    expect(container.querySelector('.lbl-end-note')?.textContent).toBe(
      'Years follow the state file’s filing year. A payment date can fall in a different calendar year. Records are matched using registration numbers in the contribution file or confirmed in official reports; a name alone is not enough. The count is of matching records, not a confirmed count of separate donations. These records may not capture all giving.',
    );

    await act(async () => button('Show 2 more payment records')!.click());
    expect(container.querySelectorAll('.lbl-pay')).toHaveLength(7);
    expect(text()).toContain('7 matching records');
    expect(button('Show 2 more payment records')).toBeUndefined();

    expect(text()).toContain('Lobbyist registration list copied Oct 29, 2026');
    expect(text()).toContain('Campaign contribution file copied Oct 29, 2026');
    expect(text()).not.toContain('Campaign contribution file copied Oct 29, 2026.');
    expect(text()).toContain('View the Board’s Lobbyist Search Tool');
    expect(text()).not.toMatch(/illustrative|example|sample|fixture|demo/i);
  });

  it('opens a payment’s source evidence, titled payer to recipient', async () => {
    await render(
      '/lobbying/lobbyists/141',
      (match) => <Lobbyist match={match} />,
      ANSWER(lobbyist()),
    );
    // Opened with no earlier page: the drawn named fallback.
    const back = container.querySelector<HTMLAnchorElement>('.f-back');
    expect(back?.textContent).toBe('Back to Lobbying');
    expect(back?.getAttribute('href')).toBe('/lobbying');
    const view = [...container.querySelectorAll('button')].filter(
      (b) => b.textContent === 'View source',
    );
    await act(async () => view[0].click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Kozak, Andrew V to DFL House Caucus');
    expect(dialog?.textContent).toContain('Contributions file');
    expect(dialog?.textContent).toContain('Copy of Oct 29, 2026');
    expect(dialog?.textContent).not.toContain('605481');
    expect(dialog?.textContent).toContain('Not checked');
    expect(dialog?.querySelector('a')?.getAttribute('href')).toBe(
      'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/party-unit/20006/2026/',
    );
  });

  it('shows a confirmed identity only when Finance holds one', async () => {
    await render(
      '/lobbying/lobbyists/141',
      (match) => <Lobbyist match={match} />,
      ANSWER(lobbyist()),
      {
        identity: { id: 'p-1', kind: 'person', name: 'Andrew Kozak' },
        confirmation: {},
      },
    );
    expect(
      requests.some((url) =>
        url.endsWith('finance/identities/lookup?record_kind=lobbyist&record_key=141'),
      ),
    ).toBe(true);
    const box = container.querySelector('[aria-label="Confirmed identity"]');
    expect(box?.textContent).toContain('CONFIRMED IDENTITY');
    expect(box?.textContent).toContain('Andrew Kozak');
    expect(box?.querySelector('a')?.getAttribute('href')).toBe(
      '/people/p-1?from=%2Flobbying%2Flobbyists%2F141',
    );
  });

  it('keeps a failed contribution file apart from no records', async () => {
    const failed = lobbyist();
    failed.contributions = {
      ...failed.contributions,
      state: 'unavailable',
      payment_count: null,
      committee_count: null,
      years: [],
    };
    await render('/lobbying/lobbyists/141', (match) => <Lobbyist match={match} />, ANSWER(failed));
    expect(text()).toContain(
      'Couldn’t load the state’s campaign contribution file. This does not mean no donation was filed under this registration number.',
    );
    expect(text()).not.toContain('No contribution records match');
    expect(text()).not.toContain('Campaign contribution file copied');
  });

  it('says no records match without claiming no giving, and no organisations when none are listed', async () => {
    const empty = lobbyist();
    empty.principals = { state: 'reported', total: 0, rows: [] };
    empty.contributions = {
      ...empty.contributions,
      state: 'not_reported',
      payment_count: 0,
      committee_count: 0,
      years: [],
    };
    await render('/lobbying/lobbyists/141', (match) => <Lobbyist match={match} />, ANSWER(empty));
    expect(text()).toContain(
      'No contribution records match this registration number in our source. This does not mean no giving.',
    );
    expect(text()).toContain(
      'The lobbyist list names no organization for this lobbyist on the copy date',
    );
    expect(text()).not.toContain('on the copy date.');
    expect(container.querySelector('.lb-note-flush')).toBeNull();
  });

  it('keeps a registration off the copied list that still has contribution records', async () => {
    const gone = lobbyist({
      state: 'not_registered_today',
      name: null,
      formatted_name: null,
    });
    gone.principals = { state: 'not_registered_today', total: 0, rows: [] };
    await render('/lobbying/lobbyists/141', (match) => <Lobbyist match={match} />, ANSWER(gone));
    expect(container.querySelector('h1')?.textContent).toBe('Registration number 141');
    expect(container.querySelector('.lb-status')?.textContent).toBe('Not listed on the copy date');
    expect(text()).toContain('7 matching records');
  });

  it('answers not found for an unknown or malformed registration', async () => {
    const unknown = lobbyist({
      state: 'not_registered_today',
      name: null,
      formatted_name: null,
    });
    unknown.principals = { state: 'not_registered_today', total: 0, rows: [] };
    unknown.contributions = {
      ...unknown.contributions,
      state: 'not_reported',
      payment_count: 0,
      years: [],
    };
    await render(
      '/lobbying/lobbyists/999999',
      (match) => <Lobbyist match={match} />,
      ANSWER({ ...unknown, registration_number: '999999' }),
    );
    // The not-found line is the page's heading, not an alert.
    expect(container.querySelector('h1')?.textContent).toBe(
      'No lobbying record was found for 999999',
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(button('Try again')).toBeUndefined();

    act(() => root.unmount());
    root = createRoot(container);
    requests = [];
    await render(
      '/lobbying/lobbyists/abc',
      (match) => <Lobbyist match={match} />,
      () => null,
    );
    expect(text()).toContain('No lobbying record was found for abc');
    expect(requests.filter((url) => url.includes('/lobbying/'))).toEqual([]);
  });

  it('says a failed load says nothing about what was reported', async () => {
    await render(
      '/lobbying/lobbyists/141',
      (match) => <Lobbyist match={match} />,
      ANSWER(null, 500),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Couldn’t load the Board’s lobbying record. This says nothing about what was reported.',
    );
    expect(text()).not.toContain('just now');
    expect(button('Try again')).toBeDefined();
  });

  it('opens at the asked-for year’s records with focus on the contributions heading', async () => {
    window.history.replaceState(null, '', '/');
    await render(
      '/lobbying/lobbyists/141?year=2025&from=%2Flobbying#contributions',
      (match) => <Lobbyist match={match} />,
      ANSWER(lobbyist()),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    // The 2025 rows come after 2026's 4, so all 7 are shown at once.
    expect(container.querySelectorAll('.lbl-pay')).toHaveLength(7);
    expect(container.querySelector('#yr-2025')).not.toBeNull();
    expect(document.activeElement?.id).toBe('lbl-gave');
    expect(window.scrollTo).toHaveBeenCalled();
  });

  it('labels payments, status, totals and the revealed rows', () => {
    expect(notFoundLine('12')).toBe('No lobbying record was found for 12');
    expect(
      contributionsReturn('/lobbying/lobbyists/141', '?year=2024&from=%2Flobbying', 2025),
    ).toBe('/lobbying/lobbyists/141?year=2025&from=%2Flobbying#contributions');
    expect(contributionsReturn('/lobbying/lobbyists/141', '', null)).toBe(
      '/lobbying/lobbyists/141#contributions',
    );
    const years = lobbyist().contributions.years;
    expect(firstShown(years, '')).toBe(5);
    expect(firstShown(years, '2026')).toBe(5);
    expect(firstShown(years, '2025')).toBe(9);
    const committee = years[1].committees[0];
    expect(committeeTotal(committee, 2025)).toBe('$600');
    // A refund keeps its sign; a verified zero is $0.
    const refund = {
      ...committee,
      payment_count: 2,
      payments: [payment(1, '-150.0000', '2025-01-01'), payment(2, '150.0000', '2025-01-02')],
    };
    expect(committeeTotal(refund, 2025)).toBe('$0');
    expect(committeeTotal(years[0].committees[0], 2026)).toBe('Missing payment amount');
    // No filing year and a payment without a date: the period is incomplete.
    const undated = {
      ...committee,
      payment_count: 1,
      payments: [payment(3, '20.0000', null)],
    };
    expect(committeeTotal(undated, null)).toBe('Reporting period incomplete');
    expect(committeeTotal(undated, 2025)).toBe('$20');
    // A committee served with fewer rows than its count never shows a partial sum.
    expect(committeeTotal({ ...committee, payment_count: 4 }, 2025)).toBe('Missing payment amount');
    expect(registrationStatus('reported')).toBe('Registered on the copy date');
    expect(registrationStatus('not_registered_today')).toBe('Not listed on the copy date');
    expect(paymentKind(payment(1, '5', null))).toBe('Contribution');
    expect(paymentKind(payment(1, '5', null, { in_kind: 'Yes' }))).toBe(
      'Donated goods or services',
    );
    const five = revealed(years, 5);
    expect(five.map((item) => item.committees.map((c) => c.payments.length))).toEqual([[4], [1]]);
    // Whole counts stay with the year and committee.
    expect(five[1].year.payment_count).toBe(3);
    expect(revealed(years, 0)).toEqual([]);
  });
});

// ---------- Principal ----------

describe('Principal record', () => {
  const ANSWER =
    (record: LobbyingPrincipal | null, status = 200) =>
    (url: string) =>
      url.includes('/lobbying/principals/')
        ? record
          ? json(record)
          : new Response('', { status })
        : null;

  it('opens on the chart of annual totals, with gaps for years with no report held', async () => {
    const record = principal();
    record.spending.rows = [
      record.spending.rows[0],
      {
        ...record.spending.rows[1],
        year: 2022,
        total_spent: null,
        record_number: 1,
      },
    ];
    await render(
      '/lobbying/principals/8450',
      (match) => <Principal match={match} />,
      ANSWER(record),
    );
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('.f-chart h3')?.textContent).toBe(
      'Total reported spending, by year',
    );
    const bars = [...container.querySelectorAll('.f-bar-row')].map((row) => row.textContent);
    expect(bars).toEqual([
      '2025$4,501',
      '2024No spending report held',
      '2023No spending report held',
      '2022Not reported',
    ]);
    expect(container.querySelectorAll('.f-bar-fill')).toHaveLength(1);
    expect(container.querySelectorAll('[data-gap]')).toHaveLength(2);
    const chart = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Table')!;
    expect(chart.getAttribute('aria-pressed')).toBe('false');
    await act(async () => chart.click());
    expect(window.location.search).toBe('?spendView=table');
    expect(container.querySelector('table')).not.toBeNull();
    // The notes follow the view as 1 group, "Reports are due" first.
    const notes = [...container.querySelectorAll('.lbp-notes li')].map((li) => li.textContent);
    expect(notes[0]).toBe('Reports are due the following March.');
    expect(notes.every((note) => note?.endsWith('.'))).toBe(true);
  });

  it('prints each year’s reported figures as filed and the lobbyists listed', async () => {
    await render(
      '/lobbying/principals/8450?spendView=table',
      (match) => <Principal match={match} />,
      ANSWER(principal()),
      {
        identity: {
          id: 'org-1',
          kind: 'organization',
          name: 'Health Association',
        },
      },
    );
    expect(requests).toContain(`${API}/api/v1/lobbying/principals/8450`);
    expect(container.querySelector('h1')?.textContent).toBe('Health Association');
    expect(text()).toContain('PRINCIPAL');
    expect(text()).toContain('State entity ID 8450');
    expect(text()).toContain(
      'A principal is a person or organization that funds lobbying and must report its spending under Minnesota law',
    );
    expect(text()).toContain(
      'Each row is 1 calendar year of this principal’s reported lobbying spending',
    );
    const heads = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(heads).toEqual([
      'YEAR',
      'TOTAL',
      'GENERAL',
      'LEGISLATIVE',
      'ADMINISTRATIVE',
      'METROPOLITAN',
      'PUC',
    ]);
    const first = [...container.querySelectorAll('tbody tr')[0].children].map((c) => c.textContent);
    expect(first).toEqual(['2025', '$4,501', '$0', '$4,501', '$0', 'Not reported', '$0']);
    const second = [...container.querySelectorAll('tbody tr')[1].children].map(
      (c) => c.textContent,
    );
    expect(second[1]).toBe('$1,200');
    // No figure is added across years.
    expect(text()).not.toContain('$5,701');
    expect(text()).toContain('“Not reported” means the file leaves the value blank.');

    const box = container.querySelector('[aria-label="Confirmed identity"]');
    expect(box?.textContent).toContain('Organization profile');
    expect(box?.querySelector('a')?.getAttribute('href')).toBe(
      '/organizations/org-1?from=%2Flobbying%2Fprincipals%2F8450%3FspendView%3Dtable',
    );

    const lobbyists = [...container.querySelectorAll<HTMLAnchorElement>('.lb-row-link')];
    expect(lobbyists).toHaveLength(1);
    expect(lobbyists[0].getAttribute('href')).toBe(
      '/lobbying/lobbyists/5245?from=%2Flobbying%2Fprincipals%2F8450%3FspendView%3Dtable',
    );
    expect(lobbyists[0].textContent).toContain('Registration number\u00a05245');
    expect(text()).toContain('Registered as Health Assn in the lobbyist list');
    expect(text()).toContain(
      'The lobbyist list shows who was registered for this principal in records copied Oct 29, 2026',
    );
    expect(text()).not.toContain('copied Oct 29, 2026.It');
    expect(container.querySelector('.lb-note-flush')?.textContent).toBe(
      'It does not show who represented it in earlier spending years',
    );
    const sources = [...container.querySelectorAll('.f-sources p')].map((p) => p.textContent);
    expect(sources).toEqual([
      'Lobbying spending figures come from the Minnesota Campaign Finance and Public Disclosure Board.',
      'Lobbying records copied Oct 29, 2026. The copy date is when Alethical obtained the source, not the end date of every filing.',
    ]);
    expect(text()).toContain('View the Board’s Lobbying Organizations Search Tool');
    expect(text()).not.toMatch(/illustrative|example|sample|fixture|demo/i);
  });

  it('keeps failed spending rows and a failed lobbyist list apart from empty ones', async () => {
    await render(
      '/lobbying/principals/8450',
      (match) => <Principal match={match} />,
      ANSWER(
        principal({
          spending: { state: 'unavailable', rows: [] },
          lobbyists: { state: 'unavailable', total: null, rows: [] },
        }),
      ),
    );
    expect(text()).toContain(
      'Couldn’t load this principal’s spending rows. This says nothing about what was reported.',
    );
    expect(text()).toContain(
      'Couldn’t load the Board’s lobbyist list. This does not mean nobody was listed for this principal.',
    );
    expect(text()).not.toContain('names no lobbyist');
    expect(container.querySelector('table')).toBeNull();
  });

  it('says when no lobbyist is listed, and leaves the blank-value note out when none is blank', async () => {
    const record = principal({
      lobbyists: { state: 'not_reported', total: 0, rows: [] },
    });
    record.spending.rows = [record.spending.rows[1]];
    await render(
      '/lobbying/principals/8450',
      (match) => <Principal match={match} />,
      ANSWER(record),
    );
    expect(text()).toContain(
      'The lobbyist list names no lobbyist for this principal on the copy date',
    );
    expect(text()).not.toContain('“Not reported” means');
  });

  it('answers not found for an ID with no spending rows, and fails honestly', async () => {
    await render(
      '/lobbying/principals/8887',
      (match) => <Principal match={match} />,
      ANSWER(principal({ entity_id: 8887, state: 'no_spending_rows', name: null })),
    );
    // The not-found line is the page's heading, not an alert.
    expect(container.querySelector('h1')?.textContent).toBe(
      'No lobbying record was found for 8887',
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    await render(
      '/lobbying/principals/8450',
      (match) => <Principal match={match} />,
      ANSWER(null, 500),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Couldn’t load the Board’s lobbying record. This says nothing about what was reported.',
    );
  });

  describe('Media buys card', () => {
    const CONNECTIONS = '/finance/media-buys/connections';
    const ROW = {
      key: 'kmsp-7',
      name: 'contract.pdf',
      label: 'contract.pdf',
      station: 'KMSP-TV',
      year: 2026,
      category: 'Local',
      kind: 'Contract',
      uploaded_at: '2026-03-30',
      version_id: 'c'.repeat(64),
      version_count: 1,
      source_changed: false,
    };
    const connections = (answer: () => Response) => (url: string) =>
      url.includes(CONNECTIONS) ? answer() : ANSWER(principal())(url);
    const card = () => container.querySelector('.mb-buys-card');
    const reads = () =>
      requests.map((url) => new URL(url)).filter((url) => url.pathname.endsWith(CONNECTIONS));

    it('reads the files connected to this entity number, under the page’s sections', async () => {
      await render(
        '/lobbying/principals/8450',
        (match) => <Principal match={match} />,
        connections(() =>
          json({
            agency_key: null,
            exact_name_count: 0,
            files: [ROW],
            total: 1,
            groups: [
              {
                label: '',
                files: [{ ...ROW, role: 'Advertiser, as printed' }],
              },
            ],
          }),
        ),
      );
      expect(reads().map((url) => [...url.searchParams])).toEqual([
        [
          ['kind', 'principal'],
          ['target', '8450'],
        ],
      ]);
      expect(card()?.parentElement?.className).toBe('mb-buys-after');
      expect(card()?.parentElement?.previousElementSibling?.className).toBe('lb-main');
      expect(card()?.textContent).toContain('KMSP-TV contract ·');
      expect(card()?.textContent).toContain('Advertiser, as printed');
      expect(card()?.querySelector('a')?.getAttribute('href')).toBe(
        `/media-buys/files/kmsp-7?version=${'c'.repeat(64)}&from=%2Flobbying%2Fprincipals%2F8450`,
      );
    });

    it('says no file is connected to the principal by name', async () => {
      await render(
        '/lobbying/principals/8450',
        (match) => <Principal match={match} />,
        connections(() =>
          json({
            agency_key: null,
            exact_name_count: 0,
            files: [],
            total: 0,
            groups: [],
          }),
        ),
      );
      expect(card()?.textContent).toContain(
        'No TV station files have a checked connection to Health Association',
      );
    });

    it('says the files could not be loaded, with Try again', async () => {
      await render(
        '/lobbying/principals/8450',
        (match) => <Principal match={match} />,
        connections(() => new Response('', { status: 500 })),
      );
      expect(card()?.textContent).toContain('Couldn’t load TV station files');
      expect(card()?.textContent).toContain('Try again');
      expect(card()?.textContent).not.toContain('problem on our side');
    });

    it('is left off while the TV station file page is off', async () => {
      const real = routes.isBuilt;
      const spy = vi
        .spyOn(routes, 'isBuilt')
        .mockImplementation((name) => name !== 'station-file' && real(name));
      await render(
        '/lobbying/principals/8450',
        (match) => <Principal match={match} />,
        ANSWER(principal()),
      );
      expect(container.querySelector('h1')?.textContent).toBe('Health Association');
      expect(card()).toBeNull();
      expect(reads()).toHaveLength(0);
      spy.mockRestore();
    });
  });

  it('formats figures and lists each lobbyist once', () => {
    expect(spendingFigure('0.0000')).toBe('$0');
    expect(spendingFigure(null)).toBe('Not reported');
    expect(spendingFigure('188500.0000')).toBe('$188,500');
    expect(distinctLobbyists(principal().lobbyists.rows)).toHaveLength(1);
    expect(lobbyistsScope(null)).toBe(
      'The lobbyist list shows who was registered for this principal in the copied records',
    );
    const rows = principal().spending.rows;
    expect(spendingBars([])).toEqual([]);
    // 2 filed rows for 1 year have no single total to draw.
    const twice = spendingBars([rows[0], { ...rows[0], record_number: 9 }]);
    expect(twice).toEqual([
      {
        key: '2025',
        label: '2025',
        amount: null,
        value: 'Amount unavailable: more than one report',
      },
    ]);
    // A filed zero is printed as $0 with no bar.
    expect(spendingBars([{ ...rows[0], total_spent: '0.0000' }])[0]).toMatchObject({
      amount: 0,
      value: '$0',
    });
    expect(recordNumber('141')).toBe('141');
    expect(recordNumber('0')).toBeNull();
    expect(recordNumber('012')).toBeNull();
    expect(recordNumber('abc')).toBeNull();
  });
});
