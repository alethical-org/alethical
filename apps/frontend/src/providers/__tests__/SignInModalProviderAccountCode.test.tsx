// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignInModalProvider } from '../SignInModalProvider';
import { useSignInModal } from '../signInModalContext';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const testState = vi.hoisted(() => ({
  dialogProps: null as any,
  errorKinds: [] as Array<string | null>,
  requestCalls: 0,
  googleCalls: 0,
  requestReplies: [] as Array<Promise<any>>,
  googleReplies: [] as Array<Promise<any>>,
  passwordReplies: [] as Array<Promise<any>>,
  pendingReplies: [] as Array<Promise<any>>,
  completionReplies: [] as Array<Promise<any>>,
  completionCalls: [] as Array<any[]>,
  isLoading: false,
  isSignedIn: false,
  accessToken: null as string | null,
  authError: null as string | null,
  authErrorKind: null as string | null,
  openSignIn: null as any,
  refreshTrackedBills: vi.fn(),
}));

function OpenSignInProbe() {
  testState.openSignIn = useSignInModal().openSignIn;
  return null;
}

vi.mock('../../components/auth/SignInDialog', () => ({
  SignInDialog: (props: any) => {
    testState.dialogProps = props;
    testState.errorKinds.push(props.errorKind);
    return null;
  },
}));

vi.mock('../../hooks/useAppQueries', () => ({
  useRefreshTrackedBills: () => testState.refreshTrackedBills,
}));

vi.mock('../AuthProvider', () => ({
  useAuth: () => ({
    isLoading: testState.isLoading,
    isSignedIn: testState.isSignedIn,
    accessToken: testState.accessToken,
    authError: testState.authError,
    authErrorKind: testState.authErrorKind,
    dismissAuthError: vi.fn(),
    signInWithGoogle: vi.fn(() => {
      testState.googleCalls += 1;
      return testState.googleReplies.shift() ?? Promise.resolve({ ok: true });
    }),
    user: null,
  }),
}));

vi.mock('../../lib/auth/linkSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/auth/linkSession')>()),
  createTemporaryAuthClient: vi.fn(() => ({})),
}));

vi.mock('../../lib/auth/accountCodeFlow', () => ({
  AccountCodeAccessController: class {
    status = 'not-started';
    targetAccountId = null;

    constructor(
      readonly purpose: 'create' | 'recover',
      readonly email: string,
    ) {}

    request() {
      testState.requestCalls += 1;
      const reply = testState.requestReplies.shift();
      if (!reply) throw new Error('Missing request reply');
      return reply;
    }

    dispose = vi.fn(async () => undefined);
    verify = vi.fn();
    finishCreateIfSameAccountOpen = vi.fn(async () => ({ ok: true, data: false }));
    savePassword = vi.fn();
    retryFinish = vi.fn();
    keepCurrentAccount = vi.fn(async () => undefined);
    switchAccount = vi.fn();
  },
}));

vi.mock('../../lib/auth/passwordSignInFlow', () => ({
  PasswordSignInController: class {
    signIn() {
      return testState.passwordReplies.shift() ?? Promise.resolve({ ok: true });
    }

    dispose = vi.fn(async () => undefined);
  },
}));

vi.mock('../../lib/auth/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/auth/operations')>()),
  validateAlethicalSession: vi.fn(),
}));

vi.mock('../../data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/api')>()),
  createPendingTrackActionFromApi: vi.fn(
    () => testState.pendingReplies.shift() ?? Promise.resolve({ reference: 'pending-default' }),
  ),
  completePendingTrackActionFromApi: vi.fn((...args: any[]) => {
    testState.completionCalls.push(args);
    return testState.completionReplies.shift() ?? Promise.resolve();
  }),
}));

vi.mock('../../lib/devSignInHold', () => ({
  signInHeldConnecting: () => false,
}));

vi.mock('../../lib/supabase', () => ({
  clearStoredSupabaseSession: vi.fn(),
  clearOrdinarySessionIfUnchanged: vi.fn(),
  setOrdinarySessionIfUnchanged: vi.fn(),
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
  },
  supabaseAuthConfig: { url: 'https://example.supabase.co', publishableKey: 'test-key' },
}));

