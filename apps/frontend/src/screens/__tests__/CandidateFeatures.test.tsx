// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CandidateFeaturesScreen } from '../CandidateFeaturesScreen';
import { CANDIDATE_FEATURE_GROUPS } from '../../lib/candidateFeatures';
import type { CandidateProfileRecord } from '../../components/candidates/types';

const mocks = vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return { getProfile: vi.fn(), title: vi.fn() };
});
vi.mock('../../data/candidates', () => ({ getCandidateProfile: mocks.getProfile }));
vi.mock('../../navigation/documentTitle', () => ({ useDocumentTitle: mocks.title }));
vi.mock('../../theme/primitives', () => ({
  PageBackground: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TopNav: () => <nav>Navigation</nav>,
  Footer: () => <footer>Footer</footer>,
}));
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.PropsWithChildren) => <svg {...props}>{children}</svg>,
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
}));
const id = 'd'.repeat(64);
const record = {
  candidate: { id, name: 'Example Person A' },
  office: 'School board member',
  votingArea: 'Example School District',
  election: { id: 'e', label: 'General election', date: '2026-11-03', type: 'general' },
} as CandidateProfileRecord;
const navigation = { navigate: vi.fn() };
let host: HTMLDivElement;
let root: Root;
async function render(candidateId?: string) {
  await act(async () =>
    root.render(
      <CandidateFeaturesScreen
        navigation={navigation as never}
        route={{ params: candidateId ? { candidateId } : undefined } as never}
      />,
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
}
beforeEach(() => {
  mocks.getProfile.mockReset();
  navigation.navigate.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('labels every feature as on the roadmap and lists all twelve under four headings', async () => {
  await render();
  const text = host.textContent!;
  expect(text).toContain('On the roadmap');
  expect(host.querySelector('[aria-level="1"]')?.textContent).toBe('Candidate profile features');
  expect(CANDIDATE_FEATURE_GROUPS.flatMap((group) => group.items)).toHaveLength(12);
  for (const group of CANDIDATE_FEATURE_GROUPS) {
    expect(text).toContain(group.heading);
    for (const item of group.items) expect(text).toContain(item.title);
  }
  expect(text).toContain('How it works');
  expect(text).toContain('labeled and kept separate from official records');
  for (const banned of ['donation', 'ranking', 'promise score', 'price', 'follower list'])
    expect(text.toLowerCase()).not.toContain(banned);
});
it('treats a direct visit as having no candidate: Go back to /candidates and Find candidates', async () => {
  await render();
  expect(mocks.getProfile).not.toHaveBeenCalled();
  expect(host.querySelector('a[aria-label="Go back"]')?.getAttribute('href')).toBe('/candidates');
  expect(host.querySelector('a[href="/candidates"]:not([aria-label])')?.textContent).toBe(
    'Find candidates',
  );
  expect(host.textContent).not.toContain('Continue claiming this candidate profile');
});
it('returns to the same candidate’s claim step from a card under the introduction', async () => {
  mocks.getProfile.mockResolvedValue(record);
  await render(id);
  expect(mocks.getProfile).toHaveBeenCalledWith(id, expect.any(AbortSignal));
  const text = host.textContent!;
  expect(text).toContain('Example Person A');
  expect(text).toContain('School board member');
  const resume = host.querySelector<HTMLAnchorElement>(
    `a[href="/candidates/${id}/claim"]:not([aria-label])`,
  )!;
  expect(resume.textContent).toBe('Continue claiming this candidate profile');
  expect(text.indexOf('Continue claiming')).toBeLessThan(text.indexOf('Who you are'));
  expect(text).not.toContain('Find candidates');
  expect(host.querySelector('a[aria-label="Go back"]')?.getAttribute('href')).toBe(
    `/candidates/${id}/claim`,
  );
  act(() => resume.click());
  expect(navigation.navigate).toHaveBeenCalledWith('CandidateClaim', { candidateId: id });
});
it('falls back to a direct visit when the candidate cannot be confirmed', async () => {
  mocks.getProfile.mockRejectedValue(new Error('not found'));
  await render(id);
  expect(host.textContent).not.toContain('Continue claiming this candidate profile');
  expect(host.textContent).toContain('Find candidates');
});
