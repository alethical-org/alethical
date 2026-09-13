/**
 * The words above the donut on both money surfaces, pinned exactly as issue 2182 settled
 * them, and the states each sentence does and does not draw in.
 *
 * The dek matters more than an ordinary caption: since #2182 it is the one place the
 * Itemized and Non-itemized labels are explained, so a change here silently removes what
 * `.claude/rules/grounded-answers.md` rule 12 requires a page carrying 2 money figures to
 * say. `unnamedFigureDraws` is the rule tying the 2 together and is pinned here too.
 */
import { describe, expect, it } from 'vitest';

import {
  dekText,
  moneyDetailsCopy as copy,
  namedMoneyDefinition,
} from '../campaignMoneyDetailsCopy';
import { unnamedFigureDraws } from '../legislatorCampaignMoney';

const SHARES =
  'Shares of the contributions this committee reported, not counting donated goods and ' +
  'services.';
const NAMED_ONLY_SHARES =
  'Shares of the named donations this year, not counting donated goods and services.';
const DEFINITION =
  'The filing names who gave for itemized contributions and not for non-itemized ' +
  'contributions. Minnesota requires naming once a donor’s giving passes $200 for the ' +
  'year, and a committee may name smaller donors.';
const BALLOT_DEFINITION =
  'The filing names who gave for itemized contributions and not for non-itemized ' +
  'contributions. Minnesota requires naming once a donor’s giving passes $500 for the ' +
  'year, the line for a ballot-question committee, and a committee may name smaller ' +
  'donors.';

describe('the heading over the donor chart', () => {
  it('asks the reader’s own question and leaves the kinds to the slices', () => {
    // "by kind of donor" described the picture beside it, and the largest slice on many
    // committees is Non-itemized contributions, which is not a kind of donor at all.
    expect(copy.chartHeading(false)).toBe('Who gave');
    expect(copy.chartHeading(true)).toBe('Who gave (named donations only)');
  });
});

describe('the dek above the donor chart', () => {
  it('prints the settled words when both contribution figures are on the page', () => {
    expect(dekText(copy.chartExplanation(false, true, false))).toBe(`${SHARES} ${DEFINITION}`);
  });

  it('keeps its own form for the named-donations-only state', () => {
    // There is no reported total in that state, so the standard opening clause would be
    // false, and there is no non-itemized figure for the last 2 sentences to define.
    expect(dekText(copy.chartExplanation(true, false, false))).toBe(NAMED_ONLY_SHARES);
  });

  it('drops the last 2 sentences wherever no non-itemized figure draws', () => {
    for (const namedOnly of [false, true]) {
      const dek = dekText(copy.chartExplanation(namedOnly, false, false));
      expect(dek).toBe(namedOnly ? NAMED_ONLY_SHARES : SHARES);
      expect(dek).not.toContain('itemized contributions');
      expect(dek).not.toContain('$200');
    }
  });

  it('carries a ballot-question filer’s own $500 line', () => {
    expect(dekText(copy.chartExplanation(false, true, true))).toBe(
      `${SHARES} ${BALLOT_DEFINITION}`,
    );
    expect(dekText(namedMoneyDefinition(true))).toBe(BALLOT_DEFINITION);
  });

  it('emphasises the 2 labels the money cards carry, and nothing else', () => {
    const bold = copy
      .chartExplanation(false, true, false)
      .filter((segment) => segment.bold)
      .map((segment) => segment.text);
    expect(bold).toEqual(['itemized contributions', 'non-itemized contributions']);
  });

  it('states when a name is required, never that a smaller donor goes unnamed', () => {
    // Rule 12: the threshold is a test on the donor's yearly total and a floor on who a
    // committee MUST name. Filer 18135's 2026 pre-general itemizes 215 donors at or under
    // $200, so a reader meeting a named $50 donation must not read our page as wrong.
    for (const isBallot of [false, true]) {
      const definition = dekText(namedMoneyDefinition(isBallot));
      expect(definition).toContain('for the year');
      expect(definition).toContain('a committee may name smaller donors');
      expect(definition).not.toMatch(/never named|not named|are never/i);
      expect(definition).not.toMatch(/under \$[25]00|below \$[25]00|less than \$[25]00/i);
    }
  });

  it('names what the chart leaves out rather than calling the rest cash', () => {
    // Every donated good or service is dropped from the slices and from the base they
    // divide by, so the exclusion is real and has to be stated. "Cash" is the Board's own
    // word and a reader can fairly read it as notes and coins.
    for (const namedOnly of [false, true]) {
      const dek = dekText(copy.chartExplanation(namedOnly, true, false));
      expect(dek).toContain('not counting donated goods and services');
      expect(dek).not.toMatch(/\bcash\b/i);
    }
  });
});

describe('the rule deciding whether a non-itemized figure draws at all', () => {
  const split = {
    state: 'shown',
    reportedTotal: '216054.0000',
    namedTotal: '151614.0000',
    unnamedTotal: '66840.0000',
  };

  it('draws beside a reported total the filing does not fully name', () => {
    expect(unnamedFigureDraws(split)).toBe(true);
  });

  it('draws for a filing that names every dollar, so the $0 carries its meaning', () => {
    expect(unnamedFigureDraws({ ...split, unnamedTotal: '0.00' })).toBe(true);
  });

  it('never turns a withheld or absent remainder into a figure', () => {
    expect(unnamedFigureDraws({ ...split, unnamedTotal: null })).toBe(false);
    for (const state of ['no_reported_total', 'sources_disagree', 'periods_differ']) {
      expect(unnamedFigureDraws({ ...split, state })).toBe(false);
    }
  });

  it('leaves a reported zero its own sentence instead of splitting nothing', () => {
    expect(
      unnamedFigureDraws({
        state: 'shown',
        reportedTotal: '0',
        namedTotal: null,
        unnamedTotal: '0',
      }),
    ).toBe(false);
  });
});
