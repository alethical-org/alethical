import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import { Bill, citationLabel } from '../pages/Bill';
import {
  billCountLine,
  billPages,
  billsPath,
  clearBillListCache,
  Legislation,
  pageNumber,
} from '../pages/Legislation';
import {
  actionRow,
  billCode,
  billHeading,
  dayLabel,
  orderActions,
  orderVersions,
  ownAuthors,
  seatLabel,
  sessionShortLabel,
  versionLabel,
  versionPhrase,
  voteForAction,
  type BillDetail,
  type ServedVote,
} from '../pages/legislationRecords';
import { RollCall, recordedFilters, rollTallies } from '../pages/RollCall';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.example.test';

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

function json(data: unknown, status = 200, page?: unknown) {
  return new Response(JSON.stringify(page ? { data, page } : { data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const missing = () => new Response('{}', { status: 404 });
const broken = () => new Response('{}', { status: 500 });

const SESSIONS = [
  {
    slug: '94-2025-regular',
    name: '94th Legislature (2025 - 2026) Regular Session',
    is_current: true,
    session_number: 94,
    year_start: 2025,
    year_end: 2026,
  },
  {
    slug: '94-2025-special-1',
    name: '94th Legislature (2025) First Special Session',
    is_current: false,
    session_number: 94,
    year_start: 2025,
    year_end: 2025,
  },
];

const COUNTS = {
  current_legislature_bills: {
    state: 'reported',
    count: 10518,
    first_year: 2025,
    last_year: 2026,
    copied_at: '2026-07-14T18:48:17Z',
  },
};

const LIST_ROW = {
  id: '94-2025-SF334',
  file_type: 'SF',
  file_number: 334,
  current_status: 'Chapter number',
  status_key: 'signed_into_law',
  latest_action_at: '2026-05-17T00:00:00Z',
  ai_analysis: { short_title: 'New Council and Fund to Modernize Human Services IT' },
};

const STATUTORY = 'A bill for an act relating to state government; creating a council';

const DETAIL: BillDetail = {
  id: '94-2025-SF334',
  title: STATUTORY,
  session: SESSIONS[0],
  description: 'Human Services Systems Modernization Advisory Council; creation',
  current_status: 'Chapter number',
  status_key: 'signed_into_law',
  latest_action_at: '2026-05-17T00:00:00Z',
  last_pulled_at: '2026-10-26T13:34:30Z',
  official_url: 'https://www.revisor.mn.gov/bills/94/2025/0/SF/334/versions/3/',
  is_omnibus: false,
  companion: { id: '94-2025-HF744', code: 'HF 744' },
  all_sponsors: [
    {
      name: 'Kari Rehrauer',
      role: 'co_author',
      legislator_id: 'leg-kari',
      source_order: 6,
      source_chamber: 'house',
      chamber: 'house',
      district: 'District 35B',
    },
    {
      name: 'Julia E. Coleman',
      role: 'co_author',
      legislator_id: 'leg-julia',
      source_order: 3,
      source_chamber: 'senate',
      chamber: 'senate',
      district: 'District 48',
    },
    {
      name: 'Melissa H. Wiklund',
      role: 'chief_author',
      legislator_id: 'leg-melissa',
      source_order: 1,
      source_chamber: 'senate',
      chamber: 'senate',
      district: 'District 51',
    },
  ],
  ai_analysis: {
    short_title: 'New Council and Fund to Modernize Human Services IT',
    summary:
      'The bill SF 334 establishes an advisory council of state, county, and Tribal representatives.',
    citations: [
      {
        id: 'laws.0.2.0-0',
        label: 'Sec. 2',
        excerpt: 'The commissioners must present the proposal to the council.',
        section_id: 'laws.0.2.0',
        section_order: 2,
        section_topic: 'Human services systems modernization advisory council',
      },
    ],
  },
  actions: [
    {
      action_number: 1,
      action_text: 'Introduction and first reading',
      action_at: '2025-01-21T00:00:00Z',
    },
    {
      action_number: 2,
      action_text: 'Referred to',
      committee_name: 'State and Local Government',
      committee_id: 'c0a8e1d2-1111-4222-8333-444455556666',
      chamber: 'senate',
      action_at: '2025-01-21T00:00:00Z',
    },
    {
      action_number: 7,
      action_text: 'Third reading Passed as amended',
      action_at: '2025-02-10T00:00:00Z',
      roll_call_text: '62-0',
    },
  ],
  versions: [
    {
      version_code: '0',
      version_name: '2025.0-SF0334-0',
      document_date: '2025-01-16T14:02:47Z',
      html_url: 'https://www.revisor.mn.gov/bills/94/2025/0/SF/334/versions/0/',
      is_current: false,
    },
    {
      version_code: '3',
      version_name: '2025.0-SF0334-3',
      document_date: '2026-05-19T12:26:09Z',
      html_url: 'https://www.revisor.mn.gov/bills/94/2025/0/SF/334/versions/3/',
      is_current: true,
    },
    {
      version_code: 'session-law',
      version_name: 'Session Law — Chapter 120',
      document_date: '2026-05-27T00:00:00Z',
      html_url: 'https://www.revisor.mn.gov/laws/2026/0/Session+Law/Chapter/120/',
      is_current: false,
    },
  ],
};

const VOTE_ID = '0b0a4d2e-5c7f-4e1a-9b3d-8f2c6a1e7d90';

const VOTE: ServedVote = {
  id: VOTE_ID,
  motion_text: 'S.F. No. 334 was read the third time, as amended, and placed on its final passage.',
  result_text: 'Third reading Passed as amended',
  chamber: 'senate',
  yes_count: 62,
  no_count: 0,
  absent_count: 0,
  excused_count: 0,
  present_count: 0,
  occurred_at: '2025-02-10T00:00:00Z',
  official_url: 'https://www.senate.mn/journals/2025-2026/2025021004.pdf#page=30',
  records: [
    {
      legislator_id: 'leg-jim',
      legislator_name: 'Jim Abeler',
      party: 'R',
      vote_value: 'yes',
    },
    {
      legislator_id: 'leg-melissa',
      legislator_name: 'Melissa H. Wiklund',
      party: null,
      vote_value: 'yes',
    },
  ],
};

const AUTHORS = {
  bill: { id: '94-2025-SF334' },
  authors: [
    {
      ...DETAIL.all_sponsors![2],
      campaign_accounts: {
        link_state: 'confirmed',
        confirmed: [
          {
            registration_number: '17393',
            committee_name: 'Wiklund, Melissa Halvorson Senate Committee',
          },
        ],
      },
    },
    { ...DETAIL.all_sponsors![1], campaign_accounts: { link_state: 'unconfirmed', confirmed: [] } },
    // A companion bill's author, named in the House file: not this bill's author.
    { ...DETAIL.all_sponsors![0], campaign_accounts: { link_state: 'confirmed', confirmed: [] } },
  ],
};

let container: HTMLDivElement;
let root: Root;
let requests: string[];

beforeEach(() => {
  clearReadCache();
  clearBillListCache();
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

async function render(path: string, element: () => React.ReactElement, answer: Answer) {
  window.history.replaceState(null, '', path);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requests.push(input);
      return answer(input);
    }),
  );
  await act(async () => {
    root.render(element());
  });
  await settle();
  await settle();
}

/** The page's words, with the no-break spaces that keep dates whole read as spaces. */
function text() {
  return (container.textContent ?? '').replace(/\u00a0/g, ' ');
}

describe('legislation records', () => {
  it('names a bill by its plain-language title, else its number, never its legal title', () => {
    expect(billHeading('Plain title', 'HF 1')).toBe('Plain title');
    expect(billHeading(null, 'HF 1')).toBe('HF 1');
    expect(billHeading('  ', 'SF 2')).toBe('SF 2');
    expect(billCode(null, null, '94-2025s1-HF1')).toBe('HF 1');
    expect(billCode('SF', 334)).toBe('SF 334');
  });

  it('prints the record’s own day and drops what will not parse', () => {
    expect(dayLabel('2025-02-10T00:00:00Z')).toBe('Feb 10, 2025');
    expect(dayLabel('2026-05-17')).toBe('May 17, 2026');
    expect(dayLabel(null)).toBeNull();
    expect(dayLabel('05/17/26')).toBeNull();
  });

  it('labels sessions short', () => {
    expect(sessionShortLabel(SESSIONS[0])).toBe('2025–26');
    expect(sessionShortLabel(SESSIONS[1])).toBe('2025 First Special');
  });

  it('labels and orders versions as alethical.com does', () => {
    expect(versionLabel('0', '2025.0-SF0334-0')).toBe('As introduced');
    expect(versionLabel('ue-1', '2025.0-UES0334-1')).toBe('1st unofficial engrossment');
    expect(versionLabel('3', '2025.0-SF0334-3')).toBe('3rd engrossment');
    expect(versionLabel('x', '2026.0-CCRHF1141A')).toBe('Conference committee report');
    expect(versionPhrase('As introduced')).toBe('introduced');
    const rows = orderVersions(DETAIL.versions!, DETAIL.actions!);
    expect(rows.map((row) => row.label)).toEqual([
      'Session Law — Chapter 120',
      '3rd engrossment',
      'As introduced',
    ]);
    // "As introduced" carries the introduction action's date, not the file stamp.
    expect(rows[2].date).toBe('Jan 21, 2025');
  });

  it('completes an action that stops on a preposition and finds its 1 roll call', () => {
    const rows = orderActions(DETAIL.actions!).map(actionRow);
    expect(rows[0]?.text).toBe('Third reading Passed as amended · 62-0');
    // Same-day actions keep the Legislature's own order.
    expect(rows.map((row) => row?.text)).toEqual([
      'Third reading Passed as amended · 62-0',
      'Introduction and first reading',
      'Referred to State and Local Government',
    ]);
    expect(voteForAction(rows[0]!, [VOTE])?.id).toBe(VOTE_ID);
    expect(voteForAction(rows[0]!, [VOTE, { ...VOTE, id: 'vote-2' }])).toBeNull();
    expect(voteForAction(rows[0]!, [{ ...VOTE, occurred_at: '2026-05-17T00:00:00Z' }])).toBeNull();
  });

  it('keeps this bill’s own authors, chief authors first', () => {
    const authors = ownAuthors(DETAIL.all_sponsors!, 'Senate');
    expect(authors.map((author) => author.name)).toEqual([
      'Melissa H. Wiklund',
      'Julia E. Coleman',
    ]);
    expect(seatLabel('District 51', 'senate')).toBe('Senate District 51');
  });

  it('builds the list read on the server', () => {
    expect(billsPath({ q: ' sf334 ', session: '', chamber: 'senate', status: '' }, 2)).toBe(
      '/bills?limit=20&offset=20&q=sf334&chamber=senate',
    );
    expect(billCountLine(4012, '2025–26')).toBe('4,012 bills · 2025–26 session');
    expect(billCountLine(1, null)).toBe('1 bill');
    expect(billPages(41)).toBe(3);
    expect(pageNumber('x')).toBe(1);
  });

  it('labels citations as alethical.com does', () => {
    expect(citationLabel('Sec. 2', 'Council')).toBe('Sec. 2 · Council');
    expect(citationLabel('SF 334, Sec. 14. TRANSFER.', 'Transfer')).toBe('Sec. 14. TRANSFER');
    expect(citationLabel('Sec. 5 · Human services ad…', 'Human services council')).toBe(
      'Sec. 5 · Human services council',
    );
  });

  it('never prints an unrecorded absent count as 0', () => {
    // Yes and No come from the official record, 0 included; Absent and Excused
    // are never read from it, so a served 0 or 3 there still reads "Not recorded".
    expect(rollTallies({ ...VOTE, absent_count: 3 })).toEqual([
      { label: 'Yes', value: '62' },
      { label: 'No', value: '0' },
      { label: 'Absent', value: 'Not recorded' },
      { label: 'Excused', value: 'Not recorded' },
    ]);
    expect(recordedFilters(VOTE.records!).map((item) => item.label)).toEqual(['All', 'Yes']);
  });
});

function legislationAnswer(list: Answer, sessions: unknown[] = SESSIONS): Answer {
  return (url) => {
    if (url.endsWith('/sessions')) return json(sessions);
    if (url.includes('/finance/landing/counts')) return json(COUNTS);
    return list(url);
  };
}

const renderLegislation = (path: string, answer: Answer, sessions: unknown[] = SESSIONS) =>
  render(
    path,
    () => <Legislation match={matchRoute('/bills')!} />,
    legislationAnswer(answer, sessions),
  );

describe('Legislation', () => {
  it('lists bills with their count, session, chamber, status and date', async () => {
    await renderLegislation('/bills', () =>
      json(
        [
          LIST_ROW,
          { ...LIST_ROW, id: '94-2025-HF9', file_type: 'HF', file_number: 9, ai_analysis: null },
        ],
        200,
        {
          total: 4012,
        },
      ),
    );
    expect(requests).toContain(`${API}/api/v1/bills?limit=20&offset=0`);
    expect(container.querySelector('h1')?.textContent).toBe('Legislation');
    expect(text()).toContain('Minnesota Legislature · revisor.mn.gov · Updated Jul 14, 2026');
    expect(text()).toContain('4,012 bills · 2025–26 session');
    const rows = [...container.querySelectorAll<HTMLAnchorElement>('.lg-row')];
    expect(rows[0].getAttribute('href')).toBe('/bills/94-2025-SF334?from=%2Fbills');
    expect(rows[0].textContent).toContain('New Council and Fund to Modernize Human Services IT');
    const meta = rows[0].querySelector('.lg-row-meta')?.textContent;
    // Each dot ends its line, so the date never starts a phone line with one.
    expect(meta).toBe('2025–26\u00a0· Senate\u00a0· Signed into Law\u00a0· May\u00a017,\u00a02026');
    // No plain-language title: the bill's number, never its legal title.
    expect(rows[1].querySelector('.lg-row-title')?.textContent).toBe('HF 9');
    expect(text()).toContain('Page 1 of 201');
    expect(text()).not.toContain('Clear all');
  });

  it('shows the empty state when nothing matches', async () => {
    await renderLegislation('/bills?q=zzzz&status=vetoed', () => json([], 200, { total: 0 }));
    expect(requests).toContain(`${API}/api/v1/bills?limit=20&offset=0&q=zzzz&status=vetoed`);
    expect(text()).toContain('0 bills · 2025–26 session');
    expect(text()).toContain('No matching records');
    expect(text()).toContain('Try another name or bill number');
    expect(text()).toContain('Clear all');
    expect((container.querySelector('#bills-q') as HTMLInputElement).value).toBe('zzzz');
  });

  it('says a failed load is on our side and offers Try again', async () => {
    let calls = 0;
    await renderLegislation('/bills', () => {
      calls += 1;
      return calls === 1 ? broken() : json([LIST_ROW], 200, { total: 1 });
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'We couldn’t load these results. This is a problem on our side.',
    );
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Try again',
    )!;
    await act(async () => retry.click());
    await settle();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(text()).toContain('1 bill · 2025–26 session');
  });

  it('builds the Session menu from the sessions the server serves, current first', async () => {
    await renderLegislation('/bills', () => json([LIST_ROW], 200, { total: 1 }));
    expect(requests).toContain(`${API}/api/v1/sessions`);
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.startsWith('Session:'),
    )!;
    expect(button.textContent).toContain('2025–26');
    await act(async () => button.click());
    const options = [...container.querySelectorAll('[role="option"]')].map(
      (item) => item.textContent,
    );
    expect(options).toEqual(['2025–26', '2025 First Special']);
  });

  it('keeps the Session menu with 1 option when 1 session is held', async () => {
    await renderLegislation('/bills', () => json([LIST_ROW], 200, { total: 1 }), [SESSIONS[0]]);
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.startsWith('Session:'),
    )!;
    await act(async () => button.click());
    expect([...container.querySelectorAll('[role="option"]')].map((i) => i.textContent)).toEqual([
      '2025–26',
    ]);
  });

  it('puts the count line under the menus and the note under the list', async () => {
    await renderLegislation('/bills', () => json([LIST_ROW], 200, { total: 1 }));
    expect(container.querySelector('.lg-count')?.classList.contains('f-count-line')).toBe(true);
    const note = container.querySelector('.lg-note');
    expect(note?.classList.contains('f-section-note')).toBe(true);
    expect(note?.previousElementSibling?.classList.contains('lg-list')).toBe(true);
    expect(container.querySelector('.lg-intro')?.textContent?.trim().endsWith('.')).toBe(false);
  });

  it('reads an unknown session as no matching records, not a failure', async () => {
    await renderLegislation('/bills?session=93-2023-regular', missing);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(text()).toContain('No matching records');
  });
});

function billAnswer(
  overrides: {
    detail?: Answer;
    votes?: Answer;
    /** The roll call's own read, `/votes/{id}`. */
    vote?: Answer;
    authors?: Answer;
    text?: Answer;
  } = {},
): Answer {
  return (url) => {
    if (url.includes('/finance/bills/')) return (overrides.authors ?? (() => json(AUTHORS)))(url);
    if (url.includes('/api/v1/votes/')) {
      return (overrides.vote ?? (() => json({ bill_id: DETAIL.id, ...VOTE })))(url);
    }
    if (url.includes('/votes')) return (overrides.votes ?? (() => json([VOTE])))(url);
    if (url.includes('/text')) {
      return (
        overrides.text ??
        (() =>
          json({
            version_code: '3',
            sections: [
              {
                section_id: 'laws.0.1.0',
                source_order: 1,
                heading: 'Section 1.',
                text: 'new text begin (a) The fund is created. new text end',
              },
              {
                section_id: 'laws.0.2.0',
                source_order: 2,
                heading: 'Sec. 2. COUNCIL.',
                text: 'The council deleted text begin may deleted text end must meet.',
              },
            ],
          }))
      )(url);
    }
    return (overrides.detail ?? (() => json(DETAIL)))(url);
  };
}

const renderBill = (path: string, answer: Answer) =>
  render(path, () => <Bill match={matchRoute(path.split('?')[0])!} />, answer);

describe('Bill', () => {
  it('heads the bill with its plain-language title and shows the summary', async () => {
    await renderBill('/bills/94-2025-SF334?from=%2Fbills', billAnswer());
    expect(requests).toContain(
      `${API}/api/v1/bills/94-2025-SF334?include=ai_analysis,all_sponsors,actions,versions`,
    );
    expect(container.querySelector('h1')?.textContent).toBe(
      'New Council and Fund to Modernize Human Services IT',
    );
    expect(text()).not.toContain(STATUTORY);
    expect(text()).toContain('Back to Legislation');
    expect(text()).toContain('2025–26 session · Senate');
    expect(text()).toContain('Signed into Law · May 17, 2026');
    // The shared cleaner drops the bill-number lead.
    expect(text()).toContain('Establishes an advisory council of state, county, and Tribal');
    expect(text()).not.toContain('The bill SF 334');
    expect(text()).toContain('Minnesota Legislature · revisor.mn.gov · Updated Oct 26, 2026');
    expect(text()).toContain('Sec. 2 · Human services systems modernization advisory council');
    expect(text()).toContain('3rd engrossment version');
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(['Summary', 'Actions3', 'Votes1', 'Bill Text', 'Versions3']);
    // Side column: this bill's own authors, its companion and the official page.
    expect(text()).toContain('Melissa H. Wiklund · Senate District 51');
    expect(text()).toContain('Julia E. Coleman');
    expect(container.querySelector('.bl-facts')?.textContent).not.toContain('Kari Rehrauer');
    expect(container.querySelector('.bl-companion')?.getAttribute('href')).toBe(
      '/bills/94-2025-HF744?from=%2Fbills%2F94-2025-SF334%3Ffrom%3D%252Fbills',
    );
    const committee = container.querySelector<HTMLAnchorElement>('.bl-facts a[aria-label]');
    expect(committee?.textContent).toBe('State and Local Government');
    expect(committee?.getAttribute('aria-label')).toBe(
      'Members’ campaign accounts, State and Local Government',
    );
    expect(committee?.getAttribute('href')).toBe(
      '/legislature/committees/c0a8e1d2-1111-4222-8333-444455556666/members?from=%2Fbills%2F94-2025-SF334%3Ffrom%3D%252Fbills',
    );
    const official = container.querySelector<HTMLAnchorElement>('.bl-official');
    expect(official?.getAttribute('href')).toBe(
      'https://www.revisor.mn.gov/bills/94/2025/0/SF/334/',
    );
  });

  it('returns to Legislation when the address names no earlier page', async () => {
    await renderBill('/bills/94-2025-SF334', billAnswer());
    const back = container.querySelector<HTMLAnchorElement>('.f-back');
    expect(back?.textContent).toBe('Back to Legislation');
    expect(back?.getAttribute('href')).toBe('/bills');
  });

  it('lists each author’s confirmed account, or says none is confirmed', async () => {
    await renderBill('/bills/94-2025-SF334', billAnswer());
    const card = container.querySelector('.bl-accounts')!;
    expect(card.textContent).toContain('Authors’ campaign accounts');
    const account = card.querySelector<HTMLAnchorElement>('.bl-account-link');
    expect(account?.textContent?.replace(/\u00a0/g, ' ')).toBe(
      'Wiklund, Melissa Halvorson Senate Committee',
    );
    expect(account?.getAttribute('href')).toBe(
      '/money/committees/17393?from=%2Fbills%2F94-2025-SF334',
    );
    expect(card.textContent).toContain('Chief author');
    expect(card.textContent).toContain('Co-author');
    expect(card.textContent).toContain('Each author’s own confirmed account');
    expect(card.textContent).toContain('No confirmed campaign account');
    expect(card.textContent).not.toContain('Kari Rehrauer');
    // The records-only note closes the section, under the list (Round 34).
    const note = card.querySelector('.bl-accounts-note');
    expect(note?.textContent).toBe(
      'These are records only; they say nothing about why anyone authored this bill',
    );
    expect(note?.previousElementSibling?.classList.contains('bl-accounts-list')).toBe(true);
    const name = card.querySelector<HTMLAnchorElement>('.bl-name-link');
    expect(name?.getAttribute('href')).toBe(
      '/legislators/leg-melissa?from=%2Fbills%2F94-2025-SF334',
    );
  });

  it('says no authors are held, with no records-only note', async () => {
    await renderBill('/bills/94-2025-SF334', billAnswer({ authors: () => json({ authors: [] }) }));
    const card = container.querySelector('.bl-accounts')!;
    expect(card.textContent).toContain('No authors held');
    expect(card.querySelector('.bl-accounts-note')).toBeNull();
  });

  it('keeps the bill when the authors’ accounts fail, with Try again', async () => {
    await renderBill('/bills/94-2025-SF334', billAnswer({ authors: broken }));
    expect(container.querySelector('.bl-accounts [role="alert"]')?.textContent).toContain(
      'We couldn’t load the authors’ campaign accounts. This is a problem on our side.',
    );
    expect(container.querySelector('h1')?.textContent).toContain('New Council');
  });

  it('shows the official description when no Alethical summary exists', async () => {
    const detail = { ...DETAIL, ai_analysis: null };
    await renderBill('/bills/94-2025-SF334', billAnswer({ detail: () => json(detail) }));
    expect(container.querySelector('h1')?.textContent).toBe('SF 334');
    expect(text()).not.toContain(STATUTORY);
    expect(text()).toContain('Official description');
    expect(text()).toContain('Human Services Systems Modernization Advisory Council; creation');
    expect(text()).toContain(
      'No Alethical summary yet. The official description and full text are available.',
    );
  });

  it('opens the bill text with its changes marked', async () => {
    await renderBill('/bills/94-2025-SF334?tab=text', billAnswer());
    expect(requests).toContain(`${API}/api/v1/bills/94-2025-SF334/versions/3/text`);
    expect(text()).toContain('Bill text · 3rd engrossment version');
    expect(text()).toContain('Posted May 19, 2026');
    expect(container.querySelector('#ft-laws\\.0\\.2\\.0-2')?.textContent).toContain(
      'SEC. 2 · COUNCIL',
    );
    expect(container.querySelector('.bl-section del')?.textContent).toBe('may');
    expect(container.querySelector('.bl-section ins')?.textContent).toContain(
      'The fund is created.',
    );
  });

  it('says plainly when the votes or the full text fail, with Try again', async () => {
    await renderBill('/bills/94-2025-SF334?tab=votes', billAnswer({ votes: broken }));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'We couldn’t load this bill’s votesTry again',
    );
    act(() => root.unmount());
    root = createRoot(container);
    await renderBill('/bills/94-2025-SF334?tab=text', billAnswer({ text: broken }));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'We couldn’t load the full textTry again',
    );
  });

  it('says when a version’s text is not held', async () => {
    await renderBill('/bills/94-2025-SF334?tab=text&version=0', billAnswer({ text: missing }));
    expect(requests).toContain(`${API}/api/v1/bills/94-2025-SF334/versions/0/text`);
    expect(text()).toContain('Text of the introduced version not held');
  });

  it('lists roll calls linking to their own pages', async () => {
    await renderBill('/bills/94-2025-SF334?tab=votes', billAnswer());
    const card = container.querySelector<HTMLAnchorElement>('a.bl-vote');
    expect(card?.textContent).toContain('S.F. No. 334 was read the third time');
    expect(card?.textContent).toContain('Senate · Feb 10, 2025');
    expect(card?.getAttribute('href')).toBe(
      `/votes/${VOTE_ID}?from=%2Fbills%2F94-2025-SF334%3Ftab%3Dvotes`,
    );
  });

  it('says no roll call is recorded when the record holds none', async () => {
    const detail = {
      ...DETAIL,
      actions: DETAIL.actions!.map((action) => ({ ...action, roll_call_text: null })),
    };
    await renderBill(
      '/bills/94-2025-SF334?tab=votes',
      billAnswer({ detail: () => json(detail), votes: () => json([]) }),
    );
    expect(text()).toContain('No roll call is recorded for this bill');
  });

  it('says roll calls are not held when an action records a tally we lack', async () => {
    await renderBill('/bills/94-2025-SF334?tab=votes', billAnswer({ votes: () => json([]) }));
    expect(text()).toContain('No roll calls held');
  });

  it('links an action to its roll call and shows each action’s chamber', async () => {
    await renderBill('/bills/94-2025-SF334?tab=actions', billAnswer());
    const link = [...container.querySelectorAll<HTMLAnchorElement>('.bl-inline-link')].find(
      (item) => item.textContent === 'Roll call',
    );
    expect(link?.getAttribute('href')).toBe(
      `/votes/${VOTE_ID}?from=%2Fbills%2F94-2025-SF334%3Ftab%3Dactions`,
    );
    const chambers = [...container.querySelectorAll('.bl-action-chamber')].map(
      (cell) => cell.textContent,
    );
    // Newest first; only the referral carries a chamber in this copy.
    expect(chambers).toEqual(['', '', 'Senate']);
    expect(container.querySelector('.bl-panel .lg-note')?.textContent).toBe(
      'Actions are recorded events from the Legislature’s journal. The latest action is the bill’s recorded status.',
    );
  });

  it('prints the committee as text when the record carries no committee id', async () => {
    const detail = {
      ...DETAIL,
      actions: DETAIL.actions!.map((action) => ({ ...action, committee_id: null })),
    };
    await renderBill('/bills/94-2025-SF334', billAnswer({ detail: () => json(detail) }));
    expect(container.querySelector('.bl-facts a[aria-label]')).toBeNull();
    expect(container.querySelector('.bl-facts')?.textContent).toContain(
      'State and Local Government',
    );
  });

  it('shows the unavailable state for a bill the server does not hold', async () => {
    await renderBill('/bills/94-2025-HF99999', missing);
    expect(container.querySelector('h1')?.textContent).toBe('This record is no longer available');
    expect(text()).toContain(
      'No bill with this number is in the current copy of the 2025–26 session. Check the bill number, or search the session.',
    );
  });

  it('offers Try again when the bill fails to load', async () => {
    await renderBill('/bills/94-2025-SF334', broken);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'We couldn’t load this bill',
    );
  });
});

