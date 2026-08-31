import { describe, expect, it } from 'vitest';

import { AskAnswer } from '../../data/types';
import { askBillCardIds, currentAskBill, shouldRefreshBillQuery } from '../billFreshness';

describe('bill record freshness', () => {
  it.each([
    ['bill', '94-2025-SF1832'],
    ['bill-votes', '94-2025-SF1832'],
    ['bill-version-text', '94-2025-SF1832', '1st-engrossment'],
    ['bills', 'current'],
    ['featured-bills', ['94-2025-SF1832']],
    ['legislator-bills', 'melissa-hortman'],
    ['tracked-bills', 'reader-1'],
    ['saved-ask-suggestion', '94-2025-SF1832', 0],
  ])('refreshes %s records after the freshness window', (...queryKey) => {
    expect(shouldRefreshBillQuery(queryKey)).toBe(true);
  });

  it.each([
    ['ask', 'What changed?'],
    ['tracked-bills-last-visit', 'advancing', 'reader-1'],
    ['current-user', 'reader-1'],
  ])('does not treat %s as a bill-record read', (...queryKey) => {
    expect(shouldRefreshBillQuery(queryKey)).toBe(false);
  });

  it('deduplicates every bill shown in a free-form Ask answer', () => {
    const answer = {
      bills: [{ id: 'bill-1' }, { id: 'bill-2' }],
      billCards: [{ id: 'bill-2' }],
      latestActionBillCards: [{ id: 'bill-3' }],
      resolvedBill: { id: 'bill-4' },
      answeringBill: { id: 'bill-4' },
      answeringBillCard: { id: 'bill-5' },
    } as AskAnswer;

    expect(askBillCardIds(answer)).toEqual(['bill-1', 'bill-2', 'bill-3', 'bill-4', 'bill-5']);
  });

  it('replaces an Ask card with the current bill record when one arrived', () => {
    const oldCard = { id: 'bill-1', status: 'Introduced', lastPulledAt: '2026-08-11' };
    const currentCard = { id: 'bill-1', status: 'Signed into law' };
    const currentById = new Map([['bill-1', currentCard]]);

    expect(currentAskBill(oldCard, currentById)).toEqual({
      id: 'bill-1',
      status: 'Signed into law',
      lastPulledAt: '2026-08-11',
    });
    expect(currentAskBill({ id: 'bill-2', status: 'Introduced' }, currentById)).toEqual({
      id: 'bill-2',
      status: 'Introduced',
    });
  });
});
