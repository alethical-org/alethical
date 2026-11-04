import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import {
  clearOutsideSpending,
  contestAnchor,
  contestHeading,
  electionLine,
  groupAmountText,
  MoneyByRace,
  moneyByRaceHref,
  officeOfAnchor,
  outsideBar,
  outsideGroups,
  paymentDates,
  positionAsFiled,
  raceSources,
  seatPart,
  type OutsideRow,
} from '../pages/MoneyByRace';
import * as routes from '../routes';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.example.test';

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

const OFFICES = [
  { office: 'House', committee_count: 478 },
  { office: 'Senate', committee_count: 233 },
  { office: 'Governor', committee_count: 29 },
];

function committee(
  registration: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    registration_number: registration,
    name,
    is_closed: false,
    termination_date: null,
    reported_total: '10700.0000',
    reported_through: '2026-07-20',
    reported_period_start: '2026-01-01',
    named: {
      state: 'reported',
      total: '10075.0000',
      payments: 24,
      first_payment_on: '2026-01-16',
      last_payment_on: '2026-10-16',
    },
    ...overrides,
  };
}

function races(overrides: Record<string, unknown> = {}) {
  return {
    state: 'reported',
    ordered_by: 'district_then_name',
    year: 2026,
    office: 'House',
    offices: OFFICES,
    committee_count: 780,
    contest_count: 2,
    contests: [
      {
        office: 'House',
        district: '1A',
        anchor: 'house-1a',
        committee_count: 2,
        periods_differ: false,
        committees: [
          committee('18558', 'Burkel, John House Committee'),
          committee('19469', 'Sandahl, Leanna Kristine House Committee', {
            reported_total: null,
            reported_through: null,
            reported_period_start: null,
            named: {
              state: 'not_reported',
              total: null,
              payments: null,
              first_payment_on: null,
              last_payment_on: null,
            },
          }),
        ],
      },
      {
        office: 'House',
        district: '1B',
        anchor: 'house-1b',
        committee_count: 1,
        periods_differ: true,
        committees: [committee('19503', 'Compeau, Jennifer House Committee')],
      },
    ],
    as_of: '2026-10-28',
    fetched_at: '2026-10-29T06:49:45Z',
    ...overrides,
  };
}

function row(overrides: Partial<OutsideRow> = {}): OutsideRow {
  return {
    spender: 'Excellence Minnesota',
    spender_registration_number: '41395',
    spender_linkable: true,
    about_committee_name: 'Burkel, John House Committee',
    about_committee_registration_number: '18558',
    direction: 'For',
    paid_on: '2026-03-31',
    amount: '1000.0000',
    record_number: 1,
    ...overrides,
  };
}

function outsidePage(rows: OutsideRow[], state = 'reported') {
  return {
    state,
    rows,
    page: {
      number: 1,
      size: 50,
      has_more: false,
      total_rows: state === 'reported' ? rows.length : null,
    },
    release_id: 'release-1',
    fetched_at: '2026-10-29T06:50:13Z',
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  clearReadCache();
  clearOutsideSpending();
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
  vi.useRealTimers();
});

type Answer = (url: string) => Response | Promise<Response>;

async function settle() {
  for (let index = 0; index < 4; index += 1) {
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
      if (input.includes('/campaign-finance/summary')) return json(SUMMARY);
      return answer(input);
    }),
  );
  const match = matchRoute(path.split('?')[0])!;
  await act(async () => {
    root.render(<MoneyByRace match={match} />);
  });
  await settle();
}

/** Races from `races()`, and the outside rows each committee's read answers. */
function answers(outside: Record<string, OutsideRow[] | 'fail'> = {}, raceBody = races()) {
  return (url: string) => {
    if (url.includes('/campaign-finance/races')) return json(raceBody);
    if (url.includes('/campaign-finance/outside-spending')) {
      const about = new URL(url).searchParams.get('about') ?? '';
      const rows = outside[about];
      if (rows === 'fail') return new Response('nope', { status: 500 });
      return json(rows ? outsidePage(rows) : outsidePage([], 'not_reported'));
    }
    return new Response('unexpected', { status: 500 });
  };
}

