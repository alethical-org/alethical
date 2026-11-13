import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import {
  accountFigures,
  committeeMeta,
  CommitteeMembers,
  copiedLine,
  type FiguresAnswer,
  type Member,
  type MembersAnswer,
} from '../pages/CommitteeMembers';
import type { ReportFigureRow, ReportFigures } from '../pages/committee/types';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

const ID = '4299ad74-8cc1-46b0-833c-91b2a507805e';
const PATH = `/legislature/committees/${ID}/members`;
const YEAR = String(new Date().getFullYear());

function member(
  id: string,
  name: string,
  accounts: Member['campaign_accounts'],
  role: string | null = null,
): Member {
  return { id, slug: null, name, role, campaign_accounts: accounts };
}

const ACCOUNT = (reg: string, name: string, legislative = true) => ({
  registration_number: reg,
  committee_name: name,
  office: legislative ? 'House' : 'Attorney General',
  for_legislative_office: legislative,
});

const MEMBERS: MembersAnswer = {
  committee: {
    id: ID,
    name: 'Elections Finance and Government Operations',
    chamber: 'Minnesota House of Representatives',
    session: '94-2025-regular',
    members_are_current: true,
  },
  members: [
    member(
      'ben',
      'Ben Davis',
      { link_state: 'confirmed', confirmed: [ACCOUNT('18822', 'Davis, Ben House Committee')] },
      'Co-Chair',
    ),
    member('casey', 'Casey Two', {
      link_state: 'confirmed',
      confirmed: [ACCOUNT('100', 'Casey House Committee'), ACCOUNT('101', 'Casey Old Committee')],
    }),
    member('drew', 'Drew None', { link_state: 'unconfirmed', confirmed: [] }),
    member('ellis', 'Ellis Looked', { link_state: 'reviewed_none_confirmed', confirmed: [] }),
  ],
};

function figures(committees: FiguresAnswer['committees']): FiguresAnswer {
  return { year: Number(YEAR), filings_copied_at: '2026-10-28T03:18:52Z', committees };
}

const BEN = figures([{ registration_number: '18822', register_kind: 'candidate_committee' }]);
const CASEY = figures([{ registration_number: '100', register_kind: 'candidate_committee' }]);

function reportRow(overrides: Partial<ReportFigureRow> = {}): ReportFigureRow {
  return {
    record_number: 7,
    report_name: '2026 Pre-Primary Report',
    report_type: 'Pre-Primary',
    cut_off_date: '2026-07-20',
    filed_date: '2026-07-27',
    effective_amendment_index: 1,
    special_election: false,
    period_start: '2026-01-01',
    beginning_cash_balance: '12000.0000',
    beginning_balance_as_of: '2026-01-01',
    ending_balance_as_of: '2026-07-20',
    contributions: '4110.0000',
    total_expenditures: '6527.8100',
    total_disbursements: null,
    total_receipts: '4200.0000',
    ending_cash_balance: '9600.0000',
    figures_state: 'reported',
    ...overrides,
  };
}

function reports(reg: string, rows: ReportFigureRow[]): ReportFigures {
  return {
    registration_number: reg,
    year: Number(YEAR),
    state: rows.length ? 'reported' : 'not_reported',
    reports: rows,
  };
}

// Ben's account holds its pre-primary figures and an older report without them;
// Casey's first account has no receipts total and a filed zero for expenditures;
// Casey's second account has no report this year.
const REPORTS: Record<string, ReportFigures> = {
  '18822': reports('18822', [
    reportRow(),
    reportRow({ record_number: 6, report_name: 'Year-End Report', figures_state: 'unavailable' }),
  ]),
  '100': reports('100', [reportRow({ total_receipts: null, total_expenditures: '0.0000' })]),
  '101': reports('101', []),
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
    root.render(<CommitteeMembers match={matchRoute(path.split('?')[0])!} />);
  });
  await settle();
  await settle();
}

