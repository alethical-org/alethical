// Bill Text tab parsing — the five properties #740 established, plus the four
// bugs that have since been found in shipped code.
//
// #740 proved these by replaying 1,881 production sections through a throwaway
// script. This is that proof, committed: the same assertions over a fixture of
// real sections (fixtures/bill-text-sections.json — provenance in
// fixtures/README.md). The corpus-wide replay stays a manual check for
// corpus-wide changes, because it needs live production data and so cannot run
// in CI; see docs/product-onboarding/bill-text-tab-spec.md § "Verification" →
// "The corpus replay, which the tests do not replace".
//
// Each property is its own named test so a failure says which rule broke.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  asHeadingCaption,
  changeKindsPresent,
  cleanSectionText,
  condenseStatuteRef,
  parseChangeRuns,
  parseSectionBody,
  plainSectionText,
  sectionIndexLabel,
  splitSectionLabel,
} from '../billText';
import sections from './fixtures/bill-text-sections.json';

type Section = (typeof sections)[number];

// Every marker word, in the exact spellings the Revisor's flattened HTML leaves
// behind. Nothing matching this may survive into a rendered string.
const MARKER_WORDS = /(?:deleted|new) text (?:begin|end)/i;

/**
 * The strings FullTextTab.tsx actually paints, for one section.
 *
 * This mirrors the component (src/components/billDetail/FullTextTab.tsx): the
 * heading is `splitSectionLabel().title` falling back to
 * `asHeadingCaption(body.caption)`; the lead-in and every block go through
 * `parseChangeRuns`; the index row is `sectionIndexLabel`. Asserting anywhere
 * else would prove the wrong thing — `parseSectionBody().blocks[].text` is
 * deliberately raw, because the component strips it downstream.
 */
