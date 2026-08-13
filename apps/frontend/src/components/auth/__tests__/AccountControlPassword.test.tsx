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
    user: { id: '1', name: 'Marissa Chen', email: 'marissa@example.com' },
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
  it('shows only the 2 confirmed live states and the 15-character rule', () => {
    const html = renderToStaticMarkup(<SetPasswordDialog open onClose={vi.fn()} />);

    expect(html).toContain('Set or change password');
    expect(html).toContain(
      'Use a password with this email as another way to sign in. It keeps the same Alethical account.',
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
  });

  it('pins the honest done copy and omits disabled Supabase feature claims', () => {
    expect(SOURCE).toContain('Password saved');
    expect(SOURCE).toContain(
      'You can now sign in with your email or with Google. It’s the same Alethical account.',
    );
    expect(SOURCE).not.toContain('one-time-code');
    expect(SOURCE).not.toContain('current-password');
    expect(SOURCE).not.toContain('security notice');
    expect(SOURCE).not.toContain('fresh proof');
    expect(SOURCE).toContain('REV9_AUTH_MESSAGES.leakedPassword');
  });

  it('adds 1 ordinary action to both account surfaces and none to the phone drawer', () => {
    const drawer = SOURCE.slice(
      SOURCE.indexOf('export function AccountDrawerRow'),
      SOURCE.indexOf('const focusRingWeb'),
    );

    expect(SOURCE.match(/Set or change password/g)).toHaveLength(3);
    expect(SOURCE).not.toContain('accessibilityRole="menuitem"');
    expect(SOURCE).not.toContain('role="menu"');
    expect(SOURCE).toContain("role: 'region', 'aria-label': 'Account'");
    expect(SOURCE).toContain('emailPasswordEnabled ?');
    expect(drawer).not.toContain('Set or change password');
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
    expect(desktop).toContain('<Text style={styles.menuItemText}>Sign out</Text>');
    expect(phone.match(/emailPasswordEnabled \?/g)).toHaveLength(1);
    expect(phone).toContain('<Text style={styles.sheetButtonText}>Sign out</Text>');
  });
});
