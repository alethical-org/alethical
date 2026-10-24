// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PersonOverviewScreen } from '../PersonOverviewScreen';
import { rememberReturnPageName, returnPageName } from '../../navigation/returnDestination';
import type { PersonRecord } from '../../data/personRecords';
import { ApiError } from '../../data/api';

const getPersonRecord = vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return vi.fn();
});
vi.mock('../../data/personRecords', () => ({ getPersonRecord }));
vi.mock('../../navigation/documentTitle', () => ({ useDocumentTitle: () => {} }));
vi.mock('../../theme/primitives', () => ({
  PageBackground: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TopNav: () => <nav />,
  Footer: () => <footer />,
}));
vi.mock('react-native-svg', () => ({
  default: ({ children }: React.PropsWithChildren) => <svg>{children}</svg>,
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
}));
vi.mock('../redesign/NotFoundScreen', () => ({ NotFoundScreen: () => <p>Page not found</p> }));
vi.mock('../../components/candidates/PersonOverviewContent', async () => {
  const { GoBackLink } = await import('../../components/GoBackLink');
  return {
    PersonOverviewContent: ({
      returnUrl,
      returnName,
      onBack,
    }: {
      returnUrl: string;
      returnName: string;
      onBack(): void;
    }) => <GoBackLink href={returnUrl} destinationName={returnName} onPress={onBack} />,
  };
});
const person: PersonRecord = {
  id: 'aaaaaaaa-1111-2222-3333-444444444444',
  name: 'Public Person',
  service: [],
  elections: [
    {
      candidateId: 'served-candidate',
      profileUrl: '/candidates/served-candidate',
      name: 'Filed Candidate Name',
      office: 'State Representative',
      votingArea: 'District 1',
      election: { id: 'e', label: 'General election', date: '2026-11-03', type: 'general' },
      source: {
        authority: 'Official source',
        url: 'https://example.org',
        checkedDate: '2026-10-13',
      },
      isJointTicket: false,
    },
  ],
  research: { items: [], nextCursor: null },
  legislator: { slug: 'served-legislator', profileUrl: '/legislators/served-legislator' },
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  getPersonRecord.mockReset().mockResolvedValue(person);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render(params: { fromCandidateId?: string; fromLegislatorSlug?: string } = {}) {
  await act(async () =>
    root.render(
      <PersonOverviewScreen
        navigation={{ navigate: vi.fn() } as never}
        route={{ params: { personId: person.id, ...params } } as never}
      />,
    ),
  );
}
function expectReturn(name: string, href: string) {
  const link = host.querySelector<HTMLAnchorElement>(`a[aria-label="Back to ${name}"]`)!;
  expect(link?.textContent).toBe(`Back to ${name}`);
  expect(link?.getAttribute('href')).toBe(href);
}
it('uses a matched election’s filed candidate name and registers the served person name', async () => {
  await render({ fromCandidateId: 'served-candidate' });
  expectReturn('Filed Candidate Name’s candidate profile', '/candidates/served-candidate');
  expect(returnPageName(`/people/${person.id}`)).toBe('Public Person');
});
it('does not trust a candidate identifier outside this person’s election records', async () => {
  await render({ fromCandidateId: 'unrelated-candidate' });
  expectReturn('Find my candidates', '/candidates');
});
it('uses a safe legislator list when the served legislator display name is unknown', async () => {
  await render({ fromLegislatorSlug: 'served-legislator' });
  expectReturn('Search legislators', '/legislators');
});
it('uses the actual served legislator name when the matching public profile is known', async () => {
  rememberReturnPageName('/legislators/served-legislator', 'Rep. Filed Legislator Name');
  await render({ fromLegislatorSlug: 'served-legislator' });
  expectReturn('Rep. Filed Legislator Name', '/legislators/served-legislator');
});
it('keeps a named safe return while the person record is still loading', async () => {
  getPersonRecord.mockReturnValue(new Promise(() => {}));
  await render({ fromCandidateId: 'served-candidate' });
  expectReturn('Find my candidates', '/candidates');
});

it('forgets a previously loaded person name when a later visit confirms the record is missing', async () => {
  await render();
  expect(returnPageName(`/people/${person.id}`)).toBe('Public Person');
  act(() => root.unmount());
  root = createRoot(host);
  getPersonRecord.mockRejectedValue(new ApiError(404, 'Record missing'));
  await render();
  expect(host.textContent).toBe('Page not found');
  expect(returnPageName(`/people/${person.id}`)).toBeNull();
});
it('retains a previously loaded person name when a later visit has a temporary network failure', async () => {
  await render();
  act(() => root.unmount());
  root = createRoot(host);
  getPersonRecord.mockRejectedValue(new Error('Network unavailable'));
  await render();
  expect(host.textContent).toContain('Person profile is unavailable');
  expect(returnPageName(`/people/${person.id}`)).toBe('Public Person');
  expectReturn('Find my candidates', '/candidates');
});
