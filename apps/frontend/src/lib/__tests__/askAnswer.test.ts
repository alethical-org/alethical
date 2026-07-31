// Display logic for the chip-reached Ask answer page (grounded-ask-spec §9.5).
//
// Every one of these re-shapes a generated answer without re-wording it
// (.claude/rules/grounded-answers.md rules 3 and 4), so the cases that matter
// most are the ones that prove the model's own words survive: the lead sentence
// is never rewritten, a list of sentences is never re-flowed into a grid, and a
// quoted passage passes through verbatim.
//
// The `bill_text` inputs below are the real production answer and citations for
// https://www.alethical.com/ask?q=HF+719%3A+Which+cities+and+counties+get+named+infrastructure+grants%3F
// captured 2026-07-31.

import { describe, expect, it } from 'vitest';

import {
  alphabeticalIndex,
  citedSections,
  followUpPrompts,
  parseAnswerBlocks,
  partialCoverageNote,
  passageTarget,
} from '../askAnswer';
import { AskCitation } from '../../data/types';

const HF719_ANSWER = [
  'The cities and counties that receive named infrastructure grants in HF 719 include:',
  '',
  '1. Silver Lake',
  '2. South Haven',
  '3. Spicer',
  '4. St. Francis',
  '5. International Falls',
  '6. Jordan',
  '7. Kandiyohi',
  '8. Keewatin',
  '9. Lafayette',
  '10. Lake Benton',
  '11. Freeport',
  '12. Fridley',
  '13. Independence',
  '14. Karlstad',
  '15. Cohasset',
  '16. Cold Spring',
  '17. Cook',
  '18. Crystal',
  '19. Dayton',
  '',
  'These grants cover various infrastructure projects, including water and sewer improvements, public facilities, and transportation enhancements.',
].join('\n');

const HF719_CITATIONS: AskCitation[] = [
  {
    label: 'HF 719, ARTICLE 1, Sec. 24. PUBLIC FACILITIES AUTHORITY',
    billId: '94-2025-HF719',
    excerpt:
      'For a grant to the city of Silver Lake to predesign, design, engineer, construct, and equip stormwater, wastewater, and drinking water infrastructure. This appropriation includes money for improvements to or replacement…',
    url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/2/',
    sectionId: 'laws.1.24.0',
    sectionOrder: 24,
    sectionTopic: 'Public facilities authority',
  },
  {
    label: 'HF 719, ARTICLE 1, Sec. 24. PUBLIC FACILITIES AUTHORITY',
    billId: '94-2025-HF719',
    excerpt:
      'For a grant to the city of International Falls to construct, renovate, furnish, and equip improvements and betterments of a capital nature at the existing water treatment facility…',
    url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/2/',
    sectionId: 'laws.1.24.0',
    sectionOrder: 24,
    sectionTopic: 'Public facilities authority',
  },
  {
    label: 'HF 719, ARTICLE 1, Sec. 16. TRANSPORTATION',
    billId: '94-2025-HF719',
    excerpt:
      'Freeport; I-94 Interchange | 6,000,000 For a grant to the city of Freeport for reconstruction of the local road portions of the intersection of marked Interstate Highway 94 and 1st Avenue…',
    url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/2/',
    sectionId: 'laws.1.16.0',
    sectionOrder: 16,
    sectionTopic: 'Transportation',
  },
  {
    label: 'HF 719, ARTICLE 1, Sec. 24. PUBLIC FACILITIES AUTHORITY',
    billId: '94-2025-HF719',
    excerpt:
      "Cohasset; Public Infrastructure | 3,000,000 For a grant to the city of Cohasset to design, construct, reconstruct, and equip the rehabilitation of the city's water tower…",
    url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/2/',
    sectionId: 'laws.1.24.0',
    sectionOrder: 24,
    sectionTopic: 'Public facilities authority',
  },
];

describe('parseAnswerBlocks keeps the model wording and only reads its shape', () => {
  it('splits the production HF 719 answer into lead, list, closing', () => {
    const blocks = parseAnswerBlocks(HF719_ANSWER);
    expect(blocks).toHaveLength(3);
    // The lead sentence is the model's own, verbatim — NOT the mockup's rewrite
    // ("Nineteen cities are named for infrastructure grants:"). §9.5 decision 5.
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      text: 'The cities and counties that receive named infrastructure grants in HF 719 include:',
    });
    expect(blocks[1].kind).toBe('list');
    expect(blocks[1].kind === 'list' && blocks[1].items).toHaveLength(19);
    expect(blocks[1].kind === 'list' && blocks[1].items[0]).toBe('Silver Lake');
    expect(blocks[2].kind).toBe('paragraph');
  });

  it('joins a hard-wrapped paragraph instead of breaking it in two', () => {
    expect(parseAnswerBlocks('The bill appropriates money\nfor two water projects.')).toEqual([
      { kind: 'paragraph', text: 'The bill appropriates money for two water projects.' },
    ]);
  });

  it('reads dash and bullet markers as a list too, and drops the marker', () => {
    expect(parseAnswerBlocks('- Cook\n* Crystal\n• Dayton')).toEqual([
      { kind: 'list', items: ['Cook', 'Crystal', 'Dayton'] },
    ]);
  });

  it('strips the markdown emphasis the synthesis emits', () => {
    expect(parseAnswerBlocks('It **doubles** the __grant__ cap.')).toEqual([
      { kind: 'paragraph', text: 'It doubles the grant cap.' },
    ]);
  });

  it('returns nothing for an empty answer rather than a blank block', () => {
    expect(parseAnswerBlocks('')).toEqual([]);
    expect(parseAnswerBlocks('\n\n  \n')).toEqual([]);
  });
});

