import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

const signIn = read('components/auth/SignInContainer.tsx');
const signInDialog = read('components/auth/SignInDialog.tsx');
const account = read('components/auth/AccountControl.tsx');
const drawer = read('theme/primitives.tsx');
const mobileShare = read('components/share/MobileShareSheet.tsx');
const desktopShare = read('components/billDetail/SharePopover.tsx');
const chat = read('screens/ChatSessionScreen.tsx');

function sourceFiles(directory: string, relative = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryRelative = join(relative, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__'
        ? []
        : sourceFiles(join(directory, entry.name), entryRelative);
    }
    return entry.name.endsWith('.tsx') ? [entryRelative] : [];
  });
}

describe('corner close-control spacing', () => {
  it('keeps the shared phone sign-in and password header fixed above every body state', () => {
    expect(signIn).toMatch(/sheetHeader: \{[\s\S]*?height: 84,[\s\S]*?paddingTop: 12/);
    expect(signIn).toMatch(/sheetBody: \{ paddingTop: 0, paddingHorizontal: 24/);
    expect(signIn).toMatch(
      /close: \{[\s\S]*?top: 24,[\s\S]*?right: 24,[\s\S]*?width: 44,[\s\S]*?minHeight: 44/,
    );
    expect(signIn).toContain("closeCard: { top: 20, right: 20, backgroundColor: 'transparent' }");
    expect(signIn.indexOf('<View style={styles.sheetHeader}>')).toBeLessThan(
      signIn.indexOf('<ScrollView', signIn.indexOf('<View style={styles.sheetHeader}>')),
    );
    expect(signInDialog).toContain(
      "'sign-in' | 'create' | 'check-email' | 'forgot' | 'forgot-sent'",
    );
    expect(signInDialog.match(/<SignInContainer/g)).toHaveLength(1);
    expect(
      account.slice(0, account.indexOf('function CloseIcon')).match(/<SignInContainer/g),
    ).toHaveLength(1);
  });

  it('keeps the phone account close box 22px from both sheet edges and below its handle', () => {
    expect(account).toMatch(/sheet: \{[\s\S]*?paddingTop: 0,[\s\S]*?paddingHorizontal: 22/);
    expect(account).toMatch(
      /sheetHeader: \{[\s\S]*?height: 66,[\s\S]*?justifyContent: 'flex-start',[\s\S]*?paddingTop: 12/,
    );
    expect(account).toMatch(
      /sheetClose: \{[\s\S]*?top: 22,[\s\S]*?right: 0,[\s\S]*?width: 44,[\s\S]*?height: 44/,
    );
    expect(account.indexOf('<View style={styles.sheetHeader}>')).toBeLessThan(
      account.indexOf(
        '<AccountSurfaceContent',
        account.indexOf('<View style={styles.sheetHeader}>'),
      ),
    );
  });

  it('matches the other phone corner controls to their 22px or 24px side padding', () => {
    expect(mobileShare).toMatch(/sheet: \{[\s\S]*?paddingHorizontal: 22/);
    expect(mobileShare).toMatch(/close: \{[\s\S]*?top: 22,[\s\S]*?right: 22/);
    expect(drawer).toMatch(/menuSheet: \{[\s\S]*?paddingHorizontal: 24,[\s\S]*?paddingTop: 24/);
  });

  it('keeps the already-correct desktop popover and chat panel in the inventory', () => {
    expect(desktopShare).toMatch(
      /sharePanel: \{[\s\S]*?paddingHorizontal: 20,[\s\S]*?paddingTop: 20/,
    );
    expect(chat).toMatch(/citationSidebar: \{[\s\S]*?padding: theme\.spacing\.md/);
  });

  it('makes a new Close or Dismiss owner update this product-wide inventory', () => {
    const owners = sourceFiles(SRC)
      .filter((path) =>
        /accessibilityLabel[\s\S]{0,100}\b(?:Close|Dismiss)\b/.test(
          readFileSync(join(SRC, path), 'utf8'),
        ),
      )
      .sort();

    expect(owners).toEqual([
      'components/auth/AccountControl.tsx',
      'components/auth/SignInContainer.tsx',
      'components/billDetail/SharePopover.tsx',
      'components/share/MobileShareSheet.tsx',
      'screens/ChatSessionScreen.tsx',
      'screens/redesign/LegislatorProfileMobileScreen.tsx',
      'screens/redesign/LegislatorProfileWebScreen.tsx',
      'theme/primitives.tsx',
    ]);
  });
});
