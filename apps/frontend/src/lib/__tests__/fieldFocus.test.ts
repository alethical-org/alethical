import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../..');
const READ_ONLY_TEXT_FIELD = 'components/billDetail/SharePopover.tsx';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith('.tsx') && !entry.endsWith('.test.tsx') ? [full] : [];
  });
}

const EDITABLE_TEXT_FIELD_SOURCES = sourceFiles(SRC)
  .filter((file) => {
    const name = relative(SRC, file);
    return name !== READ_ONLY_TEXT_FIELD && readFileSync(file, 'utf8').includes('<TextInput');
  })
  .map((file) => relative(SRC, file));

describe('site-wide editable text field focus', () => {
  it.each(EDITABLE_TEXT_FIELD_SOURCES)(
    '%s uses the shared light-purple focus treatment',
    (file) => {
      const source = readFileSync(join(SRC, file), 'utf8');

      expect(source).toContain('fieldFocusRing(');
      expect(source).toContain('fieldOutlineReset');
      expect(source).not.toContain('autoFocus');
    },
  );

  it('focuses the Find My Legislator field after empty Find, an address error, and closing choices', () => {
    const source = readFileSync(join(SRC, 'screens/FindMyLegislatorScreen.tsx'), 'utf8');
    const findAddress = source.slice(
      source.indexOf('const findAddress = () =>'),
      source.indexOf('const chooseAddress ='),
    );
    const choiceKeys = source.slice(
      source.indexOf('const onChoiceKey ='),
      source.indexOf('const navigateFromMenu ='),
    );

    expect(source.match(/\.focus\(\)/g)).toHaveLength(3);
    expect(source).toContain("state === 'not-found'");
    expect(source).toContain("state === 'service-down'");
    expect(findAddress).toContain('addressInputRef.current?.focus()');
    expect(choiceKeys).toContain('addressInputRef.current?.focus()');
  });

  it('excludes only the non-editable share-link display', () => {
    const source = readFileSync(join(SRC, READ_ONLY_TEXT_FIELD), 'utf8');

    expect(source).toContain('editable={false}');
  });
});
