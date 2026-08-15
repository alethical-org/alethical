import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

const auth = vi.hoisted(() => ({
  setPassword: vi.fn(async () => ({ ok: true }) as const),
  signOut: vi.fn(async () => ({ ok: true }) as const),
}));

vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: '1',
      name: 'Marissa Chen',
      email: 'marissa@example.com',
      signInMethods: { google: true, password: false },
    },
    setPassword: auth.setPassword,
    signOut: auth.signOut,
  }),
}));

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

import { SetPasswordDialog } from '../AccountControl';

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'AccountControl.tsx'),
  'utf8',
);

describe('signed-in set or change password', () => {
  it('shows the current Google-only Add state and the 15-character rule', () => {
    const html = renderToStaticMarkup(<SetPasswordDialog open onClose={vi.fn()} />);

    expect(html).toContain('Add a password');
    // The one-door warning (rev 12/15, #1533): a Google-only account is one
    // lost Google account away from losing Alethical.
    expect(html).toContain(
      'You sign in with Google. A password lets you sign in with marissa@example.com as well — and still works if you ever lose access to Google.',
    );
    expect(html.match(/autocomplete="new-password"/gi)).toHaveLength(2);
    expect(html).toContain('NEW PASSWORD');
    expect(html).toContain('CONFIRM PASSWORD');
    expect(html).toContain('Use at least 15 characters. A few words with spaces works well.');
    expect(html).toContain('Save password');
    expect(html).toContain('Cancel');
  });

  it('uses the signed-in account request, local checks, and first-press lock', () => {
    expect(SOURCE).toContain('validatePassword(password)');
    expect(SOURCE).toContain('validatePasswordMatch(password, confirmation)');
    expect(SOURCE).toContain('createValidRequestGate()');
    expect(SOURCE).toContain('await setPassword(password)');
    expect(SOURCE).toContain('setSaved(true)');
    expect(SOURCE).toContain('busyLabel="Saving…"');
    expect(SOURCE).toContain('onPress={onDone}');
  });

  it('pins the method-specific helper and omits disabled Supabase feature claims', () => {
    expect(SOURCE).toContain('passwordMethodCopy');
    expect(SOURCE).not.toContain('one-time-code');
    expect(SOURCE).not.toContain('current-password');
    expect(SOURCE).not.toContain('security notice');
    expect(SOURCE).not.toContain('fresh proof');
    // Field rejections show the mapped message directly, covering the two
    // pinned Supabase rejections beside the weak/leaked pair (#1533).
    expect(SOURCE).toContain("result.error.kind === 'same-password'");
    expect(SOURCE).toContain("result.error.kind === 'password-too-long'");
  });

  it('stops an uncertain save without re-offering it, and Done keeps the account signed in', () => {
    // The REQUEST FAILURE carve-out (#1533): a lost reply may have saved the
    // password server-side, and a blind retry could change it twice.
    expect(SOURCE).toContain("result.error.kind === 'uncertain-password-save'");
    expect(SOURCE).toContain('setUncertainMessage(result.error.message)');
    expect(SOURCE).toContain('uncertainMessage ? (');
  });

  it('adds 1 password action to both account surfaces and none to the phone drawer', () => {
    const drawer = SOURCE.slice(
      SOURCE.indexOf('export function AccountDrawerRow'),
      SOURCE.indexOf('const focusRingWeb'),
    );

    expect(SOURCE.match(/passwordCopy\.rowLabel/g)).toHaveLength(2);
    expect(SOURCE).not.toContain('accessibilityRole="menuitem"');
    expect(SOURCE).not.toContain('role="menu"');
    expect(SOURCE).toContain("role: 'region', 'aria-label': 'Account'");
    expect(SOURCE).toContain('emailPasswordEnabled ?');
    expect(drawer).not.toContain('passwordCopy.rowLabel');
  });

  it('keeps sign out visible while the release switch hides password actions', () => {
    const desktop = SOURCE.slice(
      SOURCE.indexOf("role: 'region', 'aria-label': 'Account'"),
      SOURCE.indexOf('/** Phone top bar'),
    );
    const phone = SOURCE.slice(
      SOURCE.indexOf('export function AccountAvatarButton'),
      SOURCE.indexOf('/** Phone drawer footer'),
    );

    expect(desktop.match(/emailPasswordEnabled \?/g)).toHaveLength(1);
    expect(desktop).toContain('<DesktopSignOut flow={signOutFlow} />');
    expect(phone.match(/emailPasswordEnabled \?/g)).toHaveLength(1);
    expect(phone).toContain('<PhoneSignOut flow={signOutFlow} />');
  });

  it('keeps the other-device note in exactly the desktop panel and phone sheet', () => {
    expect(SOURCE.match(/OTHER_DEVICE_NOTE}/g)).toHaveLength(2);
    expect(SOURCE).toContain(
      "const OTHER_DEVICE_NOTE = 'You may still be signed in on other devices';",
    );
    expect(SOURCE).toContain(
      "const SIGN_OUT_FAILURE = 'We couldn’t sign you out. Check your connection and try again.';",
    );
  });

  it('clears both password values as soon as the signed-in form closes', () => {
    expect(SOURCE).toContain("setPasswordValue('');");
    expect(SOURCE).toContain("setConfirmation('');");
  });
});
