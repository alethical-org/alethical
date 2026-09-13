import { describe, expect, it } from 'vitest';
import { paymentFilesDownloadedLine } from '../campaignMoneyDetailsPageCopy';

const day = 'Sep 1, 2026';

describe('payment and report source copy dates', () => {
  it('names both independent copy dates and separates them from coverage', () => {
    expect(paymentFilesDownloadedLine(day, 'Aug 11, 2026')).toBe(
      'We downloaded Minnesota’s payment files on Sep 1,\u00a02026 and its report totals on ' +
        'Aug 11,\u00a02026. Neither is the period the money covers.',
    );
  });

  it.each([null, undefined])('retains the one-date fallback for %s', (reportDay) => {
    expect(paymentFilesDownloadedLine(day, reportDay)).toBe(
      'We downloaded Minnesota’s payment files on Sep 1,\u00a02026, which is not the period ' +
        'the money covers. The report totals were copied separately.',
    );
  });

  it('still names both sources when they were copied on the same date', () => {
    expect(paymentFilesDownloadedLine(day, day)).toContain(
      'on Sep 1,\u00a02026 and its report totals on Sep 1,\u00a02026.',
    );
  });
});
