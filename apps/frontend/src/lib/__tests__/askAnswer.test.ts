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
  extraPassagesLabel,
  followUpPrompts,
  parseAnswerBlocks,
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
    sectionTopic: 'Public facilities authority',
  },
  {
    label: 'HF 719, ARTICLE 1, Sec. 24. PUBLIC FACILITIES AUTHORITY',
    billId: '94-2025-HF719',
    excerpt:
      'For a grant to the city of International Falls to construct, renovate, furnish, and equip improvements and betterments of a capital nature at the existing water treatment facility…',
    url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/2/',
    sectionId: 'laws.1.24.0',
    sectionTopic: 'Public facilities authority',
  },
  {
    label: 'HF 719, ARTICLE 1, Sec. 16. TRANSPORTATION',
    billId: '94-2025-HF719',
    excerpt:
      'Freeport; I-94 Interchange | 6,000,000 For a grant to the city of Freeport for reconstruction of the local road portions of the intersection of marked Interstate Highway 94 and 1st Avenue…',
    url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/2/',
    sectionId: 'laws.1.16.0',
    sectionTopic: 'Transportation',
  },
  {
    label: 'HF 719, ARTICLE 1, Sec. 24. PUBLIC FACILITIES AUTHORITY',
    billId: '94-2025-HF719',
    excerpt:
      "Cohasset; Public Infrastructure | 3,000,000 For a grant to the city of Cohasset to design, construct, reconstruct, and equip the rehabilitation of the city's water tower…",
    url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/2/',
    sectionId: 'laws.1.24.0',
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

describe('citedSections draws one card per section, not per passage', () => {
  it('collapses the three HF 719 Sec. 24 passages into one card', () => {
    const sections = citedSections(HF719_CITATIONS);
    expect(sections).toHaveLength(2);
    expect(sections[0].sectionId).toBe('laws.1.24.0');
    expect(sections[0].chipLabel).toBe('Art. 1, Sec. 24 · Public facilities authority');
    expect(sections[0].extraPassages).toBe(2);
    // The quoted passage is the best-matching one — the first retrieval returned
    // for that section — and passes through verbatim.
    expect(sections[0].excerpt).toBe(HF719_CITATIONS[0].excerpt);
    expect(sections[1].sectionId).toBe('laws.1.16.0');
    expect(sections[1].extraPassages).toBe(0);
  });

  it('still collapses by section when no section id came through', () => {
    const noIds = HF719_CITATIONS.map((c) => ({ ...c, sectionId: '' }));
    const sections = citedSections(noIds);
    expect(sections).toHaveLength(2);
    expect(sections[0].extraPassages).toBe(2);
    // With no id the card has nothing to anchor to and falls back to the URL.
    expect(sections[0].sectionId).toBe('');
    expect(sections[0].url).toBe(HF719_CITATIONS[0].url);
  });

  it('says once how many further passages a section contributed', () => {
    expect(extraPassagesLabel(0)).toBeNull();
    expect(extraPassagesLabel(1)).toBe('+1 more passage in this section');
    expect(extraPassagesLabel(2)).toBe('+2 more passages in this section');
  });
});

describe('passageTarget only links to a passage it can actually reach', () => {
  const counts = new Map([
    ['laws.1.24.0', 1],
    // Two sections answering to one id — the trap this guard exists for.
    ['laws.0.1.0', 3],
  ]);

  it('links into our own Bill Text tab when exactly one section owns the id', () => {
    expect(passageTarget('laws.1.24.0', counts, true)).toBe('passage');
  });

  it('drops the anchor when several sections share the id', () => {
    // Which section the citation means is unknowable from the id, so the reader
    // goes to the tab rather than confidently onto the wrong paragraph.
    expect(passageTarget('laws.0.1.0', counts, true)).toBe('bill-text');
  });

  it('falls back to the official source when our text has no such section', () => {
    expect(passageTarget('laws.9.9.9', counts, true)).toBe('official');
    expect(passageTarget('', counts, true)).toBe('official');
  });

  it('does not guess while the bill text is still loading', () => {
    expect(passageTarget('laws.1.24.0', new Map(), false)).toBe('bill-text');
    // Still 'official' with no id at all — no amount of loading produces one.
    expect(passageTarget('', new Map(), false)).toBe('official');
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
