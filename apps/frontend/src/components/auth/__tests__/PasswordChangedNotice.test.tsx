import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'PasswordChangedNotice.tsx'),
  'utf8',
);

describe('different-account password notice', () => {
  it('reads and removes the exact reset notice before showing it once', () => {
    expect(SOURCE).toContain("const PASSWORD_NOTICE_KEY = 'alethical.passwordChangedNotice'");
    expect(SOURCE).toContain('window.sessionStorage.getItem(PASSWORD_NOTICE_KEY)');
    expect(SOURCE).toContain('window.sessionStorage.removeItem(PASSWORD_NOTICE_KEY)');
    expect(SOURCE).toContain('user?.email.trim().toLowerCase()');
    expect(SOURCE).toContain('window.setTimeout(() => setMessage(null), 6000)');
    expect(SOURCE).toContain("role: 'status'");
    expect(SOURCE).toContain('accessibilityLiveRegion="polite"');
  });
});
