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

// AccountControl's Tracked row reads the watchlist and the navigator
// (#1698). Both are mocked at the boundary, like the auth provider above: the
// real `@react-navigation/native` and the query layer that reaches it pull in a
// React Native source file Node cannot parse, so importing this module at all
// would fail before a single assertion ran.
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

vi.mock('../../../hooks/useAppQueries', () => ({
  useTrackedBills: () => ({ data: undefined }),
  useTrackedCommittees: () => ({ data: undefined }),
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
  it('shows the current Google-only Add state and the 8-character rule', () => {
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
    expect(html).toContain('Use at least 8 characters');
    expect(html).toContain('Save password');
    expect(html).toContain('Cancel');
    expect(html).not.toContain('CODE');
  });

  it('uses the signed-in account request, local checks, and first-press lock', () => {
    expect(SOURCE).toContain('validatePassword(password)');
    expect(SOURCE).toContain('validatePasswordMatch(password, confirmation)');
    expect(SOURCE).toContain('createValidRequestGate()');
    expect(SOURCE).toContain('openingAccessToken.current ?? undefined');
    expect(SOURCE).toContain('setSaved(true)');
    expect(SOURCE).toContain('busyLabel="Saving…"');
    expect(SOURCE).toContain('onPress={onDone}');
  });

  it('pins the method-specific helper and keeps fresh proof inside this form', () => {
    const passwordDialog = SOURCE.slice(
      SOURCE.indexOf('export function SetPasswordDialog'),
      SOURCE.indexOf('function CloseIcon'),
    );

    expect(passwordDialog).toContain('passwordMethodCopy');
    expect(passwordDialog).not.toContain('current-password');
    expect(passwordDialog).not.toContain('security notice');
    expect(passwordDialog).toContain("result.error.kind === 'fresh-proof'");
    expect(passwordDialog).toContain('autoComplete="one-time-code"');
    expect(passwordDialog).toContain('...browserFillTextInputProps');
    expect(passwordDialog).toContain('accessibilityLabel="CODE"');
    expect(passwordDialog).toContain(
      "aria-describedby={freshProofMessage ? 'fresh-proof-code-help'",
    );
    expect(passwordDialog).toContain('openingAccessToken.current ?? undefined');
    // The shared save helper accepts an already-working password. The storage
    // limit remains the only provider password rejection shown here.
    expect(SOURCE).not.toContain("result.error.kind === 'same-password'");
    expect(SOURCE).toContain("result.error.kind === 'password-too-long'");
  });

  it('stops an uncertain save without re-offering it, and Done keeps the account signed in', () => {
    // The REQUEST FAILURE carve-out (#1533): a lost reply may have saved the
    // password server-side, and a blind retry could change it twice.
    expect(SOURCE).toContain("result.error.kind === 'uncertain-password-save'");
    expect(SOURCE).toContain('setUncertainMessage(result.error.message)');
    expect(SOURCE).toContain('uncertainMessage ? (');
  });

  it('uses 1 shared account-action component on desktop and phone', () => {
    expect(SOURCE).toContain('function AccountSurfaceContent');
    expect(SOURCE.match(/<AccountSurfaceContent/g)).toHaveLength(2);
    expect(SOURCE.match(/const passwordCopy =/g)).toHaveLength(1);
    expect(SOURCE.match(/passwordCopy\.rowLabel/g)).toHaveLength(2);
    expect(SOURCE).not.toContain('accessibilityRole="menuitem"');
    expect(SOURCE).not.toContain('role="menu"');
    expect(SOURCE).toContain("role: 'region', 'aria-label': 'Account'");
    expect(SOURCE).toContain('emailPasswordEnabled ?');
  });

  it('opens the shared phone account sheet from the full-width drawer account row', () => {
    const drawer = SOURCE.slice(
      SOURCE.indexOf('export function AccountDrawerRow'),
      SOURCE.indexOf('const focusRingWeb'),
    );

    expect(SOURCE).toContain('function PhoneAccountControl');
    expect(SOURCE.match(/<PhoneAccountControl/g)).toHaveLength(2);
    expect(drawer).toContain('PhoneAccountControl trigger="drawer"');
    expect(SOURCE).toMatch(/drawerAccountButton: \{[^}]*width: '100%',[^}]*minHeight: 44/s);
  });

  it('keeps sign out visible while the release switch hides password actions', () => {
    const sharedSurface = SOURCE.slice(
      SOURCE.indexOf('function AccountSurfaceContent'),
      SOURCE.indexOf('/** Desktop top nav'),
    );

    expect(sharedSurface.match(/emailPasswordEnabled \?/g)).toHaveLength(2);
    expect(sharedSurface).toContain('<DesktopSignOut flow={signOutFlow} />');
    expect(sharedSurface).toContain('<PhoneSignOut flow={signOutFlow} />');
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
