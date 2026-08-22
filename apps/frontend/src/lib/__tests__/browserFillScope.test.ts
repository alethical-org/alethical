import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARKERS = ['browserFillInputProps', 'browserFillTextInputProps'] as const;
const EXPECTED_CONSUMERS = [
  'components/auth/AccountControl.tsx',
  'components/auth/CodeField.tsx',
  'components/auth/EmailField.tsx',
  'components/auth/PasswordField.tsx',
  'components/home/HomeLegislatorFinder.tsx',
  'screens/FindMyLegislatorScreen.tsx',
  'screens/redesign/ContactUsScreen.tsx',
] as const;

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : productionSourceFiles(path);
    }
    return /\.[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

function source(path: (typeof EXPECTED_CONSUMERS)[number]) {
  return readFileSync(join(SRC, path), 'utf8');
}

describe('browser-filled field scope', () => {
  it('opts in only the 7 approved field code paths', () => {
    const consumers = productionSourceFiles(SRC)
      .filter((path) => !path.endsWith('/theme/browserFill.ts'))
      .filter((path) => MARKERS.some((marker) => readFileSync(path, 'utf8').includes(marker)))
      .map((path) => relative(SRC, path))
      .sort();

    expect(consumers).toEqual([...EXPECTED_CONSUMERS]);
  });

  it('marks auth email, both password modes, and the shared sign-in or create code', () => {
    const email = source('components/auth/EmailField.tsx');
    const password = source('components/auth/PasswordField.tsx');
    const code = source('components/auth/CodeField.tsx');

    expect(email).toContain('...browserFillInputProps');
    expect(email).toContain("autoComplete: 'email'");
    expect(password).toContain('...browserFillInputProps');
    expect(password).toContain("type PasswordAutoComplete = 'current-password' | 'new-password'");
    expect(code).toContain('...browserFillInputProps');
    expect(code).toContain("autoComplete: 'one-time-code'");
  });

  it('marks the account proof code and both legislator address fields', () => {
    const account = source('components/auth/AccountControl.tsx');
    const home = source('components/home/HomeLegislatorFinder.tsx');
    const finder = source('screens/FindMyLegislatorScreen.tsx');

    expect(account).toContain('...browserFillTextInputProps');
    expect(account).toContain('nativeID="fresh-proof-code"');
    expect(account).toContain('autoComplete="one-time-code"');
    expect(home).toContain('...browserFillTextInputProps');
    expect(home).toContain('accessibilityLabel="Full street address"');
    expect(home).toContain('autoComplete="street-address"');
    expect(finder).toContain('...browserFillTextInputProps');
    expect(finder).toContain('accessibilityLabel="Full Minnesota street address"');
    expect(finder).toContain('autoComplete="street-address"');
  });

  it('marks only Contact us name, email, and phone', () => {
    const contact = source('screens/redesign/ContactUsScreen.tsx');
    const browserFillChoice = contact.slice(
      contact.indexOf('const receivesBrowserFill ='),
      contact.indexOf('const inputShellStyle ='),
    );

    expect(browserFillChoice).toContain("field === 'name'");
    expect(browserFillChoice).toContain("field === 'email'");
    expect(browserFillChoice).toContain("field === 'phone'");
    expect(browserFillChoice).not.toContain("field === 'subject'");
    expect(browserFillChoice).not.toContain("field === 'message'");
    expect(contact).toContain('...(receivesBrowserFill ? browserFillInputProps : {})');
  });

  it.each([
    'components/search/searchPieces.tsx',
    'components/billDetail/VotesTab.tsx',
    'screens/redesign/BillDetailScreen.tsx',
    'screens/ChatSessionScreen.tsx',
    'components/billDetail/SharePopover.tsx',
  ])('keeps the excluded field in %s out of browser-fill styling', (path) => {
    const fieldSource = readFileSync(join(SRC, path), 'utf8');

    expect(fieldSource).toContain('<TextInput');
    expect(MARKERS.some((marker) => fieldSource.includes(marker))).toBe(false);
  });
});
