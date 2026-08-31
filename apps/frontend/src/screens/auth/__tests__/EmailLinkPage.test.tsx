// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => {
  const session = {
    access_token: 'temporary-access',
    refresh_token: 'temporary-refresh',
    user: {
      id: 'jordan-user',
      email: 'jordan@example.com',
      user_metadata: { name: 'Jordan' },
    },
  };
  const temporaryState = { current: session as any };
  const ordinaryState = { current: session as any };
  const accountIds = new Map<string, string>();
  const validateSession = vi.fn(async (candidate: typeof session) => {
    const accountId = accountIds.get(candidate.access_token) ?? candidate.user.id;
    return {
      ok: true as const,
      data: {
        id: accountId,
        name: candidate.user.user_metadata?.name ?? candidate.user.email.split('@')[0],
        email: candidate.user.email,
        signInMethods: { google: false, password: true },
      },
    };
  });
  const setSession = vi.fn(async (_tokens?: unknown) => ({ error: null }));
  const clearStoredSession = vi.fn();
  const setSessionIfUnchanged = vi.fn(async (expected: any, tokens: any) => {
    const current = ordinaryState.current;
    const unchanged = expected
      ? current?.access_token === expected.access_token &&
        current?.refresh_token === expected.refresh_token &&
        current?.user.id === expected.user.id
      : current === null;
    if (!unchanged) return { changed: true, data: { session: current }, error: null };
    const result = await setSession(tokens);
    ordinaryState.current = session;
    return { changed: false, data: { session }, error: result.error };
  });
  const clearSessionIfUnchanged = vi.fn(async (expected: any) => {
    const current = ordinaryState.current;
    if (
      current?.access_token !== expected.access_token ||
      current?.refresh_token !== expected.refresh_token ||
      current?.user.id !== expected.user.id
    ) {
      return false;
    }
    ordinaryState.current = null;
    clearStoredSession();
    return true;
  });
  return {
    accountIds,
    ordinaryState,
    session,
    validateSession,
    temporary: {
      verifyOtp: vi.fn(async () => ({ data: { session }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: temporaryState.current }, error: null })),
      updateUser: vi.fn(async (): Promise<{ error: unknown | null }> => ({
        error: { code: 'same_password', status: 422 },
      })),
      signOut: vi.fn(async (_options?: { scope?: string }) => ({ error: null })),
    },
    temporaryState,
    ordinary: {
      getSession: vi.fn(async () => ({ data: { session: ordinaryState.current }, error: null })),
      setSession,
      setSessionIfUnchanged,
      clearSessionIfUnchanged,
      signOut: vi.fn(async () => ({ error: null })),
    },
    clearStoredSession,
    completePendingTrackAction: vi.fn(async () => ({ returnPath: '/bills/hf1' })),
  };
});

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
}));

vi.mock('../../../lib/auth/linkSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/auth/linkSession')>();
  return {
    ...actual,
    createTemporaryAuthClient: () => auth.temporary,
  };
});

vi.mock('../../../lib/auth/operations', () => ({
  validateAlethicalSession: auth.validateSession,
}));

vi.mock('../../../lib/supabase.web', () => ({
  supabase: { auth: auth.ordinary },
  setOrdinarySessionIfUnchanged: auth.ordinary.setSessionIfUnchanged,
  clearOrdinarySessionIfUnchanged: auth.ordinary.clearSessionIfUnchanged,
  clearStoredSupabaseSession: auth.clearStoredSession,
}));

vi.mock('../../../data/api', () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
  completePendingTrackActionFromApi: auth.completePendingTrackAction,
}));

vi.mock('../../../components/auth/SignInContainer', () => ({
  descriptionTextStyle: {},
  SignInContainer: ({
    title,
    description,
    children,
  }: {
    title: string;
    description?: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </main>
  ),
}));

vi.mock('../../../components/auth/LoadingButton', () => ({
  LoadingButton: ({ label, onPress }: { label: string; onPress?: () => void | Promise<void> }) => (
    <button onClick={() => void onPress?.()}>{label}</button>
  ),
}));

vi.mock('../../../components/auth/PasswordField', () => ({
  PasswordField: ({
    label = 'PASSWORD',
    value,
    onChangeText,
  }: {
    label?: string;
    value: string;
    onChangeText: (value: string) => void;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChangeText(event.currentTarget.value)}
      />
    </label>
  ),
}));

import { EmailLinkPage } from '../EmailLinkPage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function press(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => {
    button.click();
  });
  await flush();
}

