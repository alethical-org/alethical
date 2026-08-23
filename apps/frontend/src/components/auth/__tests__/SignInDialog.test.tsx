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
  descriptionTextStyle: {},
  accountPanelDescriptionTextStyle: {},
  SignInContainer: ({
    title,
    description,
    icon,
    headerIcon,
    backAction,
    contentGap,
    children,
  }: {
    title: string;
    description: React.ReactNode;
    icon: React.ReactNode;
    headerIcon?: React.ReactNode;
    backAction?: { label: string; onPress: () => void };
    contentGap?: number;
    children: React.ReactNode;
  }) => (
    <section data-content-gap={contentGap}>
      {headerIcon}
      {backAction ? (
        <button aria-label={backAction.label} onClick={backAction.onPress}>
          Back
        </button>
      ) : null}
      {icon}
      <h2>{title}</h2>
      <div>{description}</div>
      {children}
    </section>
  ),
}));

vi.mock('../../../theme/primitives', () => ({
  GoogleButton: ({
    label,
    busyLabel,
    busy,
    disabled,
  }: {
    label: string;
    busyLabel?: string;
    busy: boolean;
    disabled?: boolean;
  }) => (
    <button aria-busy={busy} disabled={disabled}>
      {busy ? busyLabel : label}
    </button>
  ),
}));

import { SignInDialog, SignInDialogProps } from '../SignInDialog';

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'SignInDialog.tsx'),
  'utf8',
);

function props(overrides: Partial<SignInDialogProps> = {}): SignInDialogProps {
  const ok = vi.fn(async () => ({ ok: true }) as const);
  const verified = vi.fn(
    async () =>
      ({
        ok: true,
        data: { email: 'jordan@example.com', googleStillWorks: false },
      }) as const,
  );
  const passwordSaved = vi.fn(
    async () =>
      ({
        ok: true,
        data: {
          passwordStatus: 'saved',
          relationship: 'none',
          requiresAccountChoice: false,
        },
      }) as const,
  );
  return {
    open: true,
    intent: 'nav',
    emailPasswordEnabled: true,
    resendWaitSeconds: 45,
    onClose: vi.fn(),
    onGoogle: vi.fn(async () => undefined),
    onPasswordSignIn: ok,
    onRequestAccountCode: ok,
    onVerifyAccountCode: verified,
    onSaveAccountCodePassword: passwordSaved,
    onRetryAccountCodeFinish: passwordSaved,
    onKeepCurrentAccount: vi.fn(async () => undefined),
    onSwitchAccount: ok,
    onCancelAccountCode: vi.fn(async () => undefined),
    onBackFromOutcome: vi.fn(),
    ...overrides,
  };
}

function render(overrides: Partial<SignInDialogProps> = {}) {
  return renderToStaticMarkup(<SignInDialog {...props(overrides)} />);
}

