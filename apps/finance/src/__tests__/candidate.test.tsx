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

describe('Candidate profile', () => {
  it('shows the held candidacy facts and confirmed links (Confirmed links)', async () => {
    await render(`/candidates/${ID}`, () => raw(UPCOMING));
    expect(container.querySelector('h1')?.textContent).toBe('Patty Acomb');
    expect(text()).toContain('CANDIDATE PROFILE');
    expect(text()).toContain(
      'Official candidate record · Running for reelection as State Representative District 45B',
    );
    expect(text()).toContain('2026 general · Nov 3, 2026');
    expect(text()).toContain('Democratic-Farmer-Labor');
    expect(text()).toContain(
      'Candidate records from the Minnesota Secretary of State · Checked Oct 20, 2026.',
    );
    expect(text()).toContain('Election results pending');
    expect(text()).toContain('No campaign committee is confirmed for this candidacy');
    expect(text()).toContain('No confirmed records are held for this section');
    const legislator = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('View legislator profile'),
    );
    expect(legislator?.getAttribute('href')).toBe(
      `/legislators/patty-acomb?from=%2Fcandidates%2F${ID}`,
    );
    expect(legislator?.textContent).toContain(
      'Currently serving as State Representative, District 45B',
    );
    // The person profile is not built: the name, as plain text.
    expect(container.querySelector('.lg2-related-plain')?.textContent).toBe('Patty Acomb');
    const official = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Official source website'),
    );
    expect(official?.getAttribute('href')).toBe(UPCOMING.source.url);
    expect(official?.getAttribute('target')).toBe('_blank');
  });

  it('shows a past election’s certified result and an unrecorded party (Past election, No confirmed links)', async () => {
    await render(`/candidates/${ID}`, () => raw(PAST));
    expect(text()).toContain('Official candidate record · Candidate for');
    expect(text()).toContain('Party not recorded');
    expect(text()).toContain('Not elected · Election results');
    expect(text()).toContain('Checked Nov 26, 2024 · 2024 general election results');
    expect(text()).toContain(
      'No confirmed person or legislator record is connected to this candidacy',
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
    expect(text()).toContain('We couldn’t load this record. This is a problem on our side.');
    expect(
      [...container.querySelectorAll('button')].some((b) => b.textContent === 'Try again'),
    ).toBe(true);
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