const loaded: Answer = (url) => {
  if (url.endsWith('/members')) return json(MEMBERS);
  if (url.includes('/legislators/ben/')) return json(BEN);
  if (url.includes('/legislators/casey/')) return json(CASEY);
  const reg = /\/finance\/committees\/(\d+)\/report-figures/.exec(url)?.[1];
  if (reg && REPORTS[reg]) return json(REPORTS[reg]);
  return new Response(null, { status: 500 });
};

function card(name: string): HTMLElement {
  return [...container.querySelectorAll<HTMLElement>('.cmm-card')].find((item) =>
    item.textContent?.includes(name),
  )!;
}

describe('Committee members’ campaign accounts', () => {
  it('reads the roster, then each member’s own figures 1 member at a time', async () => {
    await render(PATH, loaded);
    expect(requests[0]).toBe(
      `https://api.example.test/api/v1/finance/legislative-committees/${ID}/members`,
    );
    const figureReads = requests.filter((url) => url.includes('/campaign-finance'));
    expect(figureReads.sort()).toEqual([
      `https://api.example.test/api/v1/legislators/ben/campaign-finance?year=${YEAR}`,
      `https://api.example.test/api/v1/legislators/casey/campaign-finance?year=${YEAR}`,
    ]);
    expect(container.querySelector('h1')?.textContent).toBe(
      'Elections Finance and Government Operations',
    );
    expect(container.textContent).toContain('House · 2025–26 session · 4 members');
  });

  it('lists an officer the roster names twice once, with the role', async () => {
    // The live roster sends an officer as 2 entries with the same id: 1 without a
    // role and 1 with it.
    const [ben, ...rest] = MEMBERS.members;
    const twice = { ...MEMBERS, members: [{ ...ben, role: null }, ...rest, ben] };
    await render(PATH, (url) => (url.endsWith('/members') ? json(twice) : loaded(url)));
    expect(container.textContent).toContain('House · 2025–26 session · 4 members');
    const names = [...container.querySelectorAll('.cmm-name')].map((node) => node.textContent);
    expect(names.filter((name) => name?.includes('Ben Davis'))).toHaveLength(1);
    expect(container.textContent).toContain('Co-Chair');
  });

  it('shows all served roles and the committee-session district once per member', async () => {
    const [ben, ...rest] = MEMBERS.members;
    const roster = {
      ...MEMBERS,
      members: [
        { ...ben, role: null, roles: ['Alternate', 'Co-Chair'], district: '10A' },
        { ...ben, role: 'Co-Chair', roles: ['Co-Chair'], district: '10A' },
        ...rest,
      ],
    };
    await render(PATH, (url) => (url.endsWith('/members') ? json(roster) : loaded(url)));
    expect(card('Ben Davis').querySelector('.cmm-sub')?.textContent).toBe(
      'Alternate, Co-Chair · District 10A',
    );
    expect(container.querySelectorAll('.cmm-name')).toHaveLength(4);
    expect(card('Drew None').querySelector('.cmm-sub')).toBeNull();
  });

  it('shows a served district without inventing a role and keeps legacy single roles', async () => {
    const roster = {
      ...MEMBERS,
      members: MEMBERS.members.map((item) =>
        item.id === 'drew' ? { ...item, roles: [], district: '42' } : item,
      ),
    };
    await render(PATH, (url) => (url.endsWith('/members') ? json(roster) : loaded(url)));
    expect(card('Drew None').querySelector('.cmm-sub')?.textContent).toBe('District 42');
    expect(card('Ben Davis').querySelector('.cmm-sub')?.textContent).toBe('Co-Chair');
  });

  it('shows each account’s own filed figures, never a combined total', async () => {
    await render(PATH, loaded);
    const ben = card('Ben Davis');
    expect(ben.textContent).toContain('Co-Chair');
    expect(ben.querySelector('.f-label')?.textContent).toBe('Campaign account');
    expect(ben.querySelector('a')?.getAttribute('href')).toBe(
      `/legislators/ben?from=${encodeURIComponent(PATH)}`,
    );
    const account = ben.querySelector<HTMLAnchorElement>('.cmm-account a');
    expect(account?.getAttribute('href')).toBe(
      `/money/committees/18822?year=${YEAR}&from=${encodeURIComponent(PATH)}`,
    );
    expect(ben.textContent).toContain('Candidate committee · Registration number 18822');
    const labels = [...ben.querySelectorAll('.cmm-figure dt')].map((item) => item.textContent);
    expect(labels).toEqual(['Total receipts', 'Total expenditures', 'Ending balance']);
    expect(ben.textContent).toContain('Total receipts$4,200');
    expect(ben.textContent).toContain('Total expenditures$6,527');
    expect(ben.textContent).toContain('Ending balance$9,600');
    expect(ben.querySelector('.cmm-report')?.textContent).toBe(
      '2026 Pre-Primary Report · Amendment 1 · Jan 1, 2026 to Jul 20, 2026',
    );
    expect(requests.filter((url) => url.includes('/report-figures')).sort()).toEqual([
      `https://api.example.test/api/v1/finance/committees/100/report-figures?year=${YEAR}`,
      `https://api.example.test/api/v1/finance/committees/101/report-figures?year=${YEAR}`,
      `https://api.example.test/api/v1/finance/committees/18822/report-figures?year=${YEAR}`,
    ]);
  });

  it('keeps a missing total missing and a filed zero a zero', async () => {
    await render(PATH, loaded);
    const casey = card('Casey Two');
    expect(casey.querySelector('.f-label')?.textContent).toBe('Campaign accounts');
    expect(casey.textContent).toContain('Total receiptsReport total unavailable');
    expect(casey.querySelector('[data-missing]')?.textContent).toBe('Report total unavailable');
    expect(casey.textContent).toContain('Total expenditures$0');
    expect(casey.textContent).toContain(`No ${YEAR} report held`);
  });

  it('fails 1 account’s report figures on their own, with Try again', async () => {
    let calls = 0;
    await render(PATH, (url) => {
      if (url.includes('/committees/18822/report-figures')) {
        calls += 1;
        return calls === 1 ? new Response(null, { status: 503 }) : json(REPORTS['18822']);
      }
      return loaded(url);
    });
    const alert = card('Ben Davis').querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Couldn’t load the report information');
    expect(card('Casey Two').querySelector('[role="alert"]')).toBeNull();
    await act(async () => alert!.querySelector<HTMLButtonElement>('button')!.click());
    await settle();
    expect(card('Ben Davis').querySelector('[role="alert"]')).toBeNull();
    expect(card('Ben Davis').textContent).toContain('Total receipts$4,200');
  });

  it('gives a member with no confirmed account its own line, whatever the reason', async () => {
    await render(PATH, loaded);
    for (const name of ['Drew None', 'Ellis Looked']) {
      expect(card(name).textContent).toContain('No campaign account is confirmed for this member');
    }
  });

  it('dates the roster and the report totals apart from the chosen year', async () => {
    await render(PATH, loaded);
    const sources = container.querySelector('.f-sources')!.textContent;
    expect(sources).toContain('Minnesota LegislatureCommittee roster');
    expect(sources).toContain(
      'Campaign accounts and report figures, report totals copied Oct 27, 2026',
    );
    expect(sources).toContain('Each account is linked to its member only once confirmed');
  });

  it('reads the chosen year from the address and changes it there', async () => {
    const last = String(Number(YEAR) - 1);
    await render(`${PATH}?year=${last}`, loaded);
    expect(requests.some((url) => url.endsWith(`?year=${last}`))).toBe(true);
    const pressed = container.querySelector('[aria-pressed="true"]');
    expect(pressed?.textContent).toBe(last);
    const current = [...container.querySelectorAll<HTMLButtonElement>('.f-chip')].find(
      (chip) => chip.textContent === YEAR,
    )!;
    await act(async () => current.click());
    await settle();
    expect(window.location.search).toBe('');
  });

  it('shows the loading line', async () => {
    await render(PATH, () => new Promise<Response>(() => {}));
    expect(container.textContent).toContain('Loading members’ campaign accounts…');
  });

  it('shows the failure with Try again, which reads again', async () => {
    let calls = 0;
    await render(PATH, (url) => {
      if (url.endsWith('/members')) {
        calls += 1;
        return calls === 1 ? new Response(null, { status: 503 }) : json(MEMBERS);
      }
      return loaded(url);
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Couldn’t load accounts. This is a problem on our side and says nothing about the members.',
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    );
    await settle();
    await settle();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelectorAll('.cmm-card')).toHaveLength(4);
  });

  it('fails 1 member’s figures on their own card', async () => {
    await render(PATH, (url) =>
      url.includes('/legislators/ben/') ? new Response(null, { status: 503 }) : loaded(url),
    );
    expect(card('Ben Davis').querySelector('[role="alert"]')).not.toBeNull();
    expect(card('Casey Two').querySelector('[role="alert"]')).toBeNull();
  });

  it('treats a 404 on an account’s figures as a failed read, never "no report"', async () => {
    await render(PATH, (url) =>
      url.includes('/committees/18822/report-figures')
        ? new Response(null, { status: 404 })
        : loaded(url),
    );
    const ben = card('Ben Davis');
    expect(ben.querySelector('[role="alert"]')?.textContent).toContain(
      'Couldn’t load the report information',
    );
    expect(ben.textContent).not.toContain(`No ${YEAR} report held`);
  });

  it('says when no members are recorded', async () => {
    await render(PATH, () => json({ ...MEMBERS, members: [] }));
    expect(container.textContent).toContain(
      'No members are recorded for this committee in the copied Legislature records',
    );
  });

  it('says the record is unavailable for an unknown committee', async () => {
    await render(PATH, () => new Response(null, { status: 404 }));
    expect(container.querySelector('h1')?.textContent).toBe('This record is no longer available');
  });
});

