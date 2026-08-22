// @vitest-environment jsdom

import { act, ReactNode, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const responsive = vi.hoisted(() => ({ isMobile: true, width: 390 }));

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
}));

vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({
    width: responsive.width,
    isMobile: responsive.isMobile,
    isTablet: false,
    isDesktop: !responsive.isMobile,
  }),
}));

vi.mock('../SignInContainer', () => ({
  descriptionTextStyle: {},
  SignInContainer: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: ReactNode;
    children: ReactNode;
  }) => (
    <section>
      <h1>{title}</h1>
      <div>{description}</div>
      {children}
    </section>
  ),
}));

vi.mock('../LoadingButton', () => ({
  LoadingButton: ({
    label,
    busyLabel,
    busy = false,
    disabled = false,
    onPress,
  }: {
    label: string;
    busyLabel?: string;
    busy?: boolean;
    disabled?: boolean;
    onPress?: () => void | Promise<void>;
  }) => (
    <button disabled={disabled} aria-busy={busy} onClick={() => void onPress?.()}>
      {busy ? busyLabel : label}
    </button>
  ),
}));

vi.mock('../../../theme/primitives', () => ({
  GoogleButton: ({
    label,
    busyLabel,
    busy,
    disabled = false,
    onPress,
  }: {
    label: string;
    busyLabel?: string;
    busy: boolean;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {busy ? busyLabel : label}
    </button>
  ),
}));

vi.mock('../EmailField', () => ({
  EmailField: ({
    inputRef,
    value,
    error,
    onChangeText,
  }: {
    inputRef: React.Ref<HTMLInputElement>;
    value: string;
    error?: string;
    onChangeText: (value: string) => void;
  }) => (
    <label>
      EMAIL
      <input
        ref={inputRef}
        aria-label="EMAIL"
        value={value}
        onChange={(event) => onChangeText(event.currentTarget.value)}
      />
      {error ? <span>{error}</span> : null}
    </label>
  ),
}));

vi.mock('../CodeField', () => ({
  CodeField: ({
    inputRef,
    value,
    error,
    onChangeText,
  }: {
    inputRef: React.Ref<HTMLInputElement>;
    value: string;
    error?: string;
    onChangeText: (value: string) => void;
  }) => (
    <label>
      CODE
      <input
        ref={inputRef}
        aria-label="CODE"
        value={value}
        onChange={(event) => onChangeText(event.currentTarget.value)}
      />
      {error ? <span>{error}</span> : null}
    </label>
  ),
}));

vi.mock('../PasswordField', () => ({
  PasswordField: ({
    inputRef,
    label = 'PASSWORD',
    value,
    helper,
    error,
    onFocus,
    onChangeText,
  }: {
    inputRef: React.Ref<HTMLInputElement>;
    label?: string;
    value: string;
    helper?: string;
    error?: string;
    onFocus?: () => void;
    onChangeText: (value: string) => void;
  }) => (
    <label>
      {label}
      <input
        ref={inputRef}
        aria-label={label}
        value={value}
        onFocus={onFocus}
        onChange={(event) => onChangeText(event.currentTarget.value)}
      />
      {helper ? <span>{helper}</span> : null}
      {error ? <span>{error}</span> : null}
    </label>
  ),
}));

vi.mock('../ResendControl', () => ({
  ResendControl: ({
    status,
    sentMessage,
    actionLabel,
    secondsRemaining,
    disabled = false,
    onResend,
  }: {
    status: string;
    sentMessage: string;
    actionLabel: string;
    secondsRemaining: number;
    disabled?: boolean;
    onResend: () => void | Promise<void>;
  }) =>
    status === 'ready' ? (
      <button disabled={disabled} onClick={() => void onResend()}>
        {actionLabel}
      </button>
    ) : (
      <p>
        {sentMessage} Try again in {secondsRemaining} seconds
      </p>
    ),
}));

import {
  SignInDialog,
  type AccountCodePasswordActionResult,
  type SignInDialogActionResult,
  type SignInDialogProps,
} from '../SignInDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function baseProps(overrides: Partial<SignInDialogProps> = {}): SignInDialogProps {
  return {
    open: true,
    intent: 'nav',
    initialScreen: 'create',
    initialEmail: 'jordan@example.com',
    emailPasswordEnabled: true,
    resendWaitSeconds: 60,
    onClose: vi.fn(),
    onGoogle: vi.fn(async () => undefined),
    onPasswordSignIn: vi.fn(async () => ({ ok: true }) as SignInDialogActionResult),
    onRequestAccountCode: vi.fn(async () => ({ ok: true }) as SignInDialogActionResult),
    onVerifyAccountCode: vi.fn(async () => ({
      ok: true as const,
      data: { email: 'jordan@example.com', googleStillWorks: false },
    })),
    onSaveAccountCodePassword: vi.fn(
      async () =>
        ({
          ok: true,
          data: {
            passwordStatus: 'saved',
            relationship: 'none',
            requiresAccountChoice: false,
          },
        }) as AccountCodePasswordActionResult,
    ),
    onRetryAccountCodeFinish: vi.fn(
      async () =>
        ({
          ok: true,
          data: {
            passwordStatus: 'saved',
            relationship: 'none',
            requiresAccountChoice: false,
          },
        }) as AccountCodePasswordActionResult,
    ),
    onKeepCurrentAccount: vi.fn(async () => undefined),
    onSwitchAccount: vi.fn(async () => ({ ok: true }) as SignInDialogActionResult),
    onCancelAccountCode: vi.fn(async () => undefined),
    ...overrides,
  };
}

