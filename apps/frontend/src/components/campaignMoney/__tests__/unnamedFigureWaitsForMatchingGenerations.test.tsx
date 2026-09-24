// @vitest-environment jsdom
/**
 * The non-itemized figure waits when our 2 copies were taken on different days (#2344).
 *
 * The committee page and the legislator profile's money tab both draw the money-in card
 * from `MoneyInBlock`, one with `surface="committee"` and one with `surface="profile"`.
 * When the server says the live totals copy is not the one the payment files were
 * checked against, both surfaces must draw the reported total and the itemized figure
 * with nothing worked out between them, and the one sentence saying why the comparison
 * waits. Rendered rather than source-checked: what is pinned is what a reader meets.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Path: () => <path />,
}));

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

import { MoneyInBlock } from '../MoneyCards';
import {
  MONEY_IN_NAMED_LABEL,
  MONEY_IN_REPORTED_LABEL,
  MONEY_IN_UNNAMED_LABEL,
} from '../../../lib/committeeMoneyShared';
import { splitExplanation, statedSplitNote } from '../../../lib/legislatorCampaignMoney';

/** Restore Sanity's 2026 figures on 23 Sep 2026: a total through 15 Sep beside payments
 *  from a 1 Sep file, which the live page then subtracted (issue 2344). */
const waiting = {
  state: 'generations_differ' as const,
  reportedTotal: '14111000.0000',
  reportedThrough: '2026-09-15',
  namedTotal: '1226000.0000',
  namedInKindTotal: '0.0000',
  unnamedTotal: null,
  statedSplitState: 'not_checked',
  firstPaymentOn: '2026-01-06',
  lastPaymentOn: '2026-08-20',
};

const moneyIn = {
  state: 'reported' as const,
  otherReceipts: [],
  sourceUrl: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
};

const text = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return (host.textContent ?? '').replace(/\s+/g, ' ');
};

const render = (surface: 'committee' | 'profile') =>
  text(
    renderToStaticMarkup(
      <MoneyInBlock
        surface={surface}
        split={waiting}
        moneyIn={moneyIn}
        isBallot={false}
        stampThrough="2026-09-15"
        isMobile={false}
      />,
    ),
  );

describe.each(['committee', 'profile'] as const)(
  'the money-in card on the %s surface',
  (surface) => {
    const sentence = splitExplanation('generations_differ') ?? '';
    const html = render(surface);

    it('draws both source figures with nothing worked out between them', () => {
      expect(html).toContain(MONEY_IN_REPORTED_LABEL);
      expect(html).toContain('$14,111,000');
      expect(html).toContain(MONEY_IN_NAMED_LABEL);
      expect(html).toContain('$1,226,000');
      expect(html).not.toContain(MONEY_IN_UNNAMED_LABEL);
      expect(html).not.toContain('$12,885,000');
      expect(html).not.toMatch(/\d%/);
    });

    it('says why the comparison waits, once, and nothing about a filing being unchecked', () => {
      expect(sentence).not.toBe('');
      expect(html).toContain(sentence);
      expect(html.split(sentence).length - 1).toBe(1);
      // The "not yet compared" note belongs under a drawn remainder and there is none.
      expect(html).not.toContain(statedSplitNote('not_checked') ?? '');
    });
  },
);
