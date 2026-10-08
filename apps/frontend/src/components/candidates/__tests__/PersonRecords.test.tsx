// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PersonOverviewContent } from '../PersonOverviewContent';
import { CandidateProfileContent } from '../CandidateProfileContent';
import { CandidateSearchContent } from '../CandidateSearchContent';
import { createCandidateFlow } from '../candidateFlow';
import { PersonResearch } from '../PersonResearch';
import { getPersonResearch, type PersonRecord } from '../../../data/personRecords';
import { defaultCandidateElection, preciseDate } from '../../../lib/personRecords';
import type { CandidateProfileRecord, CandidateSearchServices } from '../types';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../../../data/personRecords', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../data/personRecords')>()),
  getPersonResearch: vi.fn(),
}));
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.PropsWithChildren) => <svg {...props}>{children}</svg>,
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
}));
const source = {
  authority: 'Example School District',
  url: 'https://example.org/source',
  checkedDate: '2026-10-08',
};
const election = {
  id: 'past',
  label: 'General election',
  date: '2024-11-05',
  type: 'general' as const,
};
const profile: CandidateProfileRecord = {
  candidate: { id: 'a'.repeat(64), name: 'Example Person', sortName: 'Example Person' },
  election,
  office: 'School board member',
  votingArea: 'Example District',
  source: { ...source, retained: true },
  electionEnded: true,
  people: [{ id: 'person-one', name: 'Example Person', profileUrl: '/people/person-one' }],
  result: {
    status: 'certified',
    outcome: 'elected',
    source,
    certification: { date: '2024-11-12', authority: source.authority, url: source.url },
  },
};
const person: PersonRecord = {
  id: 'person-one',
  name: profile.candidate.name,
  service: [
    {
      id: 'service',
      status: 'elected',
      office: profile.office,
      votingArea: profile.votingArea,
      source,
      expectedStart: { value: '2025-01', precision: 'month' },
      expectedStartPassed: true,
    },
  ],
  elections: [
    {
      candidateId: profile.candidate.id,
      profileUrl: `/candidates/${profile.candidate.id}`,
      name: profile.candidate.name,
      election,
      office: profile.office,
      votingArea: profile.votingArea,
      source,
      isJointTicket: false,
      result: profile.result,
    },
  ],
  research: {
    items: [
      {
        id: 'research',
        type: 'official-record',
        title: 'Example public meeting minutes',
        publisher: source.authority,
        eventDate: '2024-11-12',
        source,
        context: {
          kind: 'election',
          candidateId: profile.candidate.id,
          election,
          office: profile.office,
        },
        status: 'available',
      },
    ],
    nextCursor: null,
  },
};
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
  vi.clearAllMocks();
});
const click = (label: string) =>
  act(() =>
    [...host.querySelectorAll<HTMLElement>('button,[role="button"]')]
      .find((button) => button.textContent?.includes(label))!
      .click(),
  );

it('keeps election and identity links exact and uses the server cutoff and saved ballot wording', async () => {
  const openPerson = vi.fn();
  await act(async () =>
    root.render(
      <CandidateProfileContent record={profile} onBack={() => {}} onOpenPerson={openPerson} />,
    ),
  );
  expect(host.textContent).toContain('Candidate for');
  expect(host.textContent).toContain('Ballot record saved October 8, 2026');
  expect(host.textContent).toContain('Certified November 12, 2024');
  const link = host.querySelector<HTMLAnchorElement>('a[href*="?candidate="]')!;
  expect(link.href).toContain(profile.candidate.id);
  expect(document.getElementById(link.getAttribute('aria-describedby')!)?.textContent).toBe(
    'Elections and service over time',
  );
  act(() => link.click());
  expect(openPerson).toHaveBeenCalledWith(person.id);
});
it('never turns a passed expected month into actual service and preserves each research source date', async () => {
  await act(async () =>
    root.render(
      <PersonOverviewContent
        record={person}
        returnLabel="Back to election record"
        returnUrl={`/candidates/${profile.candidate.id}`}
        onBack={() => {}}
        onCandidate={() => {}}
        onLegislator={() => {}}
      />,
    ),
  );
  expect(host.textContent).toContain('Expected start January 2025');
  expect(host.textContent).toContain('Current service not confirmed');
  expect(host.textContent).not.toContain('Started January');
  expect(host.textContent).not.toContain('January 1,');
  expect(host.querySelector('a[href="https://example.org/source"]')?.getAttribute('target')).toBe(
    '_blank',
  );
  click('Source details');
  expect(host.textContent).toContain('Checked October 8, 2026');
});
it('retains research and open details while more records load, fail, and retry', async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(getPersonResearch)
    .mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    )
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  await act(async () =>
    root.render(
      <PersonResearch
        personId={person.id}
        initial={{ ...person.research, nextCursor: 'next' }}
        inset={22}
      />,
    ),
  );
  click('Source details');
  click('Show more records');
  expect(host.textContent).toContain('Updating research records…');
  expect(host.textContent).toContain('Example public meeting minutes');
  expect(host.textContent).toContain('Checked October 8, 2026');
  await act(async () => reject(new Error('unavailable')));
  expect(host.textContent).toContain('Research records are unavailable');
  click('Try again');
  await act(async () => {
    await Promise.resolve();
  });
  expect(host.textContent).toContain('Example public meeting minutes');
  expect(host.textContent).toContain('Checked October 8, 2026');
  expect(host.textContent).not.toContain('Show more records');
});
it('preserves current results when historical address matching is unavailable', async () => {
  const current = { ...election, id: 'current', date: '2030-11-05' };
  const services: CandidateSearchServices = {
    getElections: async () => [current, election],
    suggest: async () => [],
    lookup: async (request) =>
      request.electionId === election.id
        ? {
            kind: 'historical-match-unavailable',
            message: '',
            electionId: election.id,
            officialResultsUrl: 'https://example.org/official-results',
          }
        : {
            kind: 'results',
            electionId: current.id,
            matchedAddress: '100 Example Street',
            coverage: [],
            races: [
              {
                id: 'race',
                group: 'school',
                office: profile.office,
                votingArea: profile.votingArea,
                entries: [{ kind: 'candidate', candidate: profile.candidate }],
                source,
              },
            ],
          },
  };
  const flow = createCandidateFlow(services);
  await flow.search({ address: '100 Example Street', electionId: current.id }, current);
  await act(async () =>
    root.render(
      <CandidateSearchContent services={services} flow={flow} onOpenProfile={() => {}} />,
    ),
  );
  await act(async () =>
    flow.search({ address: '100 Example Street', electionId: election.id }, election),
  );
  expect(host.textContent).toContain('We couldn’t confirm the races for this address and election');
  expect(host.textContent).toContain('Example Person');
  expect(host.textContent).toContain('November 5, 2030');
  expect(host.querySelector('a[href="https://example.org/official-results"]')).toBeTruthy();
});
it('chooses nearest upcoming then most recent past and preserves month precision', () => {
  const next = { ...election, id: 'next', date: '2028-11-07' };
  expect(defaultCandidateElection([next, election], new Date('2026-10-08T12:00:00Z'))?.id).toBe(
    'next',
  );
  expect(defaultCandidateElection([election, next], new Date('2030-10-08T12:00:00Z'))?.id).toBe(
    'next',
  );
  expect(preciseDate({ value: '2025-01', precision: 'month' })).toBe('January 2025');
});