describe('alphabeticalIndex only re-orders short names', () => {
  it('sorts the 19 HF 719 city names A to Z', () => {
    const blocks = parseAnswerBlocks(HF719_ANSWER);
    const items = blocks[1].kind === 'list' ? blocks[1].items : [];
    const index = alphabeticalIndex(items);
    expect(index).not.toBeNull();
    expect(index?.[0]).toBe('Cohasset');
    expect(index?.[index.length - 1]).toBe('St. Francis');
    // Same set, only re-ordered — nothing added, nothing dropped.
    expect([...(index ?? [])].sort()).toEqual([...items].sort());
  });

  it('keeps a name carrying an abbreviation, which is not a sentence', () => {
    // "St. Francis" is one of the nineteen real HF 719 entries. An earlier rule
    // treated any period-plus-space as a sentence break and killed the whole index.
    const items = [
      'St. Francis',
      'St. Paul',
      'Mt. Iron',
      'Cook',
      'Crystal',
      'Dayton',
      'Freeport',
      'Fridley',
    ];
    expect(alphabeticalIndex(items)?.[0]).toBe('Cook');
  });

  it('keeps a list of real sentences in the answer’s own order', () => {
    // Every entry here is inside the 32-character cap, so the terminal period is
    // the only thing standing between these sentences and a scanning grid.
    const sentences = [
      'It funds roads.',
      'It funds water systems.',
      'It funds parks.',
      'It funds libraries.',
      'It funds schools.',
      'It funds prisons.',
      'It funds clinics.',
      'It funds trails.',
    ];
    expect(sentences.every((s) => s.length <= 32)).toBe(true);
    expect(alphabeticalIndex(sentences)).toBeNull();
  });

  it('keeps a short list in the answer’s own order', () => {
    expect(alphabeticalIndex(['Cook', 'Crystal', 'Dayton'])).toBeNull();
  });

  it('keeps a list with one long entry in the answer’s own order', () => {
    const items = [
      'Cook',
      'Crystal',
      'Dayton',
      'Freeport',
      'Fridley',
      'Jordan',
      'Karlstad',
      'The Metropolitan Council regional parks system',
    ];
    expect(alphabeticalIndex(items)).toBeNull();
  });

  it('sorts the same way every time, so a shared ?q= link re-renders identically', () => {
    const items = [
      'Cook',
      'cook',
      'Crystal',
      'Dayton',
      'Freeport',
      'Fridley',
      'Jordan',
      'Karlstad',
    ];
    expect(alphabeticalIndex(items)).toEqual(alphabeticalIndex([...items].reverse()));
  });
});

describe('citedSections draws one card per section and keeps every passage', () => {
  it('puts the three HF 719 Sec. 24 passages under one label, all three kept', () => {
    const sections = citedSections(HF719_CITATIONS);
    // Two cards, because the four passages come from two sections.
    expect(sections).toHaveLength(2);
    expect(sections[0].sectionId).toBe('laws.1.24.0');
    expect(sections[0].chipLabel).toBe('Art. 1, Sec. 24 · Public facilities authority');
    // All three of that section's quotes survive, verbatim, in retrieval order.
    // They are three DIFFERENT grants (Silver Lake, International Falls, Cohasset),
    // so keeping only the best-matching one would drop two thirds of the evidence
    // while the answer kept its claim (#868).
    expect(sections[0].excerpts).toEqual([
      HF719_CITATIONS[0].excerpt,
      HF719_CITATIONS[1].excerpt,
      HF719_CITATIONS[3].excerpt,
    ]);
    expect(sections[1].sectionId).toBe('laws.1.16.0');
    expect(sections[1].excerpts).toEqual([HF719_CITATIONS[2].excerpt]);
    // Nothing is lost across the whole rail: four passages in, four passages out.
    expect(sections.flatMap((s) => s.excerpts)).toHaveLength(HF719_CITATIONS.length);
  });

  it('keeps two sections apart when they share an id', () => {
    // laws.0.1.0 is what the Revisor hands every section outside an article, so one
    // id can name several sections (#854). The POSITION is what separates them —
    // group on the id alone and two unrelated sections merge into one card.
    const shared: AskCitation[] = [
      { ...HF719_CITATIONS[0], sectionId: 'laws.0.1.0', sectionOrder: 1 },
      { ...HF719_CITATIONS[2], sectionId: 'laws.0.1.0', sectionOrder: 17 },
    ];
    const sections = citedSections(shared);
    expect(sections).toHaveLength(2);
    expect(sections.map((s) => s.sectionOrder)).toEqual([1, 17]);
  });

  it('still groups by label when no section id came through', () => {
    const noIds = HF719_CITATIONS.map((c) => ({ ...c, sectionId: '', sectionOrder: null }));
    const sections = citedSections(noIds);
    expect(sections).toHaveLength(2);
    expect(sections[0].excerpts).toHaveLength(3);
    // With no id the card has nothing to anchor to and falls back to the URL.
    expect(sections[0].sectionId).toBe('');
    expect(sections[0].url).toBe(HF719_CITATIONS[0].url);
  });
});

