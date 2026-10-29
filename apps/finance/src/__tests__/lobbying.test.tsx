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
  pageCount,
  pageFromParam,
  principalsNote,
  tabFromParam,
} from '../pages/Lobbying';
import { Lobbyist, paymentKind, registrationStatus, revealed } from '../pages/Lobbyist';
import { Principal, distinctLobbyists, spendingFigure } from '../pages/Principal';
import { recordNumber } from '../pages/lobbying/parts';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.example.test';
const COPIED = '2026-10-29T11:20:32Z';
const SOURCES = { expenditures: null, lobbyists: null };

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
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
      },
    ],
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
                payment(605481, '100.0000', '2026-10-08', { contributor_name: 'Kozak, Andrew V' }),
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
  it('lists registered lobbyists by name, with marks, counts and sources', async () => {
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
    expect(list).toBe(`${API}/api/v1/lobbying/lobbyists?sort=name&limit=50&offset=0`);
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(['Lobbyists1,673', 'Principals3,448']);
    expect(text()).toContain('Showing 1–2 of 1,673 registered lobbyists');
    expect(text()).toContain('Registration 1733');
    expect(text()).toContain('8 clients listed');
    expect(text()).toContain('1 client listed');
    const link = container.querySelector<HTMLAnchorElement>('[role="cell"] a');
    expect(link?.textContent).toBe('Aafedt, David M');
    expect(link?.getAttribute('href')).toBe('/lobbying/lobbyists/1733?from=%2Flobbying');
    expect(container.querySelector('[role="cell"] .f-mark-person')).not.toBeNull();
    expect(text()).toContain('Sort by: Name A–Z');
    expect(text()).toContain('Page 1 of 34');
    expect(text()).toContain('The spending records shown here begin in 2014.');
    expect(text()).toContain('Lobbying records copied Oct 29, 2026');
    expect(text()).toContain('View Minnesota’s lobbying source files');
    // Lobbyists carry no list note; the copy date is said once, at the bottom.
    expect(container.querySelector('.lb-list-note')).toBeNull();
    expect(text()).not.toMatch(/illustrative|example|sample|fixture|demo/i);
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
    const list = requests.find((url) => url.includes('/lobbying/principals?limit=50'));
    expect(list).toBe(`${API}/api/v1/lobbying/principals?limit=50&offset=0`);
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain('Principals');
    expect(text()).toContain('Showing 1–2 of 3,448 principals');
    const links = [...container.querySelectorAll<HTMLAnchorElement>('[role="cell"] a')];
    expect(links.map((a) => a.textContent)).toEqual(['100%']);
    expect(links[0].getAttribute('href')).toBe(
      '/lobbying/principals/8450?from=%2Flobbying%3Ftab%3Dprincipals',
    );
    expect(text()).toContain('AMP Robotics Corporation');
    expect(text()).toContain('Entity ID 8887');
    expect(text()).toContain('No spending page available');
    expect(text()).toContain('LATEST SPENDING YEAR');
    expect(container.querySelector('.lb-list-note')?.textContent).toBe(
      'This directory includes organisations from different reporting years and the lobbyist list copied Oct 29, 2026. Some organisations have no spending page because the Board’s spending file has no rows for them through 2025.',
    );
  });

  it('searches the open tab on the server and says when nothing matches', async () => {
    await render(
      '/lobbying?q=zzzz',
      (match) => <Lobbying match={match} />,
      directoryAnswer(
        () => json(lobbyistsPage({ lobbyists: [], total: 0, has_more: false, q: 'zzzz' })),
        () => json(principalsPage()),
      ),
    );
    expect(requests.some((url) => url.includes('lobbyists?q=zzzz&sort=name'))).toBe(true);
    expect(text()).toContain('0 registered lobbyists');
    expect(text()).toContain('No lobbyist is listed under that spelling in these records');
    expect(text()).toContain(
      'Names are matched as filed, and spellings vary between filings; try a shorter part of the name',
    );
    // A search needs the whole directory's count from its own read.
    expect(requests.some((url) => url.endsWith('lobbyists?sort=name&limit=1'))).toBe(true);
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
      'We couldn’t load the Board’s lobbyist list just now. This says nothing about who was listed.',
    );
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
        () => json(principalsPage({ state: 'unavailable', total: null, principals: [] })),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'We couldn’t load the Board’s principal records just now.',
    );
    expect(text()).not.toContain('No principal matches');
  });

  it('builds its reads and notes from the address', () => {
    expect(tabFromParam('principals')).toBe('principals');
    expect(tabFromParam('other')).toBe('lobbyists');
    expect(pageFromParam('3')).toBe(3);
    expect(pageFromParam('-2')).toBe(1);
    expect(pageCount(1673)).toBe(34);
    expect(pageCount(null)).toBe(1);
    expect(listPath('lobbyists', 'kozak', 2)).toBe(
      'lobbying/lobbyists?q=kozak&sort=name&limit=50&offset=50',
    );
    expect(listPath('principals', '', 1)).toBe('lobbying/principals?limit=50&offset=0');
    expect(countPath('principals')).toBe('lobbying/principals?limit=1');
    expect(principalsNote(null, null)).toBe(
      'This directory includes organisations from different reporting years and the lobbyist list. Some organisations have no spending page because the Board’s spending file has no rows for them.',
    );
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
    expect(text()).toContain('Registration 141');
    expect(text()).toContain('· Registered on the copy date');

    // Organisations: the spending file's name, the listed spelling noted, unlinked without spending.
    const orgLinks = [...container.querySelectorAll<HTMLAnchorElement>('.lb-row-link')];
    expect(orgLinks.map((a) => a.getAttribute('href'))).toEqual([
      '/lobbying/principals/2263?from=%2Flobbying%2Flobbyists%2F141%3Ffrom%3D%252Flobbying',
    ]);
    expect(orgLinks[0].textContent).toContain('American Express');
    expect(orgLinks[0].textContent).toContain(
      'Entity ID 2263 · registered as American Express Co in the lobbyist list',
    );
    expect(text()).toContain('No spending page available');

    // Contributions: 5 shown of 7, grouped by filing year and committee, no committee totals.
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
    expect(text()).not.toContain('$225');
    expect(text()).not.toContain('$600');
    const committee = container.querySelector<HTMLAnchorElement>('a.lbl-committee-name');
    expect(committee?.getAttribute('href')).toBe(
      '/money/committees/20006?year=2026&tab=lobbyists&from=%2Flobbying%2Flobbyists%2F141%3Ffrom%3D%252Flobbying',
    );

    await act(async () => button('Show 2 more payment records')!.click());
    expect(container.querySelectorAll('.lbl-pay')).toHaveLength(7);
    expect(text()).toContain('7 matching records');
    expect(button('Show 2 more payment records')).toBeUndefined();

    expect(text()).toContain('Lobbyist registration list copied Oct 29, 2026');
    expect(text()).toContain('Campaign contribution file copied Oct 29, 2026.');
    expect(text()).toContain('View the Board’s Lobbyist Search Tool');
    expect(text()).not.toMatch(/illustrative|example|sample|fixture|demo/i);
  });

  it('opens a payment’s source evidence, titled payer to recipient', async () => {
    await render(
      '/lobbying/lobbyists/141',
      (match) => <Lobbyist match={match} />,
      ANSWER(lobbyist()),
    );
    expect(container.querySelector('.f-back')).toBeNull();
    const view = [...container.querySelectorAll('button')].filter(
      (b) => b.textContent === 'View source',
    );
    await act(async () => view[0].click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Kozak, Andrew V to DFL House Caucus');
    expect(dialog?.textContent).toContain('Contributions file');
    expect(dialog?.textContent).toContain('Copy of Oct 29, 2026');
    expect(dialog?.textContent).toContain('605481');
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
      { identity: { id: 'p-1', kind: 'person', name: 'Andrew Kozak' }, confirmation: {} },
    );
    expect(
      requests.some((url) =>
        url.endsWith('finance/identities/lookup?record_kind=lobbyist&record_key=141'),
      ),
    ).toBe(true);
    const box = container.querySelector('[aria-label="Confirmed identity"]');
    expect(box?.textContent).toContain('CONFIRMED IDENTITY');
    expect(box?.textContent).toContain('Andrew Kozak');
    // Person profiles are not built yet: no link and no profile claim.
    expect(box?.querySelector('a')).toBeNull();
    expect(box?.textContent).not.toContain('Person profile');
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
      'We couldn’t load the state’s campaign contribution file. This does not mean no donation was filed under this registration number.',
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
      'The lobbyist list names no organisation for this lobbyist on the copy date.',
    );
  });

  it('keeps a registration off the copied list that still has contribution records', async () => {
    const gone = lobbyist({ state: 'not_registered_today', name: null, formatted_name: null });
    gone.principals = { state: 'not_registered_today', total: 0, rows: [] };
    await render('/lobbying/lobbyists/141', (match) => <Lobbyist match={match} />, ANSWER(gone));
    expect(container.querySelector('h1')?.textContent).toBe('Registration 141');
    expect(text()).toContain('· Not listed on the copy date');
    expect(text()).toContain('7 matching records');
  });

  it('answers not found for an unknown or malformed registration', async () => {
    const unknown = lobbyist({ state: 'not_registered_today', name: null, formatted_name: null });
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
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'No lobbying record was found for 999999.',
    );
    expect(button('Try again')).toBeUndefined();

    act(() => root.unmount());
    root = createRoot(container);
    requests = [];
    await render(
      '/lobbying/lobbyists/abc',
      (match) => <Lobbyist match={match} />,
      () => null,
    );
    expect(text()).toContain('No lobbying record was found for abc.');
    expect(requests.filter((url) => url.includes('/lobbying/'))).toEqual([]);
  });

  it('says a failed load says nothing about what was reported', async () => {
    await render(
      '/lobbying/lobbyists/141',
      (match) => <Lobbyist match={match} />,
      ANSWER(null, 500),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'We couldn’t load the Board’s lobbying record just now. This says nothing about what was reported.',
    );
    expect(button('Try again')).toBeDefined();
  });

  it('labels payments, status and the revealed rows', () => {
    expect(registrationStatus('reported')).toBe('Registered on the copy date');
    expect(registrationStatus('not_registered_today')).toBe('Not listed on the copy date');
    expect(paymentKind(payment(1, '5', null))).toBe('Contribution');
    expect(paymentKind(payment(1, '5', null, { in_kind: 'Yes' }))).toBe(
      'Donated goods or services',
    );
    const years = lobbyist().contributions.years;
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

  it('prints each year’s reported figures as filed and the lobbyists listed', async () => {
    await render(
      '/lobbying/principals/8450',
      (match) => <Principal match={match} />,
      ANSWER(principal()),
      { identity: { id: 'org-1', kind: 'organization', name: 'Health Association' } },
    );
    expect(requests).toContain(`${API}/api/v1/lobbying/principals/8450`);
    expect(container.querySelector('h1')?.textContent).toBe('Health Association');
    expect(text()).toContain('PRINCIPAL');
    expect(text()).toContain('Entity ID 8450');
    expect(text()).toContain(
      'A principal is a person or organisation that funds lobbying and must report its spending under Minnesota law',
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
      '/organizations/org-1?from=%2Flobbying%2Fprincipals%2F8450',
    );

    const lobbyists = [...container.querySelectorAll<HTMLAnchorElement>('.lb-row-link')];
    expect(lobbyists).toHaveLength(1);
    expect(lobbyists[0].getAttribute('href')).toBe(
      '/lobbying/lobbyists/5245?from=%2Flobbying%2Fprincipals%2F8450',
    );
    expect(lobbyists[0].textContent).toContain('Registration 5245');
    expect(text()).toContain('Registered as Health Assn in the lobbyist list');
    expect(text()).toContain(
      'The lobbyist list shows who was registered for this principal in records copied Oct 29, 2026.',
    );
    expect(text()).toContain(
      'Lobbying records copied Oct 29, 2026. The copy date is when Alethical obtained the source, not the end date of every filing.',
    );
    expect(text()).toContain('View the Board’s Lobbying Organizations Search Tool');
    expect(text()).not.toMatch(/media buys|illustrative|example|sample|fixture|demo/i);
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
      'We couldn’t load this principal’s spending rows. This says nothing about what was reported.',
    );
    expect(text()).toContain(
      'We couldn’t load the Board’s lobbyist list. This does not mean nobody was listed for this principal.',
    );
    expect(text()).not.toContain('names no lobbyist');
    expect(container.querySelector('table')).toBeNull();
  });

  it('says when no lobbyist is listed, and leaves the blank-value note out when none is blank', async () => {
    const record = principal({ lobbyists: { state: 'not_reported', total: 0, rows: [] } });
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
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'No lobbying record was found for 8887.',
    );

    act(() => root.unmount());
    root = createRoot(container);
    await render(
      '/lobbying/principals/8450',
      (match) => <Principal match={match} />,
      ANSWER(null, 500),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'We couldn’t load the Board’s lobbying record just now.',
    );
  });

  it('formats figures and lists each lobbyist once', () => {
    expect(spendingFigure('0.0000')).toBe('$0');
    expect(spendingFigure(null)).toBe('Not reported');
    expect(spendingFigure('188500.0000')).toBe('$188,500');
    expect(distinctLobbyists(principal().lobbyists.rows)).toHaveLength(1);
    expect(recordNumber('141')).toBe('141');
    expect(recordNumber('0')).toBeNull();
    expect(recordNumber('012')).toBeNull();
    expect(recordNumber('abc')).toBeNull();
  });
});