const renderVote = (path: string, answer: Answer) =>
  render(path, () => <RollCall match={matchRoute(path.split('?')[0])!} />, answer);

describe('Roll call', () => {
  it('reads the roll call by its own id and shows the motion, date, result and members', async () => {
    await renderVote(`/votes/${VOTE_ID}`, billAnswer());
    expect(requests).toContain(`${API}/api/v1/votes/${VOTE_ID}`);
    expect(requests).toContain(
      `${API}/api/v1/bills/94-2025-SF334?include=ai_analysis,all_sponsors,actions,versions`,
    );
    expect(requests.some((url) => url.endsWith('/votes'))).toBe(false);
    expect(container.querySelector('h1')?.textContent).toBe(VOTE.motion_text);
    expect(text()).toContain('Senate · Feb 10, 2025');
    expect(text()).toContain('Recorded result · Third reading Passed as amended');
    expect(text()).toContain('2 members recorded');
    expect([...container.querySelectorAll('.rc-tally dt')].map((item) => item.textContent)).toEqual(
      ['Yes', 'No', 'Absent', 'Excused'],
    );
    expect([...container.querySelectorAll('.rc-tally dd')].map((item) => item.textContent)).toEqual(
      ['62', '0', 'Not recorded', 'Not recorded'],
    );
    expect(text()).toContain('New Council and Fund to Modernize Human Services IT');
    const rows = [...container.querySelectorAll('.rc-row:not(.rc-row-head)')];
    expect(rows[0].textContent).toBe('Jim AbelerRYes');
    expect(rows[1].textContent).toContain('Party not recorded');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe(
      `/legislators/leg-jim?from=%2Fvotes%2F${VOTE_ID}`,
    );
    expect(container.querySelector<HTMLAnchorElement>('.bl-companion')?.getAttribute('href')).toBe(
      `/bills/94-2025-SF334?from=%2Fvotes%2F${VOTE_ID}`,
    );
    expect(container.querySelector('.lg-note')?.textContent).toBe(
      'Party is as recorded for this roll call. A member’s record here is a vote on one motion, never a position or an opinion. Names link only where a legislator record is confirmed.',
    );
    expect(
      container.querySelector<HTMLAnchorElement>('.f-sources-link')?.getAttribute('href'),
    ).toBe(VOTE.official_url);
    expect(text()).toContain('www.senate.mn');
    expect(text()).toContain('· Updated Oct 26, 2026. Journal of the Senate, Feb 10, 2025');
  });

  it('returns to the bill’s Votes tab when the address names no earlier page', async () => {
    await renderVote(`/votes/${VOTE_ID}`, billAnswer());
    const back = container.querySelector<HTMLAnchorElement>('.f-back');
    expect(back?.textContent).toBe('Back to Bill votes');
    expect(back?.getAttribute('href')).toBe('/bills/94-2025-SF334?tab=votes');
  });

  it('returns to the earlier page the address names', async () => {
    await renderVote(
      `/votes/${VOTE_ID}?from=%2Fbills%2F94-2025-SF334%3Ftab%3Dactions`,
      billAnswer(),
    );
    const back = container.querySelector<HTMLAnchorElement>('.f-back');
    expect(back?.textContent).toBe('Back to Bill');
    expect(back?.getAttribute('href')).toBe('/bills/94-2025-SF334?tab=actions');
  });

  it('filters members by search', async () => {
    await renderVote(`/votes/${VOTE_ID}?q=zzz`, billAnswer());
    expect(text()).toContain('No recorded member matches that');
  });

  it('still opens an older link that names the bill, keeping its address', async () => {
    await renderVote(`/votes/${VOTE_ID}?bill=94-2025-SF334&recorded=yes`, billAnswer());
    expect(container.querySelector('h1')?.textContent).toBe(VOTE.motion_text);
    expect(requests.some((url) => url.endsWith('/votes'))).toBe(false);
    expect(window.location.search).toBe('?bill=94-2025-SF334&recorded=yes');
    expect(container.querySelector('.f-chip[aria-pressed="true"]')?.textContent).toBe('Yes');
  });

  it('shows the unavailable state for a roll call the server does not hold', async () => {
    await renderVote(`/votes/${VOTE_ID}`, billAnswer({ vote: missing }));
    expect(container.querySelector('h1')?.textContent).toBe('This record is no longer available');
    expect(text()).toContain(
      'No roll call with this reference is in the current copy. Open the bill’s Votes tab for the recorded roll calls.',
    );
  });

  it('shows the unavailable state for a reference that is not a roll call id, without a read', async () => {
    await renderVote('/votes/nope?bill=94-2025-SF334', billAnswer());
    expect(requests).toEqual([]);
    expect(container.querySelector('h1')?.textContent).toBe('This record is no longer available');
  });

  it('offers Try again when the roll call fails to load, then shows it', async () => {
    let calls = 0;
    await renderVote(
      `/votes/${VOTE_ID}`,
      billAnswer({
        vote: () => {
          calls += 1;
          return calls === 1 ? broken() : json({ bill_id: DETAIL.id, ...VOTE });
        },
      }),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'We couldn’t load this roll call',
    );
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Try again',
    )!;
    await act(async () => retry.click());
    await settle();
    await settle();
    expect(container.querySelector('h1')?.textContent).toBe(VOTE.motion_text);
  });
});
