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

import {
  bienniumEyebrow,
  buildActionTimeline,
  completeDanglingTitle,
  crossReferenceTargets,
  latestActionEntry,
  plainBillSummary,
  plainKeyPoints,
  POINTER_CAPTION,
  titleSegments,
} from '../billDetail';
import { BillAction } from '../../data/types';

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

// ===========================================================================
// "See also" pointer rows (#757)
//
// 1,200 production bills end with a row whose whole content is a pointer: the
// Legislature's record says "See HF2446, HF2115" and stops. The rule these tests
// pin is the one from .claude/rules/grounded-answers.md rule 9's neighbourhood and
// from PR #744: we may describe the TARGET (its code, what it is, where it got to),
// and we may never describe the RELATIONSHIP, because the source states a pointer
// and not a mechanism. Every fixture below is the real shape of a production row.
// ===========================================================================

const REAL_POINTER_ACTIONS: Record<string, BillAction[]> = {
  // SF 1599 — a small mental-health bill whose trail ends at two omnibus bills
  // that both became law. The example the issue was filed on.
  'SF 1599': [
    {
      id: 'a1',
      date: '2025-02-20',
      description: 'x',
      actionText: 'Introduction and first reading',
      actionNumber: 1,
    },
    {
      id: 'a2',
      date: '2025-02-20',
      description: 'x',
      actionText: 'Referred to',
      committee: 'Health and Human Services',
      actionNumber: 2,
    },
    {
      id: 'a3',
      date: '',
      description: 'x',
      actionText: 'See',
      actionDescription: 'HF2446, HF2115',
      actionNumber: 3,
      crossReferences: [
        {
          code: 'HF 2446',
          id: '94-2025-HF2446',
          title: 'Agriculture and Broadband Development Budget Bill',
          status: 'Signed into Law',
        },
        {
          code: 'HF 2115',
          id: '94-2025-HF2115',
          title: 'Human Services Policy Technical Updates and Clarifications',
          status: 'Signed into Law',
        },
      ],
    },
  ],
  // HF 2084 — the chapter-and-section shape. Nothing resolves, so nothing may be
  // added: 65 production rows point at an enacted chapter with no file number.
  'HF 2084': [
    {
      id: 'b1',
      date: '2025-03-10',
      description: 'x',
      actionText: 'Introduction and first reading, referred to',
      committee: 'Legacy Finance',
      actionNumber: 1,
    },
    {
      id: 'b2',
      date: '',
      description: 'x',
      actionText: 'See',
      actionDescription: 'Chapter 36, Article 4., Section 8.',
      actionNumber: 2,
    },
  ],
  // HF 3403 — the clerk's "See Senate file in House" variant, target resolvable.
  'HF 3403': [
    {
      id: 'c1',
      date: '2026-02-17',
      description: 'x',
      actionText: 'Introduction and first reading, referred to',
      committee: 'Housing Finance and Policy',
      actionNumber: 1,
    },
    {
      id: 'c2',
      date: '',
      description: 'x',
      actionText: 'See Senate file in House',
      actionDescription: 'SF3596',
      actionNumber: 2,
      crossReferences: [
        {
          code: 'SF 3596',
          id: '94-2026-SF3596',
          title: 'Emergency Rental Assistance Aid For Counties And Tribes',
          status: 'Passed Senate',
        },
      ],
    },
  ],
  // HF 2439 — a special-session file (never resolvable, #746) beside one that is.
  'HF 2439': [
    {
      id: 'd1',
      date: '2025-03-17',
      description: 'x',
      actionText: 'Introduction and first reading, referred to',
      committee: 'Environment and Natural Resources Finance and Policy',
      actionNumber: 1,
    },
    {
      id: 'd2',
      date: '',
      description: 'x',
      actionText: 'See',
      actionDescription: '2025 1st Special Session SF3, Chapter 1, Article 1., Various Sections.',
      actionNumber: 2,
    },
    {
      id: 'd3',
      date: '',
      description: 'x',
      actionText: 'See Senate file in House',
      actionDescription: 'SF2077',
      actionNumber: 3,
      crossReferences: [
        {
          code: 'SF 2077',
          id: '94-2025-SF2077',
          title: 'Outdoor Heritage Fund And Parks Omnibus Bill',
          status: 'Signed into Law',
        },
      ],
    },
  ],
};

const NOW = new Date('2026-07-30');

