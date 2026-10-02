// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CandidateSearchContent } from '../CandidateSearchContent';
import {
  CandidateRaceGroups,
  candidateOfficeLabel,
  candidateElectionLabel,
  areaLabel,
} from '../CandidateResultsContent';
import { createCandidateFlow } from '../candidateFlow';
import type {
  CandidateElection,
  CandidateRace,
  CandidateResults,
  CandidateSearchServices,
} from '../types';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.PropsWithChildren) => <svg {...props}>{children}</svg>,
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
}));
const election: CandidateElection = {
  id: 'general',
  label: 'State general election',
  date: '2030-11-05',
  type: 'general',
};
const source = {
  authority: 'Example Elections',
  url: 'https://example.org/records',
  checkedDate: '2030-10-01',
};
const race = (id: string, office = 'State Senator'): CandidateRace => ({
  id,
  office,
  group: 'state',
  votingArea: 'Senate District 1',
  seatCount: 1,
  source,
  entries: [
    { kind: 'candidate', candidate: { id: `${id}-person`, name: `Person ${id}`, sortName: id } },
  ],
});
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const click = (element: Element) => act(() => (element as HTMLElement).click());
const button = (text: string) =>
  [...host.querySelectorAll<HTMLElement>('button,[role="button"]')].find((element) =>
    element.textContent?.includes(text),
  )!;
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

it('keeps Judges nested, reveals closed results for browser find, and offers every group when present', async () => {
  await act(async () =>
    root.render(
      <CandidateRaceGroups
        races={[
          race('state'),
          { ...race('county'), group: 'county' },
          { ...race('city'), group: 'municipal' },
          { ...race('school'), group: 'school' },
          { ...race('other'), group: 'other' },
          race('judge', 'Judge - 9th District Court 12'),
        ]}
        election={election}
        busy={false}
        onOpenProfile={() => {}}
      />,
    ),
  );
  expect(host.querySelector('nav')?.textContent).toContain('Other local');
  expect(host.querySelectorAll('nav a')).toHaveLength(5);
  const judges = button('Judges');
  expect(judges.getAttribute('aria-expanded')).toBe('false');
  const body = document.getElementById(judges.getAttribute('aria-controls')!)!;
  expect(body.getAttribute('hidden')).toBe('until-found');
  act(() => body.dispatchEvent(new Event('beforematch', { bubbles: true })));
  expect(judges.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('[aria-level="4"]')?.textContent).toBe(
    'Judge, 9th District Court, Seat 12',
  );
  const state = button('State offices');
  click(state);
  expect(state.getAttribute('aria-expanded')).toBe('false');
  const groupBody = document.getElementById(state.getAttribute('aria-controls')!)!;
  act(() => groupBody.dispatchEvent(new Event('beforematch', { bubbles: true })));
  expect(state.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('style')?.textContent).toContain('@media print');
});

it('prints each joint ticket once with 1 destination, alphabetizes full names, and keeps unequal source dates separate', async () => {
  const joint: CandidateRace = {
    ...race('governor', 'Governor & Lt Governor'),
    entries: [
      {
        kind: 'ticket',
        id: 'joint',
        members: [
          { id: 'joint', name: 'Zara Able and Amir Zed', sortName: 'Able', party: 'Independent' },
        ],
      },
      {
        kind: 'ticket',
        id: 'joint2',
        members: [{ id: 'joint2', name: 'Amir Zee and Zara Able', sortName: 'Zee' }],
      },
    ],
  };
  await act(async () =>
    root.render(
      <CandidateRaceGroups
        races={[joint, { ...race('house'), source: { ...source, checkedDate: '2030-09-30' } }]}
        election={election}
        busy={false}
        onOpenProfile={() => {}}
      />,
    ),
  );
  expect(host.querySelectorAll('a[href="/candidates/joint"]')).toHaveLength(1);
  expect(host.querySelector('a[href="/candidates/joint"]')?.getAttribute('aria-label')).toBe(
    'View profile, Zara Able and Amir Zed',
  );
  expect(host.textContent).toContain('2 tickets listed');
  expect(host.textContent).toContain(
    'Each ticket is a pair who run together. You vote for 1 ticket.',
  );
  expect(host.textContent!.indexOf('Amir Zee')).toBeLessThan(
    host.textContent!.indexOf('Zara Able and'),
  );
  expect(host.querySelectorAll('a[href="https://example.org/records"]')).toHaveLength(2);
  expect(host.textContent).toContain('October 1, 2030');
  expect(host.textContent).toContain('September 30, 2030');
  expect(host.textContent?.match(/1 seat to fill/g)).toHaveLength(1);
});

