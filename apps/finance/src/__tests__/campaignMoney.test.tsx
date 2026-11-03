import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import {
  CampaignMoney,
  countLine,
  pageCount,
  pageFromParam,
  punctuateGroup,
  registerPath,
  registrationStatus,
  sourceGroups,
  tabFromParam,
  type CommitteeRegister,
} from '../pages/CampaignMoney';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.example.test';

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

function register(overrides: Partial<CommitteeRegister> = {}): CommitteeRegister {
  return {
    state: 'reported',
    kind: 'candidate_committee',
    committees: [
      {
        registration_number: '18135',
        name: 'Hortman (Melissa) Campaign Committee',
        kind: 'candidate_committee',
        sub_type: null,
        office: 'House',
        district: '34B',
        is_closed: false,
        termination_date: null,
      },
    ],
    page: { limit: 50, offset: 0, has_more: false, total: 1 },
    register_total: 1607,
    by_kind: { candidate_committee: 762, party_unit: 299, political_committee_or_fund: 546 },
    as_of: '2026-10-28',
    reason: null,
    ...overrides,
  };
}

const SUMMARY = {
  freshness: {
    payment_copied_at: {
      contributions: '2026-10-09T21:05:10Z',
      expenditures: '2026-10-09T21:05:10Z',
      independent_expenditures: '2026-10-09T21:05:10Z',
    },
    register_fetched_at: '2026-10-28T15:41:49Z',
  },
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

async function render(path: string, answer: Answer) {
  window.history.replaceState(null, '', path);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requests.push(input);
      if (input.includes('/campaign-finance/summary')) return json(SUMMARY);
      return answer(input);
    }),
  );
  const match = matchRoute('/money')!;
  await act(async () => {
    root.render(<CampaignMoney match={match} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function registerRequests() {
  return requests.filter((url) => url.includes('/campaign-finance/committees'));
}

describe('Campaign money directory', () => {
  it('sorts the full register on the server and resets paging when the order changes', async () => {
    await render('/money?page=3', () => json(register()));
    const menu = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Sort by:'),
    )!;
    await act(async () => menu.click());
    const registration = [...container.querySelectorAll('[role="option"] button')].find(
      (b) => b.textContent === 'Registration',
    )!;
    await act(async () => (registration as HTMLButtonElement).click());
    await settle();
    expect(registerRequests().at(-1)).toContain('sort=registration');
    expect(registerRequests().at(-1)).toContain('offset=0');
    expect(window.location.search).toContain('sort=registration');
    expect(window.location.search).not.toContain('page=3');
  });
  it('lists the register with counts, a committee link, a mark and its sources', async () => {
    await render('/money', () => json(register()));
    const text = container.textContent ?? '';
    expect(container.querySelector('h1')?.textContent).toBe('Campaign money');
    expect(registerRequests()[0]).toBe(
      `${API}/api/v1/campaign-finance/committees?kind=candidate_committee&limit=50&offset=0`,
    );
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(['Candidate committees762', 'Committees and funds546', 'Party units299']);
    expect(text).toContain('1 candidate committee');
    const link = container.querySelector<HTMLAnchorElement>('[role="cell"] a');
    expect(link?.textContent).toBe('Hortman (Melissa) Campaign Committee');
    expect(link?.getAttribute('href')).toBe('/money/committees/18135?from=%2Fmoney');
    expect(container.querySelector('[role="cell"] .f-mark-committee')).not.toBeNull();
    expect(text).toContain('Candidate committee');
    expect(text).toContain('18135');
    expect(text).toContain('Page 1 of 1');
    // The Sources group holds a 2-sentence line, so every line ends with a period.
    expect(text).toContain('Register copied Oct 28, 2026.');
    expect(text).toContain(
      'Minnesota’s payment files copied Oct 9,\u00a02026; report totals copied Oct 28,\u00a02026. These are copy dates, not reporting periods.',
    );
    expect(container.querySelector('#cm-about')?.textContent).toBe('About these records');
    expect(text).toContain('Campaign payment records before 2015 are not included.');
    expect(text).toContain('Open registration');
    // Money connections and Vendors and payees are off BUILT until their screens
    // are aligned with Design's current drawing, so nothing links to them.
    expect(container.querySelector('a[href^="/money/connections"]')).toBeNull();
    expect(container.querySelector('a[href^="/money/recipients"]')).toBeNull();
    // Donors by employer is entered from here (Round 29, eug-44), not from Home.
    const employers = container.querySelector('a[href^="/money/employers"]');
    expect(employers?.getAttribute('href')).toBe('/money/employers?from=%2Fmoney');
    expect(employers?.textContent).toContain('Donors by employer');
    expect(employers?.textContent).toContain(
      'Find donors by the employer name reported in their filings.',
    );
    const race = container.querySelector('a[href^="/money/races/"]');
    expect(race?.getAttribute('href')).toBe('/money/races/house?from=%2Fmoney');
    expect(race?.textContent).toContain('Money by race');
    expect(race?.textContent).toContain(
      'Candidate committees and outside spending for one office, district and year, kept distinct.',
    );
    // The shared scrolling tab row (Round 35) holds the directory tabs.
    expect(container.querySelector('.f-scroll-tabs [role="tablist"]')).not.toBeNull();
    expect(text).not.toContain('Search by name or registration number');
    expect(text).not.toMatch(/illustrative|example|sample|fixture|demo/i);
  });

  it('prints each registration’s own status from the register', async () => {
    await render('/money', () =>
      json(
        register({
          committees: [
            {
              ...register().committees[0],
              registration_number: '1',
              name: 'Closed Committee',
              is_closed: true,
              termination_date: '2026-07-28',
            },
            {
              ...register().committees[0],
              registration_number: '2',
              name: 'Closed Undated',
              is_closed: true,
              termination_date: null,
            },
            register().committees[0],
          ],
          page: { limit: 50, offset: 0, has_more: false, total: 3 },
        }),
      ),
    );
    const statuses = [...container.querySelectorAll('.cm-status')].map((cell) => cell.textContent);
    expect(statuses).toEqual(['Terminated Jul 28, 2026', 'Terminated', 'Open registration']);
    expect(
      [...container.querySelectorAll('[role="columnheader"]')].map((cell) => cell.textContent),
    ).toEqual(['NAME', 'TYPE', 'REGISTRATION', 'REGISTRATION STATUS']);
  });

  it('honours ?tab=party and ?tab=committees from Finance Home', async () => {
    await render('/money?tab=party&from=%2Fhome', () =>
      json(register({ committees: [], page: { limit: 50, offset: 0, has_more: false, total: 0 } })),
    );
    expect(registerRequests()[0]).toContain('kind=party_unit');
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain('Party units');
    expect(container.querySelector('.f-back')?.textContent).toBe('Back to Finance Home');
    act(() => root.unmount());
    root = createRoot(container);
    requests = [];
    await render('/money?tab=committees', () => json(register()));
    expect(registerRequests()[0]).toContain('kind=political_committee_or_fund');
  });

  it('searches registered names on the server and keeps payments apart', async () => {
    await render('/money?q=caucus', () => json(register()));
    expect(registerRequests()[0]).toContain('q=caucus');
    expect(container.textContent).toContain('Registered names matching “caucus” are listed below.');
    expect(container.textContent).toContain('Payments under a name');
  });

  it('pages on the server and writes the page to the address', async () => {
    await render('/money', () =>
      json(register({ page: { limit: 50, offset: 0, has_more: true, total: 120 } })),
    );
    expect(container.textContent).toContain('Page 1 of 3');
    const next = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Next')!;
    await act(async () => next.click());
    await settle();
    expect(window.location.search).toBe('?page=2');
    expect(registerRequests().at(-1)).toContain('offset=50');
  });

  it('shows No matching records with the shared next step', async () => {
    await render('/money?q=zzzz', () =>
      json(register({ committees: [], page: { limit: 50, offset: 0, has_more: false, total: 0 } })),
    );
    const text = container.textContent ?? '';
    expect(text).toContain('No matching records');
    expect(text).toContain('Try a shorter part of the name or a different spelling.');
    expect(text).toContain('0 candidate committees');
  });

  it('says a failed load is our problem and offers Try again', async () => {
    let fail = true;
    await render('/money', () => (fail ? new Response('', { status: 500 }) : json(register())));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'We couldn’t load these results. This is a problem on our side and says nothing about who is registered.',
    );
    fail = false;
    const retry = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Try again',
    )!;
    await act(async () => retry.click());
    await settle();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('Hortman (Melissa) Campaign Committee');
  });

  it('treats an unavailable register as a failure, never as nobody registered', async () => {
    await render('/money', () =>
      json(
        register({
          state: 'unavailable',
          committees: [],
          page: { limit: 50, offset: 0, has_more: false, total: null },
          by_kind: null,
          reason: 'no_filings_snapshot',
        }),
      ),
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain('No matching records');
  });

  it('keeps the last list when a later read answers unavailable', async () => {
    await render('/money', (url) =>
      url.includes('kind=party_unit')
        ? json(
            register({
              state: 'unavailable',
              committees: [],
              page: { limit: 50, offset: 0, has_more: false, total: null },
              by_kind: null,
              reason: 'no_filings_snapshot',
            }),
          )
        : json(register()),
    );
    const party = [...container.querySelectorAll('[role="tab"]')][2] as HTMLButtonElement;
    await act(async () => party.click());
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    // The outage is a failure with Try again; the earlier rows stay on screen.
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain('Hortman (Melissa) Campaign Committee');
  });

  it('keeps earlier results while updating and when an update fails', async () => {
    let release: (value: Response) => void = () => {};
    await render('/money', (url) =>
      url.includes('kind=party_unit')
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : json(register()),
    );
    const party = [...container.querySelectorAll('[role="tab"]')][2] as HTMLButtonElement;
    await act(async () => party.click());
    expect(container.textContent).toContain('Updating results…');
    expect(container.textContent).toContain('Hortman (Melissa) Campaign Committee');
    // The kept rows keep their own count noun, never the new tab's.
    expect(container.querySelector('.cm-count')?.textContent).toBe('1 candidate committee');
    await act(async () => release(new Response('', { status: 503 })));
    await settle();
    expect(container.textContent).toContain(
      'We couldn’t update these results. Previous results are shown.',
    );
    expect(container.textContent).toContain('Hortman (Melissa) Campaign Committee');
  });

  it('shows loading rows before the first answer', async () => {
    await render('/money', () => new Promise<Response>(() => {}));
    expect(container.querySelector('.f-skeleton')).not.toBeNull();
  });
});

describe('Campaign money helpers', () => {
  it('reads the address safely', () => {
    expect(tabFromParam('party')).toBe('party');
    expect(tabFromParam('nonsense')).toBe('candidates');
    expect(pageFromParam('3')).toBe(3);
    expect(pageFromParam('-2')).toBe(1);
    expect(pageFromParam('abc')).toBe(1);
  });

  it('builds the server read for a tab, name and page', () => {
    expect(registerPath('committees', 'Example Fund', 2)).toBe(
      'campaign-finance/committees?kind=political_committee_or_fund&limit=50&offset=50&q=Example+Fund',
    );
  });

  it('counts with the register nouns and never invents a count', () => {
    expect(countLine('party', 299)).toBe('299 party units');
    expect(countLine('committees', 1)).toBe('1 committee or fund');
    expect(countLine('candidates', 1234)).toBe('1,234 candidate committees');
    expect(countLine('candidates', null)).toBeNull();
    expect(pageCount(0)).toBe(1);
    expect(pageCount(101)).toBe(3);
  });

  it('leaves out a date the server did not serve', () => {
    expect(sourceGroups(null, null)).toEqual([]);
    expect(sourceGroups(register(), null)[0].items).toEqual(['Register copied Oct 28, 2026']);
    const split = sourceGroups(register(), {
      freshness: {
        payment_copied_at: {
          contributions: '2026-10-28T17:39:35Z',
          expenditures: '2026-10-09T21:05:10Z',
          independent_expenditures: null,
        },
        register_fetched_at: null,
      },
    })[0].items;
    // The report-totals line has 2 sentences, so the whole group takes periods.
    expect(split).toContain('Register copied Oct 28, 2026.');
    expect(split).toContain('Contributions file copied Oct 28,\u00a02026.');
    expect(split).toContain('Spending file copied Oct 9,\u00a02026.');
    expect(split).toContain('Outside-spending file copy date unavailable.');
  });

  it('punctuates a Sources group by its sentence count and reads a status', () => {
    expect(punctuateGroup(['Register copied Oct 28, 2026'])).toEqual([
      'Register copied Oct 28, 2026',
    ]);
    expect(punctuateGroup(['Register copied Oct 28, 2026', 'Copied. Not a period.'])).toEqual([
      'Register copied Oct 28, 2026.',
      'Copied. Not a period.',
    ]);
    expect(registrationStatus({ is_closed: null, termination_date: null })).toEqual({
      text: 'Registration status not held',
      state: 'unknown',
    });
    expect(registrationStatus({ is_closed: true, termination_date: '2026-01-02' }).text).toBe(
      'Terminated Jan 2, 2026',
    );
  });
});
