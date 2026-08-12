import { plainBillSummary } from './billDetail';
import type { Bill } from '../data/types';

/** The current public-record fields shown by the signed-out Home hero. */
export function homeHeroBillFacts(bill: Bill) {
  const sponsor = bill.sponsors?.[0];
  return {
    identifier: bill.identifier,
    status: bill.status,
    effectiveDate: bill.effectiveDate,
    author: sponsor
      ? {
          name: sponsor.name,
          id: sponsor.slug ?? sponsor.legislatorId,
        }
      : undefined,
    summary: plainBillSummary(bill.aiAnalysis?.summary),
  };
}
