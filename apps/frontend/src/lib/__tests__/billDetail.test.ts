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
  billOverviewUrl,
  buildActionTimeline,
  citationChipLabel,
  completeStatusText,
  citationsBySection,
  completeDanglingTitle,
  crossReferenceTargets,
  latestActionEntry,
  plainBillSummary,
  plainKeyPoints,
  POINTER_CAPTION,
  readDocumentLink,
  titleSegments,
} from '../billDetail';
import { BillAction, BillVersion, Citation } from '../../data/types';

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

// An author row's names come from the clerk's action_description, which holds bare
// surnames ("Joy", "Anderson, P. E."). buildActionTimeline resolves each against the
// bill's own author list so the row can print the full name and link to the profile.
// Every case below is a real production shape, from a replay of all 6,336
// author-add rows in the corpus.
describe('author rows name the person and link to them', () => {
  const HOUSE_AUTHORS = [
    { name: 'Steve Gander', role: 'chief_author', legislatorId: 'gander-id' },
    { name: 'Jim Joy', role: 'co_author', legislatorId: 'joy-id' },
    { name: 'Roger Skraba', role: 'co_author', legislatorId: 'skraba-id' },
  ];

  const addAction = (n: number, desc: string): BillAction => ({
    id: `a${n}`,
    date: '2026-04-30',
    description: 'x',
    actionText: 'Author added',
    actionDescription: desc,
    actionNumber: n,
  });

  const authorRow = (actions: BillAction[], authors = HOUSE_AUTHORS) =>
    buildActionTimeline(actions, [], NOW, undefined, authors).rows.find((r) => r.authors)!;

  it('prints the full name and the profile id, not the clerk surname', () => {
    // HF 4301's real rows — the page showed "2 co-authors added — Joy, Skraba".
    const row = authorRow([addAction(2, 'Joy'), addAction(3, 'Skraba')]);
    expect(row.authors).toEqual([
      { label: 'Jim Joy', legislatorId: 'joy-id' },
      { label: 'Roger Skraba', legislatorId: 'skraba-id' },
    ]);
    expect(row.title).toBe('2 co-authors added — Jim Joy, Roger Skraba');
  });

  it('splits a semicolon list, which 329 production rows use', () => {
    // "Fateh; Clark" split on commas alone stayed ONE name, so the row read
    // "Co-author added" for two people and neither could resolve.
    const row = authorRow([addAction(2, 'Joy; Skraba')]);
    expect(row.authors?.map((a) => a.label)).toEqual(['Jim Joy', 'Roger Skraba']);
    expect(row.title).toBe('2 co-authors added — Jim Joy, Roger Skraba');
  });

  it('keeps a surname and its initials together, however many initials', () => {
    // The House separates its two Andersons as "Anderson, P. E." and
    // "Anderson, P. H.". A single-letter re-join left a bare "P. E." standing in
    // for a person, on 74 production rows.
    const anderson = [{ name: 'Paul Anderson', role: 'co_author', legislatorId: 'paul-id' }];
    const row = authorRow(
      [addAction(2, 'Anderson, P. E.; and Gander')],
      [...anderson, ...HOUSE_AUTHORS],
    );
    expect(row.authors?.map((a) => a.label)).toEqual(['Paul Anderson', 'Steve Gander']);
  });

  it('refuses to guess between two authors who share a surname', () => {
    // Both Andersons co-author HF 4407 and the clerk's initials are both "P.", so
    // nothing in the record says which one this row is. The row keeps the clerk's
    // own string, unlinked, rather than linking to a coin flip.
    const both = [
      { name: 'Paul Anderson', role: 'co_author', legislatorId: 'paul-id' },
      { name: 'Patti Anderson', role: 'co_author', legislatorId: 'patti-id' },
    ];
    const row = authorRow([addAction(2, 'Anderson, P. E.; and Anderson, P. H.')], both);
    expect(row.authors).toEqual([{ label: 'Anderson, P. E.' }, { label: 'Anderson, P. H.' }]);
  });

  it('uses an initial to pick between two who share a surname', () => {
    const lees = [
      { name: 'Fue Lee', role: 'co_author', legislatorId: 'fue-id' },
      { name: 'Liz Lee', role: 'co_author', legislatorId: 'liz-id' },
    ];
    expect(authorRow([addAction(2, 'Lee, F.')], lees).authors).toEqual([
      { label: 'Fue Lee', legislatorId: 'fue-id' },
    ]);
    expect(authorRow([addAction(2, 'Lee, L.')], lees).authors).toEqual([
      { label: 'Liz Lee', legislatorId: 'liz-id' },
    ]);
  });

  it('matches a two-word surname, and a Senate name through its honorific', () => {
    // The roster stores no separate surname field, and the Senate prefixes every
    // name ("Senator Erin K. Maye Quade"). 150 production rows name a member whose
    // surname is two words.
    const senate = [
      { name: 'Senator Erin K. Maye Quade', role: 'co_author', legislatorId: 'mq-id' },
      { name: 'Senator Ann M. Johnson Stewart', role: 'co_author', legislatorId: 'js-id' },
    ];
    expect(authorRow([addAction(2, 'Maye Quade; Johnson Stewart')], senate).authors).toEqual([
      { label: 'Erin K. Maye Quade', legislatorId: 'mq-id' },
      { label: 'Ann M. Johnson Stewart', legislatorId: 'js-id' },
    ]);
  });

  it('matches an accented surname the clerk wrote in plain ASCII', () => {
    const perez = [{ name: 'María Isa Pérez-Vega', role: 'co_author', legislatorId: 'pv-id' }];
    expect(authorRow([addAction(2, 'Perez-Vega')], perez).authors).toEqual([
      { label: 'María Isa Pérez-Vega', legislatorId: 'pv-id' },
    ]);
  });

  it('keeps the record’s own words for a name that is not an author here', () => {
    // A member later stricken from the bill has no author row to match — 284
    // production "Author stricken" rows are exactly this. Nothing is invented.
    const row = authorRow([addAction(2, 'Eichorn')]);
    expect(row.authors).toEqual([{ label: 'Eichorn' }]);
    expect(row.title).toBe('Co-author added — Eichorn');
  });

  it('sums an author group up for the rail rather than listing it', () => {
    // The rail is one line beside the status pill. 30 production bills have a run of
    // 24+ names as their newest action (HF 683 adds 31 at once), and the row's title
    // used to name whichever member came first — reading as one person for a row
    // that was really 31. Longest rail label corpus-wide is now 52 characters.
    const many = [addAction(2, 'Joy'), addAction(3, 'Skraba')];
    expect(latestActionEntry(many, NOW, HOUSE_AUTHORS)?.label).toBe('2 co-authors added');
    // A single add still names the person, with the full name.
    expect(latestActionEntry([addAction(2, 'Joy')], NOW, HOUSE_AUTHORS)?.label).toBe(
      'Co-author added — Jim Joy',
    );
  });

  it('leaves every name unlinked when no author list was handed in', () => {
    const { rows } = buildActionTimeline([addAction(2, 'Joy'), addAction(3, 'Skraba')], [], NOW);
    expect(rows.find((r) => r.authors)?.authors).toEqual([{ label: 'Joy' }, { label: 'Skraba' }]);
  });
});

