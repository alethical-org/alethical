// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CandidateProfileContent } from '../CandidateProfileContent';
import { CandidateClaimPanel } from '../CandidateClaimPanel';
import { CandidateButton } from '../CandidateControls';
import { ElectionOutcome, ElectionResultStatus } from '../ElectionResult';
import type { CandidateElectionResult, CandidateProfileRecord } from '../types';
import type { CandidateClaimStatus } from '../../../data/candidateClaims';

const state = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return { mobile: false, admin: false };
});
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: state.mobile, isTablet: false, isDesktop: !state.mobile }),
}));
vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({
    isLoading: false,
    isSignedIn: true,
    user: { id: 'account' },
    accessToken: 'test',
  }),
}));
vi.mock('../../../hooks/useAdminAccess', () => ({
  useAdminAccess: () => ({ state: state.admin ? 'allowed' : 'restricted' }),
}));
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.PropsWithChildren) => <svg {...props}>{children}</svg>,
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
}));
const source = {
  authority: 'Example Election Office',
  url: 'https://example.org/ballot',
  checkedDate: '2026-10-08',
};
const resultsSource = { ...source, url: 'https://example.org/results' };
const profile: CandidateProfileRecord = {
  candidate: {
    id: 'a'.repeat(64),
    name: 'Example Person',
    sortName: 'Person, Example',
    party: 'Example Party',
  },
  election: { id: 'general', label: 'General election', date: '2026-11-03', type: 'general' },
  office: 'School board member',
  votingArea: 'Example School District',
  source,
};
let host: HTMLDivElement;
let root: Root;
const render = async (node: React.ReactNode) => act(async () => root.render(node));
const status = () => host.querySelector<HTMLElement>('[data-testid="candidate-record-status"]');
const exactText = (text: string) =>
  [...host.querySelectorAll<HTMLElement>('*')].filter(
    (node) =>
      node.textContent === text && ![...node.children].some((child) => child.textContent === text),
  );
