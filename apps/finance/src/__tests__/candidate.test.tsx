import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import {
  CandidateProfile,
  resultLine,
  runningPhrase,
  sourceStamp,
  type CandidateRecord,
} from '../pages/Candidate';
import * as routes from '../routes';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

const ID = 'a'.repeat(64);

const UPCOMING: CandidateRecord = {
  candidate: { id: ID, name: 'Patty Acomb', party: 'Democratic-Farmer-Labor' },
  election: { id: '1', label: '2026 General Election', date: '2026-11-03', type: 'general' },
  office: 'State Representative District 45B',
  votingArea: 'District 45B',
  source: {
    authority: 'Minnesota Secretary of State',
    url: 'https://candidates.sos.mn.gov/candidate/123',
    checkedDate: '2026-10-20',
  },
  people: [{ id: 'p1', name: 'Patty Acomb' }],
  electionEnded: false,
  legislator: {
    slug: 'patty-acomb',
    name: 'Patty Acomb',
    serviceStatus: 'current',
    isReelection: true,
    office: 'State Representative',
    votingArea: 'District 45B',
  },
};

const PAST: CandidateRecord = {
  ...UPCOMING,
  candidate: { id: ID, name: 'Taylor Example', party: null },
  election: { id: '2', label: '2024 General Election', date: '2024-11-05', type: 'general' },
  electionEnded: true,
  people: [],
  legislator: undefined,
  result: {
    status: 'certified',
    outcome: 'not-elected',
    source: { url: 'https://electionresults.sos.mn.gov/race/9', checkedDate: '2024-11-26' },
  },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  clearReadCache();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** `/candidates/{id}` answers with the record itself, not `{ data }`. */
function raw(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function render(path: string, answer: (url: string) => Response) {
  window.history.replaceState(null, '', path);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => answer(input)),
  );
  await act(async () => {
    root.render(<CandidateProfile match={matchRoute(path.split('?')[0])!} />);
  });
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const text = () => container.textContent ?? '';

function wrapped(data: unknown) {
  return raw({ data });
}

/** The candidacy, plus the connected legislator's campaign-account reads. */
function answering(record: CandidateRecord, confirmed = false) {
  return (url: string): Response => {
    if (url.includes('/campaign-finance/years'))
      return wrapped(
        confirmed
          ? {
              link_state: 'confirmed',
              years: [{ year: 2026, committees: [{ registration_number: '18272' }] }],
            }
          : { link_state: 'unconfirmed', years: [] },
      );
    if (url.includes('/campaign-finance?year=2026'))
      return wrapped({
        year: 2026,
        committees: [
          {
            registration_number: '18272',
            committee_name: 'Acomb, Patty House Committee',
            register_kind: 'candidate_committee',
            split: {
              state: 'shown',
              reported_total: '1200.0000',
              reported_through: '2026-07-20',
            },
            money_in: { state: 'reported', itemized_contribution_total: '900.0000' },
            money_out: { state: 'not_reported' },
          },
        ],
      });
    if (url.includes('/outside-spending'))
      return wrapped({ state: 'not_reported', year: 2026, groups: [] });
    return raw(record);
  };
}

describe('Candidate profile', () => {
  it('shows the held candidacy facts and confirmed links (Confirmed links)', async () => {
    await render(`/candidates/${ID}`, answering(UPCOMING));
    expect(container.querySelector('h1')?.textContent).toBe('Patty Acomb');
    expect(text()).toContain('CANDIDATE PROFILE');
    expect(text()).toContain(
      'Official candidate record · Running for reelection as State Representative',
    );
    expect(text()).toContain('2026 general · Nov 3, 2026');
    expect(text()).toContain('Democratic-Farmer-Labor');
    expect(text()).toContain(
      'Candidate records from the Minnesota Secretary of State · Checked Oct 20, 2026.',
    );
    expect(text()).toContain('Election results pending');
    // Accounts come from the connected legislator record; none confirmed here.
    expect(text()).toContain('No campaign committee is confirmed for this candidacy');
    expect(text()).toContain('No confirmed records held');
    const legislator = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('View legislator profile'),
    );
    expect(legislator?.getAttribute('href')).toBe(
      `/legislators/patty-acomb?from=%2Fcandidates%2F${ID}`,
    );
    expect(legislator?.textContent).toContain('Serving as State Representative, District 45B');
    // The related rows are stacked two-line links (eug-8).
    expect(legislator?.className).toContain('f-row-link');
    expect(legislator?.querySelector('.f-row-link-name')?.textContent).toBe(
      'View legislator profile',
    );
    // Person profile is on, so the candidacy's confirmed person opens it and
    // its return link comes back here.
    const person = container.querySelector<HTMLAnchorElement>('a[href^="/people/"]');
    expect(person?.querySelector('.f-row-link-name')?.textContent).toBe('View person profile');
    expect(person?.getAttribute('href')).toMatch(/^\/people\/p1\?from=%2Fcandidates%2F/);
    const official = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.replace(/\u00a0/g, ' ').includes('Official source website'),
    );
    expect(official?.getAttribute('href')).toBe(UPCOMING.source.url);
    expect(official?.getAttribute('target')).toBe('_blank');
  });

  it('prints each seat fact once when the served office repeats the voting area', async () => {
    // The live record's shape: the office carries the district, and the voting
    // area names it again with its chamber.
    await render(
      `/candidates/${ID}`,
      answering({
        ...UPCOMING,
        office: 'State Representative District 56A',
        votingArea: 'House District 56A',
      }),
    );
    const facts = [...container.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]);
    expect(facts).toContainEqual(['Office', 'State Representative']);
    expect(facts).toContainEqual(['District', 'District 56A']);
    expect(text()).toContain('State Representative · District 56A · Minnesota Secretary of State');
    expect(text()).not.toContain('House District 56A');
  });

  it('shows a past election’s certified result and an unrecorded party (Past election, No confirmed links)', async () => {
    await render(`/candidates/${ID}`, answering(PAST));
    expect(text()).toContain('Official candidate record · Candidate for');
    expect(text()).toContain('Party not recorded');
    expect(text()).toContain('Not elected · Election results');
    expect(text()).toContain('Checked Nov 26, 2024 · 2024 general election results');
    expect(text()).toContain(
      'No confirmed person or legislator record is connected to this candidacy',
    );
  });

  it('shows the connected legislator’s confirmed account, linked to the report it summarizes', async () => {
    await render(`/candidates/${ID}`, answering(UPCOMING, true));
    const card = container.querySelector('.cf-account')!;
    expect(card.textContent).toContain('Acomb, Patty House Committee');
    expect(card.textContent).toContain('$1,200');
    const open = [...card.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Open campaign'),
    );
    expect(open?.getAttribute('href')).toBe(
      `/money/committees/18272?year=2026&report=2026-07-20&from=%2Fcandidates%2F${ID}`,
    );
    expect(container.querySelector('.cf-key')?.textContent).toContain(
      'Acomb, Patty House Committee · Year 2026',
    );
  });

  it('shows Loading until the record answers, and never another record', async () => {
    window.history.replaceState(null, '', `/candidates/${ID}`);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    await act(async () => {
      root.render(<CandidateProfile match={matchRoute(`/candidates/${ID}`)!} />);
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading…');
    expect(container.querySelector('h1')).toBeNull();
  });

  it('answers an unknown candidacy with the unavailable state', async () => {
    await render(`/candidates/${ID}`, () => raw({ title: 'Candidate not found' }, 404));
    expect(container.querySelector('h1')?.textContent).toBe('This record is no longer available');
    expect(text()).toContain('No candidate record with this reference is in the current copy.');
  });

  it('a failed read offers Try again', async () => {
    await render(`/candidates/${ID}`, () => raw({}, 503));
    expect(text()).toContain('We couldn’t load this record');
    expect(text()).not.toContain('problem on our side');
    expect(
      [...container.querySelectorAll('button')].some((b) => b.textContent === 'Try again'),
    ).toBe(true);
  });
});