describe('citationChipLabel never shows a topic cut off mid-word', () => {
  // The stored label is written at ingest and its shape varies by when the bill was
  // enriched. Until this change, ingest cut the topic off at 40 characters, so 2,033
  // of the 4,269 production chips whose topic came from the stored label ended in an
  // ellipsis. The server computes the same heading whole at request time, so the
  // complete value is already on the wire next to the broken one.
  it('prefers the complete served topic over a cut-off stored one', () => {
    expect(
      citationChipLabel(
        'Sec. 1 · Wright technical center; capital improv…',
        'Wright technical center',
      ),
    ).toBe('Sec. 1 · Wright technical center');
    expect(
      citationChipLabel('Sec. 3 · Appropriation; minnesota snap step up f…', 'Appropriation'),
    ).toBe('Sec. 3 · Appropriation');
    // Also on an article-structured bill, where the number carries a prefix.
    expect(
      citationChipLabel('Art. 2, Sec. 14 · Task force to establish a statewide net…', 'Task force'),
    ).toBe('Art. 2, Sec. 14 · Task force');
  });

  it('drops a cut-off topic when no complete one is served', () => {
    // 30 of those 2,033 have no served topic, because the heading is past the length
    // a chip can carry and the server drops it. The number alone is the feature's
    // designed empty state; half a word is not.
    expect(citationChipLabel('Sec. 4 · Mandatory environmental assessment work…')).toBe('Sec. 4');
    expect(citationChipLabel('Sec. 7 · Scoping environmental assessment worksh…', '')).toBe(
      'Sec. 7',
    );
  });

  it('leaves a complete stored topic alone, even when the served one differs', () => {
    // No source heading in the corpus ends in an ellipsis (checked across all 49,919
    // current-version sections), so an ellipsis is always our own cut and is the only
    // thing that lets the served value win. A complete stored topic still stands.
    expect(citationChipLabel('Sec. 2 · Transfer', 'Something else')).toBe('Sec. 2 · Transfer');
    expect(citationChipLabel('Sec. 26 · Appropriation')).toBe('Sec. 26 · Appropriation');
  });

  it('still fills in a topic for a label that carries none', () => {
    // The HF 4301 case: the stored label is just the number, and the served topic
    // supplies the whole "· Topic" half.
    expect(
      citationChipLabel(
        'HF 4301, Section 1.',
        'Drinking water regionalization planning and assistance grants',
      ),
    ).toBe('Sec. 1 · Drinking water regionalization planning and assistance grants');
    expect(citationChipLabel('HF 4301, Sec. 2.', 'Appropriation')).toBe('Sec. 2 · Appropriation');
    // No served topic — the number alone, with no dangling middot.
    expect(citationChipLabel('SF 334, Sec. 14.')).toBe('Sec. 14');
  });
});

