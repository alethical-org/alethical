// The pure text helpers on the Bill Detail page.
//
// `plainBillSummary` and `plainKeyPoints` are display cleaners for AI-written
// bill summaries. Their contract is in .claude/rules/grounded-answers.md rule 9:
// they may drop a bill-code preamble and a citation that is scaffolding, and
// they may NOT re-author the sentence. Most of the cases below are the ones the
// 10,471-summary corpus replay behind #710/#754 turned up — an unrestricted
// citation strip damaged 9 of the 10 summaries it touched, so each of those
// nine is pinned here as a must-not-change.
//
// `completeDanglingTitle` is the net under every timeline-title rule: no action
// row may end on a preposition.

import { describe, expect, it } from 'vitest';

import { completeDanglingTitle, plainBillSummary, plainKeyPoints } from '../billDetail';

describe('plainBillSummary drops what is scaffolding', () => {
  it('drops a leading amendatory clause', () => {
    expect(
      plainBillSummary('Amends Minnesota Statutes 2024, section 120B.123, to require screening.'),
    ).toBe('Require screening.');
  });

  it('drops a bill-code preamble, in each shape the corpus writes it', () => {
    expect(plainBillSummary('The bill HF 577 appropriates $6,000,000.')).toBe(
      'Appropriates $6,000,000.',
    );
    expect(plainBillSummary('HF 1116 modifies the definition of a health plan.')).toBe(
      'Modifies the definition of a health plan.',
    );
    expect(plainBillSummary('S.F. No. 334 establishes a grant program.')).toBe(
      'Establishes a grant program.',
    );
    expect(plainBillSummary('This act creates a council.')).toBe('Creates a council.');
  });

  it('drops a citation kept as a parenthetical aside, brackets and all', () => {
    expect(
      plainBillSummary('Allows a tax credit (Minnesota Statutes, chapter 290) for employers.'),
    ).toBe('Allows a tax credit for employers.');
    expect(
      plainBillSummary('Modifies the fee schedule (sections 168.013 and 168.12) for vehicles.'),
    ).toBe('Modifies the fee schedule for vehicles.');
  });

  it('takes only the first sentence when asked', () => {
    expect(
      plainBillSummary('The bill HF 577 appropriates money. It also creates a council.', {
        firstSentenceOnly: true,
      }),
    ).toBe('Appropriates money.');
  });

  it('handles empty input without inventing a sentence', () => {
    expect(plainBillSummary('')).toBe('');
    expect(plainBillSummary(null)).toBe('');
    expect(plainBillSummary(undefined)).toBe('');
    expect(plainBillSummary('   ')).toBe('');
  });
});

describe('plainBillSummary never re-authors the sentence', () => {
  // Each of these is a real production summary the unrestricted citation strip
  // broke. A display cleaner that breaks a sentence's grammar is re-authoring it.
  const mustNotChange = [
    'Adds an entity formed under chapter 116A to the definition of a utility.',
    'Expands eligibility for housing assistance like Section 8 vouchers.',
    'Conforms to a federal change to section 179 business expensing.',
    'Renames the Board of Barber Examiners throughout Minnesota Statutes.',
    'Clarifies that the rule previously pointed to chapter 119B, but now points elsewhere.',
    // "To qualify" is the reader's own opening word, not the tail of a clause we
    // cut. Stripping it unconditionally produced "Qualify, the inspector …".
    'To qualify, the inspector general must have five years of experience.',
    // A bare decimal after a comma. The naive space-before-punctuation rule
    // turned this into ", .22" -> ",.22" on two magazine-capacity bills.
    'Requires a report on ammunition, .22 caliber and larger, sold in the state.',
    // A recodification bill whose substance IS the citation. Rule 9 leaves the
    // residual ~0.08% as written rather than emptying them.
    'Minnesota Statutes 2024, section 626.8452, is amended.',
  ];

  it.each(mustNotChange)('leaves %s exactly as written', (summary) => {
    expect(plainBillSummary(summary)).toBe(summary);
  });

  it('never leaves a bill code in the output', () => {
    for (const summary of mustNotChange) {
      expect(plainBillSummary(summary)).not.toMatch(/^\s*(?:H\.?\s?F\.?|S\.?\s?F\.?)\s*\d/i);
    }
  });

  it('leaves the sentence starting with a capital', () => {
    for (const summary of [...mustNotChange, 'HF 1116 modifies the definition.']) {
      const out = plainBillSummary(summary);
      expect(out.charAt(0)).toBe(out.charAt(0).toUpperCase());
    }
  });
});

describe('plainKeyPoints', () => {
  it('cleans each point the same way a summary is cleaned', () => {
    expect(
      plainKeyPoints(['The bill HF 577 appropriates money.', 'Requires annual reporting.']),
    ).toEqual(['Appropriates money.', 'Requires annual reporting.']);
  });

  it('drops a point with no plain-language effect left', () => {
    // A point that is only a parenthetical citation collapses to empty rather
    // than having an effect invented for it.
    expect(plainKeyPoints(['(Minnesota Statutes, chapter 290)', 'Requires a report.'])).toEqual([
      'Requires a report.',
    ]);
    expect(plainKeyPoints(['', '   '])).toEqual([]);
  });

  it('keeps a point whose substance is the citation', () => {
    // Same rule-9 restraint as the summary cleaner: a recodification point is
    // left as written rather than emptied.
    expect(plainKeyPoints(['Amends Minnesota Statutes 2024, section 120B.123.'])).toEqual([
      'Amends Minnesota Statutes 2024, section 120B.123.',
    ]);
  });

  it('handles a missing list', () => {
    expect(plainKeyPoints(undefined)).toEqual([]);
  });
});

describe('completeDanglingTitle: no action row ends on a preposition', () => {
  it('uses the source value when there is one', () => {
    expect(completeDanglingTitle('Referred to', 'Ways and Means')).toBe(
      'Referred to Ways and Means',
    );
    expect(completeDanglingTitle('Re-referred to', 'Taxes')).toBe('Re-referred to Taxes');
    // A bare trailing comma is not a dangling preposition, so nothing is added.
    expect(completeDanglingTitle('Author added,', 'Smith')).toBe('Author added,');
  });

  it('loses the waiting clause rather than leaving the preposition bare', () => {
    for (const title of ['Referred to', 'Comparison bill substituted for', 'Returned to']) {
      const out = completeDanglingTitle(title, '');
      expect(out).not.toMatch(/[,\s]+(?:to|for|with|from|by|of|in|on|and)\s*$/i);
      expect(out.length).toBeGreaterThan(0);
    }
    expect(completeDanglingTitle('Third reading, referred to', '')).toBe('Third reading');
  });

  it('leaves a title that does not dangle alone', () => {
    expect(completeDanglingTitle('Third reading passed', '')).toBe('Third reading passed');
    expect(completeDanglingTitle('Author added, Smith', '')).toBe('Author added, Smith');
    expect(completeDanglingTitle('Introduction and first reading', 'Taxes')).toBe(
      'Introduction and first reading',
    );
  });
});