it('shares a source only when all source facts match and keeps generic coverage without a made-up source link', async () => {
  const results: CandidateResults = {
    kind: 'results',
    electionId: election.id,
    matchedAddress: '100 Example Street, MN 55415',
    races: [race('a'), race('b')],
    coverage: [
      { kind: 'coverage-unconfirmed', office: '', authority: source.authority, url: source.url },
    ],
  };
  const services: CandidateSearchServices = {
    getElections: async () => [election],
    suggest: async () => [],
    lookup: async () => results,
  };
  await act(async () =>
    root.render(
      <CandidateSearchContent
        services={services}
        initialAddress="100 Example Street, MN 55415"
        onOpenProfile={() => {}}
      />,
    ),
  );
  await flush();
  expect(host.querySelectorAll('a[href="https://example.org/records"]')).toHaveLength(1);
  expect(host.textContent).toContain('Some local offices may be missing');
  expect(host.textContent).not.toContain('Election information from');
});

it('keeps stale warnings with their own records when group source facts differ', async () => {
  const staleRace = { ...race('old'), source: { ...source, stale: true } };
  const render = (races: CandidateRace[]) =>
    act(async () =>
      root.render(
        <CandidateRaceGroups
          races={races}
          election={election}
          busy={false}
          onOpenProfile={() => {}}
        />,
      ),
    );
  await render([staleRace, { ...race('also-old'), source: staleRace.source }]);
  expect(host.textContent?.match(/May be out of date/g)).toHaveLength(1);
  expect(host.querySelectorAll('a[href="https://example.org/records"]')).toHaveLength(1);

  await render([staleRace, race('fresh')]);
  expect(host.textContent?.match(/May be out of date/g)).toHaveLength(1);
  expect(host.querySelectorAll('a[href="https://example.org/records"]')).toHaveLength(2);
  const words = host.textContent!;
  expect(words.indexOf('May be out of date')).toBeGreaterThan(words.indexOf('Person old'));
  expect(words.indexOf('May be out of date')).toBeLessThan(words.indexOf('Person fresh'));
});

