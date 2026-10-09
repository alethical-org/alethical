// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CandidateClaimScreen, CandidateManageScreen } from '../CandidateAccountScreens';
import { AdminCandidateClaimsScreen } from '../AdminCandidateClaimsScreen';
import { CandidateClaimPanel } from '../../components/candidates/CandidateClaimPanel';
import type { CandidateProfileRecord } from '../../components/candidates/types';
import { GuardedNavigationContext } from '../../navigation/GuardedNavigationContext';

const mocks = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return {
    auth: {
      isLoading: false,
      isSignedIn: true,
      user: { id: 'account-a', isAdmin: false },
      accessToken: 'token-a',
    },
    admin: 'restricted',
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
    detail: vi.fn(),
    recheck: vi.fn(),
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
  getAdminCandidateClaim: mocks.detail,
  recheckCandidateClaim: mocks.recheck,
  profileClaimsChanged: vi.fn(),
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
  Rect: (props: React.SVGProps<SVGRectElement>) => <rect {...props} />,
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
  can_manage: true,
  election_ended: false,
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
    (value) => (value.getAttribute('aria-label') ?? value.textContent) === label,
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
    user: { id: 'account-a', isAdmin: false },
    accessToken: 'token-a',
  };
  mocks.admin = 'restricted';
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
it('explains closed requests to signed-out visitors while preserving sign-in for existing profile claims', async () => {
  mocks.auth.isSignedIn = false;
  mocks.getProfile.mockResolvedValue({ ...record, electionEnded: true });
  act(() =>
    root.render(<CandidateClaimScreen navigation={navigation as never} route={route as never} />),
  );
  await flush();
  expect(host.querySelector('[aria-level="1"]')?.textContent).toBe(
    'Profile claims closed for this election',
  );
  expect(host.textContent).not.toContain('An approved profile claim lets you manage');
  act(() => button('Sign in to view your profile claim status').click());
  expect(mocks.signIn).toHaveBeenLastCalledWith({
    intent: 'nav',
    returnTo: `/candidates/${id}/claim`,
  });
  expect(mocks.mine).not.toHaveBeenCalled();
  manage();
  await flush();
  expect(host.querySelector('[aria-level="1"]')?.textContent).toBe('Manage this profile');
  act(() => button('Sign in to continue').click());
  expect(mocks.signIn).toHaveBeenLastCalledWith({
    intent: 'nav',
    returnTo: `/candidates/${id}/manage`,
  });
});
it('submits a manual review request with selected role, evidence, account identity and current version', async () => {
  mocks.mine
    .mockResolvedValueOnce({
      account_id: 'account-a',
      claims: [],
      request_eligibility: { allowed: true, reason: null },
    })
    .mockResolvedValue({ account_id: 'account-a', claims: [{ ...approved, status: 'pending' }] });
  mocks.apply.mockResolvedValue({});
  act(() =>
    root.render(<CandidateClaimScreen navigation={navigation as never} route={route as never} />),
  );
  await flush();
  act(() => host.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
  edit('Link to a campaign website or official record', 'https://example.org/campaign');
  edit(
    'Explain your role and how Alethical can confirm it',
    'I am authorized to represent this campaign',
  );
  act(() => button('Submit profile claim request').click());
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
  expect(host.textContent).toContain('Profile claim pending review');
  expect(host.querySelector('[aria-level="1"]')?.textContent).toBe('Profile claim pending review');
  expect(host.textContent).not.toContain('An approved profile claim lets you manage');
  expect(host.textContent!.indexOf('Public Candidate')).toBeLessThan(
    host.textContent!.indexOf('Profile claim pending review'),
  );
  expect(host.textContent).not.toContain('Enter your code');
});
it('groups verified campaign access with identity and labels the editor before its help and preview', async () => {
  manage();
  await flush();
  const text = host.textContent!;
  expect(text.indexOf('Public Candidate')).toBeLessThan(text.indexOf('Campaign access verified'));
  expect(text.indexOf('Campaign access verified')).toBeLessThan(text.indexOf('Campaign statement'));
  expect(text.indexOf('Campaign statement')).toBeLessThan(text.indexOf('Explain your record'));
  const input = host.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Campaign statement"]',
  )!;
  expect(input.getAttribute('aria-describedby')).toContain('-help');
  expect(input.style.minHeight).toBe('220px');
  expect(button('Preview').getAttribute('aria-expanded')).toBe('false');
  act(() => button('Preview').click());
  expect(button('Preview').getAttribute('aria-expanded')).toBe('true');
  const preview = host.querySelector('#campaign-statement-preview')!;
  expect(preview.textContent).toContain('Current campaign words');
  expect(preview.textContent).not.toContain('Report this statement');
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
    (value) => value.getAttribute('aria-label') === 'Remove statement',
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
  expect(host.textContent).not.toContain('Published September 30, 2026');
});
it.each([null, { body: '', updated_at: '2026-09-30', version: 2 }])(
  'does not invent a publication date for an unpublished preview (%j)',
  async (statement) => {
    mocks.privateStatement.mockResolvedValue({ account_id: 'account-a', statement, history: [] });
    manage();
    await flush();
    edit('Campaign statement', 'Unpublished preview words');
    act(() => button('Preview').click());
    expect(host.textContent).toContain('Unpublished preview words');
    expect(host.textContent).not.toContain('Published');
  },
);
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
it('keeps an admin applicant blocked even with a complete note and identity check', async () => {
  mocks.admin = 'allowed';
  mocks.detail.mockResolvedValue({
    account_id: 'account-a',
    claim: {
      ...approved,
      status: 'pending',
      applicant_is_admin: true,
      approval_block: {
        reason: 'applicant_is_admin',
        message: 'Admin accounts cannot claim candidate profiles',
      },
    },
  });
  act(() =>
    root.render(
      <AdminCandidateClaimsScreen
        navigation={navigation as never}
        route={{ params: { claimId: 'claim-a' } } as never}
      />,
    ),
  );
  await flush();
  edit('Private review note', 'Independent verification of ownership');
  act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(button('Approve profile claim request').getAttribute('aria-disabled')).toBe('true');
  act(() => button('Approve profile claim request').click());
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
  expect(host.textContent).toContain(
    'This account does not have permission to review profile claim requests',
  );
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

it('keeps the draft and returns focus to its editor when a departure is cancelled', async () => {
  const cancel = vi.fn();
  act(() =>
    root.render(
      <GuardedNavigationContext.Provider
        value={{ cancelPendingNavigation: cancel, installHistoryGuard: vi.fn() }}
      >
        <CandidateManageScreen navigation={navigation as never} route={route as never} />
      </GuardedNavigationContext.Provider>,
    ),
  );
  await flush();
  edit('Campaign statement', 'Unsaved words to preserve');
  const editor = host.querySelector<HTMLTextAreaElement>('textarea')!;
  const link = host.querySelector<HTMLAnchorElement>('a')!;
  link.focus();
  const callback = mocks.prevent.mock.lastCall![1];
  act(() =>
    callback({ data: { action: { type: 'NAVIGATE', payload: { name: 'CandidateProfile' } } } }),
  );
  expect(host.querySelector('dialog')?.getAttribute('aria-label')).toBe('You have unsaved changes');
  act(() => button('Keep editing').click());
  expect(cancel).toHaveBeenCalledOnce();
  expect(editor.value).toBe('Unsaved words to preserve');
  expect(document.activeElement).toBe(editor);
});

function adminRequest(claim = { ...approved, status: 'pending', can_manage: false }) {
  mocks.admin = 'allowed';
  mocks.detail.mockResolvedValue({ account_id: 'account-a', claim });
  act(() =>
    root.render(
      <AdminCandidateClaimsScreen
        navigation={navigation as never}
        route={{ params: { claimId: claim.id } } as never}
      />,
    ),
  );
}
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it('keeps candidate-profile return context when an admin opens an exact request from the list', async () => {
  mocks.admin = 'allowed';
  mocks.queue.mockResolvedValue({
    account_id: 'account-a',
    claims: [{ ...approved, status: 'pending' }],
    offset: 0,
    has_more: false,
  });
  act(() =>
    root.render(
      <AdminCandidateClaimsScreen
        navigation={navigation as never}
        route={{ params: { candidateId: id, fromProfile: true } } as never}
      />,
    ),
  );
  await flush();
  const link = host.querySelector<HTMLAnchorElement>(
    'a[aria-label="Review profile claim request for Public Candidate"]',
  )!;
  expect(link.getAttribute('href')).toBe(
    `/admin/candidate-claims?claim=${approved.id}&candidate=${id}&from=profile`,
  );
  act(() => link.click());
  expect(navigation.navigate).toHaveBeenCalledWith('AdminCandidateClaims', {
    claimId: approved.id,
    candidateId: id,
    fromProfile: true,
  });
});
it('groups the request, review form, and history together with instructions before the field', async () => {
  adminRequest();
  await flush();
  const article = host.querySelector('[role="article"]')!;
  const field = article.querySelector('[aria-label="Private review note"]')!;
  const help = article.querySelector('#profile-review-note-help')!;
  expect(help.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(field.getAttribute('aria-describedby')).toContain(help.id);
  expect(article.textContent).toContain('Applicant email');
  expect(article.textContent).toContain('Profile claim history');
  const returnNav = host.querySelector('[aria-label="Profile claim navigation"]')!;
  const heading = host.querySelector('[aria-level="1"]')!;
  expect(
    returnNav.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
it('blocks admin accounts before reading private owner statements or offering a claim form', async () => {
  mocks.admin = 'allowed';
  mocks.auth.user.isAdmin = true;
  manage();
  await flush();
  expect(host.textContent).toContain(
    'Admin accounts cannot claim candidate profiles or manage campaign statements',
  );
  expect(mocks.privateStatement).not.toHaveBeenCalled();
  expect(mocks.mine).not.toHaveBeenCalled();
  expect(host.querySelector('textarea')).toBeNull();
  expect(button('Review profile claim requests')).toBeDefined();
});
it('validates each profile claim form field and focuses the first error without submitting', async () => {
  mocks.mine.mockResolvedValue({
    account_id: 'account-a',
    claims: [],
    request_eligibility: { allowed: true, reason: null },
  });
  act(() =>
    root.render(<CandidateClaimScreen navigation={navigation as never} route={route as never} />),
  );
  await flush();
  act(() => button('Submit profile claim request').click());
  expect(host.textContent).toContain('Choose your role');
  expect(host.textContent).toContain('Add a link to a campaign website or official record');
  expect(host.textContent).toContain(
    'Explain your role and how Alethical can confirm it in at least 20 characters',
  );
  expect(document.activeElement?.tagName).toBe('FIELDSET');
  expect(mocks.apply).not.toHaveBeenCalled();
});
it('keeps ended pending evidence and withdrawal while new requests are unavailable', async () => {
  mocks.mine.mockResolvedValue({
    account_id: 'account-a',
    claims: [{ ...approved, status: 'pending', election_ended: true, can_request_review: false }],
    request_eligibility: { allowed: false, reason: 'election_ended' },
  });
  act(() =>
    root.render(<CandidateClaimScreen navigation={navigation as never} route={route as never} />),
  );
  await flush();
  expect(host.textContent).toContain('Election ended');
  expect(host.textContent).toContain('Private authority details');
  expect(host.textContent).toContain('Link to a campaign website or official record');
  expect(button('Withdraw profile claim request')).toBeDefined();
  expect(button('Request a profile claim review')).toBeUndefined();
  expect(host.querySelector(`a[href="/candidates/${id}"]`)).not.toBeNull();
});
it('does not hide saved request evidence when the source cannot be confirmed', async () => {
  mocks.mine.mockResolvedValue({
    account_id: 'account-a',
    claims: [{ ...approved, status: 'pending' }],
    request_eligibility: { allowed: false, reason: 'official_record_unavailable' },
  });
  act(() =>
    root.render(<CandidateClaimScreen navigation={navigation as never} route={route as never} />),
  );
  await flush();
  expect(host.textContent).toContain('Private authority details');
  expect(host.textContent).toContain('The official candidate record could not be confirmed');
  expect(button('Withdraw profile claim request')).toBeDefined();
});
it('keeps give-up confirmation busy and reports removed content only from the saved result', async () => {
  const saving = deferred();
  mocks.withdraw.mockReturnValue(saving.promise);
  manage();
  await flush();
  edit('Campaign statement', '');
  act(() => button('Give up this profile claim').click());
  expect(host.querySelector('dialog')?.textContent).toContain(
    'Your unsaved changes will be discarded',
  );
  act(() => button('Give up profile claim').click());
  expect(host.querySelector('dialog')).not.toBeNull();
  expect(button('Giving up profile claim…').getAttribute('aria-disabled')).toBe('true');
  expect(button('Keep profile claim').getAttribute('aria-disabled')).toBe('true');
  act(() => button('Giving up profile claim…').click());
  expect(mocks.withdraw).toHaveBeenCalledTimes(1);
  await act(async () =>
    saving.resolve({
      account_id: 'account-a',
      claim: {
        ...approved,
        status: 'withdrawn',
        can_manage: false,
        last_event_kind: 'given_up',
        statement_removed: true,
      },
    }),
  );
  expect(host.querySelector('dialog')).toBeNull();
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.textContent).toContain(
    'You gave up your profile claim. You no longer have campaign access to manage this candidate profile’s statement. Your published campaign statement was removed.',
  );
});
it('does not promise statement removal when giving up a profile with nothing published', async () => {
  mocks.privateStatement.mockResolvedValue({
    account_id: 'account-a',
    statement: null,
    history: [],
  });
  manage();
  await flush();
  act(() => button('Give up this profile claim').click());
  expect(host.querySelector('dialog')?.textContent).not.toContain(
    'Your published campaign statement will be removed',
  );
});
it('requires a valid private note and independent verification before approval', async () => {
  adminRequest();
  await flush();
  act(() => button('Approve profile claim request').click());
  expect(host.textContent).toContain('Write a private review note with at least 20 characters');
  expect(host.textContent).toContain('Confirm that you independently verified');
  edit('Private review note', 'x'.repeat(2001));
  act(() => button('Reject profile claim request').click());
  expect(host.textContent).toContain('Keep the private review note to 2000 characters or fewer');
  expect(mocks.review).not.toHaveBeenCalled();
  edit('Private review note', 'Independently confirmed using official campaign contact');
  act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  mocks.review.mockResolvedValue({ account_id: 'account-a', claim: approved });
  act(() => button('Approve profile claim request').click());
  await flush();
  expect(mocks.review).toHaveBeenCalledWith(
    'token-a',
    approved.id,
    expect.objectContaining({
      action: 'approve',
      identity_verified: true,
      expected_version: 3,
      expected_account_id: 'account-a',
    }),
    expect.any(AbortSignal),
  );
  expect(host.textContent).toContain('Profile claim request approved');
  expect(button('Approve profile claim request')).toBeUndefined();
  expect(button('Revoke profile claim')).toBeDefined();
});
it('blocks a stale decision until reload and keeps the same admin’s unsaved note', async () => {
  adminRequest();
  await flush();
  edit('Private review note', 'Independent verification complete through campaign contact');
  mocks.review.mockRejectedValue({ reason: 'profile_claim_changed', status: 409 });
  act(() => button('Reject profile claim request').click());
  await flush();
  expect(host.textContent).toContain('This profile claim request changed');
  expect(button('Reject profile claim request')).toBeUndefined();
  mocks.detail.mockResolvedValue({
    account_id: 'account-a',
    claim: { ...approved, status: 'pending', version: 4 },
  });
  act(() => button('Reload profile claim request').click());
  await flush();
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
    'Independent verification complete through campaign contact',
  );
  expect(button('Reject profile claim request')).toBeDefined();
});
it('clears a revoke dialog and ignores its late response when admin access disappears', async () => {
  const saving = deferred();
  mocks.review.mockReturnValue(saving.promise);
  adminRequest(approved);
  await flush();
  edit('Private review note', 'Approval granted to an account no longer authorized');
  act(() => button('Revoke profile claim').click());
  const confirm = host.querySelector<HTMLButtonElement>(
    'dialog [aria-label="Revoke profile claim"]',
  )!;
  act(() => confirm.click());
  const requestSignal = mocks.review.mock.calls[0][3] as AbortSignal;
  mocks.admin = 'signed-out';
  act(() =>
    root.render(
      <AdminCandidateClaimsScreen
        navigation={navigation as never}
        route={{ params: { claimId: approved.id } } as never}
      />,
    ),
  );
  expect(requestSignal.aborted).toBe(true);
  expect(host.querySelector('dialog')).toBeNull();
  expect(host.textContent).not.toContain('Private authority details');
  await act(async () =>
    saving.resolve({ account_id: 'account-a', claim: { ...approved, status: 'revoked' } }),
  );
  expect(host.textContent).not.toContain('Profile claim revoked');
  act(() => button('Sign in').click());
  expect(mocks.signIn).toHaveBeenCalledWith({
    intent: 'nav',
    returnTo: `/admin/candidate-claims?claim=${approved.id}`,
  });
});
it('keeps prior rows and their page through rapid filter changes and refresh', async () => {
  mocks.admin = 'allowed';
  const all = deferred();
  const refreshed = deferred();
  mocks.queue
    .mockResolvedValueOnce({
      account_id: 'account-a',
      claims: [{ ...approved, candidate_name: 'Pending candidate', status: 'pending' }],
      offset: 0,
      has_more: false,
    })
    .mockReturnValueOnce(all.promise)
    .mockReturnValueOnce(refreshed.promise);
  const render = () =>
    act(() =>
      root.render(
        <AdminCandidateClaimsScreen navigation={navigation as never} route={{} as never} />,
      ),
    );
  render();
  await flush();
  act(() => button('All').click());
  expect(host.textContent).toContain('Pending candidate');
  expect(host.textContent).toContain('previous Pending results, page 1');
  act(() => button('Pending').click());
  await flush();
  await act(async () =>
    all.resolve({
      account_id: 'account-a',
      claims: [{ ...approved, candidate_name: 'Late all result' }],
      offset: 0,
      has_more: false,
    }),
  );
  expect(host.textContent).not.toContain('Late all result');
  act(() => button('Refresh profile claim requests').click());
  expect(mocks.queue.mock.calls.at(-1)?.[1]).toBe('pending');
  await act(async () =>
    refreshed.resolve({ account_id: 'account-a', claims: [], offset: 0, has_more: false }),
  );
  expect(host.textContent).toContain('No pending profile claim requests');
});
it('labels retained Pending rows when the requested All results fail', async () => {
  mocks.admin = 'allowed';
  mocks.queue
    .mockResolvedValueOnce({
      account_id: 'account-a',
      claims: [{ ...approved, candidate_name: 'Pending candidate', status: 'pending' }],
      offset: 0,
      has_more: false,
    })
    .mockRejectedValueOnce(new Error('Unavailable'));
  act(() =>
    root.render(
      <AdminCandidateClaimsScreen navigation={navigation as never} route={{} as never} />,
    ),
  );
  await flush();
  act(() => button('All').click());
  await flush();
  expect(button('All').getAttribute('aria-pressed')).toBe('true');
  expect(host.textContent).toContain('Profile claim requests are unavailable');
  expect(host.textContent).toContain('Pending candidate');
  expect(host.textContent).toContain('Showing previous Pending results, page 1');
  expect(host.textContent).not.toContain('Updating profile claim requests');
});
it('reloads applicant eligibility failures without treating them as loss of admin permission', async () => {
  adminRequest();
  await flush();
  edit('Private review note', 'Independently verified by the campaign contact');
  act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  mocks.review.mockRejectedValue({ status: 403, reason: 'applicant_is_admin' });
  mocks.detail.mockResolvedValue({
    account_id: 'account-a',
    claim: {
      ...approved,
      status: 'pending',
      applicant_is_admin: true,
      approval_block: {
        reason: 'applicant_is_admin',
        message: 'Admin accounts cannot claim candidate profiles',
      },
    },
  });
  act(() => button('Approve profile claim request').click());
  await flush();
  expect(host.textContent).toContain('Admin accounts cannot claim candidate profiles');
  expect(host.textContent).not.toContain('This account does not have permission');
  expect(button('Reject profile claim request')).toBeDefined();
});

it.each([
  ['public', undefined, false, false, false, 'Claim this profile', 'rgb(46, 212, 126)', 'claim'],
  ['approved', true, false, false, false, 'Manage this profile', 'rgb(46, 212, 126)', 'manage'],
  [
    'pending',
    false,
    false,
    false,
    false,
    'View profile claim status',
    'rgb(255, 255, 255)',
    'claim',
  ],
  [
    'rejected',
    false,
    false,
    false,
    false,
    'View profile claim status',
    'rgb(255, 255, 255)',
    'claim',
  ],
  [
    'withdrawn',
    false,
    false,
    false,
    false,
    'View profile claim status',
    'rgb(255, 255, 255)',
    'claim',
  ],
  [
    'revoked',
    false,
    false,
    false,
    false,
    'View profile claim status',
    'rgb(255, 255, 255)',
    'claim',
  ],
  [
    'approved',
    false,
    false,
    false,
    false,
    'View profile claim status',
    'rgb(255, 255, 255)',
    'claim',
  ],
  [
    'public',
    undefined,
    true,
    false,
    false,
    'Review profile claim requests',
    'rgb(255, 255, 255)',
    'admin',
  ],
  ['public', undefined, false, true, false, null, null, null],
  [
    'pending',
    false,
    false,
    true,
    false,
    'View profile claim status',
    'rgb(255, 255, 255)',
    'claim',
  ],
  ['public', undefined, false, false, true, null, null, null],
] as const)(
  'keeps public-panel appearance and access distinct: %s manage=%s admin=%s ended=%s blocked=%s',
  async (status, canManage, admin, ended, blocked, label, fill, destination) => {
    mocks.admin = admin ? 'allowed' : 'restricted';
    mocks.mine.mockResolvedValue({
      account_id: 'account-a',
      claims:
        status === 'public'
          ? []
          : [{ ...approved, status, can_manage: canManage, election_ended: ended }],
      request_eligibility: blocked ? { reason: 'official_record_unavailable' } : null,
    });
    act(() =>
      root.render(
        <CandidateClaimPanel
          record={{ ...record, electionEnded: ended }}
          onClaim={() => {}}
          onManage={() => {}}
          onAdmin={() => {}}
        />,
      ),
    );
    await flush();
    const control = host.querySelector<HTMLAnchorElement>('a');
    if (label) {
      expect(control?.textContent).toBe(label);
      expect(getComputedStyle(control!).backgroundColor).toBe(fill);
      expect(control?.getAttribute('href')).toBe(
        destination === 'admin'
          ? `/admin/candidate-claims?candidate=${id}&from=profile`
          : `/candidates/${id}/${destination}`,
      );
      expect(document.getElementById(control!.getAttribute('aria-describedby')!)).not.toBeNull();
    } else {
      expect(control).toBeNull();
      expect(host.textContent).toContain(ended ? 'This election has ended' : 'official');
    }
  },
);