describe('Candidate profile, Media buys card', () => {
  const VERSION = 'b'.repeat(64);
  const row = (key: string, kind: string, role: string) => ({
    key,
    name: `${key}.pdf`,
    label: `${key}.pdf`,
    station: 'KSTP-TV',
    year: 2026,
    category: 'Local',
    kind,
    uploaded_at: '2026-03-04',
    version_id: VERSION,
    version_count: 1,
    source_changed: false,
    role,
  });
  /** The candidacy's reads, with the connections read answered as given. */
  function withConnections(connections: (url: URL) => Response) {
    const base = answering(UPCOMING);
    return (url: string) =>
      url.includes('/finance/media-buys/connections') ? connections(new URL(url)) : base(url);
  }
  const card = () => container.querySelector('.mb-buys-card');
  const reads = () =>
    (fetch as unknown as { mock: { calls: [string][] } }).mock.calls
      .map(([url]) => new URL(url))
      .filter((url) => url.pathname.endsWith('/finance/media-buys/connections'));

  it('reads this candidacy’s files and lists its committees’ files before those naming it', async () => {
    await render(
      `/candidates/${ID}`,
      withConnections(() =>
        wrapped({
          agency_key: null,
          exact_name_count: 0,
          files: [],
          total: 2,
          groups: [
            {
              label: 'Files with a checked connection to Acomb, Patty House Committee',
              files: [row('kstp-1', 'Invoice', 'Advertiser, as printed')],
            },
            {
              label: 'Station files that name this candidate',
              files: [row('kstp-2', 'Order', 'Named on page 2')],
            },
          ],
        }),
      ),
    );
    expect(
      reads().map((url) => [url.searchParams.get('kind'), url.searchParams.get('target')]),
    ).toEqual([['candidate', ID]]);
    const titles = [...(card()?.querySelectorAll('h3') ?? [])].map((h) => h.textContent);
    expect(titles).toEqual([
      'Files with a checked connection to Acomb, Patty House Committee',
      'TV station files that name this candidate',
    ]);
    const groups = [...(card()?.querySelectorAll('.mb-buys-group') ?? [])];
    expect(groups[0].textContent).toContain('Advertiser, as printed');
    expect(groups[1].textContent).toContain('Named on page 2');
    // Drawn between Campaign finance and Election in the main column.
    const main = [...container.querySelectorAll('.lg2-main > section h2')].map(
      (h) => h.textContent,
    );
    expect(main.indexOf('Media buys')).toBe(main.indexOf('Election') - 1);
    expect(card()?.querySelector('a')?.getAttribute('href')).toBe(
      `/media-buys/files/kstp-1?version=${VERSION}&from=%2Fcandidates%2F${ID}`,
    );
  });

  it('says no file is connected to the candidate by name', async () => {
    await render(
      `/candidates/${ID}`,
      withConnections(() =>
        wrapped({ agency_key: null, exact_name_count: 0, files: [], total: 0, groups: [] }),
      ),
    );
    expect(card()?.textContent).toContain(
      'No TV station files have a checked connection to Patty Acomb',
    );
  });

  it('says the files could not be loaded, with Try again', async () => {
    await render(
      `/candidates/${ID}`,
      withConnections(() => raw({}, 500)),
    );
    expect(card()?.textContent).toContain('We couldn’t load these TV station files');
    expect(card()?.textContent).toContain('Try again');
    expect(card()?.textContent).not.toContain('problem on our side');
  });

  it('is left off while the TV station file page is off', async () => {
    const real = routes.isBuilt;
    const spy = vi
      .spyOn(routes, 'isBuilt')
      .mockImplementation((name) => name !== 'station-file' && real(name));
    await render(`/candidates/${ID}`, answering(UPCOMING));
    expect(container.querySelector('h1')?.textContent).toBe('Patty Acomb');
    expect(card()).toBeNull();
    expect(reads()).toHaveLength(0);
    spy.mockRestore();
  });
});

describe('Candidate wording', () => {
  it('states a vote outcome only once certified', () => {
    expect(resultLine(undefined)).toBe('Election results pending');
    expect(resultLine({ status: 'unofficial', outcome: 'elected' })).toBe(
      'Unofficial election results',
    );
    expect(resultLine({ status: 'certified', outcome: 'elected' })).toBe(
      'Elected · Election results',
    );
    expect(resultLine({ status: 'pending', outcome: 'withdrew' })).toBe(
      'Withdrew · Election results pending',
    );
  });

  it('chooses the running phrase from the record', () => {
    expect(runningPhrase(UPCOMING)).toBe('Running for reelection as');
    expect(runningPhrase({ ...UPCOMING, legislator: undefined })).toBe('Running for');
    expect(runningPhrase(PAST)).toBe('Candidate for');
  });

  it('labels a saved ballot record', () => {
    expect(sourceStamp({ ...UPCOMING, source: { ...UPCOMING.source, retained: true } })).toBe(
      'Ballot record saved Oct 20, 2026',
    );
  });
});