describe('passageTarget only links to a passage it can actually reach', () => {
  it('links into our own Bill Text tab when the anchor resolves there', () => {
    expect(passageTarget('laws.1.24.0', true, true)).toBe('passage');
  });

  it('falls back to the official source when our text has no such section', () => {
    // Retrieval may have run on a version a later re-read of the bill has moved on
    // from, so the quoted passage is not in the text we would open.
    expect(passageTarget('laws.9.9.9', false, true)).toBe('official');
  });

  it('falls back to the official source when the citation names no section', () => {
    expect(passageTarget('', true, true)).toBe('official');
    expect(passageTarget('', false, false)).toBe('official');
  });

  it('does not guess while the bill text is still loading', () => {
    expect(passageTarget('laws.1.24.0', false, false)).toBe('bill-text');
  });
});

describe('partialCoverageNote warns only when the answer really is partial', () => {
  it('renders the served sentence verbatim, whatever the counts say', () => {
    // #868 owns the wording, so the page moves it rather than rewriting it — and it
    // renders even on a complete read, because reading all 102 passages of HF 719
    // still produced a list of ~30 of the ~98 cities the bill names.
    const note =
      'We searched all 102 passages of this bill’s text. A list like this can still be shortened, so read the bill’s own text if you need every item.';
    expect(
      partialCoverageNote({ passagesSearched: 102, passagesTotal: 102, complete: true, note }),
    ).toBe(note);
  });

  it('says nothing when the served sentence is deliberately absent', () => {
    // #868 nulls `note` on a question that is not list-shaped, even when coverage is
    // partial: a caveat where it does not apply teaches readers to skip the one that
    // does. The fallback must NOT override that by deriving a sentence from #868's
    // own counts.
    expect(
      partialCoverageNote({
        passagesSearched: 4,
        passagesTotal: 102,
        complete: false,
        note: null,
      }),
    ).toBeNull();
  });

  it('falls back to the numbers only for the pre-#868 payload', () => {
    // 4 of 102 is the real production ratio for HF 719 before #868 widened the read.
    expect(partialCoverageNote({ used: 4, total: 102 })).toBe(
      'This answer draws on 4 of the 102 passages in this bill, so there may be more it doesn’t cover.',
    );
  });

  it('says nothing when the answer covered the whole bill', () => {
    // A caveat on every answer teaches people to ignore it.
    expect(partialCoverageNote({ used: 4, total: 4 })).toBeNull();
    expect(partialCoverageNote({ used: 6, total: 4 })).toBeNull();
  });

  it('says nothing when the backend served no coverage', () => {
    // So this ships safely before or after either backend shape, not by guessing.
    expect(partialCoverageNote(undefined)).toBeNull();
    expect(partialCoverageNote({})).toBeNull();
  });

  it('says nothing on a zero, rather than "0 of 102"', () => {
    expect(partialCoverageNote({ used: 0, total: 102 })).toBeNull();
  });
});

describe('followUpPrompts offers the bill’s other questions', () => {
  const prompts = [
    'Which state agencies receive the largest funding amounts in this bill?',
    'Which cities and counties get named infrastructure grants?',
    'What happens to unspent money after a funded project is completed?',
    'What does the bill say about water infrastructure and drinking water grants?',
  ];

  it('drops the one just asked and offers the other three', () => {
    // The reader arrives with the chip's bill-scoped form, so the match has to
    // look past the "HF 719: " prefix scopedChipQuery adds.
    const chips = followUpPrompts(
      prompts,
      'HF 719: Which cities and counties get named infrastructure grants?',
    );
    expect(chips).toEqual([prompts[0], prompts[2], prompts[3]]);
  });

  it('matches past casing, spacing and the unscoped form too', () => {
    expect(
      followUpPrompts(prompts, '  which CITIES and counties   get named infrastructure grants? '),
    ).toEqual([prompts[0], prompts[2], prompts[3]]);
  });

  it('offers at most three, so a bill with more prompts does not sprawl', () => {
    expect(followUpPrompts([...prompts, 'And a fifth question?'], 'unrelated')).toHaveLength(3);
  });

  it('falls back to the safe generic chips for a bill with no stored prompts', () => {
    expect(followUpPrompts(undefined, 'anything')).toEqual([
      'What does this bill do?',
      'When does it take effect?',
      'Who does it affect?',
    ]);
    expect(followUpPrompts([], 'anything')).toHaveLength(3);
    // A bill whose only prompt is the one just asked has none left to offer.
    expect(followUpPrompts([prompts[1]], prompts[1])).toHaveLength(3);
  });
});