beforeEach(() => {
  state.mobile = false;
  state.admin = false;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it.each([
  ['elected', 'Elected', 'rgb(228, 248, 238)'],
  ['not-elected', 'Not elected', 'rgb(253, 236, 236)'],
  ['withdrew', 'Withdrew from election', 'rgb(241, 242, 244)'],
] as const)(
  'shows the final %s record in its double frame, with a hidden icon',
  async (outcome, label, fill) => {
    await render(
      <CandidateProfileContent
        record={{ ...profile, result: { status: 'certified', outcome, source: resultsSource } }}
        onBack={() => {}}
      />,
    );
    expect(status()?.textContent).toBe(label);
    expect(status()?.style.backgroundColor).toBe(fill);
    expect(getComputedStyle(status()!).borderWidth).toBe('1.5px');
    expect(getComputedStyle(status()?.firstElementChild as HTMLElement).borderWidth).toBe('1.5px');
    expect(status()?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(getComputedStyle(status()!.querySelector('svg')!.parentElement!).boxShadow).toContain(
      '0 0 0 4px',
    );
    expect(exactText('Election results')).toHaveLength(1);
    expect(exactText('Certified')).toHaveLength(1);
  },
);

it.each([
  ['pending', 'Election results pending'],
  ['unofficial', 'Unofficial election results'],
  ['recount', 'Election recount in progress'],
  ['tie', 'Election tie unresolved'],
  ['unavailable', 'Election results unavailable'],
] as const)(
  'names %s once on the profile and keeps vote outcomes hidden until certified',
  async (kind, label) => {
    await render(
      <CandidateProfileContent
        record={{ ...profile, result: { status: kind, outcome: 'elected', source: resultsSource } }}
        onBack={() => {}}
      />,
    );
    expect(status()?.textContent).toBe(label);
    expect(exactText(label)).toHaveLength(1);
    expect(host.textContent).not.toContain('Elected');
    expect(status()?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(status()?.style.backgroundColor).toBe(
      kind === 'unavailable' ? 'rgb(255, 255, 255)' : 'rgb(241, 242, 244)',
    );
    expect(getComputedStyle(status()?.firstElementChild as HTMLElement).borderWidth).toBe('0px');
    expect(host.textContent?.includes('These results have not been certified')).toBe(
      kind === 'unofficial',
    );
  },
);

it('keeps sourced withdrawal final even when no vote result is certified', async () => {
  await render(
    <CandidateProfileContent
      record={{ ...profile, result: { status: 'pending', outcome: 'withdrew' } }}
      onBack={() => {}}
    />,
  );
  expect(status()?.textContent).toBe('Withdrew from election');
  expect(exactText('Election results pending')).toHaveLength(1);
});

it.each([false, true])(
  'keeps certification without an outcome in the source area on mobile=%s',
  async (mobile) => {
    state.mobile = mobile;
    await render(
      <CandidateProfileContent
        record={{ ...profile, result: { status: 'certified', source: resultsSource } }}
        onBack={() => {}}
      />,
    );
    expect(status()).toBeNull();
    expect(exactText('Election results')).toHaveLength(1);
    expect(exactText('Certified')).toHaveLength(1);
    expect(host.textContent).not.toContain('Certified election results');
  },
);

it('has no outcome or results area before an election when no result is supplied', async () => {
  await render(<CandidateProfileContent record={profile} onBack={() => {}} />);
  expect(status()).toBeNull();
  expect(host.textContent).toContain('Running for');
  expect(host.textContent).toContain('Checked October 8, 2026');
  expect(host.querySelector('a[href="https://example.org/results"]')).toBeNull();
});

it('shares only equal checked dates, preserves retained ballot meaning, and keeps source links native', async () => {
  const result: CandidateElectionResult = {
    status: 'certified',
    outcome: 'elected',
    source: resultsSource,
    certification: { authority: source.authority, url: resultsSource.url, date: '2026-11-16' },
  };
  await render(<CandidateProfileContent record={{ ...profile, result }} onBack={() => {}} />);
  expect(exactText('Both checked October 8, 2026')).toHaveLength(1);
  expect(exactText('Checked October 8, 2026')).toHaveLength(0);
  expect(host.textContent).toContain('Certified November 16, 2026');
  for (const url of [source.url, resultsSource.url]) {
    const link = host.querySelector<HTMLAnchorElement>(`a[href="${url}"]`)!;
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  }
  await render(
    <CandidateProfileContent
      record={{ ...profile, source: { ...source, retained: true }, result }}
      onBack={() => {}}
    />,
  );
  expect(host.textContent).toContain('Ballot record saved October 8, 2026');
  expect(exactText('Checked October 8, 2026')).toHaveLength(1);
  expect(host.textContent).not.toContain('Both checked');
  await render(
    <CandidateProfileContent
      record={{
        ...profile,
        result: { ...result, source: { ...resultsSource, checkedDate: '2026-10-09' } },
      }}
      onBack={() => {}}
    />,
  );
  expect(exactText('Checked October 8, 2026')).toHaveLength(1);
  expect(exactText('Checked October 9, 2026')).toHaveLength(1);
  expect(host.textContent).not.toContain('Both checked');
  expect(host.textContent).not.toContain('Updated');
});

it('puts the phone status after the office and before the area without changing desktop facts', async () => {
  state.mobile = true;
  await render(
    <CandidateProfileContent
      record={{ ...profile, result: { status: 'certified', outcome: 'elected' } }}
      onBack={() => {}}
    />,
  );
  const office = exactText(profile.office)[0];
  const area = exactText(profile.votingArea)[0];
  expect(office.compareDocumentPosition(status()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(status()!.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(status()?.style.width).toBe('100%');
});

it.each(['certified', 'pending', 'unofficial', 'recount', 'tie', 'unavailable'] as const)(
  'uses neutral %s badges wherever the shared badge is rendered',
  async (kind) => {
    await render(<ElectionResultStatus result={{ status: kind }} />);
    const badge = host.querySelector('svg')!.parentElement!;
    expect(getComputedStyle(badge).backgroundColor).toBe(
      kind === 'unavailable' ? 'rgb(255, 255, 255)' : 'rgb(241, 242, 244)',
    );
    expect(host.querySelector('svg path')?.getAttribute('stroke')).toBe('#4f5651');
  },
);
it('shows a red cross with Not elected in small election rows', async () => {
  await render(<ElectionOutcome result={{ status: 'certified', outcome: 'not-elected' }} />);
  expect(host.textContent).toBe('Not elected');
  expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(host.querySelector('svg path')?.getAttribute('stroke')).toBe('#c62828');
  expect(getComputedStyle(host.querySelector('svg')!.parentElement!).backgroundColor).toBe(
    'rgb(253, 236, 236)',
  );
});

it.each(['pending', 'rejected', 'withdrawn', 'revoked', 'approved'] as const)(
  'preserves the %s claim action and gives secondary actions white words on black',
  async (claimStatus: CandidateClaimStatus) => {
    const onClaim = vi.fn();
    const onManage = vi.fn();
    await render(
      <CandidateClaimPanel
        record={profile}
        onClaim={onClaim}
        onManage={onManage}
        onAdmin={() => {}}
        services={{
          getStatement: async () => ({ statement: null }),
          reportStatement: vi.fn(),
          getClaims: async () => ({
            account_id: 'account',
            claims: [
              {
                id: 'claim',
                candidate_id: profile.candidate.id,
                candidate_name: profile.candidate.name,
                office: profile.office,
                status: claimStatus,
                evidence_url: '',
                request_note: '',
                version: 1,
              },
            ],
          }),
        }}
      />,
    );
    const owner = claimStatus === 'approved';
    const link = host.querySelector<HTMLAnchorElement>(
      `a[href="/candidates/${profile.candidate.id}/${owner ? 'manage' : 'claim'}"]`,
    )!;
    expect(link.textContent).toBe(owner ? 'Manage this profile' : 'View profile claim status');
    expect(getComputedStyle(link).backgroundColor).toBe(
      owner ? 'rgb(46, 212, 126)' : 'rgb(17, 21, 15)',
    );
    expect(getComputedStyle(link.firstElementChild as HTMLElement).color).toBe(
      owner ? 'rgb(6, 35, 26)' : 'rgb(255, 255, 255)',
    );
    act(() => link.click());
    expect(owner ? onManage : onClaim).toHaveBeenCalledOnce();
  },
);
it('keeps admin review black and public claiming green', async () => {
  const props = {
    record: profile,
    onClaim: vi.fn(),
    onManage: vi.fn(),
    onAdmin: vi.fn(),
    services: {
      getStatement: async () => ({ statement: null }),
      reportStatement: vi.fn(),
      getClaims: async () => ({ account_id: 'account', claims: [] }),
    },
  };
  await render(<CandidateClaimPanel {...props} />);
  expect(host.querySelector<HTMLAnchorElement>('a')?.textContent).toBe(
    'Claim this candidate profile',
  );
  expect(getComputedStyle(host.querySelector<HTMLAnchorElement>('a')!).backgroundColor).toBe(
    'rgb(46, 212, 126)',
  );
  state.admin = true;
  await render(<CandidateClaimPanel {...props} />);
  const admin = host.querySelector<HTMLAnchorElement>('a')!;
  expect(admin.textContent).toBe('Review profile claim requests');
  expect(getComputedStyle(admin).backgroundColor).toBe('rgb(17, 21, 15)');
  expect(admin.getAttribute('href')).toContain('/admin/candidate-claims?candidate=');
  act(() => admin.click());
  expect(props.onAdmin).toHaveBeenCalledOnce();
});
it('keeps black reserved-label buttons readable and prevents busy presses', async () => {
  const pressed = vi.fn();
  await render(
    <CandidateButton
      label="View profile claim status"
      kind="black"
      icon="none"
      reserveBusyLabel
      busyLabel="Loading profile claim status…"
      busy
      onPress={pressed}
    />,
  );
  const button = host.querySelector<HTMLElement>('[role="button"]')!;
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(
    exactText('Loading profile claim status…').some(
      (node) => node.style.color === 'rgb(255, 255, 255)',
    ),
  ).toBe(true);
  act(() => button.click());
  expect(pressed).not.toHaveBeenCalled();
});