describe('rev 9 sign-in dialog', () => {
  it('shows all 4 opening paths without the email form', () => {
    const html = render({ initialEmail: 'jordan@example.com' });

    expect(html).toContain('Sign in to Alethical');
    expect(html).toContain('Continue with Google');
    expect(html).toContain('Sign in with email');
    expect(html).toContain('Forgot password?');
    expect(html).toContain('Create an account');
    expect(html).toContain('Terms of Use');
    expect(html).toContain('Privacy Policy');
    expect(html).toContain('data-content-gap="18"');
    expect(html).not.toContain('EMAIL');
    expect(html).not.toContain('PASSWORD');
    expect(html).not.toContain('aria-expanded');
  });

  it('shows the compact email form only after the email choice', () => {
    const html = render({ initialScreen: 'email-sign-in', initialEmail: 'jordan@example.com' });

    expect(html).toContain('Sign in with email');
    expect(html).toContain('EMAIL');
    expect(html).toContain('PASSWORD');
    expect(html).toMatch(/autocomplete="email"/i);
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toContain('data-content-gap="16"');
    expect(html).not.toContain('Continue with Google');
  });

  it('keeps Google working while email launch is held for the production sender', () => {
    const html = render({ emailPasswordEnabled: false });

    expect(html).toContain('Continue with Google');
    expect(html).not.toContain('>or<');
    expect(html).not.toContain('PASSWORD');
    expect(html).not.toContain('Forgot password?');
    expect(html).not.toContain('Create an account');
  });

  it('keeps the accepted Track reason on the 4-choice opening', () => {
    const html = render({ intent: 'track', billCode: 'HF 4138' });

    expect(html).toContain('Sign in to Alethical');
    expect(html).toContain('This bill goes to your tracked list');
  });

  it('asks only for email before proving a new account', () => {
    const html = render({ initialScreen: 'create', initialEmail: 'jordan@example.com' });

    expect(html).toContain('Create your Alethical account');
    expect(html).toContain('Bills you track are saved to your account');
    expect(html).not.toContain('autocomplete="new-password"');
    expect(html).not.toContain('CONFIRM PASSWORD');
    expect(html).toContain('Already use Google with this email?');
    expect(html).not.toContain('Continue with Google.');
    expect(html.match(/Continue with Google/g)).toHaveLength(1);
    expect(html).toContain('>Continue<');
    // One shared style carries the gap above and below both help sentences,
    // so neither one touches the Google button under it.
    expect(SOURCE).toMatch(
      /googleHelp: \{\s*marginTop: t\.spacing\.sm,[\s\S]{0,200}?marginBottom: t\.spacing\.md,/,
    );
  });

  it('pins the separate create-account Track wording', () => {
    const html = render({ initialScreen: 'create', intent: 'track', billCode: 'SF 10' });

    expect(html).toContain('Create an account to track this bill');
    expect(html).toContain('This bill goes to your tracked list');
    expect(html).not.toContain('You’ll use this email and password');
  });

  it('shows the wrong-password Google help without repeating the button wording', () => {
    const html = render({
      initialScreen: 'email-sign-in',
      errorMessage: 'Email or password is incorrect',
    });

    expect(html).toContain('If you first used Google and haven’t added a password');
    // The email view points back to the four choices without placing a second
    // Google action beside the form's green Sign in button.
    expect(html).not.toMatch(/continue with Google/i);
  });

  it('shows code entry without claiming an email was sent or will arrive', () => {
    const html = render({ initialScreen: 'code', initialEmail: 'jordan@example.com' });

    expect(html).toContain('Enter your code');
    expect(html).toContain('For jordan@example.com');
    expect(html).toContain('CODE');
    expect(html).not.toContain('on the way');
    expect(html).not.toContain('sent');
    expect(html).not.toContain('arrives');
    expect(html).toContain('Send a new code');
    expect(html).toContain('Use another email');
    expect(html).toContain('Continue with Google');
    expect(html).toContain('mailto:ask@alethical.com');
  });

  it('uses the same email-first shape for account recovery', () => {
    const recover = render({ initialScreen: 'recover', initialEmail: 'jordan@example.com' });

    expect(recover).toContain('Recover your account');
    expect(recover).toContain('Enter your email to choose a new password');
    expect(recover).toContain('If no account exists, this creates one');
    expect(recover).toContain('Continue with Google');
    expect(recover).toContain('Back to sign in');
    expect(recover).not.toContain('reset email');
  });

  it('uses the dedicated deactivated outcome without a sign-in form, with a mail link', () => {
    const deactivated = render({
      errorKind: 'deactivated',
      errorMessage:
        'You’ve been signed out. Bills, votes and legislators are all still here to read. Contact us at ask@alethical.com if you think this is a mistake.',
    });

    expect(deactivated).toContain('This account has been deactivated');
    expect(deactivated).toContain('aria-label="Back to sign-in choices"');
    expect(deactivated).not.toContain('>Back to sign in<');
    expect(deactivated).not.toContain('Continue with Google');
    expect(deactivated).toContain('mailto:ask@alethical.com');
  });

  it('shows the unverified-Google result as a banner on the ordinary sign-in screen', () => {
    // The retired match-failure screen's one reachable trigger: a Google
    // return whose address Supabase has not confirmed. The form and the
    // Google button stay on the card — never a dead end (#1533).
    const html = render({
      errorKind: 'unverified-google',
      errorMessage:
        'Sign-in couldn’t finish because the email needs confirmation. Use Create account with this email to confirm it.',
    });

    expect(html).toContain('Sign-in couldn’t finish because the email needs confirmation.');
    expect(html).toContain('Continue with Google');
    expect(html).toContain('Sign in to Alethical');
    expect(html).not.toContain('We couldn’t match this sign-in');
  });

  it('uses shared validation, first-press locking, and the supplied resend wait', () => {
    expect(SOURCE).toContain('validateEmail(email)');
    expect(SOURCE).toContain('validatePassword(password)');
    expect(SOURCE).toContain('validatePasswordMatch(password, confirmation)');
    expect(SOURCE).toContain('createValidRequestGate()');
    expect(SOURCE).toContain("result.error.kind === 'email-not-confirmed'");
    expect(SOURCE).toContain("onRequestAccountCode(safeEmail, 'create')");
    expect(SOURCE).toContain("error.kind === 'bad-credentials'");
    expect(SOURCE).toContain("typeof input?.select === 'function'");
    expect(SOURCE).toContain('input?.setNativeProps?.({ selection:');
    expect(SOURCE).not.toMatch(
      /if \(error\.kind === 'bad-credentials'\) \{[\s\S]{0,200}?setPassword\(''\)/,
    );
    expect(SOURCE).toContain("dedicatedOutcome ? 'deactivated' : `${screen}:${accountOrigin}");
    expect(SOURCE).toContain('onBlur={validateEmailAfterBlur}');
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