describe('Money by race helpers', () => {
  it('builds the server’s contest anchor and finds its office', () => {
    expect(contestAnchor('House', '12A')).toBe('house-12a');
    expect(contestAnchor('Governor', null)).toBe('governor');
    expect(contestAnchor('District Court', '2-14')).toBe('district-court-2-14');
    const offices = ['House', 'Supreme Court', 'District Court', 'Governor'];
    expect(officeOfAnchor('house-12a', offices)).toBe('House');
    expect(officeOfAnchor('district-court-2-14', offices)).toBe('District Court');
    expect(officeOfAnchor('governor', offices)).toBe('Governor');
    expect(officeOfAnchor('mayor-1', offices)).toBeNull();
    expect(moneyByRaceHref('House', '34A', 2024)).toBe('/money/races/house-34a?year=2024');
  });

  it('names a district option without its office', () => {
    expect(seatPart({ office: 'House', district: '1A' })).toBe('District 1A');
    expect(seatPart({ office: 'Governor', district: null })).toBe('Statewide');
    expect(seatPart({ office: 'Supreme Court', district: 'Chief' })).toBe('Chief justice');
    expect(seatPart({ office: 'District Court', district: '2-14' })).toBe('District 2 · Seat 14');
  });

  it('states the position as filed and the payment dates', () => {
    expect(positionAsFiled('For', 'Burkel Committee')).toBe('For Burkel Committee');
    expect(positionAsFiled('Against', 'Burkel Committee')).toBe('Against Burkel Committee');
    expect(positionAsFiled(null, 'Burkel Committee')).toBe(
      'Position not stated · Burkel Committee',
    );
    expect(paymentDates(['2025-10-09', '2025-10-02'])).toBe('Oct 2, 2025 to Oct 9, 2025');
    expect(paymentDates(['2025-10-21'])).toBe('Oct 21, 2025');
    expect(paymentDates([null])).toBe('Date not given in the public file');
  });

  it('sums each spender’s payments about each committee and never across committees', () => {
    const groups = outsideGroups(
      [
        row({ amount: '40000.0000', paid_on: '2025-10-09' }),
        row({ amount: '12148.5000', paid_on: '2025-10-02' }),
        row({
          about_committee_registration_number: '19469',
          about_committee_name: 'Sandahl Committee',
          direction: 'Against',
          amount: '500.0000',
        }),
        row({ spender: 'Alpha Fund', spender_registration_number: null, amount: null }),
      ],
      ['18558', '19469'],
    );
    expect(groups.map((group) => [group.spender, group.aboutRegistration, group.amount])).toEqual([
      ['Alpha Fund', '18558', null],
      ['Excellence Minnesota', '18558', '52148.5000'],
      ['Excellence Minnesota', '19469', '500.0000'],
    ]);
    expect(groups[1].dates).toBe('Oct 2, 2025 to Oct 9, 2025');
    expect(groups[1].recordYear).toBe('2025');
    expect(groups[2].direction).toBe('Against');
    expect(groupAmountText(groups[0])).toBe('Missing payment amount');
  });

  it('applies the shared total rule and draws each net on its own side', () => {
    const [undated] = outsideGroups(
      [row({ paid_on: null, amount: '100.0000' }), row({ amount: '50.0000' })],
      ['18558'],
    );
    expect(undated.state).toBe('period-incomplete');
    expect(groupAmountText(undated)).toBe('Reporting period incomplete');
    expect(outsideBar(undated).amount).toBeNull();
    const [nothingDated] = outsideGroups([row({ paid_on: null })], ['18558']);
    expect(nothingDated.recordYear).toBeNull();

    const [refund] = outsideGroups(
      [row({ direction: 'Against', amount: '-1500.0000' })],
      ['18558'],
    );
    // The side comes from the filed position; a negative net draws no bar.
    expect(outsideBar(refund)).toEqual({
      side: 'against',
      amount: 0,
      value: '\u2212$1,500',
      negative: true,
    });
    const [against] = outsideGroups([row({ direction: 'Against', amount: '500.0000' })], ['18558']);
    expect(outsideBar(against)).toMatchObject({ side: 'against', amount: 500 });
    const [forRow] = outsideGroups([row({ amount: '500.0000' })], ['18558']);
    expect(outsideBar(forRow)).toMatchObject({ side: 'for', amount: 500 });
    expect(contestHeading({ office: 'House', district: '1A' }, 2026)).toBe(
      'State\u00a0Representative\u00a0· District\u00a01A\u00a0·\u00a02026',
    );
  });

  it('titles each state office from its code and keeps the seat label for the rest', () => {
    const nb = (text: string) => text.replace(/\u00a0/g, ' ');
    expect(nb(contestHeading({ office: 'Senate', district: '41' }, 2026))).toBe(
      'State Senator · District 41 · 2026',
    );
    expect(nb(contestHeading({ office: 'Governor', district: null }, 2026))).toBe(
      'Governor · Statewide · 2026',
    );
    expect(nb(contestHeading({ office: 'Attorney General', district: null }, 2026))).toBe(
      'Attorney General · Statewide · 2026',
    );
    // Courts, and any office code the table does not know, keep the shipped form.
    expect(nb(contestHeading({ office: 'District Court', district: '2-14' }, 2026))).toBe(
      'District Court · District 2 · Seat 14 · 2026',
    );
    expect(nb(contestHeading({ office: 'Soil and Water', district: '3' }, 2026))).toBe(
      'Soil and Water · 3 · 2026',
    );
  });

  it('dates the sources from the served copy dates only', () => {
    expect(raceSources(null, '2026-10-28')).toEqual([]);
    expect(raceSources(SUMMARY, null)[0].items).toEqual([
      'Minnesota’s payment files copied Oct 9, 2026; report totals copied Oct 28, 2026. These are copy dates, not reporting periods.',
    ]);
  });
});