describe('account-code dialog lifetime', () => {
  let mount: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    window.sessionStorage.clear();
    testState.dialogProps = null;
    testState.errorKinds = [];
    testState.requestCalls = 0;
    testState.googleCalls = 0;
    testState.requestReplies = [];
    testState.googleReplies = [];
    testState.passwordReplies = [];
    testState.pendingReplies = [];
    testState.completionReplies = [];
    testState.completionCalls = [];
    testState.isLoading = false;
    testState.isSignedIn = false;
    testState.accessToken = null;
    testState.authError = null;
    testState.authErrorKind = null;
    testState.openSignIn = null;
    testState.refreshTrackedBills.mockReset();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    act(() =>
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    mount.remove();
  });

  it.each([
    ['create', 'create'],
    ['forgot', 'recover'],
  ] as const)(
    'keeps the requested %s screen open when an existing session finishes restoring',
    async (requested, screen) => {
      act(() => root.unmount());
      window.history.replaceState(null, '', `/#auth_screen=${requested}`);
      testState.isLoading = true;
      root = createRoot(mount);
      act(() =>
        root.render(
          <SignInModalProvider>
            <OpenSignInProbe />
          </SignInModalProvider>,
        ),
      );
      expect(testState.dialogProps.open).toBe(false);

      testState.isLoading = false;
      testState.isSignedIn = true;
      testState.accessToken = 'restored-access-token';
      await act(async () => {
        root.render(
          <SignInModalProvider>
            <OpenSignInProbe />
          </SignInModalProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(testState.dialogProps.open).toBe(true);
      expect(testState.dialogProps.initialScreen).toBe(screen);
      expect(testState.completionCalls).toHaveLength(0);
    },
  );

  it.each([
    ['create', 'create'],
    ['forgot', 'recover'],
  ] as const)(
    'keeps the requested %s screen and pending Track action during session restore',
    async (requested, screen) => {
      act(() => root.unmount());
      window.history.replaceState(null, '', `/#auth_screen=${requested}`);
      window.sessionStorage.setItem(
        'alethical.pendingSignIn',
        JSON.stringify({
          intent: 'track',
          billId: 'bill-pending',
          billCode: 'HF 1',
          returnTo: '/bills/hf-1',
          pendingReference: 'pending-reference-with-at-least-32-chars',
          pendingCompletion: 'email-link',
        }),
      );
      testState.isLoading = true;
      root = createRoot(mount);
      act(() =>
        root.render(
          <SignInModalProvider>
            <OpenSignInProbe />
          </SignInModalProvider>,
        ),
      );

      testState.isLoading = false;
      testState.isSignedIn = true;
      testState.accessToken = 'restored-access-token';
      await act(async () => {
        root.render(
          <SignInModalProvider>
            <OpenSignInProbe />
          </SignInModalProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(testState.dialogProps.open).toBe(true);
      expect(testState.dialogProps.initialScreen).toBe(screen);
      expect(testState.dialogProps.intent).toBe('track');
      expect(testState.completionCalls).toHaveLength(0);
      expect(window.sessionStorage.getItem('alethical.pendingSignIn')).not.toBeNull();
    },
  );

  it('still closes an ordinary dialog when another tab signs in', async () => {
    act(() => testState.openSignIn({ intent: 'nav' }));
    expect(testState.dialogProps.open).toBe(true);

    testState.isSignedIn = true;
    testState.accessToken = 'other-tab-access-token';
    await act(async () => {
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(testState.dialogProps.open).toBe(false);
  });

  it('keeps an in-place Google cancellation open with its Track request', async () => {
    const google = deferred<{ ok: false; error: { kind: string; message: string } }>();
    testState.googleReplies.push(google.promise);
    act(() =>
      testState.openSignIn({
        intent: 'track',
        billId: 'bill-a',
        billCode: 'HF 1',
        returnTo: '/bills/hf-1',
      }),
    );

    let signIn!: Promise<void>;
    act(() => {
      signIn = testState.dialogProps.onGoogle();
    });
    await vi.waitFor(() => expect(testState.dialogProps.busyAction).toBe('google'));
    await vi.waitFor(() =>
      expect(window.sessionStorage.getItem('alethical.pendingSignIn')).not.toBeNull(),
    );

    testState.authError = 'The Google window was closed.';
    testState.authErrorKind = 'cancelled';
    await act(async () => {
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      );
      await Promise.resolve();
    });

    expect(testState.dialogProps.open).toBe(true);
    expect(testState.dialogProps.intent).toBe('track');
    expect(testState.dialogProps.billCode).toBe('HF 1');
    expect(testState.dialogProps.errorKind).toBe('cancelled');
    expect(testState.dialogProps.errorMessage).toBe('Google didn’t finish. Try again.');
    expect(testState.dialogProps.busyAction).toBeNull();
    expect(window.sessionStorage.getItem('alethical.pendingSignIn')).not.toBeNull();

    await act(async () => {
      google.resolve({
        ok: false,
        error: { kind: 'cancelled', message: 'The Google window was closed.' },
      });
      await signIn;
    });
  });

  it('reopens a returned Google cancellation with its Track request', async () => {
    act(() => root.unmount());
    window.sessionStorage.setItem(
      'alethical.pendingSignIn',
      JSON.stringify({
        intent: 'track',
        billId: 'bill-a',
        billCode: 'HF 1',
        returnTo: '/bills/hf-1',
        pendingReference: 'pending-reference-with-at-least-32-chars',
        pendingCompletion: 'ordinary',
      }),
    );
    window.history.replaceState(null, '', '/?error=access_denied');
    root = createRoot(mount);

    await act(async () => {
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(testState.dialogProps.open).toBe(true);
    expect(testState.dialogProps.intent).toBe('track');
    expect(testState.dialogProps.billCode).toBe('HF 1');
    expect(testState.dialogProps.errorKind).toBe('cancelled');
    expect(testState.dialogProps.errorMessage).toBe('Google didn’t finish. Try again.');
    expect(window.sessionStorage.getItem('alethical.pendingSignIn')).not.toBeNull();
    expect(window.location.search).toBe('');
  });

  it('does not blame Google when preparing a pending Track press fails first', async () => {
    const pendingReference = deferred<{ reference: string }>();
    testState.pendingReplies.push(pendingReference.promise);
    act(() =>
      testState.openSignIn({
        intent: 'track',
        billId: 'bill-a',
        billCode: 'HF 1',
        returnTo: '/bills/hf-1',
      }),
    );

    let signIn!: Promise<void>;
    act(() => {
      signIn = testState.dialogProps.onGoogle();
    });
    await vi.waitFor(() => expect(testState.dialogProps.busyAction).toBe('google'));
    await act(async () => {
      pendingReference.reject(new Error('Track setup failed'));
      await signIn;
    });

    expect(testState.googleCalls).toBe(0);
    expect(testState.dialogProps.errorKind).toBe('request-failure');
    expect(testState.dialogProps.errorMessage).toBe(
      'We couldn’t complete that request. Check your connection and try again.',
    );
  });

  it('closes after a requested Create screen changes to ordinary sign in', async () => {
    act(() => root.unmount());
    window.history.replaceState(null, '', '/#auth_screen=create');
    root = createRoot(mount);
    act(() =>
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      ),
    );
    await vi.waitFor(() => expect(testState.dialogProps.open).toBe(true));

    await act(async () => testState.dialogProps.onCancelAccountCode('sign-in'));
    testState.isSignedIn = true;
    testState.accessToken = 'other-tab-access-token';
    await act(async () => {
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      );
      await Promise.resolve();
    });

    expect(testState.dialogProps.open).toBe(false);
  });

  it('keeps a requested Create screen open after choosing another email', async () => {
    act(() => root.unmount());
    window.history.replaceState(null, '', '/#auth_screen=create');
    root = createRoot(mount);
    act(() =>
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      ),
    );
    await vi.waitFor(() => expect(testState.dialogProps.open).toBe(true));

    await act(async () => testState.dialogProps.onCancelAccountCode('create'));
    testState.isSignedIn = true;
    testState.accessToken = 'restored-access-token';
    await act(async () => {
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      );
      await Promise.resolve();
    });

    expect(testState.dialogProps.open).toBe(true);
  });

  it('lets an ordinary sign-in request replace a requested screen during session restore', async () => {
    act(() => root.unmount());
    window.history.replaceState(null, '', '/#auth_screen=create');
    testState.isLoading = true;
    root = createRoot(mount);
    act(() =>
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      ),
    );

    act(() => testState.openSignIn({ intent: 'nav' }));
    expect(testState.dialogProps.open).toBe(true);
    expect(testState.dialogProps.initialScreen).toBe('sign-in');

    testState.isLoading = false;
    testState.isSignedIn = true;
    testState.accessToken = 'other-tab-access-token';
    await act(async () => {
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      );
      await Promise.resolve();
    });

    expect(testState.dialogProps.open).toBe(false);
  });

  it('does not let a closed code request clear a newer dialog request', async () => {
    const firstReply = deferred<{ ok: true }>();
    const secondReply = deferred<{ ok: true }>();
    testState.requestReplies.push(firstReply.promise, secondReply.promise);

    let firstRequest!: Promise<any>;
    act(() => {
      firstRequest = testState.dialogProps.onRequestAccountCode('first@example.com', 'create');
    });
    await vi.waitFor(() => expect(testState.requestCalls).toBe(1));

    act(() => testState.dialogProps.onClose());

    let secondRequest!: Promise<any>;
    act(() => {
      secondRequest = testState.dialogProps.onRequestAccountCode('second@example.com', 'recover');
    });
    await vi.waitFor(() => expect(testState.requestCalls).toBe(2));
    expect(testState.dialogProps.busyAction).toBe('request-code');

    let firstResult: any;
    await act(async () => {
      firstReply.resolve({ ok: true });
      firstResult = await firstRequest;
    });

    expect(firstResult).toMatchObject({ ok: false, error: { kind: 'request-failure' } });
    expect(testState.dialogProps.busyAction).toBe('request-code');

    let secondResult: any;
    await act(async () => {
      secondReply.resolve({ ok: true });
      secondResult = await secondRequest;
    });

    expect(secondResult).toEqual({ ok: true });
    expect(testState.dialogProps.busyAction).toBeNull();
  });

  it.each(['google', 'password'] as const)(
    'does not let a closed %s reply clear a newer code request',
    async (method) => {
      const oldReply = deferred<any>();
      const newReply = deferred<{ ok: true }>();
      testState.requestReplies.push(newReply.promise);
      if (method === 'google') testState.googleReplies.push(oldReply.promise);
      else testState.passwordReplies.push(oldReply.promise);

      let oldRequest!: Promise<any>;
      act(() => {
        oldRequest =
          method === 'google'
            ? testState.dialogProps.onGoogle()
            : testState.dialogProps.onPasswordSignIn('first@example.com', 'password');
      });
      await vi.waitFor(() =>
        expect(testState.dialogProps.busyAction).toBe(method === 'google' ? 'google' : 'sign-in'),
      );

      act(() => testState.dialogProps.onClose());
      let newRequest!: Promise<any>;
      act(() => {
        newRequest = testState.dialogProps.onRequestAccountCode('second@example.com', 'recover');
      });
      await vi.waitFor(() => expect(testState.requestCalls).toBe(1));
      expect(testState.dialogProps.busyAction).toBe('request-code');

      await act(async () => {
        oldReply.resolve({
          ok: false,
          error: { kind: 'deactivated', message: 'OLD REQUEST ERROR' },
        });
        await oldRequest;
      });

      expect(testState.dialogProps.busyAction).toBe('request-code');
      expect(testState.dialogProps.errorMessage).not.toBe('OLD REQUEST ERROR');

      await act(async () => {
        newReply.resolve({ ok: true });
        await newRequest;
      });
      expect(testState.dialogProps.busyAction).toBeNull();
    },
  );

  it('keeps a code request open when another account signs in during Track setup', async () => {
    const pendingReference = deferred<{ reference: string }>();
    const requestReply = deferred<{ ok: true }>();
    testState.pendingReplies.push(pendingReference.promise);
    testState.requestReplies.push(requestReply.promise);

    act(() =>
      testState.openSignIn({
        intent: 'track',
        billId: 'bill-a',
        billCode: 'HF 1',
        returnTo: '/bills/hf-1',
      }),
    );
    let request!: Promise<any>;
    act(() => {
      request = testState.dialogProps.onRequestAccountCode('target@example.com', 'create');
    });
    await vi.waitFor(() => expect(testState.dialogProps.busyAction).toBe('request-code'));

    testState.isSignedIn = true;
    testState.accessToken = 'access-open-account';
    act(() =>
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      ),
    );
    pendingReference.resolve({ reference: 'pending-a' });
    await vi.waitFor(() => expect(testState.requestCalls).toBe(1));

    let result: any;
    await act(async () => {
      requestReply.resolve({ ok: true });
      result = await request;
    });

    expect(result).toEqual({ ok: true });
    expect(testState.dialogProps.open).toBe(true);
    expect(testState.dialogProps.intent).toBe('track');
    expect(testState.dialogProps.billCode).toBe('HF 1');
  });

  it('keeps a password request open when another account signs in during Track setup', async () => {
    const pendingReference = deferred<{ reference: string }>();
    const passwordReply = deferred<{ ok: true }>();
    testState.pendingReplies.push(pendingReference.promise);
    testState.passwordReplies.push(passwordReply.promise);
    act(() =>
      testState.openSignIn({
        intent: 'track',
        billId: 'bill-a',
        billCode: 'HF 1',
        returnTo: '/bills/hf-1',
      }),
    );

    let signIn!: Promise<any>;
    act(() => {
      signIn = testState.dialogProps.onPasswordSignIn('account-a@example.com', 'password');
    });
    await vi.waitFor(() => expect(testState.dialogProps.busyAction).toBe('sign-in'));

    testState.isSignedIn = true;
    testState.accessToken = 'access-account-b';
    act(() =>
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      ),
    );
    expect(testState.dialogProps.open).toBe(true);
    expect(testState.completionCalls).toHaveLength(0);

    await act(async () => {
      pendingReference.resolve({ reference: 'pending-track' });
      await Promise.resolve();
      passwordReply.resolve({ ok: true });
      await signIn;
    });

    await vi.waitFor(() => expect(testState.dialogProps.open).toBe(false));
    expect(testState.completionCalls).toEqual([['access-account-b', 'pending-track']]);
  });

  it('keeps a Google request open when another account signs in during Track setup', async () => {
    const pendingReference = deferred<{ reference: string }>();
    testState.pendingReplies.push(pendingReference.promise);
    act(() =>
      testState.openSignIn({
        intent: 'track',
        billId: 'bill-a',
        billCode: 'HF 1',
        returnTo: '/bills/hf-1',
      }),
    );

    let signIn!: Promise<void>;
    act(() => {
      signIn = testState.dialogProps.onGoogle();
    });
    await vi.waitFor(() => expect(testState.dialogProps.busyAction).toBe('google'));

    testState.isSignedIn = true;
    testState.accessToken = 'access-account-b';
    act(() =>
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      ),
    );
    expect(testState.dialogProps.open).toBe(true);
    expect(testState.completionCalls).toHaveLength(0);

    await act(async () => {
      pendingReference.resolve({ reference: 'pending-track' });
      await signIn;
    });

    await vi.waitFor(() => expect(testState.dialogProps.open).toBe(false));
    expect(testState.completionCalls).toEqual([['access-account-b', 'pending-track']]);
  });

  it('reopens after a full-page Google return when saving the pending Track press fails', async () => {
    act(() => root.unmount());
    window.sessionStorage.setItem(
      'alethical.pendingSignIn',
      JSON.stringify({
        intent: 'track',
        billId: 'bill-a',
        billCode: 'HF 1',
        returnTo: '/bills/hf-1',
        pendingReference: 'pending-track-reference-with-32-chars',
        pendingCompletion: 'ordinary',
      }),
    );
    testState.isSignedIn = true;
    testState.accessToken = 'access-account-b';
    testState.completionReplies.push(Promise.reject(new Error('Track save failed')));
    root = createRoot(mount);
    await act(async () => {
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(testState.completionCalls).toHaveLength(1));

    expect(testState.dialogProps.open).toBe(true);
    expect(testState.dialogProps.errorKind).toBe('request-failure');
    expect(testState.dialogProps.pendingTrackRetry).toBe(true);
    expect(testState.googleCalls).toBe(0);
    expect(window.sessionStorage.getItem('alethical.pendingSignIn')).not.toBeNull();

    const retryCompletion = deferred<void>();
    testState.completionReplies.push(retryCompletion.promise);
    let retry!: Promise<void>;
    act(() => {
      retry = testState.dialogProps.onGoogle();
    });

    await vi.waitFor(() => expect(testState.dialogProps.busyAction).toBe('google'));
    expect(testState.dialogProps.pendingTrackRetry).toBe(true);
    expect(testState.googleCalls).toBe(0);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await testState.dialogProps.onGoogle();
    });
    expect(testState.dialogProps.busyAction).toBe('google');
    expect(testState.completionCalls).toHaveLength(2);

    await act(async () => {
      retryCompletion.resolve();
      await retry;
    });

    await vi.waitFor(() => expect(testState.completionCalls).toHaveLength(2));
    await vi.waitFor(() => expect(testState.dialogProps.open).toBe(false));
    expect(testState.googleCalls).toBe(0);
    expect(window.sessionStorage.getItem('alethical.pendingSignIn')).toBeNull();
  });

  it('closes a requested dialog when another account wins before password failure', async () => {
    act(() => root.unmount());
    window.history.replaceState(null, '', '/#auth_screen=create');
    root = createRoot(mount);
    act(() =>
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      ),
    );
    await vi.waitFor(() => expect(testState.dialogProps.open).toBe(true));
    const passwordReply = deferred<any>();
    testState.passwordReplies.push(passwordReply.promise);

    let signIn!: Promise<any>;
    act(() => {
      signIn = testState.dialogProps.onPasswordSignIn('account-a@example.com', 'password');
    });
    await vi.waitFor(() => expect(testState.dialogProps.busyAction).toBe('sign-in'));

    testState.isSignedIn = true;
    testState.accessToken = 'access-account-b';
    act(() =>
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      ),
    );
    expect(testState.dialogProps.open).toBe(true);

    await act(async () => {
      passwordReply.resolve({
        ok: false,
        error: { kind: 'bad-credentials', message: 'Email or password is incorrect.' },
      });
      await signIn;
    });

    await vi.waitFor(() => expect(testState.dialogProps.open).toBe(false));
    expect(testState.completionCalls).toHaveLength(0);
  });

  it('finishes the newer signed-in account after an older password check settles', async () => {
    const passwordReply = deferred<{ ok: true }>();
    testState.pendingReplies.push(Promise.resolve({ reference: 'pending-track' }));
    testState.passwordReplies.push(passwordReply.promise);
    act(() =>
      testState.openSignIn({
        intent: 'track',
        billId: 'bill-a',
        billCode: 'HF 1',
        returnTo: '/bills/hf-1',
      }),
    );

    let signIn!: Promise<any>;
    act(() => {
      signIn = testState.dialogProps.onPasswordSignIn('account-a@example.com', 'password');
    });
    await vi.waitFor(() => expect(testState.dialogProps.busyAction).toBe('sign-in'));

    testState.isSignedIn = true;
    testState.accessToken = 'access-account-b';
    act(() =>
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      ),
    );
    expect(testState.dialogProps.open).toBe(true);

    await act(async () => {
      passwordReply.resolve({ ok: true });
      await signIn;
    });

    await vi.waitFor(() => expect(testState.dialogProps.open).toBe(false));
    expect(testState.completionCalls).toEqual([['access-account-b', 'pending-track']]);
  });

  it('an old Track completion cannot close or erase a newer Track request', async () => {
    const oldCompletion = deferred<void>();
    testState.pendingReplies.push(Promise.resolve({ reference: 'pending-old' }));
    testState.googleReplies.push(Promise.resolve({ ok: true }));
    testState.completionReplies.push(oldCompletion.promise);

    act(() =>
      testState.openSignIn({
        intent: 'track',
        billId: 'bill-old',
        billCode: 'HF 1',
        returnTo: '/bills/hf-1',
      }),
    );
    await act(async () => testState.dialogProps.onGoogle());

    testState.isSignedIn = true;
    testState.accessToken = 'access-old';
    act(() =>
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      ),
    );
    await vi.waitFor(() => expect(testState.completionCalls).toHaveLength(1));
    expect(testState.completionCalls[0]?.[1]).toBe('pending-old');

    testState.isSignedIn = false;
    testState.accessToken = null;
    act(() =>
      root.render(
        <SignInModalProvider>
          <OpenSignInProbe />
        </SignInModalProvider>,
      ),
    );
    act(() =>
      testState.openSignIn({
        intent: 'track',
        billId: 'bill-new',
        billCode: 'SF 2',
        returnTo: '/bills/sf-2',
      }),
    );

    await act(async () => oldCompletion.resolve());

    expect(testState.dialogProps.open).toBe(true);
    expect(testState.dialogProps.intent).toBe('track');
    expect(testState.dialogProps.billCode).toBe('SF 2');
  });
});