function enter(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Input value setter is unavailable');
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function lineageSession(token: string, sessionId = 'temporary-session') {
  const payload = globalThis
    .btoa(JSON.stringify({ sub: 'jordan-user', session_id: sessionId }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return {
    ...auth.session,
    access_token: `header.${payload}.${token}`,
    refresh_token: `temporary-${token}`,
  };
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
  window.__alethicalEmailLink = {
    tokenHash: 'old-confirmation-token',
    type: 'email',
    pendingReference: null,
  };
  vi.clearAllMocks();
  auth.ordinaryState.current = auth.session;
  auth.temporaryState.current = auth.session;
  auth.accountIds.clear();
  auth.accountIds.set(auth.session.access_token, 'jordan-account');
  auth.temporary.verifyOtp.mockResolvedValue({ data: { session: auth.session }, error: null });
  auth.temporary.updateUser.mockResolvedValue({
    error: { code: 'same_password', status: 422 },
  });
  auth.temporary.signOut.mockResolvedValue({ error: null });
  auth.ordinary.getSession.mockImplementation(async () => ({
    data: { session: auth.ordinaryState.current },
    error: null,
  }));
  auth.ordinary.setSession.mockResolvedValue({ error: null });
  auth.ordinary.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  document.body.replaceChildren();
  delete window.__alethicalEmailLink;
});

describe('old confirmation links', () => {
  it('finishes a live type=email link when the saved password is entered again', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    act(() => root.render(<EmailLinkPage kind="confirm" />));
    await press('Confirm email');

    expect(document.querySelector('h1')?.textContent).toBe('Choose a password');
    expect(auth.temporary.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'old-confirmation-token',
      type: 'email',
    });

    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    expect(inputs).toHaveLength(2);
    enter(inputs[0], 'old-password-15');
    enter(inputs[1], 'old-password-15');
    await press('Save password');

    expect(document.querySelector('h1')?.textContent).toBe('Password saved');
    expect(auth.ordinary.setSession).not.toHaveBeenCalled();
    expect(auth.temporary.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth.clearStoredSession).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it('finishes a held Track action after confirmation but before password entry', async () => {
    window.__alethicalEmailLink = {
      tokenHash: 'old-confirmation-token',
      type: 'email',
      pendingReference: 'HF 1',
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    act(() => root.render(<EmailLinkPage kind="confirm" />));
    await press('Confirm email');

    expect(document.querySelector('h1')?.textContent).toBe('Choose a password');
    expect(auth.completePendingTrackAction).toHaveBeenCalledWith('temporary-access', 'HF 1');

    act(() => root.unmount());
  });

  it('does not finish a held Track action from a password-recovery link', async () => {
    window.__alethicalEmailLink = {
      tokenHash: 'old-recovery-token',
      type: 'recovery',
      pendingReference: 'HF 1',
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    act(() => root.render(<EmailLinkPage kind="reset" />));
    await press('Continue to reset password');

    expect(document.querySelector('h1')?.textContent).toBe('Choose a new password');
    expect(auth.completePendingTrackAction).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it('keeps 1 Alethical account open when Google and password use different provider IDs', async () => {
    const googleSession = {
      access_token: 'ordinary-google-access',
      refresh_token: 'ordinary-google-refresh',
      user: {
        id: 'google-provider-user',
        email: 'jordan@example.com',
        user_metadata: { name: 'Jordan with Google' },
      },
    };
    auth.ordinaryState.current = googleSession;
    auth.accountIds.set(auth.session.access_token, 'shared-alethical-account');
    auth.accountIds.set(googleSession.access_token, 'shared-alethical-account');
    auth.temporary.updateUser.mockResolvedValueOnce({ error: null });
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    act(() => root.render(<EmailLinkPage kind="confirm" />));
    await press('Confirm email');

    expect(document.querySelector('main')?.textContent).not.toContain(
      'The account open in this browser will stay signed in',
    );
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    enter(inputs[0], 'new-password');
    enter(inputs[1], 'new-password');
    await press('Save password');

    expect(document.querySelector('h1')?.textContent).toBe('Password saved');
    expect(document.querySelector('main')?.textContent).toContain('You’re signed in');
    expect(auth.ordinary.setSession).not.toHaveBeenCalled();
    expect(auth.ordinary.signOut).not.toHaveBeenCalled();
    expect(auth.temporary.signOut).toHaveBeenCalledWith({ scope: 'local' });

    act(() => root.unmount());
  });

  it('hands off the refreshed temporary session after the password is saved', async () => {
    const before = lineageSession('before');
    const after = lineageSession('after');
    auth.ordinaryState.current = null;
    auth.temporaryState.current = after;
    auth.accountIds.set(before.access_token, 'jordan-account');
    auth.temporary.verifyOtp.mockResolvedValueOnce({ data: { session: before }, error: null });
    auth.temporary.updateUser.mockResolvedValueOnce({ error: null });
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    act(() => root.render(<EmailLinkPage kind="confirm" />));
    await press('Confirm email');
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    enter(inputs[0], 'new-password');
    enter(inputs[1], 'new-password');
    await press('Save password');

    expect(auth.ordinary.setSession).toHaveBeenCalledWith({
      access_token: after.access_token,
      refresh_token: after.refresh_token,
    });

    act(() => root.unmount());
  });

  it('preserves a fresh same-user session created after recovery ends older sessions', async () => {
    window.__alethicalEmailLink = {
      tokenHash: 'old-recovery-token',
      type: 'recovery',
      pendingReference: null,
    };
    const temporary = lineageSession('temporary', 'temporary-session');
    const beforeOtherSessionSignOut = lineageSession('ordinary-before', 'ordinary-before');
    const afterOtherSessionSignOut = lineageSession('ordinary-after', 'ordinary-after');
    auth.temporary.verifyOtp.mockResolvedValueOnce({ data: { session: temporary }, error: null });
    auth.temporaryState.current = temporary;
    auth.ordinaryState.current = beforeOtherSessionSignOut;
    auth.accountIds.set(temporary.access_token, 'jordan-account');
    auth.accountIds.set(beforeOtherSessionSignOut.access_token, 'jordan-account');
    auth.accountIds.set(afterOtherSessionSignOut.access_token, 'jordan-account');
    auth.temporary.updateUser.mockResolvedValueOnce({
      error: { code: 'same_password', status: 422 },
    });
    auth.temporary.signOut.mockImplementation(async (options?: { scope?: string }) => {
      if (options?.scope === 'others') auth.ordinaryState.current = afterOtherSessionSignOut;
      return { error: null };
    });
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    act(() => root.render(<EmailLinkPage kind="reset" />));
    await press('Continue to reset password');
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    enter(inputs[0], 'existing-password');
    enter(inputs[1], 'existing-password');
    await press('Change password');

    expect(auth.ordinary.clearSessionIfUnchanged).not.toHaveBeenCalled();
    expect(auth.ordinaryState.current).toBe(afterOtherSessionSignOut);

    act(() => root.unmount());
  });

  it('replaces the same-user session that recovery just ended', async () => {
    window.__alethicalEmailLink = {
      tokenHash: 'old-recovery-token',
      type: 'recovery',
      pendingReference: null,
    };
    const temporary = lineageSession('temporary', 'temporary-session');
    const revokedOrdinary = lineageSession('ordinary-before', 'ordinary-before');
    auth.temporary.verifyOtp.mockResolvedValueOnce({ data: { session: temporary }, error: null });
    auth.temporaryState.current = temporary;
    auth.ordinaryState.current = revokedOrdinary;
    auth.accountIds.set(temporary.access_token, 'jordan-account');
    auth.accountIds.set(revokedOrdinary.access_token, 'jordan-account');
    auth.temporary.updateUser.mockResolvedValueOnce({
      error: { code: 'same_password', status: 422 },
    });
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const root = createRoot(mount);

    act(() => root.render(<EmailLinkPage kind="reset" />));
    await press('Continue to reset password');
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    enter(inputs[0], 'existing-password');
    enter(inputs[1], 'existing-password');
    await press('Change password');

    expect(auth.temporary.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(auth.ordinary.clearSessionIfUnchanged).toHaveBeenCalledWith(revokedOrdinary);
    expect(auth.ordinaryState.current).toBeNull();

    act(() => root.unmount());
  });

  it('keeps a different Alethical account open while the linked account is completed', async () => {
    const otherSession = {
      access_token: 'ordinary-other-access',
      refresh_token: 'ordinary-other-refresh',
      user: {
        id: 'other-provider-user',
        email: 'marissa@example.com',
        user_metadata: { name: 'Marissa' },
      },
    };
    auth.ordinaryState.current = otherSession;
    auth.accountIds.set(auth.session.access_token, 'jordan-account');
    auth.accountIds.set(otherSession.access_token, 'marissa-account');
    auth.temporary.updateUser.mockResolvedValueOnce({ error: null });
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    act(() => root.render(<EmailLinkPage kind="confirm" />));
    await press('Confirm email');

    expect(document.querySelector('main')?.textContent).toContain(
      'The account open in this browser will stay signed in',
    );
    expect(document.querySelector('main')?.textContent).toContain('marissa@example.com');
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    enter(inputs[0], 'new-password');
    enter(inputs[1], 'new-password');
    await press('Save password');

    expect(document.querySelector('main')?.textContent).toContain(
      'The account open here has not changed',
    );
    expect(auth.ordinary.setSession).not.toHaveBeenCalled();
    expect(auth.ordinary.signOut).not.toHaveBeenCalled();
    expect(auth.temporary.signOut).toHaveBeenCalledWith({ scope: 'local' });

    act(() => root.unmount());
  });
});