function enter(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`Input not found: ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Input value setter is unavailable');
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

async function press(label: string) {
  const control = [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!control) throw new Error(`Control not found: ${label}`);
  await act(async () => {
    control.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function mountDialog(props: SignInDialogProps): { root: Root; mount: HTMLDivElement } {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  act(() => root.render(<SignInDialog {...props} />));
  return { root, mount };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  Reflect.deleteProperty(window, 'visualViewport');
  responsive.isMobile = true;
  responsive.width = 390;
  vi.clearAllMocks();
});

describe('email-code account access', () => {
  it('moves from Create to code entry without claiming delivery', async () => {
    const request = vi.fn(async () => ({ ok: true }) as SignInDialogActionResult);
    const { root, mount } = mountDialog(baseProps({ onRequestAccountCode: request }));

    await press('Continue');

    expect(request).toHaveBeenCalledWith('jordan@example.com', 'create');
    expect(mount.querySelector('h1')?.textContent).toBe('Enter your code');
    expect(mount.textContent?.toLowerCase()).not.toMatch(/sent|arriv|on the way/);
    expect(mount.textContent).toContain('Enter the newest code');
    expect(mount.textContent).toContain('Use another email');
    expect(mount.textContent).toContain('No code? Check spam or contact us');

    act(() => root.unmount());
  });

  it('keeps a rejected code editable and focuses it for correction', async () => {
    const verify = vi.fn(async () => ({
      ok: false as const,
      error: {
        kind: 'wrong-or-expired-code',
        message: 'That code is wrong or expired. Enter the newest code or send a new one.',
      },
    }));
    const { root, mount } = mountDialog(
      baseProps({ initialScreen: 'code', onVerifyAccountCode: verify }),
    );

    const code = enter('CODE', '123456');
    await press('Continue');

    expect(verify).toHaveBeenCalledWith('123456');
    expect(mount.querySelector('h1')?.textContent).toBe('Enter your code');
    expect(mount.textContent).toContain('That code is wrong or expired');
    expect(document.activeElement).toBe(code);

    act(() => root.unmount());
  });

  it('clears an old code after requesting a new one', async () => {
    const request = vi.fn(async () => ({ ok: true }) as SignInDialogActionResult);
    const { root } = mountDialog(
      baseProps({
        initialScreen: 'code',
        resendWaitSeconds: 0,
        onRequestAccountCode: request,
      }),
    );

    const code = enter('CODE', '12345678');
    await press('Send a new code');

    expect(request).toHaveBeenCalledWith('jordan@example.com', 'create');
    expect(code.value).toBe('');
    expect(document.activeElement).toBe(code);
    act(() => root.unmount());
  });

  it('does not show a password error when a code request is refused', async () => {
    const request = vi.fn(
      async () =>
        ({
          ok: false,
          error: { kind: 'bad-credentials', message: 'Email or password is incorrect' },
        }) as SignInDialogActionResult,
    );
    const { root, mount } = mountDialog(baseProps({ onRequestAccountCode: request }));

    await press('Continue');

    expect(mount.textContent).toContain(
      'We couldn’t request a code. Check your connection and try again.',
    );
    expect(mount.textContent).not.toContain('Email or password is incorrect');
    act(() => root.unmount());
  });

  it('ignores a finished request from an older dialog opening', async () => {
    const first = deferred<SignInDialogActionResult>();
    const second = deferred<SignInDialogActionResult>();
    const third = deferred<SignInDialogActionResult>();
    const request = vi
      .fn<SignInDialogProps['onRequestAccountCode']>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);
    const props = baseProps({ onRequestAccountCode: request });
    const { root, mount } = mountDialog(props);

    await press('Continue');
    expect(request).toHaveBeenCalledTimes(1);

    act(() => root.render(<SignInDialog {...props} open={false} busyAction={null} />));
    act(() => root.render(<SignInDialog {...props} open busyAction={null} />));

    await press('Continue');
    expect(request).toHaveBeenCalledTimes(2);
    act(() => root.render(<SignInDialog {...props} open busyAction="request-code" />));

    first.resolve({
      ok: false,
      error: { kind: 'request-failure', message: 'OLD REQUEST ERROR' },
    });
    await act(async () => {
      await first.promise;
      await Promise.resolve();
    });

    expect(mount.textContent).not.toContain('OLD REQUEST ERROR');
    const busyButton = [...mount.querySelectorAll('button')].find(
      (button) => button.textContent === 'Continuing…',
    );
    expect(busyButton?.getAttribute('aria-busy')).toBe('true');

    await press('Continuing…');
    expect(request).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
  });

  it('focuses the code after a new-code request is rate-limited', async () => {
    const request = vi.fn(
      async () =>
        ({
          ok: false,
          error: { kind: 'too-many-attempts', message: 'Try again in 60 seconds.' },
        }) as SignInDialogActionResult,
    );
    const { root } = mountDialog(
      baseProps({
        initialScreen: 'code',
        resendWaitSeconds: 60,
        onRequestAccountCode: request,
      }),
    );

    const code = enter('CODE', '12345678');
    await press('Send a new code');

    expect(document.activeElement).toBe(code);
    act(() => root.unmount());
  });

  it('marks Google and new-code actions unavailable while a code is being checked', () => {
    const { root, mount } = mountDialog(
      baseProps({ initialScreen: 'code', busyAction: 'verify-code' }),
    );

    const google = [...mount.querySelectorAll('button')].find(
      (button) => button.textContent === 'Continue with Google',
    );
    const resend = [...mount.querySelectorAll('button')].find(
      (button) => button.textContent === 'Send a new code',
    );
    expect(google?.disabled).toBe(true);
    expect(resend?.disabled).toBe(true);

    act(() => root.unmount());
  });

  it('accepts any 8 characters, rejects 7, and never mentions breaches', async () => {
    const save = vi.fn(
      async () =>
        ({
          ok: true,
          data: {
            passwordStatus: 'saved',
            relationship: 'none',
            requiresAccountChoice: false,
          },
        }) as AccountCodePasswordActionResult,
    );
    const { root, mount } = mountDialog(
      baseProps({ initialScreen: 'choose-password', onSaveAccountCodePassword: save }),
    );

    const short = enter('PASSWORD', '1234567');
    enter('CONFIRM PASSWORD', '1234567');
    await press('Save password');

    expect(save).not.toHaveBeenCalled();
    expect(mount.textContent).toContain('Use at least 8 characters');
    expect(document.activeElement).toBe(short);

    enter('PASSWORD', '12345678');
    enter('CONFIRM PASSWORD', '12345678');
    await press('Save password');

    expect(save).toHaveBeenCalledWith('12345678');
    expect(mount.textContent?.toLowerCase()).not.toMatch(/breach|leak|pwn/);

    act(() => root.unmount());
  });

  it('keeps a different open account until the person chooses', async () => {
    const save = vi.fn(
      async () =>
        ({
          ok: true,
          data: {
            passwordStatus: 'saved',
            relationship: 'different',
            requiresAccountChoice: true,
            openAccount: {
              id: 'open-user',
              name: 'Marissa Chen',
              email: 'marissa@example.com',
            },
          },
        }) as AccountCodePasswordActionResult,
    );
    const keep = vi.fn(async () => undefined);
    const switchAccount = vi.fn(async () => ({ ok: true }) as SignInDialogActionResult);
    const { root, mount } = mountDialog(
      baseProps({
        initialScreen: 'choose-password',
        onSaveAccountCodePassword: save,
        onKeepCurrentAccount: keep,
        onSwitchAccount: switchAccount,
      }),
    );

    enter('PASSWORD', 'abcdefgh');
    enter('CONFIRM PASSWORD', 'abcdefgh');
    await press('Save password');

    expect(mount.querySelector('h1')?.textContent).toBe('Account ready');
    expect(mount.textContent).toContain('You’re still signed in as marissa@example.com');
    expect(mount.textContent).toContain('Keep current account');
    expect(mount.textContent).toContain('Switch account');

    await press('Keep current account');
    expect(keep).toHaveBeenCalledTimes(1);
    expect(switchAccount).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it('allows only 1 account choice while Switch is running', async () => {
    const switching = deferred<SignInDialogActionResult>();
    const keep = vi.fn(async () => undefined);
    const switchAccount = vi.fn(() => switching.promise);

    function Harness() {
      const [busyAction, setBusyAction] = useState<SignInDialogProps['busyAction']>(null);
      return (
        <SignInDialog
          {...baseProps({ initialScreen: 'different-account' })}
          busyAction={busyAction}
          onKeepCurrentAccount={async () => {
            setBusyAction('finish-code');
            await keep();
            setBusyAction(null);
          }}
          onSwitchAccount={async () => {
            setBusyAction('switch-account');
            const result = await switchAccount();
            setBusyAction(null);
            return result;
          }}
        />
      );
    }

    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    act(() => root.render(<Harness />));

    await press('Switch account');
    expect(switchAccount).toHaveBeenCalledOnce();
    expect(
      [...mount.querySelectorAll('button')].find(
        (button) => button.textContent === 'Keep current account',
      )?.disabled,
    ).toBe(true);
    await press('Keep current account');
    expect(keep).not.toHaveBeenCalled();

    switching.resolve({ ok: true });
    await act(async () => {
      await switching.promise;
    });
    act(() => root.unmount());
  });

  it('never offers another password save after an uncertain reply', async () => {
    const save = vi.fn(
      async () =>
        ({
          ok: true,
          data: {
            passwordStatus: 'unknown',
            relationship: 'none',
            requiresAccountChoice: false,
          },
        }) as AccountCodePasswordActionResult,
    );
    const { root, mount } = mountDialog(
      baseProps({ initialScreen: 'choose-password', onSaveAccountCodePassword: save }),
    );

    enter('PASSWORD', 'abcdefgh');
    enter('CONFIRM PASSWORD', 'abcdefgh');
    await press('Save password');

    expect(mount.querySelector('h1')?.textContent).toBe(
      'We couldn’t confirm the password was saved',
    );
    expect(mount.textContent).not.toContain('Save password');
    expect(document.querySelector('input[aria-label="PASSWORD"]')).toBeNull();

    act(() => root.unmount());
  });

  it('cleans up code work before leaving Create or Recover', async () => {
    for (const [screen, label] of [
      ['create', 'Sign in'],
      ['recover', 'Back to sign in'],
    ] as const) {
      const cancel = vi.fn(async () => undefined);
      const { root, mount } = mountDialog(
        baseProps({ initialScreen: screen, onCancelAccountCode: cancel }),
      );

      await press(label);

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(mount.querySelector('h1')?.textContent).toBe('Sign in to Alethical');
      act(() => root.unmount());
    }
  });

  it('cleans up a deactivated code flow before returning to sign in', async () => {
    const cancel = vi.fn(async () => undefined);
    function Harness() {
      const [deactivated, setDeactivated] = useState(true);
      return (
        <SignInDialog
          {...baseProps({
            initialScreen: 'code',
            onCancelAccountCode: cancel,
            onBackFromOutcome: () => setDeactivated(false),
          })}
          errorKind={deactivated ? 'deactivated' : null}
          errorMessage={deactivated ? 'This account has been deactivated' : null}
        />
      );
    }
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    act(() => root.render(<Harness />));

    await press('Back to sign in');

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mount.querySelector('h1')?.textContent).toBe('Sign in to Alethical');
    expect(mount.querySelector('input[aria-label="CODE"]')).toBeNull();
    act(() => root.unmount());
  });

  it('keeps the phone password actions visible when its keyboard opens', () => {
    class PhoneViewport extends EventTarget {
      height = 844;
    }
    const viewport = new PhoneViewport();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const { root } = mountDialog(baseProps({ initialScreen: 'choose-password' }));
    const confirmation = document.querySelector<HTMLInputElement>(
      'input[aria-label="CONFIRM PASSWORD"]',
    );

    act(() => confirmation?.focus());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', inline: 'nearest' });

    scrollIntoView.mockClear();
    act(() => {
      viewport.height = 520;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', inline: 'nearest' });

    act(() => root.unmount());
  });

  it('does not move the desktop password form on focus', () => {
    responsive.isMobile = false;
    responsive.width = 1200;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const { root } = mountDialog(baseProps({ initialScreen: 'choose-password' }));

    act(() =>
      document.querySelector<HTMLInputElement>('input[aria-label="CONFIRM PASSWORD"]')?.focus(),
    );

    expect(scrollIntoView).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
