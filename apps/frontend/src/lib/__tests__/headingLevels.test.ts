import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * react-native-web renders `accessibilityRole="header"` as an `<h1>` whenever no
 * level is given (`AccessibilityUtil/propsToAccessibilityComponent.js`: role
 * `heading` with no `aria-level` returns `'h1'`). Nothing warns, so a section
 * label written that way silently claims to be the page's most important heading.
 *
 * That is how a bill page came to ship 52 `<h1>`s and a legislator profile 9,
 * with the person's name not a heading at all ([#1355]). Heading navigation is
 * how a screen-reader user skims a page, so a flat run of `<h1>`s with nothing
 * beneath is not a hierarchy at all.
 *
 * This guard is source-text, deliberately: the failure is invisible in the
 * rendered output unless you go and read the heading outline in a browser, and
 * it costs one missing prop to reintroduce.
 */
const SRC = join(__dirname, '..', '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : tsxFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('heading levels', () => {
  const files = tsxFiles(SRC);

  it('finds the screens and components to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('gives every header role an explicit level', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        // Both the JSX prop and the object-literal form a spread prop uses.
        const isJsx = line.includes('accessibilityRole="header"');
        const isObject = /accessibilityRole:\s*'header'/.test(line);
        if (!isJsx && !isObject) return;
        // The level may sit on a following prop line of the same JSX element.
        const element = lines.slice(index, index + 4).join(' ');
        if (!/(aria-level=\{|'aria-level':)/.test(element)) {
          offenders.push(`${file.slice(SRC.length + 1)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('lets the home hero claim the h1 only while Home is the visible screen', () => {
    // Home stays mounted beneath a deep-linked bill or profile, so an
    // unconditional header role here puts a second, competing <h1> in every
    // page's markup.
    const home = readFileSync(join(SRC, 'screens/redesign/HomeSignedOutScreen.tsx'), 'utf8');
    expect(home).toMatch(/const heroHeadingProps = \(isFocused: boolean\)/);
    expect(home.match(/\{\.\.\.heroHeadingProps\(isFocused\)\}/g) ?? []).toHaveLength(4);
    // No hero headline may go back to an unconditional level-1 heading.
    expect(home).not.toMatch(/accessibilityRole="header" aria-level=\{1\}/);
  });

  it('keeps the page subject as the only level-1 heading on a bill and a profile', () => {
    // One `aria-level={1}` per screen file: the thing the page is about. Section
    // labels are 2, anything nested under them 3.
    const oneLevelOne = [
      'components/billDetail/BillHeader.tsx',
      'screens/redesign/BillDetailScreen.tsx',
      'screens/redesign/LegislatorProfileWebScreen.tsx',
      'screens/redesign/LegislatorProfileMobileScreen.tsx',
    ];
    for (const rel of oneLevelOne) {
      const source = readFileSync(join(SRC, rel), 'utf8');
      expect(source.match(/aria-level=\{1\}/g) ?? []).toHaveLength(1);
    }
  });

  it('marks the legislator profile section labels as headings', () => {
    // The name used to be plain text and the section labels used to be `<h1>`s,
    // which left heading navigation unable to reach the person or skim the page.
    for (const rel of [
      'screens/redesign/LegislatorProfileWebScreen.tsx',
      'screens/redesign/LegislatorProfileMobileScreen.tsx',
    ]) {
      const source = readFileSync(join(SRC, rel), 'utf8');
      for (const label of ['Biography', 'Committees', 'Contact', 'Legislative Service']) {
        const marked = new RegExp(`accessibilityRole="header"[\\s\\S]{0,120}${label}`);
        expect(source, `${rel} — ${label}`).toMatch(marked);
      }
    }
  });
});
