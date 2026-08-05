import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Stop `accessibilityState={{ expanded }}` / `{{ selected }}` coming back (#1036).
 *
 * Measured in Chrome on react-native-web 0.21.2: neither renders anything at all —
 * no attribute, no error, no warning, and no type complaint, because
 * `accessibilityState` is not in react-native-web's prop map (`createDOMProps`), so
 * it is stripped before it ever reaches the DOM. A control that looks correctly
 * marked in the source announces no state whatsoever.
 *
 * The plain `aria-*` props are the fix. `aria-expanded` and `aria-selected` are typed
 * by React Native itself (`Libraries/Components/View/ViewAccessibility.d.ts`), so a
 * wrong value is a compile error. `aria-current` and `aria-pressed` are NOT typed —
 * measured: `aria-current={12345}` compiles clean — so nothing but this test and a
 * browser stands between a typo and a silent regression.
 *
 * `disabled` and `busy` are deliberately not covered: those are handled by
 * `useUnavailableControl` (#1030), and the sites that still pass
 * `accessibilityState={{ disabled }}` do so alongside a real `disabled` prop, which
 * react-native-web DOES render from. That pairing is correct and must keep working.
 */

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('accessibilityState never carries expanded or selected', () => {
  it('finds no site that would silently announce nothing', () => {
    // Every occurrence in this codebase is written on one line, so the rest of the
    // line is the whole prop value. A future multi-line one would slip past this;
    // the browser measurement in the PR, not this test, is the backstop for that.
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const at = line.indexOf('accessibilityState=');
          if (at === -1) return;
          const value = line.slice(at);
          if (/\b(expanded|selected)\b/.test(value)) {
            offenders.push(`${file.slice(SRC.length + 1)}:${i + 1} ${line.trim()}`);
          }
        });
    }

    expect(
      offenders,
      [
        'These render NOTHING on react-native-web. Use the plain prop instead:',
        '  accessibilityState={{ expanded: open }}  ->  aria-expanded={open}',
        '  accessibilityState={{ selected: active }} ->  aria-selected / aria-current / aria-pressed,',
        '    whichever is true for that control (see docs/design/design-principles.md).',
      ].join('\n'),
    ).toEqual([]);
  });
});