// The two rail links out to revisor.mn.gov. Both were pointing at the wrong page:
// "Read the full law" opened the introduced draft (it took whatever version the
// payload listed first), and "Bill overview" opened an engrossment rather than the
// bill's status page. The rows below are HF 719's real production payload — the bill
// that surfaced both bugs: signed into law as Laws 2026, chapter 130, with an
// introduction plus two engrossments in front of it.
const HF719_VERSIONS: BillVersion[] = [
  {
    id: 'v0',
    label: 'As introduced',
    date: '2025-02-12',
    summary: '',
    url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/0/',
    versionCode: '0',
    isCurrent: false,
  },
  {
    id: 'v1',
    label: '1st engrossment',
    date: '2026-05-16',
    summary: '',
    url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/1/',
    versionCode: '1',
    isCurrent: false,
  },
  {
    id: 'v2',
    label: '2nd engrossment',
    date: '2026-05-18',
    summary: '',
    url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/2/',
    versionCode: '2',
    isCurrent: true,
  },
  {
    id: 'law',
    label: 'Session Law — Chapter 130',
    date: '2026-05-27',
    summary: '',
    url: 'https://www.revisor.mn.gov/laws/2026/0/Session+Law/Chapter/130/',
    versionCode: 'session-law',
    isCurrent: false,
  },
];

describe('readDocumentLink picks the document the link promises, and names it', () => {
  const LAW_URL = 'https://www.revisor.mn.gov/laws/2026/0/Session+Law/Chapter/130/';
  const SECOND_ENGROSSMENT = 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/2/';

  it('sends an enacted bill to its Session Law chapter, not the introduced draft', () => {
    expect(readDocumentLink(HF719_VERSIONS, [])).toEqual({
      url: LAW_URL,
      label: 'Read the full law',
    });
  });

  it('finds the chapter wherever the payload happens to list it', () => {
    // The API sets no ordering on versions, so the fix must not depend on position.
    const [intro, first, second, law] = HF719_VERSIONS;
    for (const order of [
      [law, intro, first, second],
      [intro, law, first, second],
      [intro, first, law, second],
      [second, first, law, intro],
    ]) {
      expect(readDocumentLink(order, []).url).toBe(LAW_URL);
    }
  });

  it('sends a bill still in progress to its current text, and says "bill text"', () => {
    const inProgress = HF719_VERSIONS.filter((v) => v.versionCode !== 'session-law');
    expect(readDocumentLink(inProgress, [])).toEqual({
      url: SECOND_ENGROSSMENT,
      label: 'Read the bill text',
    });
  });

  it('falls back to the newest version when no row is marked current', () => {
    const noCurrent = HF719_VERSIONS.filter((v) => v.versionCode !== 'session-law').map((v) => ({
      ...v,
      isCurrent: false,
    }));
    expect(readDocumentLink(noCurrent, []).url).toBe(SECOND_ENGROSSMENT);
  });

  it('never promises "the full law" while opening a draft', () => {
    // The wording follows the destination, not the bill's status — so a bill the
    // status heuristic calls enacted (#270) while its chapter is missing from the
    // record says "Read the bill text" and opens the draft it really opens.
    const chapterMissing = HF719_VERSIONS.filter((v) => v.versionCode !== 'session-law');
    const chapterUnlinkable = HF719_VERSIONS.map((v) =>
      v.versionCode === 'session-law' ? { ...v, url: '' } : v,
    );
    for (const versions of [chapterMissing, chapterUnlinkable]) {
      const link = readDocumentLink(versions, []);
      expect(link.url).toBe(SECOND_ENGROSSMENT);
      expect(link.label).toBe('Read the bill text');
    }
  });

  it('yields no URL when no version carries a document', () => {
    expect(readDocumentLink([], []).url).toBeUndefined();
    expect(readDocumentLink(undefined, undefined).url).toBeUndefined();
  });
});