it('names the retained address while editing and after a failed replacement, and keeps the typed text', async () => {
  const results: CandidateResults = {
    kind: 'results',
    electionId: election.id,
    matchedAddress: '100 Original Street, MN 55415',
    races: [race('a')],
    coverage: [],
  };
  let reject!: (error: Error) => void;
  const lookup = vi
    .fn<CandidateSearchServices['lookup']>()
    .mockResolvedValueOnce(results)
    .mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
  const services: CandidateSearchServices = {
    getElections: async () => [election],
    suggest: async () => [],
    lookup,
  };
  const flow = createCandidateFlow(services);
  await act(async () =>
    root.render(
      <CandidateSearchContent
        services={services}
        flow={flow}
        initialAddress="100 Original Street"
        onOpenProfile={() => {}}
      />,
    ),
  );
  await flush();
  click(button('Change address'));
  const field = host.querySelector('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field,
      '200 New Street\nUnit 2',
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(field.value).toBe('200 New Street Unit 2');
  expect(host.textContent).toContain('Showing results for 100 Original Street, MN 55415');
  click(button('Find my candidates'));
  await flush();
  expect(host.querySelector('a[href="/candidates/a-person"]')).toBeTruthy();
  await act(async () => reject(new Error('failed')));
  await flush();
  expect(field.value).toBe('200 New Street Unit 2');
  expect(host.textContent).toContain('Showing results for 100 Original Street, MN 55415');
  expect(host.textContent).toContain('We couldn’t update the results');
  expect(host.querySelector('[role="region"]')?.textContent).toContain('About these results');
  expect(
    host
      .querySelector('a[href="/candidates/a-person"]')!
      .compareDocumentPosition(host.querySelector('[role="region"]')!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it('announces initial loading once while the election source is slow', async () => {
  const services: CandidateSearchServices = {
    getElections: () => new Promise(() => {}),
    suggest: async () => [],
    lookup: async () => ({ kind: 'no-match' }),
  };
  await act(async () =>
    root.render(<CandidateSearchContent services={services} onOpenProfile={() => {}} />),
  );
  expect(host.textContent?.match(/Finding candidates…/g)).toHaveLength(1);
  expect(button('Find my candidates').getAttribute('aria-disabled')).toBe('true');
});

it.each([
  ['Associate Justice - Supreme Court 1', 'Associate Justice, Supreme Court, Seat 1'],
  ['Associate Justice - Supreme Court 4', 'Associate Justice, Supreme Court, Seat 4'],
  ['Judge - Supreme Court 4', 'Judge, Supreme Court, Seat 4'],
  ['Judge - Court of Appeals 9', 'Judge, Court of Appeals, Seat 9'],
  ['Judge - 9th District Court 12', 'Judge, 9th District Court, Seat 12'],
])('makes the numbered judicial seat clear for %s', (sourceLabel, expected) => {
  expect(candidateOfficeLabel(sourceLabel)).toBe(expected);
});

it('keeps the retry control mounted and unavailable while replacement results load', async () => {
  const result: CandidateResults = {
    kind: 'results',
    electionId: election.id,
    matchedAddress: '100 Example Street',
    races: [race('old')],
    coverage: [],
  };
  const other: CandidateElection = {
    ...election,
    id: 'primary',
    label: 'State primary',
    type: 'primary',
    date: '2030-08-13',
  };
  let reject!: (error: Error) => void;
  let finish!: (value: CandidateResults) => void;
  const lookup = vi
    .fn<CandidateSearchServices['lookup']>()
    .mockResolvedValueOnce(result)
    .mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((yes) => {
          finish = yes;
        }),
    );
  const services: CandidateSearchServices = {
    getElections: async () => [election, other],
    suggest: async () => [],
    lookup,
  };
  const flow = createCandidateFlow(services);
  await act(async () =>
    flow.search({ address: result.matchedAddress, electionId: election.id }, election),
  );
  await act(async () =>
    root.render(
      <CandidateSearchContent services={services} flow={flow} onOpenProfile={() => {}} />,
    ),
  );
  await flush();
  const menu = host.querySelector<HTMLButtonElement>('button[role="combobox"]')!;
  click(menu);
  click(
    [...host.querySelectorAll('[role="option"]')].find((option) =>
      option.textContent?.includes('State primary'),
    )!,
  );
  await act(async () => reject(new Error('source unavailable')));
  const retry = button('Try again');
  click(retry);
  await flush();
  expect(button('Try again')).toBe(retry);
  expect(retry.getAttribute('aria-disabled')).toBe('true');
  expect(host.textContent?.match(/Updating candidates…/g)).toHaveLength(1);
  expect(host.querySelector('a[href="/candidates/old-person"]')).toBeTruthy();
  expect(host.querySelector('[aria-hidden="true"][style*="opacity: 0"]')?.textContent).toBe(
    'We couldn’t update the results',
  );
  await act(async () => finish({ ...result, electionId: other.id }));
  expect(button('Try again')).toBeUndefined();
});

it('separates real source election dates and office districts only when their facts agree', () => {
  expect(
    candidateElectionLabel({
      id: '8334',
      label: 'November 3, 2026 general election',
      date: '2026-11-03',
      type: 'general',
    }),
  ).toBe('General election');
  expect(
    candidateElectionLabel({
      id: '8334',
      label: 'November 3, 2026 special election',
      date: '2026-11-03',
      type: 'general',
    }),
  ).toBe('November 3, 2026 special election');
  expect(candidateElectionLabel({ ...election, label: 'City election for a special term' })).toBe(
    'City election for a special term',
  );
  expect(candidateOfficeLabel('State Representative District 60B', 'House District 60B')).toBe(
    'State Representative',
  );
  expect(candidateOfficeLabel('State Senator District 60', 'Senate District 60')).toBe(
    'State Senator',
  );
  expect(candidateOfficeLabel('State Representative District 60B', 'House District 60A')).toBe(
    'State Representative District 60B',
  );
  expect(candidateOfficeLabel('State Senator District 60', 'Unknown area')).toBe(
    'State Senator District 60',
  );
  expect(areaLabel('Judicial District 9th')).toBe('9th Judicial District');
});

it.each(['general', 'primary', 'empty'] as const)(
  'keeps one accessible notice after %s results, without inventing affected groups',
  async (scenario) => {
    const selected = {
      ...election,
      type: scenario === 'primary' ? ('primary' as const) : ('general' as const),
    };
    const results: CandidateResults = {
      kind: 'results',
      electionId: selected.id,
      matchedAddress: '100 Example Street',
      races:
        scenario === 'empty'
          ? []
          : [
              { ...race('county', 'County Sheriff'), group: 'county', entries: [] },
              { ...race('school', 'School Board Member'), group: 'school' },
              ...(scenario === 'general'
                ? [{ ...race('other', 'Park Commissioner'), group: 'other' as const }]
                : []),
            ],
      coverage: [
        { kind: 'coverage-unconfirmed', office: '', authority: source.authority, url: source.url },
        {
          kind: 'records-unavailable',
          office: 'Mayor, Sample City',
          authority: source.authority,
          url: source.url,
        },
      ],
    };
    const services: CandidateSearchServices = {
      getElections: async () => [selected],
      suggest: async () => [],
      lookup: async () => results,
    };
    await act(async () =>
      root.render(
        <CandidateSearchContent
          services={services}
          initialAddress="100 Example Street"
          onOpenProfile={() => {}}
        />,
      ),
    );
    await flush();
    const notice = host.querySelector('[role="region"]')!;
    const heading = document.getElementById(notice.getAttribute('aria-labelledby')!);
    expect(heading?.textContent).toBe('About these results');
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(notice.textContent).toContain('Some local offices may be missing');
    expect(notice.textContent).toContain(
      'Candidate records are unavailable for Mayor, Sample City',
    );
    expect(
      notice.querySelector('a[href="https://www.sos.mn.gov/elections-voting/whats-on-my-ballot/"]'),
    ).toBeTruthy();
    expect(host.textContent?.match(/Some local offices may be missing/g)).toHaveLength(1);
    for (const group of host.querySelectorAll('.candidate-group-toggle')) {
      expect(group.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(host.querySelector('nav')?.textContent ?? '').not.toContain('About these results');
    if (scenario === 'empty')
      expect(host.textContent).toContain(
        'No candidate records to show for this address and election',
      );
    else {
      expect(host.textContent).toContain('No candidates listed');
      expect(host.textContent).toContain('The source lists no candidates for this race');
      expect(host.textContent).not.toContain('No filed candidates');
    }
  },
);

it('uses the same source-limited empty wording in Judges', async () => {
  await act(async () =>
    root.render(
      <CandidateRaceGroups
        races={[{ ...race('judge', 'Judge - 9th District Court 12'), entries: [] }]}
        election={election}
        busy={false}
        onOpenProfile={() => {}}
      />,
    ),
  );
  click(button('Judges'));
  expect(host.textContent).toContain('No candidates listed');
  expect(host.textContent).toContain('The source lists no candidates for this race');
  expect(host.textContent).not.toContain('filing records');
});

it.each(['loading', 'failure', 'no-election'] as const)(
  'hides result notices for %s before a successful search',
  async (scenario) => {
    const services: CandidateSearchServices = {
      getElections: async () => (scenario === 'no-election' ? [] : [election]),
      suggest: async () => [],
      lookup: () =>
        scenario === 'failure' ? Promise.reject(new Error('Unavailable')) : new Promise(() => {}),
    };
    await act(async () =>
      root.render(
        <CandidateSearchContent
          services={services}
          initialAddress="100 Example Street"
          onOpenProfile={() => {}}
        />,
      ),
    );
    await flush();
    expect(host.textContent).not.toContain('About these results');
    expect(host.querySelector('[role="region"]')).toBeNull();
  },
);