describe('Money by race page', () => {
  it('shows each committee’s own figures and dates, and outside spending apart', async () => {
    await render(
      '/money/races/house-1a',
      answers({
        '18558': [
          row({ amount: '1000.0000', paid_on: '2026-03-31' }),
          row({ amount: '1000.5000', paid_on: '2026-04-02' }),
        ],
      }),
    );
    const text = container.textContent ?? '';
    expect(container.querySelector('h1')?.textContent).toBe('Money by race');
    expect(requests).toContain(`${API}/api/v1/campaign-finance/races?year=2026&office=House`);
    expect(container.querySelector('h2')?.textContent).toBe(
      'State\u00a0Representative\u00a0· District\u00a01A\u00a0·\u00a02026',
    );
    // The caveat joins the end note, so it ends with a period there.
    expect(container.querySelector('.mr-end-note')?.textContent).toContain(
      'Totals are not added across committees. These records do not confirm who is on the ballot.',
    );
    expect(text).not.toContain('The reported totals in this group cover different periods');

    const link = container.querySelector<HTMLAnchorElement>(
      '[aria-label="Candidate committees"] a',
    );
    expect(link?.textContent).toBe('Burkel, John House Committee');
    expect(link?.getAttribute('href')).toBe(
      '/money/committees/18558?year=2026&from=%2Fmoney%2Fraces%2Fhouse-1a',
    );
    expect(text).toContain('Registration 18558');
    expect(text).toContain('$10,700');
    expect(text).toContain('Figures for Jan\u00a01,\u00a02026 to Jul\u00a020,\u00a02026');
    expect(text).toContain('$10,075');
    expect(text).toContain('Payments dated Jan\u00a016,\u00a02026 to Oct\u00a016,\u00a02026');
    expect(text).toContain('No usable official total in our records for 2026');
    expect(text).toContain('No itemized contributions in our records for 2026');
    expect(text).toContain('Totals are not added across committees.');

    // Chart is the default view: a labelled list, For to the right.
    const chart = container.querySelector('ul[aria-label="Spending by outside groups"]');
    expect(chart?.querySelector('.f-split-position')?.textContent).toBe(
      'For Burkel, John House Committee',
    );
    expect(chart?.textContent).toContain('$2,000');
    expect(chart?.textContent).toContain(
      'Payments dated Mar\u00a031,\u00a02026 to Apr\u00a02,\u00a02026',
    );
    expect(chart?.querySelector('a')?.getAttribute('href')).toBe(
      '/money/committees/41395?tab=independent&year=2026&from=%2Fmoney%2Fraces%2Fhouse-1a',
    );
    // A For spender's bar is drawn on the For half.
    expect(chart?.querySelector<HTMLElement>('.f-split-for .f-split-fill')?.style.width).toBe(
      '100%',
    );
    expect(chart?.querySelector<HTMLElement>('.f-split-against .f-split-fill')?.style.width).toBe(
      '0%',
    );
    expect(
      container.querySelector('[role="table"][aria-label="Spending by outside groups"]'),
    ).toBeNull();
    expect(text).toContain('Independent expenditures for this contest');
    expect(text).not.toContain('Independent expenditures file');

    const table = [...container.querySelectorAll('[aria-label="View"] button')].find(
      (item) => item.textContent === 'Table',
    ) as HTMLButtonElement;
    await act(async () => table.click());
    expect(window.location.search).toBe('?osView=table');
    const outside = container.querySelector(
      '[role="table"][aria-label="Spending by outside groups"]',
    );
    expect(outside?.textContent).toContain('For Burkel, John House Committee');
    expect(outside?.textContent).toContain('$2,000');
    expect(outside?.textContent).toContain('Mar 31, 2026 to Apr 2, 2026');
    expect(outside?.querySelector('a')?.getAttribute('href')).toBe(
      '/money/committees/41395?tab=independent&year=2026&from=%2Fmoney%2Fraces%2Fhouse-1a%3FosView%3Dtable',
    );
    expect(text).toContain(
      'Minnesota’s payment files copied Oct 9, 2026; report totals copied Oct 28, 2026.',
    );
    // 1 outside-spending read per committee in the contest, never a combined one.
    const outsideReads = requests.filter((url) => url.includes('/outside-spending'));
    expect(outsideReads).toHaveLength(2);
    expect(outsideReads.every((url) => url.includes('year=2026'))).toBe(true);
  });

  it('links a spender to its own payment year, and to no year when undated', async () => {
    await render(
      '/money/races/house-1a?year=2026',
      answers({
        '18558': [
          row({ paid_on: '2025-10-02', amount: '40.0000' }),
          row({
            spender: 'Undated Fund',
            spender_registration_number: '50001',
            paid_on: null,
            amount: '-75.0000',
          }),
        ],
      }),
    );
    const links = [
      ...container.querySelectorAll<HTMLAnchorElement>(
        'ul[aria-label="Spending by outside groups"] a',
      ),
    ].map((link) => link.getAttribute('href'));
    expect(links).toEqual([
      '/money/committees/41395?tab=independent&year=2025&from=%2Fmoney%2Fraces%2Fhouse-1a%3Fyear%3D2026',
      '/money/committees/50001?tab=independent&from=%2Fmoney%2Fraces%2Fhouse-1a%3Fyear%3D2026',
    ]);
    // An undated row withholds the total; no bar is drawn for it.
    expect(container.textContent).toContain('Reporting period incomplete');
  });

  it('labels the 3 menus with the current choices', async () => {
    await render('/money/races/house-1a?year=2024', answers());
    const buttons = [...container.querySelectorAll('.mr-field-button')].map(
      (button) => button.textContent,
    );
    expect(buttons).toEqual(['State Representative', 'District 1A', '2024']);
    expect(requests).toContain(`${API}/api/v1/campaign-finance/races?year=2024&office=House`);
  });

  it('opens the District menu and moves to another contest', async () => {
    await render('/money/races/house-1a', answers());
    const district = container.querySelectorAll<HTMLButtonElement>('.mr-field-button')[1];
    await act(async () => district.click());
    const options = [...container.querySelectorAll('[role="option"]')].map(
      (item) => item.textContent,
    );
    expect(options).toEqual(['District 1A', 'District 1B']);
    expect(district.getAttribute('aria-expanded')).toBe('true');
    const other = container.querySelectorAll<HTMLButtonElement>('[role="option"] button')[1];
    await act(async () => other.click());
    expect(window.location.pathname).toBe('/money/races/house-1b');
  });

  it('says when a contest’s reported totals cover different periods', async () => {
    await render('/money/races/house-1b', answers());
    expect(container.textContent).toContain(
      'The reported totals in this group cover different periods. Each total shows its own dates.',
    );
  });

  it('says no outside spending is named without claiming none was made', async () => {
    await render('/money/races/house-1a', answers());
    expect(container.textContent).toContain(
      'No independent expenditure names this contest in the file for 2026. This does not mean none was made.',
    );
    expect(container.querySelector('[aria-label="Spending by outside groups"]')).toBeNull();
    expect(container.querySelector('[aria-label="View"]')).toBeNull();
  });

  it('fails the outside section on its own, with Try again', async () => {
    await render('/money/races/house-1a', answers({ '19469': 'fail' }));
    expect(container.textContent).toContain('We couldn’t load spending by outside groups.');
    expect(container.querySelector('[aria-label="Candidate committees"]')).not.toBeNull();
  });

  it('shows the failed load with Try again, never an empty race', async () => {
    await render('/money/races/house-1a', () => new Response('down', { status: 500 }));
    const text = container.textContent ?? '';
    expect(text).toContain(
      'We couldn’t load this race. This is a problem on our side and says nothing about what was filed.',
    );
    expect(text).toContain('Try again');
    expect(text).not.toContain('No registered candidate committee');
  });

  it('treats an unavailable register as a failed load', async () => {
    await render(
      '/money/races/house-1a',
      answers({}, races({ state: 'unavailable', contests: [] })),
    );
    expect(container.textContent).toContain('We couldn’t load this race.');
  });

  it('says no committee is held for a contest the register does not list', async () => {
    await render('/money/races/house-99z', answers());
    const text = container.textContent ?? '';
    expect(text).toContain('No registered candidate committee held');
    expect(container.querySelectorAll('.mr-field-button')[1].textContent).toBe('Not held');
    expect(requests.some((url) => url.includes('/outside-spending'))).toBe(false);
  });

  it('opens an office’s first district when the address names only the office', async () => {
    await render('/money/races/house?year=2026', answers());
    expect(window.location.pathname).toBe('/money/races/house-1a');
    expect(window.location.search).toBe('?year=2026');
  });

  const withElection = (election: unknown) =>
    races({
      contests: races().contests.map((contest, i) =>
        i === 0 ? { ...contest, election } : contest,
      ),
    });

  it('prints the served election beside the contest, as drawn', async () => {
    await render(
      '/money/races/house-1a',
      answers({}, withElection({ stage: 'general', date: '2026-11-03' })),
    );
    expect(container.querySelector('.mr-contest-stage')?.textContent).toBe(
      'General election · Nov 3, 2026',
    );
  });

  it('prints no election line when the race carries none', async () => {
    await render('/money/races/house-1a', answers({}, withElection(null)));
    expect(container.querySelector('.mr-contest-stage')).toBeNull();
    expect(container.textContent).not.toContain('election ·');
  });

  it('names a special election by its own stage', async () => {
    await render(
      '/money/races/house-1a',
      answers({}, withElection({ stage: 'special', date: '2026-02-10' })),
    );
    expect(container.querySelector('.mr-contest-stage')?.textContent).toBe(
      'Special election · Feb 10, 2026',
    );
  });

  it('never guesses a stage or a date', () => {
    expect(electionLine({ stage: 'primary', date: '2026-08-11' })).toBe(
      'Primary election · Aug 11, 2026',
    );
    expect(electionLine({ stage: 'runoff', date: '2026-11-03' })).toBeNull();
    expect(electionLine({ stage: 'general', date: null })).toBeNull();
    expect(electionLine({ stage: 'general', date: 'soon' })).toBeNull();
    expect(electionLine({ stage: null, date: '2026-11-03' })).toBeNull();
    expect(electionLine(null)).toBeNull();
    expect(electionLine(undefined)).toBeNull();
  });

  it('shows Loading while the race is read', async () => {
    await render('/money/races/house-1a', () => new Promise<Response>(() => {}));
    expect(container.textContent).toContain('Loading…');
    expect(container.querySelector('[role="table"]')).toBeNull();
  });

  async function chooseYear(value: string) {
    const year = container.querySelectorAll<HTMLButtonElement>('.mr-field-button')[2];
    await act(async () => year.click());
    const option = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="option"] button'),
    ].find((item) => item.textContent === value)!;
    await act(async () => option.click());
    await settle();
  }

  const RACES_2024 = races({
    year: 2024,
    contests: [
      {
        office: 'House',
        district: '1A',
        anchor: 'house-1a',
        committee_count: 1,
        periods_differ: false,
        committees: [
          committee('18558', 'Burkel, John House Committee', {
            reported_total: '5000.0000',
            reported_through: '2024-07-22',
            reported_period_start: '2024-01-01',
          }),
        ],
      },
    ],
  });

  it('keeps the last figures, dimmed and under their own year, while another year loads', async () => {
    await render('/money/races/house-1a', (url) =>
      url.includes('year=2024') && url.includes('/races')
        ? new Promise<Response>(() => {})
        : answers()(url),
    );
    await chooseYear('2024');
    expect(window.location.search).toBe('?year=2024');
    expect(container.querySelectorAll('.mr-field-button')).toHaveLength(3);
    expect(container.querySelectorAll('.mr-field-button')[2].textContent).toBe('2024');
    // Never blank: the 2026 figures stay, labelled 2026, with an Updating status.
    expect(container.textContent).not.toContain('Loading…');
    expect(container.textContent).toContain('$10,700');
    expect(container.querySelector('.mr-contest-title')?.textContent).toContain('2026');
    const status = container.querySelector('.mr-status [role="status"]');
    expect(status?.textContent).toContain('Updating results…');
    const results = container.querySelector('.mr-results')!;
    expect(results.hasAttribute('data-stale')).toBe(true);
    expect(results.getAttribute('aria-busy')).toBe('true');
    // The outside section stays on the year its figures belong to.
    expect(requests.some((url) => url.includes('/outside-spending') && url.includes('2024'))).toBe(
      false,
    );
  });

  it('names the shown district, never "Not held", while another office loads', async () => {
    await render('/money/races/house-1a', (url) =>
      url.includes('office=Senate') && url.includes('/races')
        ? new Promise<Response>(() => {})
        : answers()(url),
    );
    const office = container.querySelectorAll<HTMLButtonElement>('.mr-field-button')[0];
    await act(async () => office.click());
    const option = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="option"] button'),
    ].find((item) => item.textContent === 'State Senator')!;
    await act(async () => option.click());
    await settle();
    // The test mounts the page itself, so it follows the address the menu set.
    const next = matchRoute(window.location.pathname)!;
    await act(async () => {
      root.render(<MoneyByRace match={next} />);
    });
    await settle();
    expect(window.location.pathname).toBe('/money/races/senate');
    expect(container.textContent).toContain('$10,700');
    expect(container.querySelectorAll('.mr-field-button')[1].textContent).toBe('District 1A');
  });

  it('keeps the last figures with a notice and Try again when another year fails', async () => {
    let fail = true;
    await render('/money/races/house-1a', (url) => {
      if (url.includes('year=2024') && url.includes('/races')) {
        return fail ? new Response('down', { status: 500 }) : json(RACES_2024);
      }
      return answers()(url);
    });
    await chooseYear('2024');
    const alert = container.querySelector('.mr-status [role="alert"]');
    expect(alert?.textContent).toContain('We couldn’t update these results');
    expect(container.textContent).toContain('$10,700');
    expect(container.querySelector('.mr-contest-title')?.textContent).toContain('2026');
    expect(container.querySelector('.mr-results')?.hasAttribute('data-stale')).toBe(false);
    expect(container.textContent).not.toContain('We couldn’t load this race.');
    fail = false;
    await act(async () => alert!.querySelector<HTMLButtonElement>('button')!.click());
    await settle();
    expect(container.querySelector('.mr-status [role="alert"]')).toBeNull();
    expect(container.textContent).toContain('$5,000');
    expect(container.textContent).not.toContain('$10,700');
    expect(container.querySelector('.mr-contest-title')?.textContent).toContain('2024');
  });

  it('keeps the last figures when another year answers unavailable', async () => {
    await render('/money/races/house-1a', (url) =>
      url.includes('year=2024') && url.includes('/races')
        ? json(races({ year: 2024, state: 'unavailable', contests: [] }))
        : answers()(url),
    );
    await chooseYear('2024');
    expect(container.querySelector('.mr-status [role="alert"]')?.textContent).toContain(
      'We couldn’t update these results',
    );
    expect(container.textContent).toContain('$10,700');
  });
});

