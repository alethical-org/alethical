import { describe, expect, it } from 'vitest';
import { paymentCopyLines, paymentSourceCopyLines } from '../paymentCopyDates';
import { committeeOutsideSpending } from '../committeeOutsideSpending';
import { committeeFinanceFromPayload } from '../../data/api';
import { nameSearchGroups } from '../../data/moneyNameSearch';

const fresh = '2026-10-24T18:00:00Z';
const older = '2026-10-09T18:00:00Z';
const dates = { contributions: fresh, expenditures: older, independentExpenditures: older };

describe('independent source file copy dates', () => {
  it('keeps current contributions beside retained spending with exact source labels', () => {
    expect(paymentCopyLines(dates)).toEqual([
      'Contributions file copied Oct 24,\u00a02026',
      'Spending file copied Oct 9,\u00a02026',
      'Outside-spending file copied Oct 9,\u00a02026',
    ]);
  });
  it('groups only known dates on the same Minnesota day', () => {
    expect(
      paymentSourceCopyLines({
        contributions: fresh,
        expenditures: fresh,
        independentExpenditures: '2026-10-25T02:00:00Z',
      }),
    ).toEqual(['Campaign payment files last copied: Oct 24, 2026']);
    expect(paymentSourceCopyLines({ ...dates, expenditures: null })).toContain(
      'Spending file copy date unavailable',
    );
    expect(paymentCopyLines()).toEqual([
      'Contributions file copy date unavailable',
      'Spending file copy date unavailable',
      'Outside-spending file copy date unavailable',
    ]);
  });
  it('uses the outside file date in committee summaries and never falls back to a root date', () => {
    const money = committeeFinanceFromPayload({
      registration_number: '17868',
      year: 2026,
      fetched_at: fresh,
      payment_copied_at: {
        contributions: fresh,
        expenditures: older,
        independent_expenditures: older,
      },
    });
    expect(money.paymentCopiedAt).toEqual(dates);
    expect(committeeOutsideSpending(money).fetchedAt).toBe(older);
    const oldResponse = committeeFinanceFromPayload({
      registration_number: '17868',
      year: 2026,
      fetched_at: fresh,
    });
    expect(committeeOutsideSpending(oldResponse).fetchedAt).toBeNull();
    expect(oldResponse.paymentCopiedAt).toEqual({
      contributions: null,
      expenditures: null,
      independentExpenditures: null,
    });
  });
  it('keeps each searched payment group’s source date, including missing dates', () => {
    const groups = nameSearchGroups([
      { kind: 'gave', fetched_at: fresh },
      { kind: 'got_paid', fetched_at: older },
      { kind: 'got_paid_independent' },
    ]);
    expect(groups.map((group) => group.fetchedAt)).toEqual([fresh, older, null]);
  });
});
