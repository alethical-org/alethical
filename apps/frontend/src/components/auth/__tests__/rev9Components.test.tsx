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

import { AccountCard } from '../AccountCard';
import { CodeField } from '../CodeField';
import { EmailField } from '../EmailField';
import { FormError } from '../FormError';
import { LoadingButton } from '../LoadingButton';
import { PasswordField } from '../PasswordField';
import { ResendControl } from '../ResendControl';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (name: string) => readFileSync(join(HERE, '..', name), 'utf8');

describe('rev 9 shared sign-in components', () => {
  it('renders a permanently labelled email field with browser email help and linked errors', () => {
    const html = renderToStaticMarkup(
      <EmailField
        id="test-email"
        value="name"
        error="Enter a complete email address."
        onChangeText={vi.fn()}
      />,
    );

    expect(html).toContain('id="test-email-label"');
    expect(html).toContain('aria-labelledby="test-email-label"');
    expect(html).toContain('aria-describedby="test-email-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/type="email"/i);
    expect(html).toMatch(/autocomplete="email"/i);
    expect(html).toContain('data-alethical-browser-fill="true"');
    expect(html).toMatch(/inputmode="email"/i);
    expect(html).toContain('min-height:50px');
    expect(html).toContain('padding-top:16px');
    expect(html).toContain('padding-bottom:16px');
    expect(html).toContain('padding-left:16px');
    expect(html).toContain('padding-right:16px');
    expect(html).toContain('box-sizing:border-box');
    expect(html).toContain('line-height:22px');
    expect(html).not.toContain('padding-vertical');
    expect(html).not.toContain('padding-horizontal');
    expect(html).not.toMatch(/autofocus/i);
    expect(source('EmailField.tsx')).toContain('fontSize: 17');
  });

  it('renders password-manager hints, a linked helper, and a 44px Show control', () => {
    const html = renderToStaticMarkup(
      <PasswordField
        id="test-password"
        label="NEW PASSWORD"
        value="a password"
        autoComplete="new-password"
        helper="Use at least 8 characters"
        onChangeText={vi.fn()}
      />,
    );

    expect(html).toContain('aria-labelledby="test-password-label"');
    expect(html).toContain('aria-describedby="test-password-help"');
    expect(html).toMatch(/type="password"/i);
    expect(html).toMatch(/autocomplete="new-password"/i);
    expect(html).toContain('data-alethical-browser-fill="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Show password');
    expect(html).toContain('min-height:50px');
    expect(html).toContain('padding-top:16px');
    expect(html).toContain('padding-bottom:16px');
    expect(html).toContain('box-sizing:border-box');
    expect(html).toContain('line-height:22px');
    expect(html).not.toContain('padding-vertical');
    expect(source('PasswordField.tsx')).toContain('minWidth: 44');
    expect(source('PasswordField.tsx')).toContain('minHeight: 44');
    expect(source('PasswordField.tsx')).toContain('setSelectionRange');
    expect(source('PasswordField.tsx')).not.toContain('maxLength=');
    expect(source('PasswordField.tsx')).not.toContain('autoFocus');

    const currentPasswordHtml = renderToStaticMarkup(
      <PasswordField value="a password" onChangeText={vi.fn()} />,
    );
    expect(currentPasswordHtml).toMatch(/autocomplete="current-password"/i);
    expect(currentPasswordHtml).toContain('data-alethical-browser-fill="true"');
  });

  it('renders a labelled one-time-code field with numeric keyboard help and linked errors', () => {
    const html = renderToStaticMarkup(
      <CodeField value="123" error="That code is wrong or expired" onChangeText={vi.fn()} />,
    );

    expect(html).toContain('CODE');
    expect(html).toMatch(/autocomplete="one-time-code"/i);
    expect(html).toContain('data-alethical-browser-fill="true"');
    expect(html).toMatch(/inputmode="numeric"/i);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="auth-code-[^"]+-error"/);
    expect(html).toContain('That code is wrong or expired');
  });

  it('keeps compact account-panel fields at 48px and the Show control at 44px', () => {
    const email = renderToStaticMarkup(
      <EmailField compact id="compact-email" value="name@example.com" onChangeText={vi.fn()} />,
    );
    const password = renderToStaticMarkup(
      <PasswordField compact id="compact-password" value="password" onChangeText={vi.fn()} />,
    );
    const code = renderToStaticMarkup(<CodeField compact value="123456" onChangeText={vi.fn()} />);

    for (const html of [email, password, code]) {
      expect(html).toContain('min-height:46px');
      expect(html).toContain('padding-top:12px');
      expect(html).toContain('padding-bottom:12px');
    }
    expect(source('EmailField.tsx')).toContain('inputShellCompact: { minHeight: 48 }');
    expect(source('PasswordField.tsx')).toContain('inputShellCompact: { minHeight: 48 }');
    expect(source('CodeField.tsx')).toContain('inputShellCompact: { minHeight: 48 }');
    expect(source('PasswordField.tsx')).toContain('minHeight: 44');
  });

  it('uses one quiet field error and one announced banner error', () => {
    const field = renderToStaticMarkup(
      <FormError id="field-error" message="Passwords do not match." />,
    );
    const banner = renderToStaticMarkup(
      <FormError variant="banner" message="We couldn’t complete that request." />,
    );

    expect(field).toContain('id="field-error"');
    expect(field).toContain('aria-live="polite"');
    expect(banner).toContain('role="alert"');
    expect(banner).toContain('We couldn’t complete that request.');
  });

  it('keeps a busy action focusable, named, and locked before its request starts', () => {
    const html = renderToStaticMarkup(
      <LoadingButton label="Sign in" busy busyLabel="Signing in…" onPress={vi.fn()} />,
    );
    const buttonSource = source('LoadingButton.tsx');

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Signing in…');
    expect(html).not.toContain('disabled=""');
    expect(buttonSource).toContain("button.setAttribute('aria-disabled', 'true')");
    expect(buttonSource.indexOf('pressLock.current = true')).toBeLessThan(
      buttonSource.indexOf('await onPress()'),
    );
    expect(buttonSource).toContain('opacity: 0.75');
  });

  it('shares one resend treatment for sending, sent, waiting, and ready', () => {
    const waiting = renderToStaticMarkup(
      <ResendControl
        status="waiting"
        secondsRemaining={37}
        sentMessage="Enter the newest code"
        onResend={vi.fn()}
      />,
    );
    const sending = renderToStaticMarkup(
      <ResendControl status="sending" sentMessage="Enter the newest code" onResend={vi.fn()} />,
    );
    const rateLimited = renderToStaticMarkup(
      <ResendControl
        status="rate-limited"
        secondsRemaining={37}
        sentMessage="Enter the newest code"
        onResend={vi.fn()}
      />,
    );

    expect(waiting).toContain('role="status"');
    expect(waiting).toContain('aria-live="off"');
    expect(waiting).toContain('Try again in 37 seconds');
    expect(sending).toContain('aria-busy="true"');
    expect(sending).toContain('Requesting…');
    expect(rateLimited).toContain('Try again in 37 seconds');
    expect(rateLimited).not.toContain('Enter the newest code');
  });

  it('names the other signed-in account without making the card interactive', () => {
    const html = renderToStaticMarkup(
      <AccountCard
        label="This browser is still signed in as:"
        name="Marissa Chen"
        email="marissa@example.com"
      />,
    );

    expect(html).toContain('This browser is still signed in as:');
    expect(html).toContain('Marissa Chen');
    expect(html).toContain('marissa@example.com');
    expect(html).not.toContain('role="button"');
  });

  it('keeps legacy screens unchanged and gives the account panel its accepted layout', () => {
    const container = source('SignInContainer.tsx');

    expect(container).toContain("variant = 'flow'");
    expect(container).toContain("variant === 'page'");
    expect(container).toContain('isMobile');
    expect(container).toContain("maxHeight: '92dvh'");
    expect(container).toContain('accessibilityLabel={displayedFrame.title}');
    expect(container).toContain("role: 'dialog'");
    expect(container).toContain("'aria-modal': true");
    expect(container).toContain('accessible={false}');
    expect(container).toContain("'aria-hidden': true");
    expect(container).toContain('ScrollView');
    expect(container).toContain('focusableChildren');
    expect(container).toContain('element.getClientRects().length > 0');
    expect(container).not.toContain('element.offsetParent !== null');
    expect(container).toContain("element.getAttribute('aria-disabled') !== 'true'");
    expect(container).toContain('focusables[nextIndex].focus()');
    expect(container).toContain('const closeRef = useRef<View>(null)');
    expect(container).toContain('ref={closeRef}');
    expect(container).toContain('close?.focus()');
    expect(container).toContain("card.setAttribute('tabindex', '-1')");
    expect(container).toContain("card.removeAttribute('tabindex')");
    expect(container).toContain("event.key === 'Escape'");
    expect(container).toContain('focusKey');
    expect(container).toContain('minHeight: 44');
    expect(container).toContain('accountPanelHeaderContentGap = 14');
    expect(container).toMatch(/accountHeader: \{[\s\S]*?height: 66,/);
    expect(container).toContain('accountHeaderSheet: { marginHorizontal: 22 }');
    expect(container).toMatch(/accountCard: \{[\s\S]*?width: 420,/);
    expect(container).toContain('accountCardBody: { paddingTop: 0, paddingHorizontal: 20');
    expect(container).toContain('visualViewportHeight - (asSheet ? 45 : 80)');
    expect(container.match(/duration: 90/g)).toHaveLength(3);
    expect(container).toContain('frameOffset.setValue(reduceMotion ? 0 : 8)');
    expect(container).toContain('if (reduceMotion)');
    expect(container).toContain("{ outlineStyle: 'none', outlineWidth: 0 } as object");
    expect(container).toContain('onRequestClose={onModalRequestClose}');
    expect(container).toContain("{...(isWeb ? ({ 'aria-hidden': true } as object) : null)}");

    const app = readFileSync(join(HERE, '..', '..', '..', '..', 'App.tsx'), 'utf8');
    expect(app).toContain(':not([role="heading"]):not(h1):not(h2):not(h3):not(h4):not(h5):not(h6)');
  });

  it('keeps the Google busy words visible and equal to the accessible name', () => {
    // Rev 17 (#1533): both Google busy buttons show "Continuing with Google…"
    // as visible words, the screen-reader name IS those words (the diverging
    // "Signing in with Google" label is deleted so the two cannot drift), and
    // reduced motion hides the spinner graphic entirely.
    const primitives = readFileSync(
      join(HERE, '..', '..', '..', 'theme', 'primitives.tsx'),
      'utf8',
    );

    expect(primitives).toContain("busyLabel = 'Continuing with Google…'");
    expect(primitives).toContain('accessibilityLabel={busy ? busyLabel : label}');
    expect(primitives).not.toContain('Signing in with Google');
    const googleButton = primitives.slice(
      primitives.indexOf('export function GoogleButton'),
      primitives.indexOf('// A `CityChip`'),
    );
    expect(googleButton).toContain('useReducedMotion()');
    expect(googleButton).toContain('const unavailable = busy || disabled');
    expect(googleButton).toContain('accessibilityState={{ busy, disabled: unavailable }}');
    expect(googleButton).toContain('{!reduceMotion ? (');
    expect(googleButton).toContain('<Text style={styles.googleBtnText}>{busyLabel}</Text>');
    expect(primitives).toContain('googleBtnCompact: { minHeight: 54');
  });

  it('gives the phone account sheet a 44 by 44 Close that returns focus', () => {
    // Rev 15 (#1533): the sheet previously closed only by scrim tap or the
    // account control — no visible Close, no focus return.
    const accountControl = source('AccountControl.tsx');

    expect(accountControl).toContain('const closeSheet = ');
    expect(accountControl).toContain('accessibilityLabel="Close"');
    expect(accountControl).toContain('sheetClose: {');
    expect(accountControl).toMatch(/sheetClose: \{[^}]*width: 44,[^}]*height: 44/s);
    expect(accountControl).toContain('avatarRef.current as unknown as HTMLElement | null)?.focus');
  });
});
