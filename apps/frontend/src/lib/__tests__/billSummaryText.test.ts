import { describe, expect, it } from 'vitest';

import { billDescriptionLines, restatesTitle } from '../billSummaryText';

describe('what a bill tells a search engine and a share card', () => {
  it('gives both the summary sentence when it adds to the title', () => {
    expect(
      billDescriptionLines(
        'Statewide Capital Projects and Bonding Bill',
        'Authorizes billions in state bond financing for construction and renovation projects. More follows.',
      ),
    ).toEqual({
      search:
        'Authorizes billions in state bond financing for construction and renovation projects.',
      card: 'Authorizes billions in state bond financing for construction and renovation projects.',
    });
  });

  it('holds the card back when the sentence only says the title again', () => {
    // The card shows the title directly above this line, so the 2 together would
    // say one thing twice (Eugene, 17 Sep 2026). A search result shows no title
    // of ours beside it, so it still gets the sentence.
    expect(
      billDescriptionLines(
        'Peace Officers Must Be US Citizens',
        'Sets a rule that new peace officer license applicants in Minnesota must be U.S. citizens. More follows.',
      ),
    ).toEqual({
      search:
        'Sets a rule that new peace officer license applicants in Minnesota must be U.S. citizens.',
      card: '',
    });
  });

  it('gives neither a line when the bill has no summary', () => {
    expect(billDescriptionLines('Education funding', null)).toEqual({ search: '', card: '' });
  });

  it('judges a restatement by the title words the sentence carries', () => {
    expect(
      restatesTitle(
        'Peace Officers Must Be US Citizens',
        'Sets a rule that new peace officer license applicants in Minnesota must be U.S. citizens.',
      ),
    ).toBe(true);
    expect(
      restatesTitle(
        'Statewide Capital Projects and Bonding Bill',
        'Authorizes billions in state bond financing for construction and renovation projects spread across nearly every part of state government.',
      ),
    ).toBe(false);
    expect(
      restatesTitle(
        'New Rules For Minors\u2019 Social Media Accounts',
        'Large social media platforms will have to publicly explain how their algorithms, notifications, and engagement features work.',
      ),
    ).toBe(false);
    // No title to restate: the sentence always adds something.
    expect(restatesTitle('', 'Authorizes borrowing.')).toBe(false);
  });
});
