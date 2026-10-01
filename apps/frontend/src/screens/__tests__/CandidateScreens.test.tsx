// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CandidateProfileScreen } from '../CandidateProfileScreen';
import type { CandidateProfileRecord } from '../../components/candidates/types';

const { getProfile } = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return { getProfile: vi.fn() };
});
vi.mock('../../components/candidates/CandidateClaimPanel', () => ({
  CandidateClaimPanel: () => null,
}));
vi.mock('../../data/candidates', () => ({
  getCandidateProfile: getProfile,
  candidateFlow: { getState: () => ({ displayed: null }), clear: vi.fn() },
}));
vi.mock('../../navigation/documentTitle', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../../theme/primitives', () => ({
  PageBackground: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TopNav: () => <nav>Navigation</nav>,
  Footer: () => <footer>Footer</footer>,
}));
vi.mock('../redesign/NotFoundScreen', () => ({ NotFoundScreen: () => <p>Page not found</p> }));
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.PropsWithChildren) => <svg {...props}>{children}</svg>,
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
}));
const id = 'a'.repeat(64);
const secondId = 'b'.repeat(64);
const record: CandidateProfileRecord = {
  candidate: { id, name: 'Public Candidate', sortName: 'Candidate, Public' },
  office: 'State Representative',
  votingArea: 'House District 1A',
  election: { id: '8334', label: 'General election', date: '2026-11-03', type: 'general' },
  source: {
    authority: 'Minnesota Secretary of State',
    url: 'https://myballotmn.sos.mn.gov/',
    checkedDate: '2026-09-30',
    stale: true,
  },
};
let host: HTMLDivElement;
let root: Root;
const navigate = vi.fn();
function render(candidateId = id) {
  act(() =>
    root.render(
      <CandidateProfileScreen
        navigation={{ navigate } as never}
        route={{ params: { candidateId } } as never}
      />,
    ),
  );
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
beforeEach(() => {
  getProfile.mockReset();
  navigate.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('opens a direct public profile with the record’s own election and source date, and returns to candidates', async () => {
  getProfile.mockResolvedValue(record);
  render();
  expect(host.textContent).toContain('Loading candidate record');
  await flush();
  expect(host.textContent).toContain('Public Candidate');
  expect(host.textContent).toContain('November 3, 2026');
  expect(host.textContent).toContain('Checked September 30, 2026');
  expect(host.textContent).toContain('May be out of date');
  act(() => host.querySelector<HTMLAnchorElement>('a[href="/candidates"]')!.click());
  expect(navigate).toHaveBeenCalledWith('Candidates');
});
it('distinguishes absent records from service failures and offers retry', async () => {
  const { ApiError } = await import('../../data/api');
  getProfile.mockRejectedValueOnce(new ApiError(404, 'Not found'));
  render();
  await flush();
  expect(host.textContent).toContain('Page not found');
  getProfile.mockRejectedValueOnce(new Error('Service unavailable')).mockResolvedValueOnce(record);
  render(secondId);
  await flush();
  expect(host.textContent).toContain('Candidate record is unavailable');
  expect(host.textContent).not.toContain('Page not found');
  act(() =>
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Try again')!
      .click(),
  );
  await flush();
  expect(host.textContent).toContain('Public Candidate');
});
it('cancels an old profile request and prevents its late response from replacing a newer record', async () => {
  let finish!: (record: CandidateProfileRecord) => void;
  let oldSignal!: AbortSignal;
  getProfile
    .mockImplementationOnce((_: string, signal: AbortSignal) => {
      oldSignal = signal;
      return new Promise<CandidateProfileRecord>((resolve) => {
        finish = resolve;
      });
    })
    .mockResolvedValueOnce({
      ...record,
      candidate: { ...record.candidate, id: secondId, name: 'Second Candidate' },
    });
  render();
  render(secondId);
  await flush();
  expect(oldSignal.aborted).toBe(true);
  expect(host.textContent).toContain('Second Candidate');
  await act(async () => finish(record));
  expect(host.textContent).not.toContain('Public Candidate');
  expect(host.textContent).toContain('Second Candidate');
});
