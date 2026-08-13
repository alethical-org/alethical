import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
}));

vi.mock('../SignInContainer', () => ({
  SignInContainer: ({
    title,
    description,
    icon,
    children,
  }: {
    title: string;
    description: React.ReactNode;
    icon: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <section>
      {icon}
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </section>
  ),
}));

vi.mock('../../../theme/primitives', () => ({
  GoogleButton: ({
    label,
    busyLabel,
    busy,
  }: {
    label: string;
    busyLabel?: string;
    busy: boolean;
  }) => <button aria-busy={busy}>{busy ? busyLabel : label}</button>,
}));

import { SignInDialog, SignInDialogProps } from '../SignInDialog';

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'SignInDialog.tsx'),
  'utf8',
);

function props(overrides: Partial<SignInDialogProps> = {}): SignInDialogProps {
  const ok = vi.fn(async () => ({ ok: true }) as const);
  return {
    open: true,
    intent: 'nav',
    emailPasswordEnabled: true,
    resendWaitSeconds: 45,
    onClose: vi.fn(),
    onGoogle: vi.fn(async () => undefined),
    onPasswordSignIn: ok,
    onCreateAccount: ok,
    onResendConfirmation: ok,
    onForgotPassword: ok,
    onBackFromOutcome: vi.fn(),
    ...overrides,
  };
}

function render(overrides: Partial<SignInDialogProps> = {}) {
  return renderToStaticMarkup(<SignInDialog {...props(overrides)} />);
}

describe('rev 9 sign-in dialog', () => {
  it('keeps Google and adds the complete email sign-in choice', () => {
    const html = render({ initialEmail: 'jordan@example.com' });

    expect(html).toContain('Sign in to Alethical');
    expect(html).toContain('Continue with Google');
    expect(html).toContain('>or<');
    expect(html).toContain('EMAIL');
    expect(html).toContain('PASSWORD');
    expect(html).toMatch(/autocomplete="email"/i);
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toContain('Forgot password?');
    expect(html).toContain('Create an account');
    expect(html).toContain('Terms of Use');
    expect(html).toContain('Privacy Policy');
  });

  it('keeps Google working while email launch is held for the production sender', () => {
    const html = render({ emailPasswordEnabled: false });

    expect(html).toContain('Continue with Google');
    expect(html).not.toContain('>or<');
    expect(html).not.toContain('PASSWORD');
    expect(html).not.toContain('Forgot password?');
    expect(html).not.toContain('Create an account');
  });

  it('keeps the Track reason and bill code on email or Google sign-in', () => {
    const html = render({ intent: 'track', billCode: 'HF 4138' });

    expect(html).toContain('Sign in to track this bill');
    expect(html).toContain(
      'Save HF 4138 to your tracked bills and check where it stands whenever you come back.',
    );
  });

  it('renders 2 new-password fields and the 15-character passphrase help on create', () => {
    const html = render({ initialScreen: 'create', initialEmail: 'jordan@example.com' });

    expect(html).toContain('Create your Alethical account');
    expect(html).toContain('Bills you track are saved to your account.');
    expect(html.match(/autocomplete="new-password"/gi)).toHaveLength(2);
    expect(html).toContain('CONFIRM PASSWORD');
    expect(html).toContain('Use at least 15 characters. A few words with spaces works well.');
    expect(html).toContain('Already use Google with this email?');
    expect(html).toContain('Continue with Google.');
    expect(html).toContain('Create account');
  });

  it('pins the separate create-account Track wording', () => {
    const html = render({ initialScreen: 'create', intent: 'track', billCode: 'SF 10' });

    expect(html).toContain('Create an account to track this bill');
    expect(html).toContain(
      'Save SF 10 to your tracked bills and check where it stands whenever you come back.',
    );
    expect(html).not.toContain('You’ll use this email and password');
  });

  it('shows the neutral confirmation destination and its 3 safe actions', () => {
    const html = render({ initialScreen: 'check-email', initialEmail: 'jordan@example.com' });

    expect(html).toContain('Check your email');
    expect(html).toContain(
      'If this address can create an Alethical account, a confirmation link is on the way to jordan@example.com.',
    );
    expect(html).toContain('Resend email');
    expect(html).toContain('Sign in after confirming');
    expect(html).toContain('Change email');
  });

  it('uses neutral reset wording before and after sending', () => {
    const forgot = render({ initialScreen: 'forgot', initialEmail: 'jordan@example.com' });
    const sent = render({ initialScreen: 'forgot-sent', initialEmail: 'jordan@example.com' });

    expect(forgot).toContain('Reset your password');
    expect(forgot).toContain('Send reset instructions');
    expect(forgot).toContain('Back to sign in');
    expect(sent).toContain(
      'If an Alethical account can use that email, we’ll send password reset instructions to jordan@example.com.',
    );
    expect(sent).toContain('Resend email');
    expect(sent).toContain('Change email');
  });

  it('uses dedicated deactivated and unsafe-match outcomes without a sign-in form', () => {
    const deactivated = render({
      errorKind: 'deactivated',
      errorMessage:
        'This account has been deactivated, so we’ve signed you out. Bills, votes and legislators are all still here to read. Contact us at ask@alethical.com if you think this is a mistake.',
    });
    const unsafe = render({
      errorKind: 'match-failed',
      errorMessage:
        'We couldn’t safely match this sign-in to your account. Sign in with the method you used before.',
    });

    expect(deactivated).toContain('This account has been deactivated');
    expect(deactivated).toContain('Back to sign in');
    expect(deactivated).not.toContain('Continue with Google');
    expect(unsafe).toContain('We couldn’t match this sign-in');
    expect(unsafe).toContain('Back to sign in');
    expect(unsafe).not.toContain('EMAIL');
  });

  it('uses shared validation, first-press locking, and the supplied resend wait', () => {
    expect(SOURCE).toContain('validateEmail(email)');
    expect(SOURCE).toContain('validatePassword(password)');
    expect(SOURCE).toContain('validatePasswordMatch(password, confirmation)');
    expect(SOURCE).toContain('createValidRequestGate()');
    expect(SOURCE).toContain("result.error.kind === 'email-not-confirmed'");
    expect(SOURCE).toContain("result.error.kind === 'check-email'");
    expect(SOURCE).toContain("if (error.kind === 'bad-credentials') setPassword('')");
    expect(SOURCE).toContain('Math.ceil(resendWaitSeconds)');
    expect(SOURCE).not.toMatch(/resendWaitSeconds\s*=\s*60/);
    expect(SOURCE).not.toContain('maxlength');
  });

  it('clears email and password values as soon as the sign-in form closes', () => {
    expect(SOURCE).toContain("setEmail('');");
    expect(SOURCE).toContain("setPassword('');");
    expect(SOURCE).toContain("setConfirmation('');");
  });
});
