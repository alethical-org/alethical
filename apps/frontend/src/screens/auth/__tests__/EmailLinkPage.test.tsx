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
  return {
    session,
    temporary: {
      verifyOtp: vi.fn(async () => ({ data: { session }, error: null })),
      updateUser: vi.fn(async () => ({ error: { code: 'same_password', status: 422 } })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    ordinary: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      setSession: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    clearStoredSession: vi.fn(),
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
  validateAlethicalSession: vi.fn(async () => ({
    ok: true,
    data: {
      id: auth.session.user.id,
      name: 'Jordan',
      email: auth.session.user.email,
      signInMethods: { google: false, password: true },
    },
  })),
}));

vi.mock('../../../lib/supabase.web', () => ({
  supabase: { auth: auth.ordinary },
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

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
  window.__alethicalEmailLink = {
    tokenHash: 'old-confirmation-token',
    type: 'email',
    pendingReference: null,
  };
  vi.clearAllMocks();
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
});
