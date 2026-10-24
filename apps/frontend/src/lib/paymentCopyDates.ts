import type { PaymentCopyDates } from '../data/types';
import { centralDateLabel } from './moneyLanding';
import { paymentFilesDownloadedLine } from './campaignMoneyDetailsPageCopy';

export const PAYMENT_FILE_LABELS = {
  contributions: 'Contributions file',
  expenditures: 'Spending file',
  independentExpenditures: 'Outside-spending file',
} as const;

export function paymentFileCopyLine(source: keyof PaymentCopyDates, copiedAt?: string | null) {
  const label = PAYMENT_FILE_LABELS[source];
  return copiedAt
    ? `${label} copied ${centralDateLabel(copiedAt).replace(/,\s/, ',\u00a0')}`
    : `${label} copy date unavailable`;
}

/** Group only equally dated sources; never borrow a release's date for a missing slot. */
export function paymentCopyLines(
  dates?: PaymentCopyDates,
  reportTotalsDay?: string | null,
): string[] {
  const keys = Object.keys(PAYMENT_FILE_LABELS) as (keyof PaymentCopyDates)[];
  const days = keys.map((key) => (dates?.[key] ? centralDateLabel(dates[key]!) : null));
  if (days[0] && days.every((day) => day === days[0])) {
    return [paymentFilesDownloadedLine(days[0], reportTotalsDay)];
  }
  return [
    ...keys.map((key) => paymentFileCopyLine(key, dates?.[key])),
    ...(reportTotalsDay
      ? [`Report totals copied ${reportTotalsDay}. This is a copy date, not a reporting period.`]
      : []),
  ];
}

/** The sources panel already explains copy dates and dates report totals separately. */
export function paymentSourceCopyLines(dates?: PaymentCopyDates): string[] {
  const keys = Object.keys(PAYMENT_FILE_LABELS) as (keyof PaymentCopyDates)[];
  const days = keys.map((key) => (dates?.[key] ? centralDateLabel(dates[key]!) : null));
  return days[0] && days.every((day) => day === days[0])
    ? [`Campaign payment files last copied: ${days[0]}`]
    : keys.map((key) => paymentFileCopyLine(key, dates?.[key]));
}