function renderedStrings(section: Section): string[] {
  const text = section.text;
  const { number, title } = splitSectionLabel(section.heading);
  const body = parseSectionBody(text, { hasTitle: !!title });
  const heading = title ?? asHeadingCaption(body.caption);
  const runs = [
    ...(body.leadIn ? parseChangeRuns(body.leadIn) : []),
    ...body.blocks.flatMap((block) => parseChangeRuns(block.text)),
  ];
  return [
    number,
    heading,
    sectionIndexLabel(section.heading, text),
    ...runs.map((run) => run.text),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

/**
 * A body paragraph as the reader finally sees it: through `parseSectionBody`,
 * which tidies the spacing, then through `parseChangeRuns`, which the component
 * paints. `plainSectionText` is deliberately NOT this path — it only tidies
 * where a marker pair was removed, because its job is classification.
 */
function renderedBody(text: string): string {
  return parseSectionBody(text, { hasTitle: true })
    .blocks.flatMap((block) => parseChangeRuns(block.text))
    .map((run) => run.text)
    .join('');
}

/** The index row for a section, as the section list renders it. */
function indexLabel(section: Section): string {
  return sectionIndexLabel(section.heading, section.text);
}

function withId(section: Section): string {
  return `${section.billId}/${section.sectionId}`;
}

it('the fixture is real section text from several bills', () => {
  expect(sections.length).toBeGreaterThan(40);
  expect(new Set(sections.map((s) => s.billId)).size).toBeGreaterThan(3);
  // Amending bills are the whole point; a fixture with no markers proves nothing.
  expect(sections.filter((s) => MARKER_WORDS.test(s.text)).length).toBeGreaterThan(5);
});

describe('property 1: no marker word ever reaches the screen', () => {
  it('holds for every rendered string of every fixture section', () => {
    const leaked: string[] = [];
    for (const section of sections) {
      for (const value of renderedStrings(section)) {
        if (MARKER_WORDS.test(value)) leaked.push(`${withId(section)}: ${value.slice(0, 120)}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('holds when a marker pair is left unclosed', () => {
    const runs = parseChangeRuns('Fees are deleted text begin waived for the first year.');
    expect(runs.map((r) => r.text).join('')).not.toMatch(MARKER_WORDS);
    // An unclosed "begin" must not strike the rest of the section either.
    expect(runs.every((r) => r.kind === 'plain')).toBe(true);
  });

  it('holds when an end marker appears with no begin', () => {
    const runs = parseChangeRuns('Fees are waived deleted text end for the first year.');
    expect(runs.map((r) => r.text).join('')).not.toMatch(MARKER_WORDS);
    expect(runs.every((r) => r.kind === 'plain')).toBe(true);
  });

  it('holds when a deleted begin is closed by a new end', () => {
    // The backreference in MARKER_PAIR must stop these pairing up. Either way,
    // no marker word may survive and nothing may be struck by accident.
    const runs = parseChangeRuns('Fees are deleted text begin waived new text end for a year.');
    expect(runs.map((r) => r.text).join('')).not.toMatch(MARKER_WORDS);
    expect(runs.every((r) => r.kind === 'plain')).toBe(true);
  });

  it('holds for the label and heading paths, not just the body', () => {
    expect(splitSectionLabel('Sec. 4. deleted text begin OLD NAME deleted text end.')).toEqual({
      number: 'SEC. 4',
      title: expect.not.stringMatching(MARKER_WORDS),
    });
    expect(condenseStatuteRef('deleted text begin Minnesota Statutes 2024, section 62A.011')).toBe(
      '§ 62A.011',
    );
  });
});

describe('property 2: no index row is blank where a caption or citation exists', () => {
  it('holds for every fixture section', () => {
    const blankWithSource: string[] = [];
    for (const section of sections) {
      if (indexLabel(section)) continue;
      const { title } = splitSectionLabel(section.heading);
      const body = parseSectionBody(section.text, { hasTitle: !!title });
      const hasCaption = !!(
        title ??
        body.caption ??
        body.blocks.find((b) => b.kind === 'subheading')
      );
      const hasCitation = !!condenseStatuteRef(body.leadIn ?? body.blocks[0]?.text ?? '');
      if (hasCaption || hasCitation) blankWithSource.push(withId(section));
    }
    expect(blankWithSource).toEqual([]);
  });

  it('falls back to a condensed citation when the source names no caption', () => {
    const text =
      'Minnesota Statutes 2024, section 115A.554, subdivision 2, is amended to read:\n\n' +
      '(a) A sanitary district may exercise the powers of a county.';
    expect(sectionIndexLabel('Sec. 12.', text)).toBe('§ 115A.554, subd. 2');
  });
});

describe('property 3: a caption used as a heading loses its period and keeps its case', () => {
  it('holds for every heading the fixture produces', () => {
    for (const section of sections) {
      const { title } = splitSectionLabel(section.heading);
      const body = parseSectionBody(section.text, { hasTitle: !!title });
      for (const heading of [title, asHeadingCaption(body.caption), indexLabel(section)]) {
        if (!heading) continue;
        // An initialism ("U.S.C.") owns its final period; nothing else may keep one.
        if (/(?:\b[A-Za-z]\.){2,}$/.test(heading)) continue;
        expect(heading, withId(section)).not.toMatch(/\.$/);
      }
    }
  });

  it('changes nothing but the trailing period', () => {
    for (const section of sections) {
      const { caption } = parseSectionBody(section.text, { hasTitle: false });
      if (!caption) continue;
      const heading = asHeadingCaption(caption);
      if (!heading) continue;
      // Same characters, same capitals — only a trailing "." may be gone.
      expect(caption.trim()).toMatch(
        new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.?$`),
      );
    }
  });

  it('leaves acronyms alone', () => {
    expect(asHeadingCaption('DNR land sales.')).toBe('DNR land sales');
    expect(asHeadingCaption('CHAMPUS coverage.')).toBe('CHAMPUS coverage');
    expect(asHeadingCaption('REPEALER.')).toBe('REPEALER');
    // An initialism's own period stays put.
    expect(asHeadingCaption('Compliance with 42 U.S.C.')).toBe('Compliance with 42 U.S.C.');
  });

  it('returns null rather than an empty heading', () => {
    expect(asHeadingCaption('.')).toBeNull();
    expect(asHeadingCaption('   ')).toBeNull();
    expect(asHeadingCaption(null)).toBeNull();
    expect(asHeadingCaption(undefined)).toBeNull();
  });
});

describe('property 4: no two index rows within one article group read alike', () => {
  it('holds for every article group in the fixture', () => {
    const groups = new Map<string, Section[]>();
    for (const section of sections) {
      const key = `${section.billId}|${section.articleHeading ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), section]);
    }
    for (const [key, group] of groups) {
      const labels = group.map(indexLabel).filter(Boolean);
      expect(new Set(labels).size, `${key} has repeated index rows`).toBe(labels.length);
    }
  });

  it('keeps the subdivision that is the only difference between two sections', () => {
    // HF 2484, article "APPROPRIATION MODIFICATIONS", sections 2 and 3: same
    // chapter, article and section of the same session law. Drop the
    // subdivision and both rows read "Laws 2023, ch. 71, art. 1, § 10".
    const nine = 'Laws 2023, chapter 71, article 1, section 10, subdivision 9, is amended to read:';
    const ten = 'Laws 2023, chapter 71, article 1, section 10, subdivision 10, is amended to read:';
    expect(condenseStatuteRef(nine)).toBe('Laws 2023, ch. 71, art. 1, § 10, subd. 9');
    expect(condenseStatuteRef(ten)).toBe('Laws 2023, ch. 71, art. 1, § 10, subd. 10');
    expect(condenseStatuteRef(nine)).not.toBe(condenseStatuteRef(ten));
  });

  it('does not mistake a subdivision named later in the body for part of the citation', () => {
    const text =
      'Minnesota Statutes 2024, section 115A.554, is amended to read:\n\n' +
      'A district may act under section 400.08, subdivision 4.';
    expect(condenseStatuteRef(text)).toBe('§ 115A.554');
  });
});

describe('property 5: no index row is a truncated statute sentence', () => {
  it('holds for every fixture section', () => {
    for (const section of sections) {
      const label = indexLabel(section);
      if (!label) continue;
      expect(label, withId(section)).not.toMatch(/\b(?:is|are)\s+(?:amended|repealed)\b/i);
      expect(label, withId(section)).not.toMatch(/to read:?$/i);
      expect(label, withId(section)).not.toMatch(/^Minnesota (?:Statutes|Rules)\b/);
      expect(label.length, withId(section)).toBeLessThanOrEqual(120);
    }
  });

  it('condenses a session-law citation rather than truncating it', () => {
    for (const section of sections) {
      const label = indexLabel(section);
      if (!label.startsWith('Laws ')) continue;
      expect(label, withId(section)).toMatch(
        /^Laws \d{4}(?:, ch\. \d+)?(?:, art\. \d+)?(?:, § \d+[a-z]?)?(?:, subd\. \d+[a-z]?)?$/,
      );
    }
  });

  it('condenses each citation form to its short reference', () => {
    expect(condenseStatuteRef('Minnesota Statutes 2024, section 115A.554, is amended')).toBe(
      '§ 115A.554',
    );
    expect(condenseStatuteRef('[62A.011] HEALTH PLAN DEFINITIONS.')).toBe('§ 62A.011');
    expect(condenseStatuteRef('Minnesota Rules, part 7000.0100, is amended to read:')).toBe(
      'Rules 7000.0100',
    );
    expect(condenseStatuteRef('This section is effective the day following final enactment.')).toBe(
      null,
    );
  });
});

describe('regressions found in shipped code', () => {
  it('keeps the space before a bare decimal (#756)', () => {
    // Live on production education funding bills: the spacing cleaner glued the
    // number onto the word before it ("counted as.55 pupil unit").
    for (const text of [
      'the student is counted as .55 pupil unit for the year',
      'shall include, .22 caliber tube feeders',
      'a tax of $ .0025 per gallon',
      'up to .75 percent may be used by the department',
    ]) {
      expect(cleanSectionText(text)).toBe(text);
      expect(renderedBody(text)).toBe(text);
    }
  });

  it('still tidies punctuation after a closing bracket (#755)', () => {
    // The stricter guard tried for #756 — also requiring a letter or digit
    // before the gap — broke this in 195 sampled sections.
    const cases: Array<[string, string]> = [
      ['as provided in paragraph (a) .', 'as provided in paragraph (a).'],
      ['under clause (3) , the commissioner', 'under clause (3), the commissioner'],
      ['firefighters ; emergency personnel', 'firefighters; emergency personnel'],
      ['the commissioner shall report annually .', 'the commissioner shall report annually.'],
    ];
    for (const [input, expected] of cases) {
      expect(cleanSectionText(input)).toBe(expected);
      expect(renderedBody(input)).toBe(expected);
    }
  });

  it('closes the stray space where a marker pair is removed', () => {
    // Replacing a pair with the run it wrapped joined two spaces, which left
    // "Literacy  incentive aid" in 22 of 2,897 sampled index rows (SF 2255 § 10).
    expect(plainSectionText('Literacy deleted text begin incentivedeleted text end aid.')).toBe(
      'Literacy incentive aid.',
    );
    for (const section of sections) {
      expect(indexLabel(section), withId(section)).not.toMatch(/[ \t]{2,}/);
    }
  });

  it('never lets a struck caption become the section title', () => {
    // Shown as a title, a caption the Legislature is deleting would read as
    // current law. It stays in the body so its strike-through renders.
    const text =
      'deleted text begin Board deleted text end Grants.\n\n' +
      '(a) The commissioner shall award grants.';
    const body = parseSectionBody(text, { hasTitle: false });
    expect(body.caption).toBeNull();
    expect(body.blocks[0].text).toContain('deleted text begin');
    // ...and the run it produces is marked as removed, not printed as language.
    expect(parseChangeRuns(body.blocks[0].text).some((r) => r.kind === 'removed')).toBe(true);
  });

  it('promotes an unmarked caption as the title', () => {
    const text = 'Health plan.\n\n(a) A health plan means a policy of accident coverage.';
    const body = parseSectionBody(text, { hasTitle: false });
    expect(body.caption).toBe('Health plan.');
    expect(asHeadingCaption(body.caption)).toBe('Health plan');
  });

  it('uses no regex lookbehind anywhere in the pure text helpers', () => {
    // Hermes, the engine the native builds run on, does not reliably support it.
    for (const file of ['billText.ts', 'billDetail.ts']) {
      const here = dirname(fileURLToPath(import.meta.url));
      const source = readFileSync(join(here, '..', file), 'utf8');
      expect(source, file).not.toMatch(/\(\?<[=!]/);
    }
  });
});

describe('supporting helpers', () => {
  it('splits a stored heading into its number and title', () => {
    expect(splitSectionLabel('Sec. 16. REPEALER.')).toEqual({
      number: 'SEC. 16',
      title: 'REPEALER',
    });
    expect(splitSectionLabel('Section 1.')).toEqual({ number: 'SEC. 1', title: null });
    expect(splitSectionLabel('Sec. 3a. TRANSFERS.')).toEqual({
      number: 'SEC. 3A',
      title: 'TRANSFERS',
    });
    expect(splitSectionLabel(null)).toEqual({ number: null, title: null });
  });

  it('marks a deleted run as removed and a new run as added', () => {
    expect(parseChangeRuns('Fees deleted text begin of $75 deleted text end apply.')).toEqual([
      { kind: 'plain', text: 'Fees ' },
      { kind: 'removed', text: 'of $75' },
      { kind: 'plain', text: ' apply.' },
    ]);
    // Ingestion currently strips the "new text" pair before it reaches us
    // (#741), so no fixture section carries one — but the parser handles it and
    // must keep doing so once ingestion stops stripping it.
    expect(parseChangeRuns('Fees new text begin of $90 new text end apply.')).toEqual([
      { kind: 'plain', text: 'Fees ' },
      { kind: 'added', text: 'of $90' },
      { kind: 'plain', text: ' apply.' },
    ]);
  });

  it('reports only the change kinds a bill actually contains', () => {
    expect(changeKindsPresent(sections.map((s) => s.text)).removed).toBe(true);
    expect(changeKindsPresent(['plain text', null, undefined])).toEqual({
      removed: false,
      added: false,
    });
    expect(changeKindsPresent(['a new text begin b new text end c'])).toEqual({
      removed: false,
      added: true,
    });
  });

  it('indents a roman-numeral clause under the numbered clause above it', () => {
    const text = '(1) a district may:\n\n(i) sell land; and\n\n(ii) lease land.';
    const kinds = parseSectionBody(text, { hasTitle: true }).blocks.map((b) => b.kind);
    expect(kinds).toEqual(['clause', 'subclause', 'subclause']);
  });

  it('leaves a lone "(i)" in a letter sequence as a paragraph', () => {
    const text = '(h) the first case;\n\n(i) the second case;\n\n(j) the third case.';
    const kinds = parseSectionBody(text, { hasTitle: true }).blocks.map((b) => b.kind);
    expect(kinds).toEqual(['para', 'para', 'para']);
  });

  it('does not mistake a short sentence for a headnote', () => {
    const text = 'This section is effective the day following final enactment.';
    expect(parseSectionBody(text, { hasTitle: false }).caption).toBeNull();
  });
});
