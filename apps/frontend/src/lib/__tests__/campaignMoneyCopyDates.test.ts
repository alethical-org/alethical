import { describe, expect, it } from 'vitest';
import { paymentFilesDownloadedLine } from '../campaignMoneyDetailsPageCopy';

const day = 'Sep 1, 2026';

describe('payment and report source copy dates', () => {
  it('names both independent copy dates and separates them from coverage', () => {
    expect(paymentFilesDownloadedLine(day, 'Aug 11, 2026')).toBe(
      'Minnesota’s payment files copied Sep 1,\u00a02026; report totals copied ' +
        'Aug 11,\u00a02026. These are copy dates, not reporting periods.',
    );
  });

  it.each([null, undefined])('retains the one-date fallback for %s', (reportDay) => {
    expect(paymentFilesDownloadedLine(day, reportDay)).toBe(
      'Minnesota’s payment files copied Sep 1,\u00a02026. This is a copy date, not a reporting period. The report totals were copied separately.',
    );
  });

  it('still names both sources when they were copied on the same date', () => {
    expect(paymentFilesDownloadedLine(day, day)).toContain(
      'Sep 1,\u00a02026; report totals copied Sep 1,\u00a02026.',
    );
  });
});