describe('a pointer row is recognisable as a pointer, on all four shapes', () => {
  it('classifies every "See" variant as crossReference, never as an ordinary step', () => {
    for (const [name, actions] of Object.entries(REAL_POINTER_ACTIONS)) {
      const { rows } = buildActionTimeline(actions, [], NOW);
      const pointers = rows.filter((row) => row.kind === 'crossReference');
      expect(pointers.length, name).toBeGreaterThan(0);
      for (const row of pointers) expect(row.title, name).toMatch(/^See also /);
      // And no ordinary step is mistaken for one.
      for (const row of rows.filter((r) => r.kind !== 'crossReference'))
        expect(row.title, name).not.toMatch(/^See also /);
    }
  });

  it('reports that kind as the latest action, which is what lets the rail qualify the status', () => {
    // The status pill on all four of these reads "Introduced". The rail caption is
    // gated on this kind, so if the kind stopped surfacing here the caption would
    // silently vanish from 1,190 bills and they would read as ordinary proposals.
    for (const [name, actions] of Object.entries(REAL_POINTER_ACTIONS)) {
      expect(latestActionEntry(actions, NOW)?.kind, name).toBe('crossReference');
    }
  });

  it('wins a dateless tie against a procedural row, so the caption cannot go missing', () => {
    // SF 2483's real shape: the pointer is dateless, and so is a "Referred to Rules
    // and Administration" row that the source appends without a date. Both land in
    // the same dateless group, where the tie is broken by rank. Ranked level with
    // `procedural`, the referral won by position and 13 production bills lost their
    // pointer caption entirely — reading as ordinary proposals (#757).
    const actions: BillAction[] = [
      {
        id: 'i1',
        date: '2025-04-30',
        description: 'x',
        actionText: 'Second reading',
        actionNumber: 1,
      },
      {
        id: 'i2',
        date: '',
        description: 'x',
        actionText: 'See',
        actionDescription: 'HF4252',
        actionNumber: 2,
      },
      {
        id: 'i3',
        date: '',
        description: 'x',
        actionText: 'Referred to',
        committee: 'Rules and Administration',
        actionNumber: 3,
      },
    ];
    const latest = latestActionEntry(actions, NOW);
    expect(latest?.kind).toBe('crossReference');
    expect(latest?.label).toBe('See also HF 4252');
  });

  it('still loses to a real outcome, so an enacted law never reads as a pointer', () => {
    // Grounded-answers rule 7: enacted law must never read as a pending step. A
    // signed bill that also carries a pointer row keeps the signing as its latest
    // action, and its status pill says "Signed into Law" — which is why the caption
    // is correctly absent on the one production bill in that shape (HF 2115).
    const actions: BillAction[] = [
      {
        id: 'j1',
        date: '2025-05-24',
        description: 'x',
        actionText: 'Governor approval',
        actionNumber: 1,
      },
      {
        id: 'j2',
        date: '',
        description: 'x',
        actionText: 'See',
        actionDescription: 'HF1',
        actionNumber: 2,
      },
    ];
    expect(latestActionEntry(actions, NOW)?.kind).toBe('signing');
  });

  it("leaves an ordinary bill's latest action kind alone", () => {
    const ordinary: BillAction[] = [
      {
        id: 'e1',
        date: '2025-03-10',
        description: 'x',
        actionText: 'Introduction and first reading, referred to',
        committee: 'Taxes',
        actionNumber: 1,
      },
    ];
    expect(latestActionEntry(ordinary, NOW)?.kind).toBe('procedural');
  });
});