describe('derived figures and labels', () => {
  it('names the chamber and session', () => {
    expect(committeeMeta({ ...MEMBERS, members: MEMBERS.members.slice(0, 1) })).toBe(
      'House · 2025–26 session · 1 member',
    );
  });

  it('has no report when no report of the year carries figures', () => {
    expect(accountFigures(undefined)).toEqual({ state: 'none' });
    expect(accountFigures(reports('1', []))).toEqual({ state: 'none' });
    expect(accountFigures(reports('1', [reportRow({ figures_state: 'unavailable' })]))).toEqual({
      state: 'none',
    });
  });

  it('reads the 3 drawn figures as filed, never a missing one as $0', () => {
    expect(
      accountFigures(
        reports('1', [reportRow({ total_expenditures: null, ending_cash_balance: '-150.0000' })]),
      ),
    ).toEqual({
      state: 'figures',
      figures: [
        { label: 'Total receipts', value: '$4,200', missing: false },
        { label: 'Total expenditures', value: 'Report total unavailable', missing: true },
        { label: 'Ending balance', value: '\u2212$150', missing: false },
      ],
      report: '2026 Pre-Primary Report · Amendment 1 · Jan 1, 2026 to Jul 20, 2026',
    });
  });

  it('names the report’s end alone when its start is not printed', () => {
    const result = accountFigures(
      reports('1', [reportRow({ period_start: null, effective_amendment_index: 0 })]),
    );
    expect(result.state === 'figures' && result.report).toBe(
      '2026 Pre-Primary Report · as filed · Report figures through Jul 20, 2026',
    );
  });

  it('states 1 copy date, or both when members disagree', () => {
    expect(copiedLine(['2026-10-28T03:18:52Z', '2026-10-28T03:18:52Z'])).toBe(
      'report totals copied Oct 27, 2026',
    );
    expect(copiedLine([])).toBeNull();
  });
});
