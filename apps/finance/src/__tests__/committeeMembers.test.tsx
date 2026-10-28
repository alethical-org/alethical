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

const BEN = figures([
  {
    registration_number: '18822',
    register_kind: 'candidate_committee',
    split: { reported_total: '4110.0000', reported_through: '2026-07-20' },
    money_out: { reported_total: '6527.8100', reported_through: '2026-07-20' },
  },
]);
// Casey's second account has no report this year; the first has no official
// contributions total and a filed zero for spending.
const CASEY = figures([
  {
    registration_number: '100',
    register_kind: 'candidate_committee',
    split: { reported_total: null, reported_through: null },
    money_out: { reported_total: '0', reported_through: '2026-07-20' },
  },
]);

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
    expect(ben.textContent).toContain('Candidate committee · Registration 18822');
    expect(ben.textContent).toContain('Total contributions$4,110');
    expect(ben.textContent).toContain('Expenditures$6,527');
    expect(ben.textContent).toContain(
      "The committee's own report to the state, covering through Jul 20, 2026",
    );
  });

  it('keeps a missing total missing and a filed zero a zero', async () => {
    await render(PATH, loaded);
    const casey = card('Casey Two');
    expect(casey.querySelector('.f-label')?.textContent).toBe('Campaign accounts');
    expect(casey.textContent).toContain('Total contributionsReport total unavailable');
    expect(casey.textContent).toContain('Expenditures$0');
    expect(casey.textContent).toContain('the filing’s own zero');
    expect(casey.textContent).toContain(`No report for ${YEAR} is held for this account`);
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
      'We couldn’t load these accounts. This is a problem on our side and says nothing about the members.',
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

  it('has no report when neither official total is held', () => {
    expect(accountFigures(undefined)).toEqual({ state: 'none' });
    expect(
      accountFigures({
        registration_number: '1',
        split: { reported_total: null, reported_through: null },
        money_out: { reported_total: null, reported_through: null },
      }),
    ).toEqual({ state: 'none' });
  });

  it('omits a missing spending total and says it is our gap', () => {
    const result = accountFigures({
      registration_number: '1',
      split: { reported_total: '10', reported_through: '2026-07-20' },
      money_out: { reported_total: null, reported_through: null },
    });
    expect(result).toEqual({
      state: 'figures',
      figures: [{ label: 'Total contributions', value: '$10', missing: false }],
      notes: ['We do not hold an official spending total for this committee for this year'],
      period: "The committee's own report to the state, covering through Jul 20, 2026",
    });
  });

  it('dates each figure when the 2 reports end on different days', () => {
    const result = accountFigures({
      registration_number: '1',
      split: { reported_total: '10', reported_through: '2026-07-20' },
      money_out: { reported_total: '5', reported_through: '2026-10-19' },
    });
    if (result.state !== 'figures') throw new Error('expected figures');
    expect(result.period).toBeNull();
    expect(result.figures.map((figure) => figure.period)).toEqual([
      "The committee's own report to the state, covering through Jul 20, 2026",
      "The committee's own report to the state, covering through Oct 19, 2026",
    ]);
  });

  it('states 1 copy date, or both when members disagree', () => {
    expect(copiedLine(['2026-10-28T03:18:52Z', '2026-10-28T03:18:52Z'])).toBe(
      'report totals copied Oct 27, 2026',
    );
    expect(copiedLine([])).toBeNull();
  });
});
