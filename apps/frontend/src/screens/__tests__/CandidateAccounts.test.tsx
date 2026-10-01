// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CandidateClaimScreen, CandidateManageScreen } from '../CandidateAccountScreens';
import { AdminCandidateClaimsScreen } from '../AdminCandidateClaimsScreen';
import { CandidateClaimPanel } from '../../components/candidates/CandidateClaimPanel';
import type { CandidateProfileRecord } from '../../components/candidates/types';

const mocks = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return {
    auth: {
      isLoading: false,
      isSignedIn: true,
      user: { id: 'account-a', isAdmin: true },
      accessToken: 'token-a',
    },
    admin: 'allowed',
    focused: true,
    getProfile: vi.fn(),
    mine: vi.fn(),
    privateStatement: vi.fn(),
    publicStatement: vi.fn(),
    apply: vi.fn(),
    withdraw: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    report: vi.fn(),
    queue: vi.fn(),
    reports: vi.fn(),
    review: vi.fn(),
    resolve: vi.fn(),
    signIn: vi.fn(),
    prevent: vi.fn(),
  };
});
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../providers/signInModalContext', () => ({
  useSignInModal: () => ({ openSignIn: mocks.signIn }),
}));
vi.mock('../../hooks/useAdminAccess', () => ({
  useAdminAccess: () => ({ state: mocks.admin, retry: vi.fn() }),
}));
vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => mocks.focused,
  usePreventRemove: mocks.prevent,
}));
vi.mock('../../data/candidates', () => ({ getCandidateProfile: mocks.getProfile }));
vi.mock('../../data/candidateClaims', () => ({
  getMyCandidateClaims: mocks.mine,
  getPrivateCandidateStatement: mocks.privateStatement,
  getCandidateStatement: mocks.publicStatement,
  requestCandidateClaim: mocks.apply,
  withdrawCandidateClaim: mocks.withdraw,
  saveCandidateStatement: mocks.save,
  removeCandidateStatement: mocks.remove,
  reportCandidateStatement: mocks.report,
  getAdminCandidateClaims: mocks.queue,
  getCandidateStatementReports: mocks.reports,
  reviewCandidateClaim: mocks.review,
  resolveCandidateStatementReport: mocks.resolve,
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
const record: CandidateProfileRecord = {
  candidate: { id, name: 'Public Candidate', sortName: 'Candidate, Public' },
  office: 'State Representative',
  votingArea: 'House District 1A',
  election: { id: '8334', label: 'General election', date: '2026-11-03', type: 'general' },
  source: {
    authority: 'Minnesota Secretary of State',
    url: 'https://myballotmn.sos.mn.gov/',
    checkedDate: '2026-09-30',
  },
};
const approved = {
  id: 'claim-a',
  candidate_id: id,
  candidate_name: record.candidate.name,
  office: record.office,
  status: 'approved',
  version: 3,
  evidence_url: 'https://example.org/campaign',
  request_note: 'Private authority details',
};
let host: HTMLDivElement;
let root: Root;
const navigation = { navigate: vi.fn(), dispatch: vi.fn() };
const route = { params: { candidateId: id } };
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
function button(label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (value) => value.textContent === label,
  )!;
}
function edit(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!;
    descriptor.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function manage() {
  act(() =>
    root.render(<CandidateManageScreen navigation={navigation as never} route={route as never} />),
  );
}
beforeEach(() => {
  for (const value of Object.values(mocks))
    if (typeof value === 'function' && 'mockReset' in value)
      (value as ReturnType<typeof vi.fn>).mockReset();
  mocks.auth = {
    isLoading: false,
    isSignedIn: true,
    user: { id: 'account-a', isAdmin: true },
    accessToken: 'token-a',
  };
  mocks.admin = 'allowed';
  mocks.focused = true;
  mocks.getProfile.mockResolvedValue(record);
  mocks.mine.mockResolvedValue({ account_id: 'account-a', claims: [approved] });
  mocks.privateStatement.mockResolvedValue({
    account_id: 'account-a',
    statement: { body: 'Current campaign words', updated_at: '2026-09-30', version: 2 },
    history: [],
  });
  mocks.publicStatement.mockResolvedValue({ statement: null });
  mocks.queue.mockResolvedValue({
    account_id: 'account-a',
    claims: [],
    offset: 0,
    has_more: false,
  });
  mocks.reports.mockResolvedValue({
    account_id: 'account-a',
    reports: [],
    offset: 0,
    has_more: false,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('uses the existing sign-in dialog and keeps private claims unavailable while signed out', async () => {
  mocks.auth.isSignedIn = false;
  act(() =>
    root.render(<CandidateClaimScreen navigation={navigation as never} route={route as never} />),
  );
  await flush();
  expect(host.textContent).toContain('Sign in to continue');
  expect(host.textContent).not.toContain('Private authority details');
  expect(mocks.mine).not.toHaveBeenCalled();
  act(() => button('Sign in to continue').click());
  expect(mocks.signIn).toHaveBeenCalledWith({ intent: 'nav', returnTo: `/candidates/${id}/claim` });
});
it('submits a manual review request with selected role, evidence, account identity and current version', async () => {
  mocks.mine
    .mockResolvedValueOnce({ account_id: 'account-a', claims: [] })
    .mockResolvedValue({ account_id: 'account-a', claims: [{ ...approved, status: 'pending' }] });
  mocks.apply.mockResolvedValue({});
  act(() =>
    root.render(<CandidateClaimScreen navigation={navigation as never} route={route as never} />),
  );
  await flush();
  act(() => host.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
  edit('Supporting record URL', 'https://example.org/campaign');
  edit(
    'Explain your authority to represent this campaign',
    'I am authorized to represent this campaign',
  );
  act(() => button('Submit for review').click());
  await flush();
  expect(mocks.apply).toHaveBeenCalledWith(
    'token-a',
    expect.objectContaining({
      candidate_id: id,
      expected_account_id: 'account-a',
      expected_version: 0,
      evidence_url: 'https://example.org/campaign',
      request_note: 'Candidate\n\nI am authorized to represent this campaign',
    }),
    expect.any(AbortSignal),
  );
  expect(host.textContent).toContain('Review pending');
  expect(host.textContent).not.toContain('Enter your code');
});
it('keeps the complete draft after an uncertain save and reads server state before enabling another save', async () => {
  mocks.save.mockRejectedValue(new Error('Lost response'));
  manage();
  await flush();
  edit('Campaign statement', 'Unsaved new campaign statement');
  act(() => button('Save changes').click());
  await flush();
  expect(mocks.save).toHaveBeenCalledWith(
    'token-a',
    'claim-a',
    {
      body: 'Unsaved new campaign statement',
      expected_account_id: 'account-a',
      expected_version: 2,
    },
    expect.any(AbortSignal),
  );
  expect(
    host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Campaign statement"]')!.value,
  ).toBe('Unsaved new campaign statement');
  expect(host.textContent).not.toContain('Changes saved');
  mocks.privateStatement.mockResolvedValue({
    account_id: 'account-a',
    statement: { body: 'Unsaved new campaign statement', updated_at: '2026-09-30', version: 3 },
    history: [],
  });
  act(() => button('Try again').click());
  await flush();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Current public statement');
});
it('removes a statement only after the safe confirmation and the server reply', async () => {
  mocks.remove.mockResolvedValue({});
  manage();
  await flush();
  act(() => button('Remove statement').click());
  expect(host.querySelector('dialog')?.textContent).toContain(
    'Remove your statement from the public profile?',
  );
  expect(mocks.remove).not.toHaveBeenCalled();
  act(() => button('Keep statement').click());
  expect(mocks.remove).not.toHaveBeenCalled();
  act(() => button('Remove statement').click());
  mocks.privateStatement.mockResolvedValue({
    account_id: 'account-a',
    statement: { body: '', updated_at: '2026-09-30', version: 3 },
    history: [],
  });
  const risky = [...host.querySelectorAll<HTMLButtonElement>('dialog button')].find(
    (value) => value.textContent === 'Remove statement',
  )!;
  act(() => risky.click());
  await flush();
  expect(mocks.remove).toHaveBeenCalledWith(
    'token-a',
    'claim-a',
    { expected_account_id: 'account-a', expected_version: 2 },
    expect.any(AbortSignal),
  );
  expect(host.textContent).toContain('Statement removed');
});
it('erases private drafts and cancels requests when the account changes', async () => {
  manage();
  await flush();
  edit('Campaign statement', 'Account A private draft');
  const signal = mocks.mine.mock.calls[0][2] as AbortSignal;
  mocks.auth = { ...mocks.auth, user: { id: 'account-b', isAdmin: false }, accessToken: 'token-b' };
  mocks.mine.mockResolvedValue({ account_id: 'account-b', claims: [] });
  manage();
  await flush();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain('Account A private draft');
  expect(host.querySelector('textarea')).toBeNull();
});
it('keeps public campaign words separate and renders them as text', async () => {
  mocks.auth.isSignedIn = false;
  mocks.publicStatement.mockResolvedValue({
    statement: { body: '<script>not executable</script>', version: 1, updated_at: '2026-09-30' },
  });
  act(() =>
    root.render(
      <CandidateClaimPanel
        record={record}
        onClaim={() => {}}
        onManage={() => {}}
        onAdmin={() => {}}
      />,
    ),
  );
  await flush();
  expect(host.textContent).toContain('From the campaign');
  expect(host.textContent).toContain('Written by the campaign, not Alethical');
  expect(host.querySelector('script')).toBeNull();
  expect(host.querySelector(`a[href="/candidates/${id}/claim"]`)).not.toBeNull();
});
it('requires independent proof and a review note, and prevents self approval', async () => {
  mocks.queue.mockResolvedValue({
    account_id: 'account-a',
    claims: [{ ...approved, status: 'pending', user_id: 'account-a' }],
    offset: 0,
    has_more: false,
  });
  act(() =>
    root.render(
      <AdminCandidateClaimsScreen navigation={navigation as never} route={{} as never} />,
    ),
  );
  await flush();
  edit('Review note for Public Candidate', 'Independent verification of ownership');
  act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(button('Approve request').getAttribute('aria-disabled')).toBe('true');
  act(() => button('Approve request').click());
  expect(mocks.review).not.toHaveBeenCalled();
});
it('keeps the staff queues private for non-administrators', async () => {
  mocks.admin = 'restricted';
  act(() =>
    root.render(
      <AdminCandidateClaimsScreen navigation={navigation as never} route={{} as never} />,
    ),
  );
  await flush();
  expect(host.textContent).toContain('Restricted access');
  expect(mocks.queue).not.toHaveBeenCalled();
  expect(mocks.reports).not.toHaveBeenCalled();
});

it('refreshes public campaign words after returning from manage, including a removed statement', async () => {
  mocks.auth.isSignedIn = false;
  mocks.publicStatement
    .mockResolvedValueOnce({
      statement: { body: 'Previously public text', updated_at: '2026-09-30', version: 1 },
    })
    .mockResolvedValue({ statement: null });
  const renderPanel = () =>
    act(() =>
      root.render(
        <CandidateClaimPanel
          record={record}
          onClaim={() => {}}
          onManage={() => {}}
          onAdmin={() => {}}
        />,
      ),
    );
  renderPanel();
  await flush();
  expect(host.textContent).toContain('Previously public text');
  mocks.focused = false;
  renderPanel();
  await flush();
  mocks.focused = true;
  renderPanel();
  await flush();
  expect(mocks.publicStatement).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain('Previously public text');
});

it('keeps an unsaved statement when the same account refreshes its sign-in token', async () => {
  manage();
  await flush();
  edit('Campaign statement', 'Unsaved campaign words');
  mocks.auth = { ...mocks.auth, accessToken: 'refreshed-token-a' };
  manage();
  await flush();
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Unsaved campaign words');
  mocks.save.mockResolvedValue({
    statement: { body: 'Unsaved campaign words', version: 3, updated_at: '2026-09-30' },
  });
  act(() => button('Save changes').click());
  await flush();
  expect(mocks.save).toHaveBeenCalledWith(
    'refreshed-token-a',
    approved.id,
    expect.objectContaining({ body: 'Unsaved campaign words' }),
    expect.any(AbortSignal),
  );
});
