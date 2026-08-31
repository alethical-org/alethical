import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A bill's plain-language title is what a screen reader must announce, the same
 * words everyone else reads ([#1362], `.claude/rules/grounded-answers.md` rule 10).
 *
 * `accessibilityLabel` **replaces** an element's visible text for assistive
 * technology rather than adding to it. So passing the statutory `bill.title` as
 * the label of a node whose visible text is the short title meant a bill page
 * showed 43 plain-language characters and announced **900 characters of statutory
 * cross-references** — measured on production 11 Aug 2026 from Chrome's
 * accessibility tree. Reading the prop looks correct, which is why it survived for
 * months and why this is a test rather than a comment.
 *
 * The statutory title stays reachable: a hover tooltip (the DOM `title` property,
 * which is additive) plus the Bill Text section and the source link.
 *
 * This checks the source, because Vitest here runs pure logic with no DOM and
 * cannot compute an accessible name. The computed name itself is verified in a
 * real browser — see the PR for #1362.
 */
const SRC = join(__dirname, '..', '..');

/** Every surface that shows a bill's short title over its statutory one. */
const BILL_TITLE_SURFACES = [
  'components/billDetail/BillHeader.tsx',
  'components/search/BillResultCard.tsx',
  'screens/redesign/BillDetailScreen.tsx',
  'screens/redesign/AskAnswerScreen.tsx',
];

describe('a bill title announces the plain-language words', () => {
  it('never hands the statutory title to a screen reader as a label', () => {
    const offenders: string[] = [];
    for (const rel of BILL_TITLE_SURFACES) {
      const lines = readFileSync(join(SRC, rel), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (/accessibilityLabel=\{(bill\.title|fullTitle)\}/.test(line)) {
          offenders.push(`${rel}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('still keeps the statutory title reachable as a hover tooltip', () => {
    // Removing the label must not remove the statutory wording from the page. The
    // phone bill screen is deliberately absent: there is no hover on a phone, so
    // it relies on the Bill Text section instead.
    for (const rel of [
      'components/billDetail/BillHeader.tsx',
      'components/search/BillResultCard.tsx',
      'screens/redesign/AskAnswerScreen.tsx',
    ]) {
      const source = readFileSync(join(SRC, rel), 'utf8');
      expect(source, rel).toMatch(/(setAttribute\('title'|\.title = bill\.title)/);
    }
  });
});