describe('billOverviewUrl points at the status page, not a text document', () => {
  it('drops the version tail from a numbered engrossment URL', () => {
    expect(billOverviewUrl('https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/2/')).toBe(
      'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/',
    );
  });

  it('drops the whole tail from an unofficial-engrossment URL', () => {
    // The corpus holds this second shape (e.g. SF 1943), where the version code is
    // two path segments — stripping only the last one would leave "/versions/ue/".
    expect(
      billOverviewUrl('https://www.revisor.mn.gov/bills/94/2025/0/SF/1943/versions/ue/2/'),
    ).toBe('https://www.revisor.mn.gov/bills/94/2025/0/SF/1943/');
  });

  it('leaves a URL that names no version alone, and handles a missing one', () => {
    expect(billOverviewUrl('https://www.revisor.mn.gov/bills/94/2025/0/HF/719/')).toBe(
      'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/',
    );
    expect(billOverviewUrl(undefined)).toBeUndefined();
  });
});

describe('citationsBySection shows each cited section once', () => {
  // Citations are served per key point, so a bill whose key points all draw on the
  // same section carries one citation each. These are HF 4301's six as production
  // serves them: five resolve to laws.0.1.0, one to laws.0.2.0.
  const hf4301: Citation[] = [0, 1, 2, 3, 4].map((i) => ({
    id: `laws.0.1.0-${i}`,
    label: 'HF 4301, Section 1.',
    excerpt: `point ${i}`,
    url: 'https://www.revisor.mn.gov/bills/94/2026/0/HF/4301/',
    sectionId: 'laws.0.1.0',
    sectionTopic: 'Drinking water regionalization planning and assistance grants',
  }));
  hf4301.push({
    id: 'laws.0.2.0-5',
    label: 'HF 4301, Sec. 2.',
    excerpt: 'appropriation',
    url: 'https://www.revisor.mn.gov/bills/94/2026/0/HF/4301/',
    sectionId: 'laws.0.2.0',
    sectionTopic: 'Appropriation',
  });

  it('keeps one chip per destination section, in served order', () => {
    const kept = citationsBySection(hf4301);
    expect(kept.map((c) => c.sectionId)).toEqual(['laws.0.1.0', 'laws.0.2.0']);
    // The first occurrence wins, so the excerpt and id belong to a real citation.
    expect(kept[0].id).toBe('laws.0.1.0-0');
  });

  it('never removes a chip a reader could have told apart', () => {
    // The invariant that makes this safe on all 10,463 production bills that carry
    // chips: whatever is dropped had an identical-reading twin that stayed, so the
    // set of chip texts on screen cannot shrink.
    const chipTexts = (cs: Citation[]) =>
      new Set(cs.map((c) => citationChipLabel(c.label, c.sectionTopic)));
    expect(chipTexts(citationsBySection(hf4301))).toEqual(chipTexts(hf4301));
  });

  it('does not merge two different sections that share a label', () => {
    // A section number repeats across a bill's articles, so the label alone is not
    // the identity — the destination is part of it.
    const kept = citationsBySection([
      { ...hf4301[0], id: 'a', sectionId: 'laws.0.1.0' },
      { ...hf4301[0], id: 'b', sectionId: 'laws.1.1.0' },
    ]);
    expect(kept.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('does not merge two sections that share an id but read differently', () => {
    // section_id_text is NOT unique within a version — laws.0.1.0 is the id the
    // Revisor hands every section outside an article (#763/#854) — so the id alone
    // is not the identity either. Two chips a reader can tell apart both stay.
    const kept = citationsBySection([
      { ...hf4301[0], id: 'a', label: 'Sec. 1 · Eligible recipients' },
      { ...hf4301[0], id: 'b', label: 'Sec. 2 · Appropriation' },
    ]);
    expect(kept.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('separates two same-reading chips that #854 pinned to different sections', () => {
    // The case the shared id cannot express and the label cannot either: one id
    // covering several sections whose headings match, so both chips read the same.
    // sectionOrder is what tells them apart, and the key uses the anchor built from
    // it — without that these two would collapse and one section become unreachable.
    const kept = citationsBySection([
      { ...hf4301[0], id: 'a', sectionOrder: 1 },
      { ...hf4301[0], id: 'b', sectionOrder: 46 },
    ]);
    expect(kept.map((c) => c.id)).toEqual(['a', 'b']);
    // And the same section cited by two key points is still one chip.
    expect(
      citationsBySection([
        { ...hf4301[0], id: 'a', sectionOrder: 1 },
        { ...hf4301[1], id: 'b', sectionOrder: 1 },
      ]).map((c) => c.id),
    ).toEqual(['a']);
  });

  it('falls back to the rendered label when the backend resolved no section', () => {
    // An unresolved citation renders a disabled chip, so two of them are only
    // duplicates when they read identically.
    const kept = citationsBySection([
      { ...hf4301[0], id: 'a', sectionId: '', label: 'HF 4301, Sec. 3. TRANSFER.' },
      { ...hf4301[0], id: 'b', sectionId: '', label: 'HF 4301, Sec. 3. TRANSFER.' },
      { ...hf4301[0], id: 'c', sectionId: '', label: 'HF 4301, Sec. 9. REPEALER.' },
    ]);
    expect(kept.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('leaves a bill whose citations are all distinct untouched, and handles none', () => {
    const distinct = [hf4301[0], hf4301[5]];
    expect(citationsBySection(distinct)).toHaveLength(2);
    expect(citationsBySection([])).toEqual([]);
  });
});

// `completeStatusText` applies the same no-dangling-preposition rule to the bill's
// CURRENT STATUS, which the timeline has had since #599 and the "Latest action"
// line never did (#812). Every string below is a real production status, and the
// committee beside it is the one stored on that bill's matching action row.
describe('completeStatusText finishes a status that stops on a preposition', () => {
  const action = (action_text: string, committee_name: string) => [
    { action_text: 'Introduction and first reading', committee_name: null },
    { action_text, committee_name },
  ];

  it('names the committee on the two most common statuses (5,680 production bills)', () => {
    expect(
      completeStatusText(
        'Introduction and first reading, referred to',
        action(
          'Introduction and first reading, referred to',
          'Environment and Natural Resources Finance and Policy',
        ),
      ),
    ).toBe(
      'Introduction and first reading, referred to Environment and Natural Resources Finance and Policy',
    );
    expect(completeStatusText('Referred to', action('Referred to', 'Capital Investment'))).toBe(
      'Referred to Capital Investment',
    );
  });

  it('handles the re-refer and returned-to wordings too', () => {
    expect(
      completeStatusText(
        'Comm report: To pass as amended and re-refer to',
        action('Comm report: To pass as amended and re-refer to', 'Health and Human Services'),
      ),
    ).toBe('Comm report: To pass as amended and re-refer to Health and Human Services');
    expect(
      completeStatusText(
        'House rule 4.20, interim disposition of bills, returned to',
        action('House rule 4.20, interim disposition of bills, returned to', 'Education Policy'),
      ),
    ).toBe('House rule 4.20, interim disposition of bills, returned to Education Policy');
  });

  it('matches the action by its text, not by position', () => {
    expect(
      completeStatusText('Referred to', [
        { action_text: 'Referred to', committee_name: 'Taxes' },
        { action_text: 'Author added', committee_name: null },
      ]),
    ).toBe('Referred to Taxes');
  });

  it('drops the unfinished clause rather than inventing a committee', () => {
    // No matching action, an action with no committee, and no actions at all —
    // all three lose the clause that was waiting on a value, and none of them
    // ends on a preposition.
    expect(completeStatusText('Introduction and first reading, referred to', [])).toBe(
      'Introduction and first reading',
    );
    expect(
      completeStatusText('Introduction and first reading, referred to', [
        { action_text: 'Introduction and first reading, referred to', committee_name: '' },
      ]),
    ).toBe('Introduction and first reading');
    expect(completeStatusText('Referred to', undefined)).toBe('Referred');
  });

  it('leaves a status that already reads as a finished sentence alone', () => {
    for (const status of [
      'Chapter number',
      'Passed the House',
      'Introduction and first reading, referred to Taxes',
      'Governor vetoed',
      'Effective date',
    ]) {
      expect(completeStatusText(status, [])).toBe(status);
    }
  });

  it('returns nothing for a missing status, so the caller can omit the line', () => {
    expect(completeStatusText(null, [])).toBeUndefined();
    expect(completeStatusText('   ', [])).toBeUndefined();
  });
});
