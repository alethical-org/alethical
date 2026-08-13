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
        helper="Use at least 15 characters."
        onChangeText={vi.fn()}
      />,
    );

    expect(html).toContain('aria-labelledby="test-password-label"');
    expect(html).toContain('aria-describedby="test-password-help"');
    expect(html).toMatch(/type="password"/i);
    expect(html).toMatch(/autocomplete="new-password"/i);
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
        sentMessage="If this address can receive an email, we’ve sent one."
        onResend={vi.fn()}
      />,
    );
    const sending = renderToStaticMarkup(
      <ResendControl status="sending" sentMessage="Sent." onResend={vi.fn()} />,
    );

    expect(waiting).toContain('role="status"');
    expect(waiting).toContain('aria-live="off"');
    expect(waiting).toContain('You can resend in 37 seconds.');
    expect(sending).toContain('aria-busy="true"');
    expect(sending).toContain('Resending…');
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

  it('keeps the desktop modal, phone sheet, and email-link page in one container', () => {
    const container = source('SignInContainer.tsx');

    expect(container).toContain("variant = 'flow'");
    expect(container).toContain("variant === 'page'");
    expect(container).toContain('isMobile');
    expect(container).toContain("maxHeight: '92dvh'");
    expect(container).toContain('accessibilityLabel={title}');
    expect(container).not.toContain("role: 'dialog'");
    expect(container).toContain('accessible={false}');
    expect(container).toContain("'aria-hidden': true");
    expect(container).toContain('ScrollView');
    expect(container).toContain('focusableChildren');
    expect(container).toContain("card.setAttribute('tabindex', '-1')");
    expect(container).toContain("card.removeAttribute('tabindex')");
    expect(container).toContain("event.key === 'Escape'");
    expect(container).toContain('minHeight: 44');
  });
});