describe('crossReferenceTargets describes the target and never the relationship', () => {
  it('names what each resolvable target is and where it got to', () => {
    const { rows } = buildActionTimeline(REAL_POINTER_ACTIONS['SF 1599'], [], NOW);
    const pointer = rows.find((row) => row.kind === 'crossReference')!;
    expect(crossReferenceTargets(pointer)).toEqual([
      {
        code: 'HF 2446',
        billId: '94-2025-HF2446',
        title: 'Agriculture and Broadband Development Budget Bill',
        status: 'Signed into Law',
      },
      {
        code: 'HF 2115',
        billId: '94-2025-HF2115',
        title: 'Human Services Policy Technical Updates and Clarifications',
        status: 'Signed into Law',
      },
    ]);
  });

  it('adds nothing to a target we cannot look up', () => {
    // The chapter-and-section row, and the special-session row beside a resolvable
    // one: a row we cannot resolve gains no invented detail (#745's contract).
    for (const name of ['HF 2084', 'HF 2439'] as const) {
      const { rows } = buildActionTimeline(REAL_POINTER_ACTIONS[name], [], NOW);
      for (const row of rows.filter((r) => r.kind === 'crossReference')) {
        if (!row.links?.length) expect(crossReferenceTargets(row), name).toEqual([]);
      }
    }
    const { rows } = buildActionTimeline(REAL_POINTER_ACTIONS['HF 2084'], [], NOW);
    expect(rows.flatMap(crossReferenceTargets)).toEqual([]);
  });

  it('drops a link with no title rather than showing a code with a blank beside it', () => {
    const actions: BillAction[] = [
      {
        id: 'f1',
        date: '',
        description: 'x',
        actionText: 'See',
        actionDescription: 'HF1, HF2',
        actionNumber: 1,
        crossReferences: [
          { code: 'HF 1', id: '94-2025-HF1' },
          { code: 'HF 2', id: '94-2025-HF2', title: 'A Titled Bill', status: 'In Committee' },
        ],
      },
    ];
    const { rows } = buildActionTimeline(actions, [], NOW);
    // Both codes stay linked in the title — only the described sub-lines are
    // filtered, so a target we hold no title for is still followable.
    expect(
      titleSegments(rows[0])
        .filter((s) => s.billId)
        .map((s) => s.text),
    ).toEqual(['HF 1', 'HF 2']);
    expect(crossReferenceTargets(rows[0]).map((t) => t.code)).toEqual(['HF 2']);
  });

  it('keeps a target whose status we do not hold, since the title alone is worth saying', () => {
    const actions: BillAction[] = [
      {
        id: 'g1',
        date: '',
        description: 'x',
        actionText: 'See',
        actionDescription: 'HF9',
        actionNumber: 1,
        crossReferences: [{ code: 'HF 9', id: '94-2025-HF9', title: 'A Titled Bill' }],
      },
    ];
    const { rows } = buildActionTimeline(actions, [], NOW);
    expect(crossReferenceTargets(rows[0])).toEqual([
      { code: 'HF 9', billId: '94-2025-HF9', title: 'A Titled Bill', status: undefined },
    ]);
  });
});

describe('the plain-language key explains the pointer row, without claiming a mechanism', () => {
  it('glosses "See also" wherever such a row is shown, on all four shapes', () => {
    for (const [name, actions] of Object.entries(REAL_POINTER_ACTIONS)) {
      const { glossary } = buildActionTimeline(actions, [], NOW);
      expect(
        glossary.map((entry) => entry.term),
        name,
      ).toContain('See also');
    }
  });

  it('does not gloss it on a bill with no such row', () => {
    const ordinary: BillAction[] = [
      {
        id: 'h1',
        date: '2025-03-10',
        description: 'x',
        actionText: 'Introduction and first reading, referred to',
        committee: 'Taxes',
        actionNumber: 1,
      },
    ];
    const { glossary } = buildActionTimeline(ordinary, [], NOW);
    expect(glossary.map((entry) => entry.term)).not.toContain('See also');
  });

  it('never says where the language ended up, in either piece of fixed copy', () => {
    // The hard constraint from PR #744: the record states a pointer, not a
    // mechanism. These are the phrasings that would assert one.
    const { glossary } = buildActionTimeline(REAL_POINTER_ACTIONS['SF 1599'], [], NOW);
    const gloss = glossary.find((entry) => entry.term === 'See also')!.def;
    for (const copy of [gloss, POINTER_CAPTION]) {
      expect(copy).not.toMatch(
        /folded|absorb|incorporat|merged|became law as part|rolled into|moved into|ended up|superseded|replaced by/i,
      );
      // And each one says the thing that stops the wrong impression forming.
      expect(copy).toMatch(/does not say how/i);
    }
  });
});

describe('bienniumEyebrow names the session the bill is actually from', () => {
  it('uses the served session name, not arithmetic on the bill id', () => {
    expect(bienniumEyebrow('94-2025-SF334', '94th Legislature (2025 - 2026) Regular Session')).toBe(
      '2025–2026 LEGISLATIVE SESSION',
    );
  });

  it('names a special session as a special session', () => {
    // #746: the old version parsed "94-2025s1-HF5" with /^\d+-(\d{4})-/, which misses
    // because the segment is "2025s1", and fell through to a bare "LEGISLATIVE
    // SESSION" — a session eyebrow naming no session, on every special-session page.
    expect(bienniumEyebrow('94-2025s1-HF5', '94th Legislature (2025) First Special Session')).toBe(
      '2025 FIRST SPECIAL SESSION',
    );
  });

  it('falls back to the id while the session is still loading', () => {
    expect(bienniumEyebrow('94-2026-HF4138')).toBe('2025–2026 LEGISLATIVE SESSION');
    expect(bienniumEyebrow('94-2025-SF334', 'Current session')).toBe(
      '2025–2026 LEGISLATIVE SESSION',
    );
  });

  it('says nothing rather than naming a session it cannot identify', () => {
    expect(bienniumEyebrow('', undefined)).toBe('');
    expect(bienniumEyebrow('94-2025s1-HF5')).toBe('');
  });
});
