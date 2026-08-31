// Section anchors — the HTML id and URL fragment that address ONE section of a
// bill's text.
//
// The rule these enforce: no two sections on a page may answer to the same
// anchor, and no link anyone has already shared may stop working. Those pull in
// opposite directions, which is why `resolveSectionAnchor` exists at all and why
// its fallback is tested as carefully as its exact match.
//
// The shapes below are real. `laws.0.1.0` is the id the Revisor hands every
// section sitting outside an article, so 66 current bill versions repeat it — 30
// sections deep on 94-2025-SF3492 and on 94-2025-HF3284 (#763, #854).

import { describe, expect, it } from 'vitest';

import {
  citationSectionAnchor,
  citationSectionHref,
  parseSectionAnchor,
  resolveSectionAnchor,
  sectionAnchorFromHash,
  sectionAnchorId,
  sectionAnchorValue,
} from '../billText';

// The first five sections of 94-2025-SF3492, where all but one share an id.
const SF3492 = [
  { sectionId: 'laws.0.1.0', sourceOrder: 1 },
  { sectionId: 'laws.0.2.0', sourceOrder: 2 },
  { sectionId: 'laws.0.1.0', sourceOrder: 3 },
  { sectionId: 'laws.0.1.0', sourceOrder: 4 },
  { sectionId: 'laws.0.1.0', sourceOrder: 5 },
];

describe('an anchor names one section and only one', () => {
  it('gives every section of a repeated-id bill a distinct HTML id', () => {
    const ids = SF3492.map(sectionAnchorId);
    expect(new Set(ids).size).toBe(SF3492.length);
    expect(ids[0]).toBe('ft-laws.0.1.0-1');
    expect(ids[2]).toBe('ft-laws.0.1.0-3');
  });

  it('falls back to the id alone when a section has no position', () => {
    // A response cached before the API served source_order. One anchor, the old
    // shape, rather than an anchor ending in "-null".
    expect(sectionAnchorId({ sectionId: 'laws.0.1.0', sourceOrder: null })).toBe('ft-laws.0.1.0');
  });

  it('keeps the fragment value and the HTML id in step', () => {
    const section = { sectionId: 'laws.0.1.0', sourceOrder: 4 };
    expect(sectionAnchorId(section)).toBe(`ft-${sectionAnchorValue(section)}`);
  });
});

describe('parsing an anchor back apart', () => {
  it('splits the position off the end', () => {
    expect(parseSectionAnchor('laws.0.1.0-4')).toEqual({
      sectionId: 'laws.0.1.0',
      sourceOrder: 4,
    });
  });

  it('reads a bare id as an id, not as a broken pair', () => {
    expect(parseSectionAnchor('laws.0.1.0')).toEqual({
      sectionId: 'laws.0.1.0',
      sourceOrder: null,
    });
  });

  it('does not mistake a hyphen inside an id for the separator', () => {
    // No production id carries a hyphen (all 71,150 match laws.<n>.<n>.<n>), but
    // the rule is "a plain number after the LAST hyphen" rather than "any
    // hyphen", so an id that ever did would survive.
    expect(parseSectionAnchor('laws.0.1.0-a')).toEqual({
      sectionId: 'laws.0.1.0-a',
      sourceOrder: null,
    });
    expect(parseSectionAnchor('some-id-7')).toEqual({
      sectionId: 'some-id',
      sourceOrder: 7,
    });
  });

  it('reads both anchor prefixes out of a URL fragment', () => {
    expect(sectionAnchorFromHash('#ft-laws.0.1.0-4')?.sourceOrder).toBe(4);
    expect(sectionAnchorFromHash('#section-laws.0.1.0')?.sourceOrder).toBeNull();
    expect(sectionAnchorFromHash('#ft-laws.0.1.0')?.sectionId).toBe('laws.0.1.0');
    expect(sectionAnchorFromHash('')).toBeNull();
    expect(sectionAnchorFromHash('#votes')).toBeNull();
  });
});

describe('resolving an anchor against the sections on the page', () => {
  it('reaches the exact section a positional anchor names', () => {
    expect(resolveSectionAnchor(SF3492, parseSectionAnchor('laws.0.1.0-4'))).toBe(SF3492[3]);
    expect(resolveSectionAnchor(SF3492, parseSectionAnchor('laws.0.1.0-5'))).toBe(SF3492[4]);
  });

  it('lands an old id-only link on the first section carrying that id', () => {
    // Every `#ft-laws.0.1.0` link shared before #854 keeps working. It cannot say
    // which of the 30 it meant, so it reaches the first — which is what it did
    // before, not a new behaviour.
    expect(resolveSectionAnchor(SF3492, parseSectionAnchor('laws.0.1.0'))).toBe(SF3492[0]);
  });

  it('falls back to the id when the position no longer matches', () => {
    // A positional link made before a re-read of the bill moved the section. The
    // id is still meaningful, so it lands on the first section carrying it rather
    // than on whatever now sits at that position — silently landing on an
    // unrelated section is the failure the id half of the anchor prevents.
    expect(resolveSectionAnchor(SF3492, parseSectionAnchor('laws.0.1.0-99'))).toBe(SF3492[0]);
  });

  it('resolves nothing for an id this version does not carry', () => {
    expect(resolveSectionAnchor(SF3492, parseSectionAnchor('laws.9.9.9-1'))).toBeNull();
    expect(resolveSectionAnchor(SF3492, null)).toBeNull();
  });

  it('is unaffected by repeats on a bill whose ids are all distinct', () => {
    const ordinary = [
      { sectionId: 'laws.0.1.0', sourceOrder: 1 },
      { sectionId: 'laws.0.2.0', sourceOrder: 2 },
    ];
    expect(resolveSectionAnchor(ordinary, parseSectionAnchor('laws.0.2.0-2'))).toBe(ordinary[1]);
    expect(resolveSectionAnchor(ordinary, parseSectionAnchor('laws.0.2.0'))).toBe(ordinary[1]);
  });
});

describe('a citation chip jumps to the section it cites', () => {
  it('carries the position when the API pinned the citation to one section', () => {
    const anchor = citationSectionAnchor({ sectionId: 'laws.0.1.0', sectionOrder: 7 });
    expect(anchor).toBe('laws.0.1.0-7');
    expect(resolveSectionAnchor(SF3492, parseSectionAnchor('laws.0.1.0-3'))).toBe(SF3492[2]);
  });

  it('falls back to the bare id when it did not', () => {
    // Keep the old anchor readable for grouping and existing id-only links. New
    // citation links use citationSectionHref below and refuse this guess.
    for (const sectionOrder of [null, undefined]) {
      expect(citationSectionAnchor({ sectionId: 'laws.0.1.0', sectionOrder })).toBe('laws.0.1.0');
    }
  });

  it('gives a confirmed citation one exact, copyable bill-text address', () => {
    expect(
      citationSectionHref('94-2026-HF4301', {
        sectionId: 'laws.0.1.0',
        sectionOrder: 1,
      }),
    ).toBe('/bills/94-2026-HF4301?tab=text#ft-laws.0.1.0-1');
  });

  it.each([null, undefined, 0, 1.5])(
    'does not link a citation whose section position is not exact (%s)',
    (sectionOrder) => {
      expect(
        citationSectionHref('94-2026-HF4301', {
          sectionId: 'laws.0.1.0',
          sectionOrder,
        }),
      ).toBeNull();
    },
  );

  it('does not link a citation with no section id', () => {
    expect(
      citationSectionHref('94-2026-HF4301', {
        sectionId: '',
        sectionOrder: 1,
      }),
    ).toBeNull();
  });
});
