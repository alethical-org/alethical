// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CandidateProfileRecord,
  CandidateSearchServices,
} from '../../components/candidates/types';
import {
  candidateLookupPageSnapshot,
  candidateProfilePageSnapshot,
} from '../candidatePageSnapshot';
import { legalPageSnapshot } from '../legalPageSnapshot';
import type { PageSnapshot } from '../pageSnapshot';
import { personPageSnapshot } from '../personPageSnapshot';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
vi.mock('react-native-svg', () => ({ default: () => null, Path: () => null, Circle: () => null }));
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isDesktop: true, isTablet: false, width: 1200 }),
}));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate() {} }) }));
vi.mock('../../theme/primitives', () => ({
  Container: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PageBackground: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TopNav: () => null,
  Footer: () => null,
}));
const { CandidateProfileContent } =
  await import('../../components/candidates/CandidateProfileContent');
const { CandidateSearchContent } =
  await import('../../components/candidates/CandidateSearchContent');
const { PrivacyScreen, TermsScreen } = await import('../../screens/LegalScreens');

function screenText(html: string) {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element.textContent!.replace(/\s+/g, ' ');
}
function snapshotLines(snapshot: PageSnapshot): string[] {
  return [
    snapshot.heading,
    snapshot.subheading,
    snapshot.bodyHeading,
    ...snapshot.body,
    ...(snapshot.backLink ? [snapshot.backLink.label] : []),
    ...snapshot.facts.flatMap((fact) => [fact.label, ...fact.lines]),
    ...(snapshot.sections ?? []).flatMap((section) => [
      section.heading.replace(/^\d+ /, ''),
      ...(section.body ?? []),
      ...(section.items ?? []).flatMap((item) => [
        item.label,
        ...(item.detail ? [item.detail] : []),
      ]),
      ...(section.blocks ?? []).flatMap((block) =>
        block.kind === 'prose'
          ? block.lines
          : block.kind === 'bullets'
            ? block.items
            : block.kind === 'runs'
              ? [block.runs.map((run) => run.text).join('')]
              : [],
      ),
    ]),
    ...snapshot.links.map((link) => link.label),
  ].filter(Boolean);
}
const record: CandidateProfileRecord = {
  candidate: {
    id: 'a'.repeat(64),
    name: 'Public Candidate',
    sortName: 'Candidate, Public',
    party: 'NONPARTISAN',
  },
  office: 'State Representative, District 1A',
  votingArea: 'House District 1A',
  election: {
    id: '8334',
    date: '2026-11-03',
    label: 'November 3, 2026 State General Election',
    type: 'general',
  },
  source: {
    authority: 'Minnesota Secretary of State',
    url: 'https://myballotmn.sos.mn.gov/',
    checkedDate: '2026-10-01',
    stale: true,
  },
  website: 'https://campaign.example.org/',
  legislator: {
    id: 'held-legislator',
    slug: 'public-candidate',
    name: 'Public Candidate',
    profileUrl: '/legislators/public-candidate',
    serviceStatus: 'current',
    isReelection: true,
    office: 'State Representative',
    votingArea: 'House District 1A',
    source: { authority: 'Minnesota House of Representatives', url: 'https://www.house.mn.gov/' },
  },
};
afterEach(() => vi.useRealTimers());

describe('public first-response copy matches the actual screens', () => {
  it.each([undefined, '2024-11-12'])(
    'keeps certification with optional date %s in candidate and person first responses',
    (date) => {
      const result = {
        status: 'certified' as const,
        outcome: 'elected' as const,
        source: record.source,
        certification: { authority: record.source.authority, url: record.source.url, date },
      };
      const profile = { ...record, result };
      const expected = date ? 'Certified November 12, 2024' : 'Certified';
      const person = personPageSnapshot({
        id: '00000000-0000-4000-8000-000000000084',
        name: record.candidate.name,
        service: [],
        research: { items: [], nextCursor: null },
        elections: [
          {
            candidateId: record.candidate.id,
            profileUrl: `/candidates/${record.candidate.id}`,
            name: record.candidate.name,
            election: record.election,
            office: record.office,
            votingArea: record.votingArea,
            source: record.source,
            isJointTicket: false,
            result,
          },
        ],
      });
      for (const snapshot of [candidateProfilePageSnapshot(profile), person]) {
        expect(snapshotLines(snapshot)).toContain('Election results');
        expect(snapshotLines(snapshot)).toContain(expected);
      }
      const shown = screenText(
        renderToStaticMarkup(<CandidateProfileContent record={profile} onBack={() => {}} />),
      );
      expect(shown).toContain(expected);
    },
  );
  it('opens the official Google policy from the visible privacy wording', () => {
    const element = document.createElement('div');
    element.innerHTML = renderToStaticMarkup(<PrivacyScreen />);
    const link = [...element.querySelectorAll('a')].find(
      (anchor) => anchor.textContent === 'Google API Services User Data Policy',
    );
    expect(link?.getAttribute('href')).toBe(
      'https://developers.google.com/terms/api-services-user-data-policy',
    );
    expect(link?.getAttribute('rel')).toContain('noopener');
  });
  it('serves the same candidate lookup instructions without running an address search', () => {
    const services: CandidateSearchServices = {
      getElections: vi.fn(async () => []),
      suggest: vi.fn(async () => []),
      lookup: vi.fn(async () => ({ kind: 'no-match' as const })),
    };
    const shown = screenText(
      renderToStaticMarkup(<CandidateSearchContent services={services} onOpenProfile={() => {}} />),
    );
    for (const line of snapshotLines(candidateLookupPageSnapshot())) expect(shown).toContain(line);
    expect(services.lookup).not.toHaveBeenCalled();
    expect(services.suggest).not.toHaveBeenCalled();
  });
  it.each(['current', 'former', 'unknown'] as const)(
    'preserves the public facts and %s service meaning',
    (status) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
      const profile = { ...record, legislator: { ...record.legislator!, serviceStatus: status } };
      expect(candidateProfilePageSnapshot(profile).backLink).toEqual({
        label: 'Go back',
        href: '/candidates',
      });
      const shown = screenText(
        renderToStaticMarkup(<CandidateProfileContent record={profile} onBack={() => {}} />),
      );
      for (const line of snapshotLines(candidateProfilePageSnapshot(profile)))
        expect(shown).toContain(line);
    },
  );
  it('uses past-election wording for the joint ticket and names only the confirmed linked member', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    const profile = {
      ...record,
      isJointTicket: true,
      candidate: { ...record.candidate, name: 'Public Candidate and Running Mate' },
    };
    const snapshot = candidateProfilePageSnapshot(profile);
    const shown = screenText(
      renderToStaticMarkup(<CandidateProfileContent record={profile} onBack={() => {}} />),
    );
    for (const line of snapshotLines(snapshot)) expect(shown).toContain(line);
    expect(snapshot.sections?.[1].body).toContain('Candidate for');
    expect(snapshot.sections?.[1].body).not.toContain('Running for reelection');
  });
  it.each([
    ['/privacy', PrivacyScreen],
    ['/terms', TermsScreen],
  ] as const)('serves all the legal text the %s screen shows', (path, Screen) => {
    const shown = screenText(renderToStaticMarkup(<Screen />));
    for (const line of snapshotLines(legalPageSnapshot(path))) expect(shown).toContain(line);
  });
});