describe('Money by race page, return link', () => {
  it('falls back to Campaign money when opened with no usable earlier page', async () => {
    await render('/money/races/house-1a?from=%2F%2Fexample.test', answers());
    const back = container.querySelector<HTMLAnchorElement>('.f-back');
    expect(back?.textContent).toBe('Back to Campaign money');
    expect(back?.getAttribute('href')).toBe('/money');
  });

  it('keeps the named fallback when the race cannot be read', async () => {
    await render('/money/races/house-1a', () => new Response('down', { status: 500 }));
    expect(container.querySelector('.f-back')?.textContent).toBe('Back to Campaign money');
  });

  it('returns to the earlier page when the address names one', async () => {
    await render('/money/races/house-1a?from=%2Fmoney%2Fcommittees%2F18558', answers());
    const back = container.querySelector<HTMLAnchorElement>('.f-back');
    expect(back?.textContent).toBe('Back to Committee');
    expect(back?.getAttribute('href')).toBe('/money/committees/18558');
  });
});

describe('Money by race page, Media buys card', () => {
  const CONNECTIONS = '/finance/media-buys/connections';
  const ROW = {
    key: 'kmsp-5',
    name: 'order.pdf',
    label: 'order.pdf',
    station: 'KMSP-TV',
    year: 2026,
    category: 'Local',
    kind: 'Order',
    uploaded_at: '2026-04-09',
    version_id: 'd'.repeat(64),
    version_count: 1,
    source_changed: false,
  };
  const withConnections = (answer: () => Response) => {
    const base = answers();
    return (url: string) => (url.includes(CONNECTIONS) ? answer() : base(url));
  };
  const card = () => container.querySelector('.mb-buys-card');
  const reads = () =>
    requests.map((url) => new URL(url)).filter((url) => url.pathname.endsWith(CONNECTIONS));
  const text = () => (card()?.textContent ?? '').replace(/ /g, ' ');

  it('reads the files whose checked election names this contest, below outside spending', async () => {
    await render(
      '/money/races/house-1a?year=2026',
      withConnections(() =>
        json({
          agency_key: null,
          exact_name_count: 0,
          files: [ROW],
          total: 1,
          groups: [{ label: 'General election', files: [{ ...ROW, role: 'General election' }] }],
        }),
      ),
    );
    expect(
      reads().map((url) => [url.searchParams.get('kind'), url.searchParams.get('target')]),
    ).toEqual([['race', '{"office":"House","district":"1A","year":2026}']]);
    expect(card()?.parentElement?.className).toBe('mb-buys-after');
    expect(card()?.parentElement?.previousElementSibling?.querySelector('h3')?.textContent).toBe(
      'Spending by outside groups',
    );
    expect(card()?.querySelector('h3')).toBeNull();
    expect(text()).toContain('KMSP-TV order ·');
    expect(text()).toContain('General election');
    expect(card()?.querySelector('a')?.getAttribute('href')).toBe(
      `/media-buys/files/kmsp-5?version=${'d'.repeat(64)}&from=%2Fmoney%2Fraces%2Fhouse-1a%3Fyear%3D2026`,
    );
  });

  it('says no file is connected to the contest by its heading', async () => {
    await render(
      '/money/races/house-1a?year=2026',
      withConnections(() =>
        json({ agency_key: null, exact_name_count: 0, files: [], total: 0, groups: [] }),
      ),
    );
    expect(text()).toContain(
      'No TV station files have a checked connection to State Representative · District 1A · 2026',
    );
  });

  it('says the files could not be loaded, with Try again', async () => {
    await render(
      '/money/races/house-1a?year=2026',
      withConnections(() => new Response('down', { status: 500 })),
    );
    expect(text()).toContain('We couldn’t load these TV station files');
    expect(text()).toContain('Try again');
    expect(text()).not.toContain('problem on our side');
  });

  it('is left off while the TV station file page is off', async () => {
    const real = routes.isBuilt;
    const spy = vi
      .spyOn(routes, 'isBuilt')
      .mockImplementation((name) => name !== 'station-file' && real(name));
    await render('/money/races/house-1a?year=2026', answers());
    expect(container.querySelector('.mr-contest-title')).not.toBeNull();
    expect(card()).toBeNull();
    expect(reads()).toHaveLength(0);
    spy.mockRestore();
  });
});
